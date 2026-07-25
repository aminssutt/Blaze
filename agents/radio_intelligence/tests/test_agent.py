"""Tests for the Radio Intelligence agent (ticket #13).

The vLLM server is MOCKED with respx: every Gemma answer is a realistic CANNED
structured extraction for one of the 5 demo transcripts of data/audio/manifest.json.
No GPU / no network — live Gemma validation is deferred to ticket #52.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import jsonschema
import pytest
import respx

from agents.common.inference_client import GemmaClient, StructuredOutputError
from agents.radio_intelligence.agent import (
    DEGRADED_CONFIDENCE,
    EVIDENCE_NOT_FOUND,
    UNKNOWN_UNIT,
    RadioIntelligenceAgent,
    evidence_in_transcript,
    load_radio_event_schema,
    load_system_prompt,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
MANIFEST_PATH = REPO_ROOT / "data" / "audio" / "manifest.json"

BASE_URL = "http://localhost:8000"
CHAT_URL = f"{BASE_URL}/v1/chat/completions"

KNOWN_UNITS = ["alpha-3", "bravo-2"]

MANIFEST = {entry["audio_id"]: entry for entry in json.loads(MANIFEST_PATH.read_text("utf-8"))}
RADIO_EVENT_SCHEMA = load_radio_event_schema()


# ---------------------------------------------------------------------------
# Canned Gemma responses (realistic extractions for the 5 demo transcripts)
# ---------------------------------------------------------------------------


def llm_event(**overrides) -> dict:
    event = {
        "unit_id": "alpha-3",
        "event_type": "other",
        "location_reference": None,
        "facts": [],
        "urgency": "medium",
        "confidence": 0.9,
        "confirmation_status": "reported",
        "is_correction": False,
        "corrects_event_id": None,
        "uncertainties": [],
        "evidence_text": "",
    }
    event.update(overrides)
    return event


CANNED_EXTRACTIONS: dict[str, dict] = {
    # Audio 1 — D17 blocked + black smoke + explosions (explosions REPORTED, not seen up close).
    "audio_01": {
        "events": [
            llm_event(
                event_type="road_status",
                location_reference="D17",
                facts=["La route D17 est bloquée pour le CCF d'Alpha 3"],
                urgency="high",
                confidence=0.92,
                evidence_text="La route D17 est bloquée pour notre camion-citerne.",
            ),
            llm_event(
                event_type="hazard_report",
                location_reference="hangar",
                facts=[
                    "Fumée noire très dense près du hangar",
                    "Plusieurs explosions entendues",
                ],
                urgency="critical",
                confidence=0.88,
                confirmation_status="reported",
                evidence_text=(
                    "Nous observons une fumée noire très dense près du hangar, "
                    "en notant également plusieurs explosions."
                ),
            ),
        ],
        "confidence": 0.9,
        "uncertainties": [],
        "proposed_tool_calls": [
            {
                "tool_name": "update_map_road_status",
                "arguments": {"road": "D17", "status": "blocked"},
                "reason": "Bloquage de la D17 rapporté par Alpha 3",
            }
        ],
    },
    # Audio 2 — 30% water left, near-zero visibility.
    "audio_02": {
        "events": [
            llm_event(
                event_type="resource_update",
                facts=[
                    "Il reste environ 30% d'eau à Alpha 3",
                    "Visibilité presque nulle pour Alpha 3",
                    "Alpha 3 ne peut pas poursuivre longtemps dans ces conditions",
                ],
                urgency="high",
                confidence=0.85,
                uncertainties=["quantité d'eau approximative ('environ 30%')"],
                evidence_text="Il nous reste environ 30% d'eau et la visibilité devient presque nulle.",
            )
        ],
        "confidence": 0.85,
        "uncertainties": ["quantité d'eau approximative ('environ 30%')"],
        "proposed_tool_calls": [
            {
                "tool_name": "flag_unit_resource_low",
                "arguments": {"unit": "alpha-3", "resource": "water", "level_pct": 30},
                "reason": "Niveau d'eau bas rapporté",
            }
        ],
    },
    # Audio 3 — wind shifted to south-east, fire heading to D17.
    "audio_03": {
        "events": [
            llm_event(
                unit_id="bravo-2",
                event_type="wind_update",
                location_reference="D17",
                facts=[
                    "Le vent a tourné vers le sud-est",
                    "La vitesse du vent augmente fortement",
                    "Le feu progresse en direction de la D17",
                ],
                urgency="critical",
                confidence=0.9,
                evidence_text=(
                    "Le vent vient de tourner vers le sud-est et sa vitesse augmente fortement."
                ),
            )
        ],
        "confidence": 0.9,
        "uncertainties": [],
        "proposed_tool_calls": [],
    },
    # Audio 4 — correction of audio_01's road_status (D17 not fully blocked, VL can pass north).
    "audio_04": {
        "events": [
            llm_event(
                event_type="correction",
                location_reference="D17",
                facts=[
                    "La D17 n'est pas totalement bloquée",
                    "La D17 reste inaccessible aux camions lourds",
                    "Les VL peuvent passer par le côté nord",
                ],
                urgency="medium",
                confidence=0.9,
                is_correction=True,
                corrects_event_id="evt-audio_01-road",
                evidence_text=(
                    "Correction concernant la D17 : la route n'est pas totalement bloquée, "
                    "mais elle reste inaccessible aux camions lourds."
                ),
            )
        ],
        "confidence": 0.9,
        "uncertainties": [],
        "proposed_tool_calls": [
            {
                "tool_name": "update_map_road_status",
                "arguments": {"road": "D17", "status": "partially_blocked", "passable_for": ["VL"]},
                "reason": "Correction du statut de la D17",
            }
        ],
    },
    # Audio 5 — visual CONFIRMATION of the explosions + gas bottle hazard.
    "audio_05": {
        "events": [
            llm_event(
                unit_id="bravo-2",
                event_type="confirmation",
                location_reference="hangar",
                facts=["Les explosions proviennent de l'arrière du hangar"],
                urgency="critical",
                confidence=0.93,
                confirmation_status="confirmed",
                evidence_text=(
                    "confirmation visuelle : les explosions proviennent de l'arrière du hangar"
                ),
            ),
            llm_event(
                unit_id="bravo-2",
                event_type="hazard_report",
                location_reference="hangar",
                facts=[
                    "Présence suspectée de bouteilles de gaz derrière le hangar",
                    "La zone du hangar doit être considérée comme dangereuse",
                ],
                urgency="critical",
                confidence=0.7,
                confirmation_status="reported",
                uncertainties=["présence de bouteilles de gaz suspectée, non confirmée"],
                evidence_text="Nous suspectons la présence de bouteilles de gaz.",
            ),
        ],
        "confidence": 0.8,
        "uncertainties": ["présence de bouteilles de gaz suspectée, non confirmée"],
        "proposed_tool_calls": [
            {
                "tool_name": "mark_danger_zone",
                "arguments": {"location": "hangar", "hazard": "gas_bottles"},
                "reason": "Zone dangereuse confirmée visuellement",
            }
        ],
    },
}

#: recent_context passed for audio_04 (correction) — the road_status from audio_01.
RECENT_CONTEXT = [
    {
        "event_id": "evt-audio_01-road",
        "audio_id": "audio_01",
        "unit_id": "alpha-3",
        "event_type": "road_status",
        "location_reference": "D17",
        "facts": ["La route D17 est bloquée pour le CCF d'Alpha 3"],
        "urgency": "high",
        "confidence": 0.92,
        "confirmation_status": "reported",
        "is_correction": False,
        "corrects_event_id": None,
        "uncertainties": [],
        "evidence_text": "La route D17 est bloquée pour notre camion-citerne.",
        "observed_at": "2026-07-25T10:00:00+00:00",
        "source_type": "human_report",
    }
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def completion_body(content: str) -> dict:
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "model": "google/gemma-4-E4B-it",
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 800, "completion_tokens": 250, "total_tokens": 1050},
    }


def mock_gemma(extraction: dict) -> None:
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(200, json=completion_body(json.dumps(extraction, ensure_ascii=False)))
    )


def make_agent(recent_context=None, **client_kwargs) -> RadioIntelligenceAgent:
    client_kwargs.setdefault("base_url", BASE_URL)
    client_kwargs.setdefault("retry_backoff_s", 0.0)
    client = GemmaClient(agent="radio_intelligence", **client_kwargs)
    return RadioIntelligenceAgent(client, known_units=KNOWN_UNITS, recent_context=recent_context)


def transcript_input(audio_id: str) -> dict:
    entry = MANIFEST[audio_id]
    return {
        "audio_id": audio_id,
        "text": entry["reference_transcript"],
        "speaker_hint": entry["speaker_hint"],
        "observed_at": "2026-07-25T10:00:00+00:00",
    }


async def run_extraction(audio_id: str, extraction: dict | None = None, recent_context=None):
    mock_gemma(extraction if extraction is not None else CANNED_EXTRACTIONS[audio_id])
    agent = make_agent(recent_context=recent_context)
    try:
        return await agent.extract(transcript_input(audio_id))
    finally:
        await agent.client.aclose()


# ---------------------------------------------------------------------------
# The 5 demo transcripts produce the expected facts of the manifest
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("audio_id", list(CANNED_EXTRACTIONS))
@respx.mock
async def test_demo_transcript_produces_expected_event_types(audio_id):
    recent = RECENT_CONTEXT if audio_id == "audio_04" else None
    extraction = await run_extraction(audio_id, recent_context=recent)

    got_types = {e["event_type"] for e in extraction.events}
    expected_types = set(MANIFEST[audio_id]["expected_event_types"])
    assert expected_types <= got_types, f"{audio_id}: expected {expected_types}, got {got_types}"


@pytest.mark.parametrize("audio_id", list(CANNED_EXTRACTIONS))
@respx.mock
async def test_every_event_validates_against_radio_event_schema(audio_id):
    recent = RECENT_CONTEXT if audio_id == "audio_04" else None
    extraction = await run_extraction(audio_id, recent_context=recent)

    assert extraction.events, f"{audio_id}: no events extracted"
    for event in extraction.events:
        jsonschema.validate(event, RADIO_EVENT_SCHEMA)  # must not raise
        assert event["audio_id"] == audio_id
        assert event["source_type"] == "human_report"


# ---------------------------------------------------------------------------
# Acceptance criteria of the ticket
# ---------------------------------------------------------------------------


@respx.mock
async def test_audio_04_is_correction_with_corrects_event_id():
    extraction = await run_extraction("audio_04", recent_context=RECENT_CONTEXT)

    corrections = [e for e in extraction.events if e["event_type"] == "correction"]
    assert corrections, "audio_04 must yield a correction event"
    correction = corrections[0]
    assert correction["is_correction"] is True
    assert correction["corrects_event_id"] == "evt-audio_01-road"


@respx.mock
async def test_audio_04_correction_target_resolved_deterministically_when_llm_omits_it():
    extraction = CANNED_EXTRACTIONS["audio_04"]
    extraction = json.loads(json.dumps(extraction))
    extraction["events"][0]["corrects_event_id"] = None  # the LLM "forgot" the target

    result = await run_extraction("audio_04", extraction=extraction, recent_context=RECENT_CONTEXT)

    correction = result.events[0]
    assert correction["is_correction"] is True
    # Guardrail (4): the D17 road_status of the recent context is matched by location.
    assert correction["corrects_event_id"] == "evt-audio_01-road"
    assert any("correction" in u for u in correction["uncertainties"])


@respx.mock
async def test_explosions_reported_in_audio_01_and_confirmed_in_audio_05():
    extraction_1 = await run_extraction("audio_01")
    explosion_events_1 = [
        e for e in extraction_1.events if any("explosion" in f.lower() for f in e["facts"])
    ]
    assert explosion_events_1, "audio_01 must mention the explosions"
    assert all(e["confirmation_status"] == "reported" for e in explosion_events_1)

    extraction_5 = await run_extraction("audio_05")
    explosion_events_5 = [
        e for e in extraction_5.events if any("explosion" in f.lower() for f in e["facts"])
    ]
    assert explosion_events_5, "audio_05 must mention the explosions"
    assert all(e["confirmation_status"] == "confirmed" for e in explosion_events_5)


# ---------------------------------------------------------------------------
# Deterministic guardrails
# ---------------------------------------------------------------------------


@respx.mock
async def test_invented_evidence_degrades_confidence_and_flags_uncertainty():
    extraction = json.loads(json.dumps(CANNED_EXTRACTIONS["audio_01"]))
    extraction["events"][0]["evidence_text"] = "Le pont sur la rivière est effondré."  # invented

    result = await run_extraction("audio_01", extraction=extraction)

    degraded = result.events[0]
    assert degraded["confidence"] <= DEGRADED_CONFIDENCE
    assert degraded["confidence"] < 0.92  # strictly below the LLM's original confidence
    assert any(EVIDENCE_NOT_FOUND in u for u in degraded["uncertainties"])
    # Global confidence is dragged down too.
    assert result.confidence <= DEGRADED_CONFIDENCE
    # The untouched second event keeps its confidence.
    assert result.events[1]["confidence"] == pytest.approx(0.88)
    assert not any(EVIDENCE_NOT_FOUND in u for u in result.events[1]["uncertainties"])


@respx.mock
async def test_evidence_match_is_fuzzy_on_case_accents_and_punctuation():
    extraction = json.loads(json.dumps(CANNED_EXTRACTIONS["audio_01"]))
    # Same span as the transcript, but ASCII-mangled: no accents, different case/punctuation.
    extraction["events"][0]["evidence_text"] = "la route D17 est bloquee pour notre camion citerne"

    result = await run_extraction("audio_01", extraction=extraction)

    event = result.events[0]
    assert event["confidence"] == pytest.approx(0.92)  # NOT degraded
    assert not any(EVIDENCE_NOT_FOUND in u for u in event["uncertainties"])


def test_evidence_in_transcript_unit():
    transcript = MANIFEST["audio_01"]["reference_transcript"]
    assert evidence_in_transcript("FUMEE NOIRE TRES DENSE pres du hangar", transcript)
    assert not evidence_in_transcript("bouteilles de gaz", transcript)
    assert not evidence_in_transcript("", transcript)


@respx.mock
async def test_unknown_unit_is_forced_to_unknown_with_uncertainty():
    extraction = json.loads(json.dumps(CANNED_EXTRACTIONS["audio_02"]))
    extraction["events"][0]["unit_id"] = "charlie-7"  # not in KNOWN_UNITS

    result = await run_extraction("audio_02", extraction=extraction)

    event = result.events[0]
    assert event["unit_id"] == UNKNOWN_UNIT
    assert any("charlie-7" in u for u in event["uncertainties"])
    jsonschema.validate(event, RADIO_EVENT_SCHEMA)


@respx.mock
async def test_known_unit_matches_fuzzily_and_is_canonicalized():
    extraction = json.loads(json.dumps(CANNED_EXTRACTIONS["audio_03"]))
    extraction["events"][0]["unit_id"] = "Bravo 2"  # STT-style spelling of bravo-2

    result = await run_extraction("audio_03", extraction=extraction)

    assert result.events[0]["unit_id"] == "bravo-2"


@respx.mock
async def test_source_type_forced_to_human_report():
    # Guardrail (3): whatever happens, radio events are human reports.
    result = await run_extraction("audio_03")
    assert all(e["source_type"] == "human_report" for e in result.events)


@respx.mock
async def test_tool_calls_are_proposed_never_executed():
    result = await run_extraction("audio_01")
    assert len(result.proposed_tool_calls) == 1
    call = result.proposed_tool_calls[0]
    assert call.tool_name == "update_map_road_status"
    assert call.arguments == {"road": "D17", "status": "blocked"}
    # Exactly ONE HTTP call happened: the extraction itself. No tool execution.
    assert respx.calls.call_count == 1


# ---------------------------------------------------------------------------
# StructuredOutputError propagation (invalid model output, repair loop exhausted)
# ---------------------------------------------------------------------------


@respx.mock
async def test_invalid_llm_output_twice_raises_structured_output_error():
    # Initial call + 1 repair attempt, both invalid -> typed StructuredOutputError.
    respx.post(CHAT_URL).mock(
        side_effect=[
            httpx.Response(200, json=completion_body("ceci n'est pas du JSON")),
            httpx.Response(200, json=completion_body('{"events": "pas un tableau"}')),
        ]
    )
    client = GemmaClient(base_url=BASE_URL, retry_backoff_s=0.0, repair_attempts=1)
    agent = RadioIntelligenceAgent(client, known_units=KNOWN_UNITS)
    try:
        with pytest.raises(StructuredOutputError) as exc_info:
            await agent.extract(transcript_input("audio_01"))
    finally:
        await client.aclose()

    assert exc_info.value.attempts == 2
    assert respx.calls.call_count == 2


# ---------------------------------------------------------------------------
# Prompt content sanity + prompt actually sent to the model
# ---------------------------------------------------------------------------


def test_system_prompt_contains_key_instructions():
    prompt = load_system_prompt()
    # Lexicon
    for term in ["CCF", "PC", "VL", "D17"]:
        assert term in prompt
    # STT-noise tolerance examples
    for noisy in ["dédicite", "Jean-Garre", "camion citerne"]:
        assert noisy in prompt
    # Core rules
    assert "NE JAMAIS créer de plan tactique" in prompt
    assert "EXACT" in prompt  # evidence_text exact
    assert "proposed_tool_calls" in prompt
    for status in ["reported", "inferred", "confirmed"]:
        assert status in prompt
    # Two few-shot examples, one with a correction and one noisy
    assert "Exemple 1" in prompt and "Exemple 2" in prompt
    assert '"is_correction": true' in prompt


@respx.mock
async def test_messages_carry_system_prompt_known_units_and_context():
    await run_extraction("audio_04", recent_context=RECENT_CONTEXT)

    request = json.loads(respx.calls.last.request.content)
    assert request["messages"][0]["role"] == "system"
    assert "Radio Intelligence" in request["messages"][0]["content"]
    user_msg = request["messages"][1]["content"]
    assert "alpha-3" in user_msg and "bravo-2" in user_msg
    assert "evt-audio_01-road" in user_msg  # recent context is visible to the model
    assert MANIFEST["audio_04"]["reference_transcript"] in user_msg
    # Structured output is requested against our extraction schema.
    assert request["response_format"]["type"] == "json_schema"
    assert request["response_format"]["json_schema"]["name"] == "radio_extraction"
