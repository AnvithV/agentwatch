"""
governance.py — AgentWatch Governance Pipeline (Person 1)

Pipeline order (fail-closed):
  1. Loop detection  (Person 2 — called from main.py before this module)
  2. extract_entities()   — Fastino GLiNER
  3. check_policy()       — Senso
  4. check_safety()       — Text safety filter (future: Modulate ToxMod for voice)
  5. PROCEED if all pass, HALT on first failure
"""

import re
import logging
from datetime import datetime, timezone

import aiohttp

import config
from models import ExtractedEntities, GovernanceDecision

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# ANSI helpers for demo-friendly terminal output
# ─────────────────────────────────────────────
_GREEN = "\033[92m"
_RED = "\033[91m"
_YELLOW = "\033[93m"
_CYAN = "\033[96m"
_RESET = "\033[0m"


def _log(icon: str, tag: str, msg: str, color: str = _CYAN) -> None:
    print(f"{color}{icon} [{tag}] {msg}{_RESET}", flush=True)


# ─────────────────────────────────────────────
# 1. Entity Extraction  (Fastino GLiNER)
# ─────────────────────────────────────────────

_TOTAL_COST_RE = re.compile(
    r"total\s+cost\s+\$?([\d,]+(?:\.\d{1,2})?)", re.IGNORECASE
)
_PRICE_RE = re.compile(
    r"(?:cost|price|at)\s*\$?([\d,]+(?:\.\d{1,2})?)", re.IGNORECASE
)
_TICKER_RE = re.compile(r"\b([A-Z]{1,5})\b")
_ACTION_RE = re.compile(r"\b(BUY|SELL|HOLD|RESEARCH|EXECUTE|RECOMMEND)\b", re.IGNORECASE)
_QTY_RE = re.compile(r"\b(\d+)\s+shares?\b", re.IGNORECASE)
_VENDOR_RE = re.compile(r"\b(?:vendor|supplier|provider)\s+[\"']?([A-Za-z0-9\s]+)[\"']?", re.IGNORECASE)

_KNOWN_TICKERS = {
    "AAPL", "MSFT", "GOOG", "GOOGL", "AMZN", "TSLA", "META", "NVDA",
    "NFLX", "AMD", "INTC", "GME", "AMC", "BBBY", "SPY", "QQQ",
}


def _regex_extract(raw_log: str) -> dict:
    """Fallback entity extraction using regex when Fastino is unavailable."""
    entities: dict = {}

    price_match = _TOTAL_COST_RE.search(raw_log) or _PRICE_RE.search(raw_log)
    if price_match:
        entities["price"] = float(price_match.group(1).replace(",", ""))

    action_match = _ACTION_RE.search(raw_log)
    if action_match:
        entities["action_type"] = action_match.group(1).upper()

    qty_match = _QTY_RE.search(raw_log)
    if qty_match:
        entities["quantity"] = int(qty_match.group(1))

    ticker_candidates = set(_TICKER_RE.findall(raw_log))
    known = ticker_candidates & _KNOWN_TICKERS
    if known:
        entities["ticker"] = next(iter(known))

    vendor_match = _VENDOR_RE.search(raw_log)
    if vendor_match:
        entities["vendor"] = vendor_match.group(1).strip()

    return entities


async def extract_entities(raw_log: str) -> dict:
    """
    Call Fastino GLiNER API to extract structured entities from raw_log.
    Falls back to regex extraction on any API failure.

    Returns dict with keys: price, action_type, ticker, quantity, vendor
    """
    if not config.FASTINO_API_KEY:
        logger.warning("FASTINO_API_KEY not set — using regex fallback")
        result = _regex_extract(raw_log)
        _log("🔍", "Fastino", f"Regex extracted: {result}", _YELLOW)
        return result

    payload = {
        "task": "extract_entities",
        "text": raw_log,
        "schema": ["total_cost", "unit_price", "action_type", "ticker", "quantity", "vendor"],
        "threshold": 0.3,
    }
    headers = {
        "X-API-Key": config.FASTINO_API_KEY,
        "Content-Type": "application/json",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                config.FASTINO_API_URL,
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()

        # Fastino response: {"result": {"entities": {"label": ["value", ...]}}}
        raw_entities = data.get("result", {}).get("entities", {})
        entities: dict = {}

        def first(key):
            vals = raw_entities.get(key, [])
            return vals[0] if vals else None

        total_cost = first("total_cost")
        if total_cost:
            cleaned = re.sub(r"[^\d.]", "", total_cost)
            if cleaned:
                entities["price"] = float(cleaned)
        elif first("unit_price"):
            cleaned = re.sub(r"[^\d.]", "", first("unit_price"))
            if cleaned:
                entities["price"] = float(cleaned)

        if first("action_type"):
            entities["action_type"] = first("action_type").upper()
        if first("ticker"):
            entities["ticker"] = first("ticker").upper()
        if first("quantity"):
            cleaned = re.sub(r"[^\d]", "", first("quantity"))
            if cleaned:
                entities["quantity"] = int(cleaned)
        if first("vendor"):
            entities["vendor"] = first("vendor")

        _log("🔍", "Fastino", f"GLiNER extracted: {entities}", _CYAN)
        return entities

    except Exception as exc:
        logger.warning("Fastino API error (%s) — using regex fallback", exc)
        result = _regex_extract(raw_log)
        _log("🔍", "Fastino", f"Fallback extracted: {result}", _YELLOW)
        return result


# ─────────────────────────────────────────────
# 2. Policy Check  (Senso)
# ─────────────────────────────────────────────

def _build_senso_query(entities: dict) -> str:
    """Build a natural language policy query from extracted entities."""
    parts = ["Is this agent action compliant with our trading policies?"]
    if entities.get("action_type"):
        parts.append(f"Action: {entities['action_type']}")
    if entities.get("ticker"):
        parts.append(f"Ticker: {entities['ticker']}")
    if entities.get("quantity"):
        parts.append(f"Quantity: {entities['quantity']} shares")
    if entities.get("price"):
        parts.append(f"Total cost: ${entities['price']:,.2f}")
    if entities.get("vendor"):
        parts.append(f"Vendor: {entities['vendor']}")
    return " | ".join(parts)


_VIOLATION_SIGNALS = re.compile(
    r"\b(violat|not compliant|non.compliant|exceeds|prohibited|restricted|"
    r"not allowed|unauthori[sz]ed|over budget|blocked|forbidden)\b",
    re.IGNORECASE,
)


async def check_policy(entities: dict, agent_id: str) -> dict:
    """
    Query Senso semantic search to validate entities against org knowledge base.
    Falls back to MOCK_POLICIES if Senso is unavailable.

    Returns: {"compliant": bool, "violation": str | None, "policy_limit": value | None}
    """
    if not config.SENSO_API_KEY:
        logger.warning("SENSO_API_KEY not set — using mock policy store")
        return _mock_policy_check(entities)

    query = _build_senso_query(entities)
    payload = {"query": query, "max_results": 3}
    headers = {
        "X-API-Key": config.SENSO_API_KEY,
        "Content-Type": "application/json",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                config.SENSO_API_URL,
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=8),
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()

        answer = data.get("answer", "")
        # Check for explicit compliance markers first (case-insensitive)
        answer_lower = answer.lower()

        # First check for explicit non-compliance (these take priority)
        has_non_compliant = (
            "non-compliant" in answer_lower or
            "not compliant" in answer_lower or
            "**violation**" in answer_lower or
            "**non-compliant**" in answer_lower
        )

        # Then check for explicit compliance markers (flexible matching)
        # Matches: "**compliant**", "**Yes — compliant.**", "compliant", "yes, compliant", etc.
        has_compliant = (
            "compliant" in answer_lower and
            "non-compliant" not in answer_lower and
            "not compliant" not in answer_lower
        )

        if has_non_compliant:
            compliant = False
        elif has_compliant:
            compliant = True
        else:
            # Fall back to violation signal detection only if no explicit markers
            compliant = not bool(_VIOLATION_SIGNALS.search(answer))
        violation = answer if not compliant else None

        result = {
            "compliant": compliant,
            "violation": violation,
            "policy_limit": None,
        }
        label = "COMPLIANT" if compliant else f"VIOLATION — {answer[:120]}"
        color = _CYAN if compliant else _RED
        _log("📋", "Senso", f"Policy check via API: {label}", color)
        return result

    except Exception as exc:
        logger.warning("Senso API error (%s) — using mock policy store", exc)
        return _mock_policy_check(entities)


def _mock_policy_check(entities: dict) -> dict:
    """Evaluate entities against MOCK_POLICIES with severity levels."""
    policies = config.MOCK_POLICIES
    warnings = []

    price = entities.get("price")
    if price is not None:
        # Hard limit: HALT
        if price > policies["budget_limit"]:
            result = {
                "compliant": False,
                "severity": "critical",
                "violation": f"cost ${price:,.2f} exceeds budget limit ${policies['budget_limit']:,}",
                "policy_limit": policies["budget_limit"],
                "warnings": warnings,
            }
            _log("📋", "Senso", f"Local policy check: VIOLATION — {result['violation']}", _YELLOW)
            return result
        # Soft limit: WARN (80% of budget)
        elif price > policies["budget_limit"] * 0.8:
            warnings.append(f"Approaching budget limit: ${price:,.2f} is {price/policies['budget_limit']*100:.0f}% of ${policies['budget_limit']:,}")
            _log("⚠️", "Senso", f"WARNING: Approaching budget limit ({price/policies['budget_limit']*100:.0f}%)", _YELLOW)

    ticker = entities.get("ticker")
    if ticker and ticker in policies["restricted_tickers"]:
        result = {
            "compliant": False,
            "severity": "critical",
            "violation": f"ticker {ticker} is on the restricted list",
            "policy_limit": None,
            "warnings": warnings,
        }
        _log("📋", "Senso", f"Local policy check: VIOLATION — {result['violation']}", _YELLOW)
        return result

    qty = entities.get("quantity")
    if qty is not None:
        # Hard limit: HALT
        if qty > policies["max_position_size"]:
            result = {
                "compliant": False,
                "severity": "critical",
                "violation": f"quantity {qty} exceeds max position size {policies['max_position_size']}",
                "policy_limit": policies["max_position_size"],
                "warnings": warnings,
            }
            _log("📋", "Senso", f"Local policy check: VIOLATION — {result['violation']}", _YELLOW)
            return result
        # Soft limit: WARN (80% of position size)
        elif qty > policies["max_position_size"] * 0.8:
            warnings.append(f"Approaching position limit: {qty} shares is {qty/policies['max_position_size']*100:.0f}% of {policies['max_position_size']}")
            _log("⚠️", "Senso", f"WARNING: Approaching position limit ({qty/policies['max_position_size']*100:.0f}%)", _YELLOW)

    action = entities.get("action_type")
    if action and action not in policies["allowed_actions"]:
        result = {
            "compliant": False,
            "severity": "warning",  # Less severe - just unknown action
            "violation": f"action '{action}' is not in allowed actions",
            "policy_limit": None,
            "warnings": warnings,
        }
        _log("📋", "Senso", f"Local policy check: VIOLATION — {result['violation']}", _YELLOW)
        return result

    _log("📋", "Senso", "Policy check via API: COMPLIANT", _CYAN)
    return {"compliant": True, "severity": "info", "violation": None, "policy_limit": None, "warnings": warnings}


# ─────────────────────────────────────────────
# 3. Safety Check  (Keyword-based text safety filter)
# Future: Integrate Modulate ToxMod for voice agent safety
# ─────────────────────────────────────────────

_TOXIC_PATTERNS = re.compile(
    r"\b(guaranteed|must buy|you will lose everything|100%\s*certain|"
    r"pump|dump|manipulat|coerce|deceive|deceptive|aggressive|threaten)\b",
    re.IGNORECASE,
)
_URGENCY_PATTERN = re.compile(
    r"\b(NOW|IMMEDIATELY|urgent|act fast|limited time|don'?t miss)\b",
    re.IGNORECASE,
)


async def check_safety(thought: str) -> dict:
    """
    Analyze agent thought for safety violations via keyword pattern matching.
    Detects toxic language, manipulation, and coercion patterns.

    Returns: {"safe": bool, "flags": list[str]}
    """
    return _keyword_safety_check(thought)


def _keyword_safety_check(thought: str) -> dict:
    flags = []
    if _TOXIC_PATTERNS.search(thought):
        flags.append("toxic_language")
    if _URGENCY_PATTERN.search(thought):
        flags.append("manipulative_urgency")

    result = {"safe": len(flags) == 0, "flags": flags}
    label = "SAFE" if result["safe"] else f"VIOLATION — {flags}"
    color = _CYAN if result["safe"] else _YELLOW
    _log("🛡️", "Safety", f"Check: {label}", color)
    return result


# ─────────────────────────────────────────────
# 4. Governance Pipeline Orchestrator
# ─────────────────────────────────────────────

async def run_governance_pipeline(telemetry: dict) -> GovernanceDecision:
    """
    Orchestrate the full governance pipeline for a telemetry event.

    Pipeline (fail-closed — first HALT wins):
      1. Loop detection   — handled upstream in main.py (Person 2)
      2. extract_entities — Fastino GLiNER
      3. check_policy     — Senso
      4. check_safety     — Text safety filter

    Returns a GovernanceDecision.
    """
    agent_id = telemetry["agent_id"]
    step_id = telemetry["step_id"]
    raw_log = telemetry.get("raw_log", "")
    thought = telemetry.get("thought", "")

    _log("⏳", agent_id, f'Step received: "{thought[:80]}"', _CYAN)

    now = datetime.now(timezone.utc)

    accumulated_warnings: list[str] = []

    def _halt(reason: str, details: str, triggered_by: str, severity: str = "critical") -> GovernanceDecision:
        _log("🛑", "AgentWatch", f"Decision: HALT — {reason}", _RED)
        return GovernanceDecision(
            agent_id=agent_id,
            step_id=step_id,
            decision="HALT",
            severity=severity,
            reason=reason,
            details=details,
            triggered_by=triggered_by,
            timestamp=now,
            warnings=accumulated_warnings,
        )

    def _proceed() -> GovernanceDecision:
        if accumulated_warnings:
            _log("⚠️", "AgentWatch", f"Decision: PROCEED with {len(accumulated_warnings)} warning(s)", _YELLOW)
        else:
            _log("✅", "AgentWatch", "Decision: PROCEED", _GREEN)
        return GovernanceDecision(
            agent_id=agent_id,
            step_id=step_id,
            decision="PROCEED",
            severity="warning" if accumulated_warnings else "info",
            reason="APPROVED",
            details="All governance checks passed" + (f" ({len(accumulated_warnings)} warnings)" if accumulated_warnings else ""),
            triggered_by="governance_pipeline",
            timestamp=now,
            warnings=accumulated_warnings,
        )

    # ── Step 1: Entity extraction (Fastino) ──────────────────────────────────
    try:
        entities = await extract_entities(raw_log)
    except Exception as exc:
        logger.error("extract_entities failed: %s", exc)
        return _halt(
            "FACT_CHECK_FAILED",
            f"Entity extraction error: {exc}",
            "fastino_extract",
        )

    # ── Step 2: Policy check (Senso) ─────────────────────────────────────────
    try:
        policy_result = await check_policy(entities, agent_id)
    except Exception as exc:
        logger.error("check_policy failed: %s", exc)
        return _halt(
            "POLICY_VIOLATION",
            f"Policy check error: {exc}",
            "senso_policy_check",
        )

    # Accumulate any warnings from policy check
    accumulated_warnings.extend(policy_result.get("warnings", []))

    if not policy_result.get("compliant", True):
        violation = policy_result.get("violation", "unknown policy violation")
        limit = policy_result.get("policy_limit")
        severity = policy_result.get("severity", "critical")
        details = f"{violation}"
        if limit is not None:
            details += f" (limit: {limit})"
        return _halt("POLICY_VIOLATION", details, "senso_policy_check", severity)

    # ── Step 3: Safety check (Modulate) ──────────────────────────────────────
    try:
        safety_result = await check_safety(thought)
    except Exception as exc:
        logger.error("check_safety failed: %s", exc)
        return _halt(
            "SAFETY_VIOLATION",
            f"Safety check error: {exc}",
            "safety_check",
        )

    if not safety_result.get("safe", True):
        flags = safety_result.get("flags", [])
        return _halt(
            "SAFETY_VIOLATION",
            f"Safety flags detected: {', '.join(flags)}",
            "safety_check",
        )

    return _proceed()
