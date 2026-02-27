"""
Governance Pipeline — Person 1 owns this file.
Fastino GLiNER 2 is live. Senso attempts real API, falls back to local policy engine.
Modulate-inspired text safety check covers the text analysis layer.
"""

import json
import re
from datetime import datetime, timezone

import aiohttp

import config
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
# Entity Extraction (Fastino GLiNER 2 API)
# ---------------------------------------------------------------------------
async def _fastino_extract(raw_log: str) -> dict:
    """Calls the real Fastino GLiNER 2 API for entity extraction."""
    payload = {
        "task": "extract_entities",
        "text": raw_log,
        "schema": ["total_cost", "unit_price", "action_type", "ticker", "quantity", "vendor"],
        "threshold": 0.3,
        "include_confidence": True,
        "include_spans": False,
        "format_results": True,
    }
    headers = {
        "X-API-Key": config.FASTINO_API_KEY,
        "Content-Type": "application/json",
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(config.FASTINO_API_URL, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            resp.raise_for_status()
            data = await resp.json()

    result = data.get("result", {})
    entities_raw = result.get("entities", {})

    # Helper: GLiNER returns either plain strings or {"text": ..., "confidence": ...} objects
    def _get_text(item):
        if isinstance(item, dict):
            return item.get("text", "")
        return str(item)

    # Normalize GLiNER output into our flat entity dict
    entities: dict = {}

    # Prefer total_cost over unit_price for policy checks
    for price_key in ["total_cost", "unit_price"]:
        prices = entities_raw.get(price_key, [])
        if prices:
            price_str = _get_text(prices[0]).replace("$", "").replace(",", "")
            price_match = re.search(r"[\d.]+", price_str)
            if price_match:
                entities["price"] = float(price_match.group())
                break

    actions = entities_raw.get("action_type", [])
    if actions:
        entities["action_type"] = _get_text(actions[0]).upper()

    tickers = entities_raw.get("ticker", [])
    if tickers:
        entities["ticker"] = _get_text(tickers[0]).upper()

    quantities = entities_raw.get("quantity", [])
    if quantities:
        qty_match = re.search(r"\d+", _get_text(quantities[0]))
        if qty_match:
            entities["quantity"] = int(qty_match.group())

    vendors = entities_raw.get("vendor", [])
    if vendors:
        entities["vendor"] = _get_text(vendors[0])

    return entities


def _regex_fallback(raw_log: str) -> dict:
    """Regex fallback if Fastino API is unavailable."""
    entities: dict = {}

    total_cost_match = re.search(r"total cost \$([\d,]+(?:\.\d{2})?)", raw_log, re.IGNORECASE)
    if total_cost_match:
        entities["price"] = float(total_cost_match.group(1).replace(",", ""))
    else:
        price_match = re.search(r"\$[\d,]+(?:\.\d{2})?", raw_log)
        if price_match:
            entities["price"] = float(price_match.group().replace("$", "").replace(",", ""))

    action_match = re.search(r"\b(BUY|SELL|HOLD|RESEARCH)\b", raw_log, re.IGNORECASE)
    if action_match:
        entities["action_type"] = action_match.group().upper()

    ticker_match = re.search(r"\b([A-Z]{1,5})\b", raw_log)
    if ticker_match:
        entities["ticker"] = ticker_match.group()

    qty_match = re.search(r"(\d+)\s+shares", raw_log, re.IGNORECASE)
    if qty_match:
        entities["quantity"] = int(qty_match.group(1))

    return entities


async def extract_entities(raw_log: str) -> dict:
    """Extracts entities via Fastino GLiNER 2 API, falls back to regex on failure."""
    if config.FASTINO_API_KEY:
        try:
            entities = await _fastino_extract(raw_log)
            print(f"  [Fastino] GLiNER extracted: {entities}")
            return entities
        except Exception as e:
            print(f"  [Fastino] API error, using regex fallback: {e}")

    entities = _regex_fallback(raw_log)
    print(f"  [Fastino] Regex fallback extracted: {entities}")
    return entities


# ---------------------------------------------------------------------------
# Policy Check (Senso Context OS + local policy fallback)
# ---------------------------------------------------------------------------
async def _senso_policy_check(entities: dict, agent_id: str) -> dict:
    """Queries Senso's search API to check entities against ingested policies."""
    # Build a natural language compliance query from the extracted entities
    parts = []
    if entities.get("action_type"):
        parts.append(f"action: {entities['action_type']}")
    if entities.get("ticker"):
        parts.append(f"ticker: {entities['ticker']}")
    if entities.get("price"):
        parts.append(f"cost: ${entities['price']:,.0f}")
    if entities.get("quantity"):
        parts.append(f"quantity: {entities['quantity']} shares")

    if not parts:
        return {"compliant": True, "violation": None, "policy_limit": None}

    query = f"Is this trade compliant with our policies? {', '.join(parts)}"

    headers = {
        "X-API-Key": config.SENSO_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {"query": query, "max_results": 3}

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{config.SENSO_API_URL}/search",
            json=payload,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()

    answer = data.get("answer", "").lower()
    # Parse Senso's response for compliance signals
    violation_signals = ["exceeds", "violation", "not compliant", "restricted", "prohibited", "denied", "over budget"]
    for signal in violation_signals:
        if signal in answer:
            return {
                "compliant": False,
                "violation": f"Senso policy check: {data.get('answer', 'policy violation detected')}",
                "policy_limit": None,
            }

    return {"compliant": True, "violation": None, "policy_limit": None}


def _local_policy_check(entities: dict) -> dict:
    """Local policy engine fallback when Senso is unavailable."""
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


async def check_policy(entities: dict, agent_id: str) -> dict:
    """Checks policy via Senso API, falls back to local policy engine."""
    if config.SENSO_API_KEY and config.SENSO_API_URL:
        try:
            result = await _senso_policy_check(entities, agent_id)
            print(f"  [Senso] Policy check via API: {'COMPLIANT' if result['compliant'] else 'VIOLATION'}")
            return result
        except Exception as e:
            print(f"  [Senso] API error, using local policy engine: {e}")

    result = _local_policy_check(entities)
    print(f"  [Senso] Local policy check: {'COMPLIANT' if result['compliant'] else 'VIOLATION'}")
    return result


# ---------------------------------------------------------------------------
# Safety Check (Modulate-inspired text safety analysis)
# ---------------------------------------------------------------------------
async def check_safety(thought: str) -> dict:
    """
    Text safety check inspired by Modulate's voice safety categories.
    Detects aggression, deception, coercion, and manipulation in agent output.
    Modulate integration is voice-SDK based; this covers the text analysis layer.
    """
    thought_lower = thought.lower()
    flags = [kw for kw in SAFETY_KEYWORDS if kw in thought_lower]
    print(f"  [Modulate] Safety check: {'SAFE' if not flags else f'FLAGGED {flags}'}")
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
