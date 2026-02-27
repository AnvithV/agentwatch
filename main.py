from datetime import datetime, timezone

from fastapi import FastAPI

from models import TelemetryEvent, GovernanceDecision
from governance import run_governance_pipeline, extract_entities, check_policy
from neo4j_driver import log_step, check_for_loops, get_agent_graph

app = FastAPI(title="AgentWatch", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/v1/telemetry", response_model=GovernanceDecision)
async def receive_telemetry(event: TelemetryEvent):
    telemetry = event.model_dump()
    # Ensure timestamp is a string for Neo4j/JSON storage
    if isinstance(telemetry.get("timestamp"), datetime):
        telemetry["timestamp"] = telemetry["timestamp"].isoformat()

    # 1. Pre-log the step so loop detection can see it
    await log_step(telemetry, {"decision": "PENDING", "reason": "", "triggered_by": ""})

    # 2. Check for loops (fastest check — short-circuit)
    is_loop = await check_for_loops(
        event.agent_id, event.tool_used, event.input_parameters
    )

    if is_loop:
        decision = GovernanceDecision(
            agent_id=event.agent_id,
            step_id=event.step_id,
            decision="HALT",
            reason="LOOP_DETECTED",
            details=f"Agent repeated {event.tool_used} with same params 3+ times",
            triggered_by="neo4j_loop_check",
            timestamp=datetime.now(timezone.utc),
        )
    else:
        # 3. Run full governance pipeline
        decision = await run_governance_pipeline(telemetry)

    # 4. Update the step with the final decision
    await log_step(telemetry, decision.model_dump())

    return decision


@app.get("/api/v1/agent/{agent_id}/graph")
async def get_graph(agent_id: str):
    graph = await get_agent_graph(agent_id)
    return graph
