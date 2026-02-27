from contextlib import asynccontextmanager
from datetime import datetime, timezone

import aiohttp
from fastapi import FastAPI

import config
from models import TelemetryEvent, GovernanceDecision
from governance import run_governance_pipeline, extract_entities, check_policy
from neo4j_driver import log_step, check_for_loops, get_agent_graph

TRADING_POLICIES = """
AgentWatch Trading Policy Document

1. Budget Limits:
   - Maximum single trade cost: $100,000
   - Any trade exceeding $100,000 total cost must be HALTED immediately

2. Restricted Securities:
   - The following tickers are RESTRICTED and may NOT be traded: GME, AMC, BBBY
   - Any attempt to trade restricted tickers must be HALTED

3. Position Size Limits:
   - Maximum position size per trade: 1,000 shares
   - Any trade exceeding 1,000 shares must be HALTED

4. Allowed Actions:
   - Permitted actions: BUY, SELL, HOLD, RESEARCH
   - Any other action type must be HALTED for review

5. Risk Management:
   - Agents must not concentrate more than 20% of portfolio in a single ticker
   - Leveraged or margin trades are NOT permitted
"""


async def _check_senso_connection():
    """Verify Senso API is reachable and policies are ingested on startup."""
    if not config.SENSO_API_KEY or not config.SENSO_API_URL:
        print("[Senso] No API key configured, using local policy engine")
        return

    headers = {
        "X-API-Key": config.SENSO_API_KEY,
        "Content-Type": "application/json",
    }

    try:
        async with aiohttp.ClientSession() as session:
            # Test search with a policy query
            async with session.post(
                config.SENSO_API_URL,
                json={"query": "What is the maximum trade cost?", "max_results": 1},
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data.get("total_results", 0) > 0:
                        print(f"[Senso] Connected — {data['total_results']} policy chunks indexed")
                    else:
                        print("[Senso] Connected but no policies found — ingest policies via /org/ingestion/upload")
                        print("[Senso] Local policy engine active as fallback")
                else:
                    text = await resp.text()
                    print(f"[Senso] API returned {resp.status}: {text}")
                    print("[Senso] Using local policy engine as fallback")
    except Exception as e:
        print(f"[Senso] Could not connect: {e}")
        print("[Senso] Using local policy engine as fallback")


@asynccontextmanager
async def lifespan(app):
    # Startup: verify Senso connection and policy availability
    await _check_senso_connection()
    yield


app = FastAPI(title="AgentWatch", version="0.1.0", lifespan=lifespan)


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
