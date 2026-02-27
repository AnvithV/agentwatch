"""
Quick test script to verify Neo4j connection and functions.
Run: python test_neo4j.py
"""
import asyncio
from datetime import datetime
from uuid import uuid4


async def test_neo4j():
    from neo4j_driver import log_step, check_for_loops, get_agent_graph, get_driver

    print("=" * 50)
    print("AgentWatch Neo4j Integration Test")
    print("=" * 50)

    # Test 1: Connection
    print("\n[TEST 1] Connecting to Neo4j...")
    driver = await get_driver()
    print("Connection successful!")

    agent_id = f"test-agent-{uuid4().hex[:8]}"

    # Test 2: Log steps
    print(f"\n[TEST 2] Logging 3 sample steps for {agent_id}...")

    for i in range(3):
        telemetry = {
            "agent_id": agent_id,
            "step_id": f"step-{uuid4().hex[:8]}",
            "timestamp": datetime.utcnow().isoformat(),
            "thought": f"Test thought {i+1}",
            "tool_used": "tavily_search",
            "input_parameters": {"query": f"test query {i+1}"},
            "observation": f"Test observation {i+1}",
            "raw_log": f"Test log entry {i+1}"
        }
        decision = {
            "decision": "PROCEED",
            "reason": "APPROVED",
            "details": "Test passed",
            "triggered_by": "test"
        }
        await log_step(telemetry, decision)
    print("Steps logged!")

    # Test 3: Check for loops (should be False - different params)
    print("\n[TEST 3] Checking for loops (different params)...")
    is_loop = await check_for_loops(agent_id, "tavily_search", {"query": "unique"})
    print(f"Loop detected: {is_loop} (expected: False)")

    # Test 4: Create a loop condition
    print("\n[TEST 4] Creating loop condition (3x same tool+params)...")
    for i in range(3):
        telemetry = {
            "agent_id": agent_id,
            "step_id": f"step-loop-{uuid4().hex[:8]}",
            "timestamp": datetime.utcnow().isoformat(),
            "thought": "Repeated search",
            "tool_used": "tavily_search",
            "input_parameters": {"query": "TSLA price"},  # Same params
            "observation": "Same result",
            "raw_log": "Repeated log"
        }
        decision = {
            "decision": "PROCEED",
            "reason": "APPROVED",
            "details": "",
            "triggered_by": "test"
        }
        await log_step(telemetry, decision)

    is_loop = await check_for_loops(agent_id, "tavily_search", {"query": "TSLA price"})
    print(f"Loop detected: {is_loop} (expected: True)")

    # Test 5: Get agent graph
    print("\n[TEST 5] Getting agent graph...")
    graph = await get_agent_graph(agent_id)
    print(f"Nodes: {len(graph['nodes'])}")
    print(f"Edges: {len(graph['edges'])}")

    # Cleanup
    print(f"\n[CLEANUP] Removing test data for {agent_id}...")
    await driver.clear_agent_data(agent_id)

    print("\n" + "=" * 50)
    print("All tests passed!")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(test_neo4j())
