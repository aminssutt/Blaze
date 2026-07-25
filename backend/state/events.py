"""Event types and envelope matching contracts/schemas/event_envelope.schema.json.

Pure python + pydantic. No FastAPI, no I/O.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict

from pydantic import BaseModel, ConfigDict, Field, field_validator


class EventType(str, Enum):
    """Exact enum from contracts/schemas/event_envelope.schema.json."""

    INCIDENT_STARTED = "incident.started"
    AUDIO_RECEIVED = "audio.received"
    TRANSCRIPTION_STARTED = "transcription.started"
    TRANSCRIPT_READY = "transcript.ready"
    RADIO_AGENT_STARTED = "radio_agent.started"
    RADIO_EVENT_EXTRACTED = "radio_event.extracted"
    CONTEXT_AGENT_STARTED = "context_agent.started"
    TOOL_CALL_REQUESTED = "tool.call.requested"
    TOOL_CALL_COMPLETED = "tool.call.completed"
    SITUATION_SNAPSHOT_READY = "situation.snapshot.ready"
    PLANNING_STARTED = "planning.started"
    PLAN_DRAFT_READY = "plan.draft.ready"
    SAFETY_REVIEW_STARTED = "safety_review.started"
    SAFETY_REVIEW_READY = "safety_review.ready"
    APPROVAL_REQUESTED = "approval.requested"
    APPROVAL_RECEIVED = "approval.received"
    PLAN_REVISION_REQUESTED = "plan.revision.requested"
    DISPATCH_STARTED = "dispatch.started"
    DISPATCH_INSTRUCTION_READY = "dispatch.instruction.ready"
    TTS_STARTED = "tts.started"
    TTS_READY = "tts.ready"
    DISPATCH_SENT = "dispatch.sent"
    METRIC_UPDATED = "metric.updated"
    NETWORK_MODE_CHANGED = "network.mode.changed"
    FALLBACK_ACTIVATED = "fallback.activated"
    ERROR = "error"
    INCIDENT_COMPLETED = "incident.completed"


class EventEnvelope(BaseModel):
    """Envelope wrapping every event streamed from the backend to the frontend.

    Mirrors event_envelope.schema.json (all six fields required).
    """

    model_config = ConfigDict(frozen=True)

    event_id: str = Field(min_length=1)
    incident_id: str = Field(min_length=1)
    event_type: EventType
    timestamp: str
    sequence: int = Field(ge=1)
    payload: Dict[str, Any]

    @field_validator("timestamp")
    @classmethod
    def _must_be_iso8601(cls, value: str) -> str:
        # Accept "Z" suffix as well as explicit offsets.
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value

    def to_dict(self) -> Dict[str, Any]:
        """Plain-dict form, event_type as its wire string."""
        data = self.model_dump()
        data["event_type"] = self.event_type.value
        return data


EventListener = Callable[[EventEnvelope], None]
"""Injectable observer invoked synchronously for every emitted envelope."""
