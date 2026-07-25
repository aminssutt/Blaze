"""BLAZE Agent 1 — Radio Intelligence.

Turns one STT transcript of a firefighter radio message into validated,
structured :class:`RadioEvent` items (see ``contracts/schemas/radio_event.schema.json``)
via a schema-constrained Gemma call (``GemmaClient.chat_structured``), followed by
DETERMINISTIC post-LLM guardrails (plain code, no LLM):

1. every ``evidence_text`` must be a (fuzzy: case/accent/punctuation tolerant)
   substring of the transcript, otherwise the event's confidence is degraded and an
   ``evidence_not_found`` uncertainty is attached;
2. ``unit_id`` must belong to ``known_units`` (fuzzy match), otherwise it is forced
   to ``"unknown"`` with an uncertainty;
3. ``source_type`` is always forced to ``"human_report"``;
4. ``is_correction=true`` requires a non-null ``corrects_event_id`` — if the model
   left it null but a matching earlier event exists in ``recent_context``, the target
   is resolved deterministically (same normalized location, else same event, most
   recent first) and an uncertainty is recorded; conversely, ``is_correction=false``
   forces ``corrects_event_id`` to null (a dangling link would let downstream
   consumers silently fuse/downgrade the target event) with an uncertainty;
5. every event is finally validated against ``radio_event.schema.json`` — an event
   that still fails raises :class:`RadioEventValidationError`.

The agent NEVER executes tool calls (they are only *proposed* in
``RadioExtraction.proposed_tool_calls``) and NEVER produces tactical plans.
"""

from __future__ import annotations

import copy
import json
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

import jsonschema
from pydantic import BaseModel, ConfigDict, Field

from agents.common.inference_client import GemmaClient

REPO_ROOT = Path(__file__).resolve().parents[2]
RADIO_EVENT_SCHEMA_PATH = REPO_ROOT / "contracts" / "schemas" / "radio_event.schema.json"
PROMPT_PATH = REPO_ROOT / "inference" / "prompts" / "radio_intelligence.md"

#: Confidence ceiling applied to an event whose evidence_text is not found in the transcript.
DEGRADED_CONFIDENCE = 0.3

EVIDENCE_NOT_FOUND = "evidence_not_found"
UNKNOWN_UNIT = "unknown"


class RadioEventValidationError(Exception):
    """An event still fails radio_event.schema.json after the deterministic guardrails."""

    def __init__(self, message: str, event: Mapping[str, Any]) -> None:
        super().__init__(message)
        self.event = dict(event)


class ProposedToolCall(BaseModel):
    """A tool call proposed by the model. NEVER executed by this agent."""

    model_config = ConfigDict(frozen=True)

    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    reason: str = ""


class RadioExtraction(BaseModel):
    """Validated result of one transcript extraction."""

    model_config = ConfigDict(frozen=True)

    audio_id: str
    events: tuple[dict[str, Any], ...]
    confidence: float = Field(ge=0.0, le=1.0)
    uncertainties: tuple[str, ...] = ()
    proposed_tool_calls: tuple[ProposedToolCall, ...] = ()
    attempts: int = 1


# ---------------------------------------------------------------------------
# Schemas & prompt loading
# ---------------------------------------------------------------------------


def load_radio_event_schema() -> dict[str, Any]:
    """The canonical RadioEvent contract (contracts/schemas/radio_event.schema.json)."""
    return json.loads(RADIO_EVENT_SCHEMA_PATH.read_text(encoding="utf-8"))


def load_system_prompt() -> str:
    """The French system prompt (section after '## Prompt système') from the prompt file."""
    text = PROMPT_PATH.read_text(encoding="utf-8")
    marker = "## Prompt système"
    idx = text.find(marker)
    return text[idx + len(marker):].strip() if idx >= 0 else text.strip()


def build_extraction_schema() -> dict[str, Any]:
    """JSON schema sent to Gemma: events[] + global confidence/uncertainties/tool calls.

    The model only produces the *semantic* fields of each event; identifiers,
    timestamps and ``source_type`` are injected deterministically by the agent.
    """
    event_schema = load_radio_event_schema()
    llm_event_properties = {
        k: copy.deepcopy(v)
        for k, v in event_schema["properties"].items()
        if k not in {"event_id", "audio_id", "observed_at", "source_type"}
    }
    llm_event_required = [
        "event_type",
        "facts",
        "urgency",
        "confidence",
        "confirmation_status",
        "is_correction",
        "evidence_text",
    ]
    return {
        "type": "object",
        "properties": {
            "events": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": llm_event_properties,
                    "required": llm_event_required,
                    "additionalProperties": False,
                },
            },
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "uncertainties": {"type": "array", "items": {"type": "string"}},
            "proposed_tool_calls": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "tool_name": {"type": "string"},
                        "arguments": {"type": "object"},
                        "reason": {"type": "string"},
                    },
                    "required": ["tool_name"],
                },
            },
        },
        "required": ["events", "confidence"],
        "additionalProperties": False,
    }


# ---------------------------------------------------------------------------
# Deterministic text normalization (guardrails, not LLM)
# ---------------------------------------------------------------------------

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_text(text: str) -> str:
    """Lowercase, strip accents, collapse everything non-alphanumeric to single spaces."""
    decomposed = unicodedata.normalize("NFKD", text)
    no_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _NON_ALNUM.sub(" ", no_accents.lower()).strip()


def evidence_in_transcript(evidence: str, transcript: str) -> bool:
    """Fuzzy substring check: case, accents and punctuation are tolerated."""
    norm_evidence = normalize_text(evidence)
    if not norm_evidence:
        return False
    return norm_evidence in normalize_text(transcript)


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class RadioIntelligenceAgent:
    """Agent 1 — extracts structured RadioEvents from one radio transcript.

    Args:
        client: shared :class:`GemmaClient` (local vLLM).
        known_units: unit identifiers active on the operation (e.g. ``["alpha-3", "bravo-2"]``).
        recent_context: previously extracted RadioEvent dicts (most recent last), used
            to resolve correction targets and given to the model as context.
    """

    AGENT_NAME = "radio_intelligence"

    def __init__(
        self,
        client: GemmaClient,
        known_units: Sequence[str],
        recent_context: Sequence[Mapping[str, Any]] | None = None,
        *,
        system_prompt: str | None = None,
    ) -> None:
        self.client = client
        self.known_units = list(known_units)
        self.recent_context = [dict(e) for e in (recent_context or [])]
        self.system_prompt = system_prompt if system_prompt is not None else load_system_prompt()
        self._radio_event_schema = load_radio_event_schema()
        self._extraction_schema = build_extraction_schema()
        self._normalized_units = {normalize_text(u): u for u in self.known_units}

    # -- public API --------------------------------------------------------

    async def extract(self, transcript_result: Mapping[str, Any]) -> RadioExtraction:
        """Extract validated RadioEvents from one STT transcript result.

        ``transcript_result`` needs at least ``text`` (the transcript) and ``audio_id``;
        optional keys: ``speaker_hint``, ``observed_at`` (ISO 8601).
        """
        transcript = str(transcript_result.get("text") or "")
        audio_id = str(transcript_result.get("audio_id") or "unknown_audio")
        observed_at = str(
            transcript_result.get("observed_at")
            or datetime.now(timezone.utc).isoformat(timespec="seconds")
        )

        messages = self._build_messages(transcript, transcript_result)
        result = await self.client.chat_structured(
            messages,
            schema=self._extraction_schema,
            schema_name="radio_extraction",
            agent=self.AGENT_NAME,
        )
        data: dict[str, Any] = result.data

        events: list[dict[str, Any]] = []
        global_uncertainties = [str(u) for u in data.get("uncertainties") or []]
        for index, raw_event in enumerate(data.get("events") or [], start=1):
            event = self._apply_guardrails(
                dict(raw_event),
                transcript=transcript,
                audio_id=audio_id,
                observed_at=observed_at,
                index=index,
            )
            self._validate_event(event)
            events.append(event)

        tool_calls = tuple(
            ProposedToolCall(
                tool_name=str(tc.get("tool_name") or ""),
                arguments=dict(tc.get("arguments") or {}),
                reason=str(tc.get("reason") or ""),
            )
            for tc in data.get("proposed_tool_calls") or []
            if tc.get("tool_name")
        )

        global_confidence = float(data.get("confidence") or 0.0)
        if events:
            global_confidence = min(
                global_confidence, *(float(e["confidence"]) for e in events)
            )
        global_confidence = min(1.0, max(0.0, global_confidence))

        return RadioExtraction(
            audio_id=audio_id,
            events=tuple(events),
            confidence=global_confidence,
            uncertainties=tuple(global_uncertainties),
            proposed_tool_calls=tool_calls,
            attempts=result.attempts,
        )

    # -- prompt assembly ---------------------------------------------------

    def _build_messages(
        self, transcript: str, transcript_result: Mapping[str, Any]
    ) -> list[dict[str, Any]]:
        context_events = [
            {
                "event_id": e.get("event_id"),
                "event_type": e.get("event_type"),
                "location_reference": e.get("location_reference"),
                "facts": e.get("facts"),
                "unit_id": e.get("unit_id"),
            }
            for e in self.recent_context
        ]
        user_payload = {
            "unites_connues": self.known_units,
            "contexte_recent": context_events,
            "speaker_hint": transcript_result.get("speaker_hint"),
            "transcript": transcript,
        }
        user_content = (
            "Voici le message radio à analyser (transcription STT, erreurs possibles).\n"
            + json.dumps(user_payload, ensure_ascii=False, indent=2)
            + "\nRéponds uniquement avec le JSON demandé."
        )
        return [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_content},
        ]

    # -- deterministic guardrails (real code, no LLM) ----------------------

    def _apply_guardrails(
        self,
        event: dict[str, Any],
        *,
        transcript: str,
        audio_id: str,
        observed_at: str,
        index: int,
    ) -> dict[str, Any]:
        uncertainties = [str(u) for u in event.get("uncertainties") or []]

        # Deterministic identity / provenance fields.
        event.setdefault("event_id", f"evt-{audio_id}-{index}-{uuid.uuid4().hex[:8]}")
        event["audio_id"] = audio_id
        event.setdefault("observed_at", observed_at)
        # (3) source_type is ALWAYS human_report for radio events.
        event["source_type"] = "human_report"

        # Defaults for optional-in-LLM-schema fields.
        event.setdefault("unit_id", None)
        event.setdefault("location_reference", None)
        event.setdefault("corrects_event_id", None)

        # (1) evidence_text must be a fuzzy substring of the transcript.
        evidence = str(event.get("evidence_text") or "")
        if not evidence_in_transcript(evidence, transcript):
            event["confidence"] = min(float(event.get("confidence") or 0.0), DEGRADED_CONFIDENCE)
            uncertainties.append(
                f"{EVIDENCE_NOT_FOUND}: l'extrait '{evidence}' n'apparaît pas dans le transcript"
            )

        # (2) unit_id must belong to known_units (fuzzy match), else "unknown".
        unit_id = event.get("unit_id")
        if unit_id is not None:
            matched = self._normalized_units.get(normalize_text(str(unit_id)))
            if matched is None:
                uncertainties.append(
                    f"unité inconnue: '{unit_id}' ne fait pas partie des unités connues"
                )
                event["unit_id"] = UNKNOWN_UNIT
            else:
                event["unit_id"] = matched

        # (4) is_correction=true requires corrects_event_id when a matching prior
        # event exists in recent_context.
        if bool(event.get("is_correction")):
            corrects = event.get("corrects_event_id")
            known_ids = {
                e.get("event_id") for e in self.recent_context if e.get("event_id")
            }
            if corrects is not None and corrects not in known_ids and known_ids:
                uncertainties.append(
                    f"correction: event corrigé '{corrects}' absent du contexte récent"
                )
            if corrects is None:
                target = self._find_correction_target(event)
                if target is not None:
                    event["corrects_event_id"] = target
                    uncertainties.append(
                        f"correction: cible résolue de manière déterministe -> '{target}'"
                    )
                else:
                    uncertainties.append(
                        "correction: aucun event correspondant trouvé dans le contexte récent"
                    )
        else:
            # A non-correction event must NEVER keep a link to a prior event:
            # downstream consumers (Agent 2) would silently fuse/overwrite the
            # target (e.g. downgrade a confirmed event). Strip it and flag it.
            dangling = event.get("corrects_event_id")
            if dangling:
                uncertainties.append(
                    "corrects_event_id fourni sans is_correction=true — lien supprimé "
                    f"(cible proposée: '{dangling}')"
                )
            event["corrects_event_id"] = None

        event["uncertainties"] = uncertainties
        event["facts"] = [str(f) for f in event.get("facts") or []]
        event["confidence"] = min(1.0, max(0.0, float(event.get("confidence") or 0.0)))
        return event

    def _find_correction_target(self, event: Mapping[str, Any]) -> str | None:
        """Most recent prior event matching the correction's location (else any prior event)."""
        location = event.get("location_reference")
        norm_location = normalize_text(str(location)) if location else ""
        candidates = [e for e in reversed(self.recent_context) if e.get("event_id")]
        if norm_location:
            for prior in candidates:
                prior_loc = prior.get("location_reference")
                if prior_loc and normalize_text(str(prior_loc)) == norm_location:
                    return str(prior["event_id"])
        return str(candidates[0]["event_id"]) if candidates else None

    def _validate_event(self, event: Mapping[str, Any]) -> None:
        """(5) Final validation against the canonical radio_event.schema.json."""
        try:
            jsonschema.validate(dict(event), self._radio_event_schema)
        except jsonschema.ValidationError as exc:
            raise RadioEventValidationError(
                f"RadioEvent failed contract validation after guardrails: {exc.message}",
                event=event,
            ) from exc
