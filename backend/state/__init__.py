"""BLAZE deterministic incident state machine (pure python + pydantic).

Standalone module: no FastAPI, no I/O. Consumed by the orchestrator and API
layers (separate tickets).
"""

from .events import EventEnvelope, EventListener, EventType
from .machine import (
    TERMINAL_STATES,
    ActivityStatus,
    ApprovalDecision,
    AuditRecord,
    IllegalTransitionError,
    IncidentState,
    IncidentStateMachine,
    SafetyReviewStatus,
)

__all__ = [
    "ActivityStatus",
    "ApprovalDecision",
    "AuditRecord",
    "EventEnvelope",
    "EventListener",
    "EventType",
    "IllegalTransitionError",
    "IncidentState",
    "IncidentStateMachine",
    "SafetyReviewStatus",
    "TERMINAL_STATES",
]
