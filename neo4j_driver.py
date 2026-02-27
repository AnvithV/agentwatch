import json
from datetime import datetime
from typing import Optional
from neo4j import AsyncGraphDatabase
from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD


class Neo4jDriver:
    """Async Neo4j driver for AgentWatch telemetry storage and loop detection."""

    def __init__(self):
        self.driver = None

    async def connect(self):
        """Initialize the Neo4j async driver."""
        self.driver = AsyncGraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD)
        )
        # Verify connectivity
        async with self.driver.session() as session:
            result = await session.run("RETURN 'connected' AS status")
            record = await result.single()
            print(f"[Neo4j] {record['status']}")

    async def close(self):
        """Close the Neo4j driver."""
        if self.driver:
            await self.driver.close()

    async def log_step(self, telemetry: dict, decision: dict) -> None:
        """
        Write an AgentStep node to Neo4j with telemetry + decision data.
        Links step to Agent node and creates NEXT relationship for ordering.
        """
        async with self.driver.session() as session:
            query = """
            // Create or merge the Agent node
            MERGE (a:Agent {agent_id: $agent_id})

            // Create the new AgentStep node
            CREATE (s:AgentStep {
                step_id: $step_id,
                timestamp: datetime($timestamp),
                thought: $thought,
                tool_used: $tool_used,
                input_parameters: $input_parameters,
                observation: $observation,
                raw_log: $raw_log,
                decision: $decision,
                reason: $reason,
                details: $details,
                triggered_by: $triggered_by
            })

            // Link step to agent
            CREATE (a)-[:HAS_STEP]->(s)

            // Link to previous step for sequential ordering
            WITH a, s
            OPTIONAL MATCH (a)-[:HAS_STEP]->(prev:AgentStep)
            WHERE prev.step_id <> s.step_id
            WITH a, s, prev ORDER BY prev.timestamp DESC LIMIT 1
            FOREACH (_ IN CASE WHEN prev IS NOT NULL THEN [1] ELSE [] END |
                CREATE (prev)-[:NEXT]->(s)
            )

            RETURN s.step_id AS step_id
            """

            # Convert timestamp to ISO string if it's a datetime object
            timestamp = telemetry.get("timestamp")
            if isinstance(timestamp, datetime):
                timestamp = timestamp.isoformat()

            params = {
                "agent_id": telemetry.get("agent_id"),
                "step_id": telemetry.get("step_id"),
                "timestamp": timestamp,
                "thought": telemetry.get("thought", ""),
                "tool_used": telemetry.get("tool_used", ""),
                "input_parameters": json.dumps(telemetry.get("input_parameters", {})),
                "observation": telemetry.get("observation", ""),
                "raw_log": telemetry.get("raw_log", ""),
                "decision": decision.get("decision", ""),
                "reason": decision.get("reason", ""),
                "details": decision.get("details", ""),
                "triggered_by": decision.get("triggered_by", "")
            }

            result = await session.run(query, params)
            record = await result.single()
            print(f"[Neo4j] Logged step: {record['step_id']}")

    async def check_for_loops(self, agent_id: str, tool_used: str, input_parameters: dict) -> bool:
        """
        Check if agent repeated same tool+params 3x in last 5 steps.
        Returns True if loop detected (circuit breaker should fire).
        """
        async with self.driver.session() as session:
            query = """
            // Find last 5 steps for this agent
            MATCH (a:Agent {agent_id: $agent_id})-[:HAS_STEP]->(s:AgentStep)
            WITH s ORDER BY s.timestamp DESC LIMIT 5

            // Count how many used the same tool + same parameters
            WITH collect(s) AS steps
            UNWIND steps AS step
            WITH step
            WHERE step.tool_used = $tool_used
              AND step.input_parameters = $input_parameters
            RETURN count(step) AS repeat_count
            """

            params = {
                "agent_id": agent_id,
                "tool_used": tool_used,
                "input_parameters": json.dumps(input_parameters)
            }

            result = await session.run(query, params)
            record = await result.single()

            repeat_count = record["repeat_count"] if record else 0
            is_loop = repeat_count >= 3

            if is_loop:
                print(f"[Neo4j] LOOP DETECTED: {agent_id} repeated {tool_used} {repeat_count}x")

            return is_loop

    async def get_agent_graph(self, agent_id: str) -> dict:
        """
        Return nodes + edges for the reasoning graph of a given agent.
        Format suitable for visualization.
        """
        async with self.driver.session() as session:
            query = """
            MATCH (a:Agent {agent_id: $agent_id})-[:HAS_STEP]->(s:AgentStep)
            OPTIONAL MATCH (s)-[:NEXT]->(next:AgentStep)
            WITH a, s, next
            ORDER BY s.timestamp
            RETURN
                a.agent_id AS agent_id,
                collect(DISTINCT {
                    id: s.step_id,
                    thought: s.thought,
                    tool_used: s.tool_used,
                    input_parameters: s.input_parameters,
                    observation: s.observation,
                    decision: s.decision,
                    reason: s.reason,
                    timestamp: toString(s.timestamp)
                }) AS nodes,
                collect(DISTINCT CASE WHEN next IS NOT NULL THEN {
                    source: s.step_id,
                    target: next.step_id,
                    type: "NEXT"
                } ELSE NULL END) AS edges
            """

            result = await session.run(query, {"agent_id": agent_id})
            record = await result.single()

            if not record:
                return {"agent_id": agent_id, "nodes": [], "edges": []}

            # Filter out null edges
            edges = [e for e in record["edges"] if e is not None]

            return {
                "agent_id": record["agent_id"],
                "nodes": record["nodes"],
                "edges": edges
            }

    async def get_halted_steps(self, agent_id: str) -> list:
        """Get all HALTed steps for an agent (useful for debugging)."""
        async with self.driver.session() as session:
            query = """
            MATCH (a:Agent {agent_id: $agent_id})-[:HAS_STEP]->(s:AgentStep)
            WHERE s.decision = "HALT"
            RETURN s.thought AS thought, s.reason AS reason,
                   toString(s.timestamp) AS timestamp
            ORDER BY s.timestamp
            """

            result = await session.run(query, {"agent_id": agent_id})
            records = await result.data()
            return records

    async def clear_agent_data(self, agent_id: str) -> None:
        """Clear all data for an agent (useful for testing)."""
        async with self.driver.session() as session:
            query = """
            MATCH (a:Agent {agent_id: $agent_id})-[:HAS_STEP]->(s:AgentStep)
            DETACH DELETE s
            WITH a
            DELETE a
            """
            await session.run(query, {"agent_id": agent_id})
            print(f"[Neo4j] Cleared data for agent: {agent_id}")


# Singleton instance
_driver: Optional[Neo4jDriver] = None


async def get_driver() -> Neo4jDriver:
    """Get or create the Neo4j driver singleton."""
    global _driver
    if _driver is None:
        _driver = Neo4jDriver()
        await _driver.connect()
    return _driver


# Convenience functions matching the contract signatures
async def log_step(telemetry: dict, decision: dict) -> None:
    """Writes an AgentStep node to Neo4j with the telemetry + decision data."""
    driver = await get_driver()
    await driver.log_step(telemetry, decision)


async def check_for_loops(agent_id: str, tool_used: str, input_parameters: dict) -> bool:
    """Returns True if agent repeated same tool+params 3x in last 5 steps."""
    driver = await get_driver()
    return await driver.check_for_loops(agent_id, tool_used, input_parameters)


async def get_agent_graph(agent_id: str) -> dict:
    """Returns nodes + edges for the reasoning graph of a given agent."""
    driver = await get_driver()
    return await driver.get_agent_graph(agent_id)
