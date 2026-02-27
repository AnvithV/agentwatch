from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import aiohttp
from fastapi import FastAPI
from pydantic import BaseModel

import config
from models import TelemetryEvent, GovernanceDecision
from governance import run_governance_pipeline, extract_entities, check_policy
from neo4j_driver import log_step, check_for_loops, get_agent_graph

# ---------------------------------------------------------------------------
# Webhook Registry — stores callback URLs for agents
# ---------------------------------------------------------------------------
_webhook_registry: dict[str, str] = {}  # agent_id -> webhook_url


class WebhookConfig(BaseModel):
    agent_id: str
    webhook_url: str


async def _fire_webhook(agent_id: str, decision: GovernanceDecision):
    """Fire webhook on HALT to actively stop the agent."""
    webhook_url = _webhook_registry.get(agent_id) or _webhook_registry.get("*")
    if not webhook_url:
        return

    payload = {
        "event": "HALT",
        "agent_id": agent_id,
        "step_id": decision.step_id,
        "reason": decision.reason,
        "details": decision.details,
        "triggered_by": decision.triggered_by,
        "timestamp": decision.timestamp.isoformat(),
        "action": "STOP_AGENT",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                webhook_url,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status < 300:
                    print(f"[Webhook] Fired HALT to {webhook_url} — {resp.status}")
                else:
                    print(f"[Webhook] Failed: {resp.status}")
    except Exception as e:
        print(f"[Webhook] Error: {e}")

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

    # 5. Fire webhook if HALT (active circuit breaker)
    if decision.decision == "HALT":
        await _fire_webhook(event.agent_id, decision)

    return decision


@app.get("/api/v1/agent/{agent_id}/graph")
async def get_graph(agent_id: str):
    graph = await get_agent_graph(agent_id)
    return graph


@app.get("/api/v1/stats")
async def get_stats():
    """Get aggregated governance statistics."""
    from neo4j_driver import get_stats
    return await get_stats()


@app.get("/api/v1/agents")
async def list_agents():
    """List all agents with their step counts."""
    from neo4j_driver import list_agents
    return await list_agents()


@app.get("/api/v1/agent/{agent_id}/halts")
async def get_agent_halts(agent_id: str):
    """Get all HALT decisions for an agent with details."""
    from neo4j_driver import get_halted_steps
    halts = await get_halted_steps(agent_id)
    return {"agent_id": agent_id, "halts": halts, "count": len(halts)}


# ---------------------------------------------------------------------------
# Webhook Management — Active Circuit Breaker
# ---------------------------------------------------------------------------

@app.post("/api/v1/webhooks")
async def register_webhook(config: WebhookConfig):
    """
    Register a webhook URL for an agent.
    When AgentWatch issues a HALT, it will POST to this URL.
    Use agent_id="*" for a global catch-all webhook.
    """
    _webhook_registry[config.agent_id] = config.webhook_url
    return {
        "status": "registered",
        "agent_id": config.agent_id,
        "webhook_url": config.webhook_url,
    }


@app.get("/api/v1/webhooks")
async def list_webhooks():
    """List all registered webhooks."""
    return {"webhooks": _webhook_registry}


@app.delete("/api/v1/webhooks/{agent_id}")
async def delete_webhook(agent_id: str):
    """Remove a webhook registration."""
    if agent_id in _webhook_registry:
        del _webhook_registry[agent_id]
        return {"status": "deleted", "agent_id": agent_id}
    return {"status": "not_found", "agent_id": agent_id}


# ---------------------------------------------------------------------------
# Demo Webhook Receiver — Shows the circuit breaker in action
# ---------------------------------------------------------------------------
_halt_signals: list[dict] = []  # Store received HALT signals for demo


@app.post("/demo/webhook/halt")
async def demo_webhook_receiver(payload: dict):
    """
    Demo endpoint that receives HALT webhooks.
    In production, this would be your agent's control plane.
    """
    print(f"\n{'='*60}")
    print(f"🚨 HALT SIGNAL RECEIVED")
    print(f"   Agent: {payload.get('agent_id')}")
    print(f"   Reason: {payload.get('reason')}")
    print(f"   Details: {payload.get('details')}")
    print(f"   Action: {payload.get('action')}")
    print(f"{'='*60}\n")

    _halt_signals.append(payload)
    return {"status": "received", "action": "agent_stopped"}


@app.get("/demo/webhook/signals")
async def get_halt_signals():
    """View all HALT signals received by the demo webhook."""
    return {"signals": _halt_signals, "count": len(_halt_signals)}


# ---------------------------------------------------------------------------
# Policy Configuration API — Dynamic policy management
# ---------------------------------------------------------------------------

class PolicyUpdate(BaseModel):
    budget_limit: Optional[int] = None
    restricted_tickers: Optional[list[str]] = None
    max_position_size: Optional[int] = None
    allowed_actions: Optional[list[str]] = None


# Store default policies for reset
_DEFAULT_POLICIES = {
    "budget_limit": 100_000,
    "restricted_tickers": ["GME", "AMC", "BBBY"],
    "max_position_size": 1000,
    "allowed_actions": ["BUY", "SELL", "HOLD", "RESEARCH"],
}


@app.get("/api/v1/policies")
async def get_policies():
    """Get current policy configuration."""
    return {
        "policies": config.MOCK_POLICIES,
        "description": {
            "budget_limit": "Maximum single trade cost in USD",
            "restricted_tickers": "Tickers that cannot be traded",
            "max_position_size": "Maximum shares per trade",
            "allowed_actions": "Permitted action types",
        }
    }


@app.put("/api/v1/policies")
async def update_policies(update: PolicyUpdate):
    """Update policy configuration dynamically."""
    changes = []

    if update.budget_limit is not None:
        old = config.MOCK_POLICIES["budget_limit"]
        config.MOCK_POLICIES["budget_limit"] = update.budget_limit
        changes.append(f"budget_limit: ${old:,} → ${update.budget_limit:,}")

    if update.restricted_tickers is not None:
        old = config.MOCK_POLICIES["restricted_tickers"]
        config.MOCK_POLICIES["restricted_tickers"] = update.restricted_tickers
        changes.append(f"restricted_tickers: {old} → {update.restricted_tickers}")

    if update.max_position_size is not None:
        old = config.MOCK_POLICIES["max_position_size"]
        config.MOCK_POLICIES["max_position_size"] = update.max_position_size
        changes.append(f"max_position_size: {old} → {update.max_position_size}")

    if update.allowed_actions is not None:
        old = config.MOCK_POLICIES["allowed_actions"]
        config.MOCK_POLICIES["allowed_actions"] = update.allowed_actions
        changes.append(f"allowed_actions: {old} → {update.allowed_actions}")

    print(f"[Policy] Updated: {', '.join(changes)}")

    return {
        "status": "updated",
        "changes": changes,
        "current_policies": config.MOCK_POLICIES,
    }


@app.post("/api/v1/policies/reset")
async def reset_policies():
    """Reset policies to default values."""
    for key, value in _DEFAULT_POLICIES.items():
        config.MOCK_POLICIES[key] = value if not isinstance(value, list) else value.copy()

    print("[Policy] Reset to defaults")
    return {
        "status": "reset",
        "policies": config.MOCK_POLICIES,
    }


@app.post("/api/v1/policies/restricted-tickers/{ticker}")
async def add_restricted_ticker(ticker: str):
    """Add a ticker to the restricted list."""
    ticker = ticker.upper()
    if ticker not in config.MOCK_POLICIES["restricted_tickers"]:
        config.MOCK_POLICIES["restricted_tickers"].append(ticker)
        return {"status": "added", "ticker": ticker, "restricted_tickers": config.MOCK_POLICIES["restricted_tickers"]}
    return {"status": "already_exists", "ticker": ticker}


@app.delete("/api/v1/policies/restricted-tickers/{ticker}")
async def remove_restricted_ticker(ticker: str):
    """Remove a ticker from the restricted list."""
    ticker = ticker.upper()
    if ticker in config.MOCK_POLICIES["restricted_tickers"]:
        config.MOCK_POLICIES["restricted_tickers"].remove(ticker)
        return {"status": "removed", "ticker": ticker, "restricted_tickers": config.MOCK_POLICIES["restricted_tickers"]}
    return {"status": "not_found", "ticker": ticker}


# ---------------------------------------------------------------------------
# Audit & Export — Compliance reporting
# ---------------------------------------------------------------------------

@app.get("/api/v1/agent/{agent_id}/export")
async def export_agent_session(agent_id: str):
    """
    Export full agent session for audit/compliance.
    Returns all steps, decisions, and summary stats.
    """
    from neo4j_driver import get_halted_steps

    graph = await get_agent_graph(agent_id)
    halts = await get_halted_steps(agent_id)

    nodes = graph.get("nodes", [])

    # Calculate summary
    proceed_count = sum(1 for n in nodes if n.get("decision") == "PROCEED")
    halt_count = sum(1 for n in nodes if n.get("decision") == "HALT")

    # Group by reason
    reasons = {}
    for n in nodes:
        reason = n.get("reason", "UNKNOWN")
        reasons[reason] = reasons.get(reason, 0) + 1

    return {
        "agent_id": agent_id,
        "export_timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total_steps": len(nodes),
            "proceed_count": proceed_count,
            "halt_count": halt_count,
            "halt_rate": f"{halt_count/len(nodes)*100:.1f}%" if nodes else "0%",
            "decisions_by_reason": reasons,
        },
        "halts": halts,
        "full_trace": nodes,
        "graph": graph,
    }


@app.get("/api/v1/compliance/report")
async def compliance_report():
    """
    Generate overall compliance report across all agents.
    Useful for audits and dashboards.
    """
    from neo4j_driver import get_stats, list_agents

    stats = await get_stats()
    agents = await list_agents()

    total = stats.get("total_steps", 0)
    halts = stats.get("halt_count", 0)

    return {
        "report_timestamp": datetime.now(timezone.utc).isoformat(),
        "overall_compliance_rate": f"{(total-halts)/total*100:.1f}%" if total > 0 else "N/A",
        "total_decisions": total,
        "total_halts": halts,
        "total_proceeds": stats.get("proceed_count", 0),
        "violations_by_type": stats.get("violations_by_type", {}),
        "agents_monitored": agents.get("count", 0),
        "high_risk_agents": [
            a for a in agents.get("agents", [])
            if a.get("halt_count", 0) > 2
        ],
        "policies_active": config.MOCK_POLICIES,
    }
