"""
Governance Pipeline — Person 1 owns this file.
Mock implementations below will be replaced with real Fastino, Senso, and Modulate integrations.
"""

import json
import re
from datetime import datetime, timezone

from models import GovernanceDecision, TelemetryEvent

# ---------------------------------------------------------------------------
# Fallback mock policies — replace with real Senso calls when API is ready
# ---------------------------------------------------------------------------
MOCK_POLICIES = {
    "budget_limit": 100_000,
    "restricted_tickers": ["GME", "AMC", "BBBY"],
    "max_position_size": 1000,
    "allowed_actions": ["BUY", "SELL", "HOLD", "RESEARCH"],
}

# Safety keywords (fallback for Modulate)
SAFETY_KEYWORDS = [
    "guaranteed",
    "you must",
    "lose everything",
    "act now",
    "risk-free",
    "100% return",
]


# ---------------------------------------------------------------------------
# Entity Extraction (Fastino GLiNER — mock/regex fallback)
# ---------------------------------------------------------------------------
async def extract_entities(raw_log: str) -> dict:
    """
    TODO: Replace with real Fastino GLiNER API call.
    Regex fallback extracts price, action_type, ticker, quantity.
    """
    entities: dict = {}

    # Price: match patterns like "$121,250" or "total cost $121,250"
    price_match = re.search(r"\$[\d,]+(?:\.\d{2})?", raw_log)
    if price_match:
        price_str = price_match.group().replace("$", "").replace(",", "")
        entities["price"] = float(price_str)

    # Look for "total cost" specifically (higher priority)
    total_cost_match = re.search(r"total cost \$([\d,]+(?:\.\d{2})?)", raw_log, re.IGNORECASE)
    if total_cost_match:
        entities["price"] = float(total_cost_match.group(1).replace(",", ""))

    # Action type
    action_match = re.search(r"\b(BUY|SELL|HOLD|RESEARCH)\b", raw_log, re.IGNORECASE)
    if action_match:
        entities["action_type"] = action_match.group().upper()

    # Ticker (1-5 uppercase letters)
    ticker_match = re.search(r"\b([A-Z]{1,5})\b", raw_log)
    if ticker_match:
        entities["ticker"] = ticker_match.group()

    # Quantity
    qty_match = re.search(r"(\d+)\s+shares", raw_log, re.IGNORECASE)
    if qty_match:
        entities["quantity"] = int(qty_match.group(1))

    return entities


# ---------------------------------------------------------------------------
# Policy Check (Senso — mock fallback)
# ---------------------------------------------------------------------------
async def check_policy(entities: dict, agent_id: str) -> dict:
    """
    TODO: Replace with real Senso API call.
    Checks extracted entities against mock policy store.
    """
    # Budget check
    price = entities.get("price")
    if price is not None and price > MOCK_POLICIES["budget_limit"]:
        return {
            "compliant": False,
            "violation": f"cost ${price:,.0f} exceeds budget ${MOCK_POLICIES['budget_limit']:,}",
            "policy_limit": MOCK_POLICIES["budget_limit"],
        }

    # Restricted ticker check
    ticker = entities.get("ticker")
    if ticker and ticker in MOCK_POLICIES["restricted_tickers"]:
        return {
            "compliant": False,
            "violation": f"ticker {ticker} is on restricted list",
            "policy_limit": None,
        }

    # Position size check
    quantity = entities.get("quantity")
    if quantity is not None and quantity > MOCK_POLICIES["max_position_size"]:
        return {
            "compliant": False,
            "violation": f"quantity {quantity} exceeds max position size {MOCK_POLICIES['max_position_size']}",
            "policy_limit": MOCK_POLICIES["max_position_size"],
        }

    return {"compliant": True, "violation": None, "policy_limit": None}


# ---------------------------------------------------------------------------
# Safety Check (Modulate — keyword fallback)
# ---------------------------------------------------------------------------
async def check_safety(thought: str) -> dict:
    """
    TODO: Replace with real Modulate API call.
    Keyword-based safety check as fallback.
    """
    thought_lower = thought.lower()
    flags = [kw for kw in SAFETY_KEYWORDS if kw in thought_lower]

    raw_log_lower = thought_lower  # also check raw_log if passed
    return {"safe": len(flags) == 0, "flags": flags}


# ---------------------------------------------------------------------------
# Orchestrator — runs the full governance pipeline
# ---------------------------------------------------------------------------
async def run_governance_pipeline(telemetry: dict) -> GovernanceDecision:
    """
    Runs all governance checks in order. Fail-closed: if any check errors, default to HALT.
    """
    agent_id = telemetry["agent_id"]
    step_id = telemetry["step_id"]

    # 1. Extract entities from raw_log via Fastino
    try:
        entities = await extract_entities(telemetry.get("raw_log", ""))
    except Exception:
        return GovernanceDecision(
            agent_id=agent_id,
            step_id=step_id,
            decision="HALT",
            reason="POLICY_VIOLATION",
            details="Entity extraction failed — fail-closed",
            triggered_by="fastino_extraction",
            timestamp=datetime.now(timezone.utc),
        )

    # 2. Policy check via Senso
    try:
        policy_result = await check_policy(entities, agent_id)
        if not policy_result["compliant"]:
            return GovernanceDecision(
                agent_id=agent_id,
                step_id=step_id,
                decision="HALT",
                reason="POLICY_VIOLATION",
                details=policy_result["violation"],
                triggered_by="senso_policy_check",
                timestamp=datetime.now(timezone.utc),
            )
    except Exception:
        return GovernanceDecision(
            agent_id=agent_id,
            step_id=step_id,
            decision="HALT",
            reason="POLICY_VIOLATION",
            details="Policy check failed — fail-closed",
            triggered_by="senso_policy_check",
            timestamp=datetime.now(timezone.utc),
        )

    # 3. Safety check via Modulate
    try:
        safety_result = await check_safety(telemetry.get("thought", ""))
        if not safety_result["safe"]:
            return GovernanceDecision(
                agent_id=agent_id,
                step_id=step_id,
                decision="HALT",
                reason="SAFETY_VIOLATION",
                details=f"Unsafe language detected: {safety_result['flags']}",
                triggered_by="modulate_safety_check",
                timestamp=datetime.now(timezone.utc),
            )
    except Exception:
        return GovernanceDecision(
            agent_id=agent_id,
            step_id=step_id,
            decision="HALT",
            reason="SAFETY_VIOLATION",
            details="Safety check failed — fail-closed",
            triggered_by="modulate_safety_check",
            timestamp=datetime.now(timezone.utc),
        )

    # All checks passed
    return GovernanceDecision(
        agent_id=agent_id,
        step_id=step_id,
        decision="PROCEED",
        reason="APPROVED",
        details="All governance checks passed",
        triggered_by="governance_pipeline",
        timestamp=datetime.now(timezone.utc),
    )
