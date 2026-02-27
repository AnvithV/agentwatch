from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class TelemetryEvent(BaseModel):
    agent_id: str
    step_id: str
    timestamp: datetime
    thought: str
    tool_used: str
    input_parameters: dict
    observation: str
    raw_log: str
    # Cross-agent causal chain: reference to parent step from another agent
    parent_step_id: Optional[str] = None
    parent_agent_id: Optional[str] = None


class GovernanceDecision(BaseModel):
    agent_id: str
    step_id: str
    decision: str  # "HALT", "WARN", or "PROCEED"
    severity: str = "info"  # "critical", "warning", "info"
    reason: str  # POLICY_VIOLATION | LOOP_DETECTED | SAFETY_VIOLATION | FACT_CHECK_FAILED | APPROVED
    details: str
    triggered_by: str
    timestamp: datetime
    warnings: list[str] = []  # Accumulated warnings even on PROCEED


class ExtractedEntities(BaseModel):
    price: Optional[float] = None
    action_type: Optional[str] = None
    ticker: Optional[str] = None
    quantity: Optional[int] = None
    vendor: Optional[str] = None
    raw: dict = {}
