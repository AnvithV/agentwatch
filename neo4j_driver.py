"""
Neo4j Driver — Person 2 owns this file.
Async Neo4j driver with graceful in-memory fallback if Neo4j is unreachable.
"""

import json
from datetime import datetime, timezone
from typing import Optional
from collections import defaultdict

from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

# ---------------------------------------------------------------------------
# In-memory fallback store (used when Neo4j is unavailable)
# ---------------------------------------------------------------------------
_fallback_steps: dict[str, list[dict]] = defaultdict(list)
_fallback_influences: list[dict] = []  # Cross-agent INFLUENCES edges
_neo4j_available: bool = True


async def clear_all_data():
    """Clear all data - both in-memory fallback and Neo4j."""
    global _fallback_steps, _fallback_influences, _driver

    # Clear in-memory fallback
    _fallback_steps.clear()
    _fallback_influences.clear()
    print("[Neo4j] Cleared in-memory fallback data")

    # Clear Neo4j if connected
    if _driver and _driver.driver:
        try:
            async with _driver.driver.session() as session:
                await session.run("MATCH (n) DETACH DELETE n")
                print("[Neo4j] Cleared all Neo4j data")
        except Exception as e:
            print(f"[Neo4j] Failed to clear Neo4j: {e}")


class Neo4jDriver:
    """Async Neo4j driver for AgentWatch telemetry storage and loop detection."""

    def __init__(self):
        self.driver = None

    async def connect(self) -> bool:
        """Initialize the Neo4j async driver. Returns True if connected, False if fallback."""
        global _neo4j_available
        try:
            from neo4j import AsyncGraphDatabase
            self.driver = AsyncGraphDatabase.driver(
                NEO4J_URI,
                auth=(NEO4J_USER, NEO4J_PASSWORD)
            )
            # Verify connectivity
            async with self.driver.session() as session:
                result = await session.run("RETURN 'connected' AS status")
                record = await result.single()
                print(f"[Neo4j] {record['status']} to {NEO4J_URI}")
            _neo4j_available = True
            return True
        except Exception as e:
            print(f"[Neo4j] Connection failed: {e}")
            print("[Neo4j] Using in-memory fallback")
            _neo4j_available = False
            self.driver = None
            return False

    async def close(self):
        """Close the Neo4j driver."""
        if self.driver:
            await self.driver.close()

    async def log_step(self, telemetry: dict, decision: dict) -> None:
        """
        Write an AgentStep node to Neo4j with telemetry + decision data.
        Falls back to in-memory if Neo4j unavailable.
        """
        # Convert timestamp to ISO string if it's a datetime object
        timestamp = telemetry.get("timestamp")
        if isinstance(timestamp, datetime):
            timestamp = timestamp.isoformat()
        elif timestamp is None:
            timestamp = datetime.now(timezone.utc).isoformat()

        step_data = {
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
            "triggered_by": decision.get("triggered_by", ""),
            # Cross-agent causal chain
            "parent_step_id": telemetry.get("parent_step_id"),
            "parent_agent_id": telemetry.get("parent_agent_id"),
        }

        # Try Neo4j first
        if self.driver and _neo4j_available:
            try:
                async with self.driver.session() as session:
                    query = """
                    MERGE (a:Agent {agent_id: $agent_id})
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
                    CREATE (a)-[:HAS_STEP]->(s)
                    WITH a, s
                    OPTIONAL MATCH (a)-[:HAS_STEP]->(prev:AgentStep)
                    WHERE prev.step_id <> s.step_id
                    WITH a, s, prev ORDER BY prev.timestamp DESC LIMIT 1
                    FOREACH (_ IN CASE WHEN prev IS NOT NULL THEN [1] ELSE [] END |
                        CREATE (prev)-[:NEXT]->(s)
                    )
                    RETURN s.step_id AS step_id
                    """
                    result = await session.run(query, step_data)
                    record = await result.single()
                    print(f"[Neo4j] Logged step: {record['step_id']}")
                    return
            except Exception as e:
                print(f"[Neo4j] Write failed, using fallback: {e}")

        # Fallback to in-memory
        agent_id = telemetry.get("agent_id")
        _fallback_steps[agent_id].append(step_data)
        print(f"[Fallback] Logged step: {step_data['step_id']}")

        # Create INFLUENCES edge if this step references a parent from another agent
        parent_step_id = telemetry.get("parent_step_id")
        parent_agent_id = telemetry.get("parent_agent_id")
        if parent_step_id and parent_agent_id and parent_agent_id != agent_id:
            _fallback_influences.append({
                "source_agent_id": parent_agent_id,
                "source_step_id": parent_step_id,
                "target_agent_id": agent_id,
                "target_step_id": step_data["step_id"],
                "type": "INFLUENCES"
            })
            print(f"[Fallback] Created INFLUENCES edge: {parent_agent_id} → {agent_id}")

    async def check_for_loops(self, agent_id: str, tool_used: str, input_parameters: dict) -> bool:
        """
        Check if agent repeated same tool+params 3x in last 5 steps.
        Returns True if loop detected (circuit breaker should fire).
        """
        input_params_json = json.dumps(input_parameters)

        # Try Neo4j first
        if self.driver and _neo4j_available:
            try:
                async with self.driver.session() as session:
                    query = """
                    MATCH (a:Agent {agent_id: $agent_id})-[:HAS_STEP]->(s:AgentStep)
                    WITH s ORDER BY s.timestamp DESC LIMIT 5
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
                        "input_parameters": input_params_json
                    }
                    result = await session.run(query, params)
                    record = await result.single()
                    repeat_count = record["repeat_count"] if record else 0
                    is_loop = repeat_count >= 3
                    if is_loop:
                        print(f"[Neo4j] LOOP DETECTED: {agent_id} repeated {tool_used} {repeat_count}x")
                    return is_loop
            except Exception as e:
                print(f"[Neo4j] Loop check failed, using fallback: {e}")

        # Fallback to in-memory
        steps = _fallback_steps.get(agent_id, [])
        recent = steps[-5:] if len(steps) >= 5 else steps
        repeat_count = sum(
            1 for s in recent
            if s["tool_used"] == tool_used and s["input_parameters"] == input_params_json
        )
        is_loop = repeat_count >= 3
        if is_loop:
            print(f"[Fallback] LOOP DETECTED: {agent_id} repeated {tool_used} {repeat_count}x")
        return is_loop

    async def get_agent_graph(self, agent_id: str) -> dict:
        """
        Return nodes + edges for the reasoning graph of a given agent.
        Format suitable for visualization.
        """
        # Try Neo4j first
        if self.driver and _neo4j_available:
            try:
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

                    edges = [e for e in record["edges"] if e is not None]
                    return {
                        "agent_id": record["agent_id"],
                        "nodes": record["nodes"],
                        "edges": edges
                    }
            except Exception as e:
                print(f"[Neo4j] Graph query failed, using fallback: {e}")

        # Fallback to in-memory - filter out PENDING steps and dedupe by step_id
        steps = _fallback_steps.get(agent_id, [])

        # Keep only the final decision for each step_id (not PENDING)
        step_map = {}
        for s in steps:
            if s["decision"] != "PENDING":
                step_map[s["step_id"]] = s

        final_steps = list(step_map.values())
        # Sort by timestamp
        final_steps.sort(key=lambda x: x.get("timestamp", ""))

        nodes = [
            {
                "id": s["step_id"],
                "thought": s["thought"],
                "tool_used": s["tool_used"],
                "input_parameters": s["input_parameters"],
                "observation": s["observation"],
                "decision": s["decision"],
                "reason": s["reason"],
                "details": s.get("details", ""),
                "timestamp": s["timestamp"]
            }
            for s in final_steps
        ]
        edges = [
            {"source": final_steps[i]["step_id"], "target": final_steps[i+1]["step_id"], "type": "NEXT"}
            for i in range(len(final_steps) - 1)
        ]
        return {"agent_id": agent_id, "nodes": nodes, "edges": edges}

    async def get_halted_steps(self, agent_id: str) -> list:
        """Get all HALTed steps for an agent (useful for debugging)."""
        if self.driver and _neo4j_available:
            try:
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
            except Exception as e:
                print(f"[Neo4j] Query failed, using fallback: {e}")

        # Fallback
        steps = _fallback_steps.get(agent_id, [])
        return [
            {"thought": s["thought"], "reason": s["reason"], "timestamp": s["timestamp"]}
            for s in steps if s["decision"] == "HALT"
        ]

    async def clear_agent_data(self, agent_id: str) -> None:
        """Clear all data for an agent (useful for testing)."""
        if self.driver and _neo4j_available:
            try:
                async with self.driver.session() as session:
                    query = """
                    MATCH (a:Agent {agent_id: $agent_id})-[:HAS_STEP]->(s:AgentStep)
                    DETACH DELETE s
                    WITH a
                    DELETE a
                    """
                    await session.run(query, {"agent_id": agent_id})
                    print(f"[Neo4j] Cleared data for agent: {agent_id}")
                    return
            except Exception as e:
                print(f"[Neo4j] Clear failed, using fallback: {e}")

        # Fallback
        if agent_id in _fallback_steps:
            del _fallback_steps[agent_id]
            print(f"[Fallback] Cleared data for agent: {agent_id}")

    async def get_stats(self) -> dict:
        """Get aggregated governance statistics."""
        if self.driver and _neo4j_available:
            try:
                async with self.driver.session() as session:
                    query = """
                    MATCH (s:AgentStep)
                    WHERE s.decision IN ['PROCEED', 'HALT']
                    WITH s.decision AS decision, s.reason AS reason, count(*) AS cnt
                    RETURN decision, reason, cnt
                    ORDER BY cnt DESC
                    """
                    result = await session.run(query)
                    records = await result.data()

                    stats = {
                        "total_steps": 0,
                        "proceed_count": 0,
                        "halt_count": 0,
                        "violations_by_type": {}
                    }

                    for r in records:
                        stats["total_steps"] += r["cnt"]
                        if r["decision"] == "PROCEED":
                            stats["proceed_count"] += r["cnt"]
                        elif r["decision"] == "HALT":
                            stats["halt_count"] += r["cnt"]
                            reason = r["reason"] or "UNKNOWN"
                            stats["violations_by_type"][reason] = stats["violations_by_type"].get(reason, 0) + r["cnt"]

                    return stats
            except Exception as e:
                print(f"[Neo4j] Stats query failed: {e}")

        # Fallback
        stats = {"total_steps": 0, "proceed_count": 0, "halt_count": 0, "violations_by_type": {}}
        for agent_id, steps in _fallback_steps.items():
            for s in steps:
                if s["decision"] in ["PROCEED", "HALT"]:
                    stats["total_steps"] += 1
                    if s["decision"] == "PROCEED":
                        stats["proceed_count"] += 1
                    else:
                        stats["halt_count"] += 1
                        reason = s.get("reason", "UNKNOWN")
                        stats["violations_by_type"][reason] = stats["violations_by_type"].get(reason, 0) + 1
        return stats

    async def list_agents(self) -> dict:
        """List all agents with step counts."""
        if self.driver and _neo4j_available:
            try:
                async with self.driver.session() as session:
                    query = """
                    MATCH (a:Agent)-[:HAS_STEP]->(s:AgentStep)
                    WHERE s.decision IN ['PROCEED', 'HALT']
                    WITH a.agent_id AS agent_id,
                         count(*) AS total_steps,
                         sum(CASE WHEN s.decision = 'HALT' THEN 1 ELSE 0 END) AS halt_count,
                         max(s.timestamp) AS last_activity
                    RETURN agent_id, total_steps, halt_count, toString(last_activity) AS last_activity
                    ORDER BY last_activity DESC
                    """
                    result = await session.run(query)
                    records = await result.data()
                    return {"agents": records, "count": len(records)}
            except Exception as e:
                print(f"[Neo4j] List agents failed: {e}")

        # Fallback
        agents = []
        for agent_id, steps in _fallback_steps.items():
            halt_count = sum(1 for s in steps if s.get("decision") == "HALT")
            agents.append({
                "agent_id": agent_id,
                "total_steps": len(steps),
                "halt_count": halt_count,
                "last_activity": steps[-1]["timestamp"] if steps else None
            })
        return {"agents": agents, "count": len(agents)}

    async def get_cross_agent_graph(self) -> dict:
        """
        Return full multi-agent graph with INFLUENCES edges.
        Shows causal chains across agents.
        """
        # Try Neo4j first
        if self.driver and _neo4j_available:
            try:
                async with self.driver.session() as session:
                    query = """
                    MATCH (a:Agent)-[:HAS_STEP]->(s:AgentStep)
                    OPTIONAL MATCH (s)-[:INFLUENCES]->(target:AgentStep)<-[:HAS_STEP]-(targetAgent:Agent)
                    WITH a, s, target, targetAgent
                    ORDER BY s.timestamp
                    RETURN
                        a.agent_id AS agent_id,
                        collect(DISTINCT {
                            id: s.step_id,
                            agent_id: a.agent_id,
                            thought: s.thought,
                            tool_used: s.tool_used,
                            decision: s.decision,
                            reason: s.reason,
                            details: s.details,
                            timestamp: toString(s.timestamp)
                        }) AS nodes,
                        collect(DISTINCT CASE WHEN target IS NOT NULL THEN {
                            source: s.step_id,
                            source_agent: a.agent_id,
                            target: target.step_id,
                            target_agent: targetAgent.agent_id,
                            type: "INFLUENCES"
                        } ELSE NULL END) AS influences
                    """
                    result = await session.run(query)
                    records = await result.data()

                    all_nodes = []
                    all_edges = []
                    for r in records:
                        all_nodes.extend(r["nodes"])
                        all_edges.extend([e for e in r["influences"] if e is not None])

                    return {
                        "nodes": all_nodes,
                        "edges": all_edges,
                        "agent_count": len(records)
                    }
            except Exception as e:
                print(f"[Neo4j] Cross-agent graph query failed, using fallback: {e}")

        # Fallback to in-memory
        all_nodes = []
        for agent_id, steps in _fallback_steps.items():
            for s in steps:
                if s["decision"] in ["PROCEED", "HALT"]:
                    all_nodes.append({
                        "id": s["step_id"],
                        "agent_id": agent_id,
                        "thought": s["thought"],
                        "tool_used": s["tool_used"],
                        "decision": s["decision"],
                        "reason": s["reason"],
                        "details": s.get("details", ""),
                        "timestamp": s["timestamp"]
                    })

        return {
            "nodes": all_nodes,
            "edges": _fallback_influences.copy(),
            "agent_count": len(_fallback_steps)
        }


# ---------------------------------------------------------------------------
# Singleton + convenience functions
# ---------------------------------------------------------------------------
_driver: Optional[Neo4jDriver] = None


async def get_driver() -> Neo4jDriver:
    """Get or create the Neo4j driver singleton."""
    global _driver
    if _driver is None:
        _driver = Neo4jDriver()
        await _driver.connect()
    return _driver


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


async def get_stats() -> dict:
    """Returns aggregated governance statistics across all agents."""
    driver = await get_driver()
    return await driver.get_stats()


async def list_agents() -> dict:
    """Returns list of all agents with their step counts."""
    driver = await get_driver()
    return await driver.list_agents()


async def get_halted_steps(agent_id: str) -> list:
    """Returns all HALT steps for an agent."""
    driver = await get_driver()
    return await driver.get_halted_steps(agent_id)


async def get_cross_agent_graph() -> dict:
    """Returns full multi-agent graph with INFLUENCES edges."""
    driver = await get_driver()
    return await driver.get_cross_agent_graph()
