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


class GovernanceDecision(BaseModel):
    agent_id: str
    step_id: str
    decision: str       # "HALT" or "PROCEED"
    reason: str         # POLICY_VIOLATION | LOOP_DETECTED | SAFETY_VIOLATION | FACT_CHECK_FAILED | APPROVED
    details: str
    triggered_by: str
    timestamp: datetime


class ExtractedEntities(BaseModel):
    price: Optional[float] = None
    action_type: Optional[str] = None
    ticker: Optional[str] = None
    quantity: Optional[int] = None
    vendor: Optional[str] = None
    raw: dict = {}
