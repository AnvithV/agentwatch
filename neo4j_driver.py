"""
Neo4j Driver — Person 2 owns this file.
Tries Neo4j first, gracefully falls back to in-memory if Neo4j is unreachable.
"""

import json
from datetime import datetime, timezone
from collections import defaultdict

import config

# ---------------------------------------------------------------------------
# In-memory fallback store
# ---------------------------------------------------------------------------
_agent_steps: dict[str, list[dict]] = defaultdict(list)

# Set to True to attempt Neo4j connection (falls back automatically on failure)
USE_NEO4J = True

# Neo4j driver (initialized lazily)
_driver = None
_neo4j_available = True  # flipped to False after first connection failure


def _get_driver():
    global _driver, _neo4j_available
    if not _neo4j_available:
        return None
    if _driver is None:
        try:
            from neo4j import GraphDatabase
            _driver = GraphDatabase.driver(
                config.NEO4J_URI,
                auth=(config.NEO4J_USER, config.NEO4J_PASSWORD),
            )
            # Test the connection
            _driver.verify_connectivity()
            print(f"[Neo4j] Connected to {config.NEO4J_URI}")
        except Exception as e:
            print(f"[Neo4j] Connection failed, using in-memory fallback: {e}")
            _driver = None
            _neo4j_available = False
    return _driver


# ---------------------------------------------------------------------------
# Log Step
# ---------------------------------------------------------------------------
async def log_step(telemetry: dict, decision: dict) -> None:
    """Writes an AgentStep node to Neo4j (or in-memory fallback)."""
    agent_id = telemetry["agent_id"]

    step = {
        "step_id": telemetry["step_id"],
        "timestamp": telemetry.get("timestamp", datetime.now(timezone.utc).isoformat()),
        "thought": telemetry["thought"],
        "tool_used": telemetry["tool_used"],
        "input_parameters": json.dumps(telemetry["input_parameters"]),
        "observation": telemetry.get("observation", ""),
        "decision": decision.get("decision", ""),
        "reason": decision.get("reason", ""),
        "triggered_by": decision.get("triggered_by", ""),
    }

    if USE_NEO4J:
        driver = _get_driver()
        if driver:
            try:
                with driver.session() as session:
                    session.run(
                        """
                        MERGE (a:Agent {agent_id: $agent_id})
                        MERGE (s:AgentStep {step_id: $step_id})
                        SET s.timestamp = $timestamp,
                            s.thought = $thought,
                            s.tool_used = $tool_used,
                            s.input_parameters = $input_parameters,
                            s.observation = $observation,
                            s.decision = $decision,
                            s.reason = $reason,
                            s.triggered_by = $triggered_by
                        MERGE (a)-[:HAS_STEP]->(s)
                        WITH a, s
                        OPTIONAL MATCH (a)-[:HAS_STEP]->(prev:AgentStep)
                        WHERE prev.step_id <> s.step_id
                        WITH s, prev ORDER BY prev.timestamp DESC LIMIT 1
                        FOREACH (_ IN CASE WHEN prev IS NOT NULL THEN [1] ELSE [] END |
                            MERGE (prev)-[:NEXT]->(s)
                        )
                        """,
                        agent_id=agent_id,
                        **step,
                    )
                return
            except Exception as e:
                print(f"[Neo4j] log_step failed, using in-memory fallback: {e}")

    # In-memory fallback — upsert by step_id
    existing = next(
        (i for i, s in enumerate(_agent_steps[agent_id]) if s["step_id"] == step["step_id"]),
        None,
    )
    if existing is not None:
        _agent_steps[agent_id][existing] = step
    else:
        _agent_steps[agent_id].append(step)


# ---------------------------------------------------------------------------
# Loop Detection (Circuit Breaker)
# ---------------------------------------------------------------------------
async def check_for_loops(agent_id: str, tool_used: str, input_parameters: dict) -> bool:
    """Returns True if agent repeated same tool+params 3x in last 5 steps."""
    params_str = json.dumps(input_parameters, sort_keys=True)

    if USE_NEO4J:
        driver = _get_driver()
        if driver:
            try:
                with driver.session() as session:
                    result = session.run(
                        """
                        MATCH (a:Agent {agent_id: $agent_id})-[:HAS_STEP]->(s:AgentStep)
                        WITH s ORDER BY s.timestamp DESC LIMIT $window
                        WITH collect(s) AS steps
                        UNWIND steps AS step
                        WITH step WHERE step.tool_used = $tool_used
                             AND step.input_parameters = $input_parameters
                        RETURN count(step) AS repeat_count
                        """,
                        agent_id=agent_id,
                        tool_used=tool_used,
                        input_parameters=params_str,
                        window=config.LOOP_WINDOW,
                    )
                    record = result.single()
                    return record and record["repeat_count"] >= config.LOOP_THRESHOLD
            except Exception as e:
                print(f"[Neo4j] check_for_loops failed, using in-memory fallback: {e}")

    # In-memory fallback
    steps = _agent_steps.get(agent_id, [])
    recent = steps[-config.LOOP_WINDOW:]
    repeat_count = sum(
        1
        for s in recent
        if s["tool_used"] == tool_used and s["input_parameters"] == params_str
    )
    return repeat_count >= config.LOOP_THRESHOLD


# ---------------------------------------------------------------------------
# Graph Query
# ---------------------------------------------------------------------------
async def get_agent_graph(agent_id: str) -> dict:
    """Returns nodes + edges for the reasoning graph of a given agent."""

    if USE_NEO4J:
        driver = _get_driver()
        if driver:
            try:
                nodes = []
                edges = []
                with driver.session() as session:
                    result = session.run(
                        """
                        MATCH (a:Agent {agent_id: $agent_id})-[:HAS_STEP]->(s:AgentStep)
                        OPTIONAL MATCH (s)-[:NEXT]->(next:AgentStep)
                        RETURN s, next ORDER BY s.timestamp
                        """,
                        agent_id=agent_id,
                    )
                    for record in result:
                        step = record["s"]
                        nodes.append(dict(step))
                        if record["next"]:
                            edges.append({
                                "from": step["step_id"],
                                "to": record["next"]["step_id"],
                                "relationship": "NEXT",
                            })
                return {"agent_id": agent_id, "nodes": nodes, "edges": edges}
            except Exception as e:
                print(f"[Neo4j] get_agent_graph failed, using in-memory fallback: {e}")

    # In-memory fallback
    steps = _agent_steps.get(agent_id, [])
    nodes = [dict(s) for s in steps]
    edges = []
    for i in range(len(steps) - 1):
        edges.append({
            "from": steps[i]["step_id"],
            "to": steps[i + 1]["step_id"],
            "relationship": "NEXT",
        })
    return {"agent_id": agent_id, "nodes": nodes, "edges": edges}
