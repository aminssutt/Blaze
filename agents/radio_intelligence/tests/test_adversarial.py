"""Adversarial tests for the Radio Intelligence agent (ticket #14).

Complements test_agent.py (ticket #13, 5 demo transcripts) with the TRICKY
messages of data/evaluation/radio_messages.jsonl (ticket #19): negations,
implicit corrections, vehicle-type restrictions, ambiguous numbers, missing
speakers, contradictory reports, confirmed vs unconfirmed, noisy STT, and
guardrail behaviour under stress (mixed real/invented evidence, partially
valid batches).

As in test_agent.py the vLLM server is MOCKED with respx: every Gemma answer
is a realistic CANNED structured extraction for the dataset transcript under
test. The asserts pin down what the agent MUST guarantee downstream —
polarity of facts, correction links, uncertainty flags, no silent fusion —
independently of the live model (deferred to ticket #52).
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
    normalize_text,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
DATASET_PATH = REPO_ROOT / "data" / "evaluation" / "radio_messages.jsonl"

BASE_URL = "http://localhost:8000"
CHAT_URL = f"{BASE_URL}/v1/chat/completions"

#: All 4 field units of the evaluation dataset (#19).
KNOWN_UNITS = ["alpha-3", "bravo-2", "charlie-1", "delta-4"]

DATASET: dict[str, dict] = {
    row["id"]: row
    for row in (
        json.loads(line)
        for line in DATASET_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    )
}


# ---------------------------------------------------------------------------
# Helpers (mirrors test_agent.py, kept local so each file stays standalone)
# ---------------------------------------------------------------------------


def llm_event(**overrides) -> dict:
    event = {
        "unit_id": None,
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


def completion_body(content: str) -> dict:
    return {
        "id": "chatcmpl-adversarial",
        "object": "chat.completion",
        "model": "google/gemma-4-E4B-it",
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 900, "completion_tokens": 300, "total_tokens": 1200},
    }


def mock_gemma(extraction: dict) -> None:
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(200, json=completion_body(json.dumps(extraction, ensure_ascii=False)))
    )


def message_input(msg_id: str) -> dict:
    row = DATASET[msg_id]
    return {
        "audio_id": msg_id,
        "text": row["transcript"],
        "speaker_hint": row["speaker_expected"],
        "observed_at": "2026-07-25T11:00:00+00:00",
    }


async def run_msg(msg_id: str, extraction: dict, recent_context=None, **client_kwargs):
    """Mock one canned Gemma answer and run the agent on one dataset transcript."""
    mock_gemma(extraction)
    client_kwargs.setdefault("base_url", BASE_URL)
    client_kwargs.setdefault("retry_backoff_s", 0.0)
    client = GemmaClient(agent="radio_intelligence", **client_kwargs)
    agent = RadioIntelligenceAgent(client, known_units=KNOWN_UNITS, recent_context=recent_context)
    try:
        return await agent.extract(message_input(msg_id))
    finally:
        await client.aclose()


def facts_matching(facts: list[str], keyword: str) -> list[str]:
    """Facts whose normalized form contains the (normalized) keyword."""
    norm_kw = normalize_text(keyword)
    return [f for f in facts if norm_kw in normalize_text(f)]


def assert_fact_negated(facts: list[str], keyword: str, negators: list[str]) -> None:
    """Every fact mentioning `keyword` must carry one of the negation markers.

    This is THE negation contract: a negated fact ('pas de blessés') must never
    surface downstream as the positive fact ('blessés').
    """
    matching = facts_matching(facts, keyword)
    assert matching, f"no fact mentions '{keyword}' in {facts}"
    for fact in matching:
        norm = normalize_text(fact)
        assert any(normalize_text(neg) in norm for neg in negators), (
            f"fact '{fact}' states '{keyword}' WITHOUT negation marker {negators} — "
            "the negated fact leaked as a positive fact"
        )


# ---------------------------------------------------------------------------
# Negations — the negated fact must NEVER appear as a positive fact
# ---------------------------------------------------------------------------


@respx.mock
async def test_negation_no_casualties_is_not_a_casualty_fact():
    # msg_06 — « Pas de blessés à signaler. Je répète : aucun blessé. »
    extraction = {
        "events": [
            llm_event(
                unit_id="charlie-1",
                event_type="other",
                location_reference="hangar",
                facts=["trois ouvriers évacués du hangar", "aucun blessé à signaler"],
                urgency="medium",
                confidence=0.9,
                confirmation_status="confirmed",
                evidence_text="Nous avons évacué les trois ouvriers du hangar. Pas de blessés à signaler.",
            )
        ],
        "confidence": 0.9,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_06", extraction)

    event = result.events[0]
    assert_fact_negated(event["facts"], "blessé", ["aucun", "pas de", "sans"])
    # Evacuation is a genuine positive fact and must survive.
    assert facts_matching(event["facts"], "évacué")
    # Real evidence -> no degradation.
    assert event["confidence"] == pytest.approx(0.9)
    assert not any(EVIDENCE_NOT_FOUND in u for u in event["uncertainties"])


@respx.mock
async def test_negation_fire_did_not_reach_station():
    # msg_07 — « le feu n'a PAS atteint la station-service » (répété deux fois).
    extraction = {
        "events": [
            llm_event(
                unit_id="alpha-3",
                event_type="hazard_report",
                location_reference="station-service",
                facts=[
                    "le feu n'a pas atteint la station-service",
                    "front de feu à environ 200 mètres de la station-service",
                ],
                urgency="high",
                confidence=0.92,
                evidence_text="le feu n'a PAS atteint la station-service",
            )
        ],
        "confidence": 0.92,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_07", extraction)

    event = result.events[0]
    # A fact about 'atteint' MUST keep the negation — 'le feu a atteint la
    # station-service' would trigger a catastrophic wrong dispatch.
    assert_fact_negated(event["facts"], "atteint", ["pas atteint", "n a pas atteint"])
    # The real positive information (distance ~200 m) is preserved.
    assert facts_matching(event["facts"], "200")
    # Evidence is a real span (fuzzy: case of 'PAS' tolerated) -> not degraded.
    assert event["confidence"] == pytest.approx(0.92)
    assert not any(EVIDENCE_NOT_FOUND in u for u in event["uncertainties"])


@respx.mock
async def test_negation_threat_lifted_and_no_reinforcements():
    # msg_08 — double négation opérationnelle: plus menacée + pas besoin de renforts.
    extraction = {
        "events": [
            llm_event(
                unit_id="bravo-2",
                event_type="hazard_report",
                location_reference="ferme au nord",
                facts=[
                    "la ferme au nord n'est plus menacée",
                    "aucun renfort nécessaire sur le secteur nord pour l'instant",
                ],
                urgency="low",
                confidence=0.88,
                evidence_text="La ferme au nord n'est plus menacée",
            )
        ],
        "confidence": 0.88,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_08", extraction)

    event = result.events[0]
    assert_fact_negated(event["facts"], "menacée", ["plus menacée", "pas menacée"])
    assert_fact_negated(event["facts"], "renfort", ["aucun", "pas de", "pas besoin"])
    # Threat lifted -> urgency must be low despite the fire vocabulary.
    assert event["urgency"] == "low"


# ---------------------------------------------------------------------------
# Implicit correction — « annulez mon dernier message », no 'correction' keyword
# ---------------------------------------------------------------------------

#: Prior context for msg_10: an older D17 event + the (most recent) blocked
#: water point that the implicit correction cancels.
POINT_EAU_CONTEXT = [
    {
        "event_id": "evt-d17-old",
        "audio_id": "msg_x1",
        "unit_id": "alpha-3",
        "event_type": "road_status",
        "location_reference": "D17",
        "facts": ["D17 bloquée"],
        "urgency": "high",
        "confidence": 0.9,
        "confirmation_status": "reported",
        "is_correction": False,
        "corrects_event_id": None,
        "uncertainties": [],
        "evidence_text": "la D17 est bloquée",
        "observed_at": "2026-07-25T10:40:00+00:00",
        "source_type": "human_report",
    },
    {
        "event_id": "evt-pe2-blocked",
        "audio_id": "msg_x2",
        "unit_id": "bravo-2",
        "event_type": "resource_update",
        "location_reference": "point d'eau numéro 2",
        "facts": ["point d'eau numéro 2 inaccessible, barrière fermée"],
        "urgency": "high",
        "confidence": 0.85,
        "confirmation_status": "reported",
        "is_correction": False,
        "corrects_event_id": None,
        "uncertainties": [],
        "evidence_text": "le point d'eau numéro 2 est inaccessible",
        "observed_at": "2026-07-25T10:50:00+00:00",
        "source_type": "human_report",
    },
]


@respx.mock
async def test_implicit_correction_annulez_mon_dernier_message():
    # msg_10 — is_correction=true WITHOUT the word 'correction'; the model cannot
    # know the event_id, the guardrail must resolve it from recent_context.
    extraction = {
        "events": [
            llm_event(
                unit_id="bravo-2",
                event_type="correction",
                location_reference="point d'eau numéro 2",
                facts=[
                    "point d'eau numéro 2 accessible",
                    "barrière ouverte par les agents municipaux",
                ],
                urgency="medium",
                confidence=0.87,
                is_correction=True,
                corrects_event_id=None,  # the model has no id — deterministic resolution
                evidence_text="annulez mon dernier message. Le point d'eau numéro 2 est bien accessible",
            )
        ],
        "confidence": 0.87,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_10", extraction, recent_context=POINT_EAU_CONTEXT)

    correction = result.events[0]
    assert correction["is_correction"] is True
    assert correction["event_type"] == "correction"
    # Location match beats recency-only: the water-point event is the target,
    # NOT the older D17 event.
    assert correction["corrects_event_id"] == "evt-pe2-blocked"
    assert any("correction" in u for u in correction["uncertainties"])


@respx.mock
async def test_correction_with_dangling_target_is_flagged_but_kept():
    # Documented behaviour: an explicit corrects_event_id UNKNOWN to the recent
    # context is kept (the model may know more than our short window) but flagged.
    extraction = {
        "events": [
            llm_event(
                unit_id="bravo-2",
                event_type="correction",
                location_reference="point d'eau numéro 2",
                facts=["point d'eau numéro 2 accessible"],
                urgency="medium",
                confidence=0.8,
                is_correction=True,
                corrects_event_id="evt-does-not-exist",
                evidence_text="annulez mon dernier message",
            )
        ],
        "confidence": 0.8,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_10", extraction, recent_context=POINT_EAU_CONTEXT)

    correction = result.events[0]
    assert correction["corrects_event_id"] == "evt-does-not-exist"
    assert any("absent du contexte récent" in u for u in correction["uncertainties"])


# ---------------------------------------------------------------------------
# Vehicle-type restrictions — structured facts must distinguish CCF vs VL
# ---------------------------------------------------------------------------


@respx.mock
async def test_vehicle_restriction_bridge_ccf_blocked_vl_allowed():
    # msg_12 — the bridge is CONDITIONAL: closed for CCF, open for VL.
    extraction = {
        "events": [
            llm_event(
                unit_id="delta-4",
                event_type="road_status",
                location_reference="pont sur le ruisseau",
                facts=[
                    "pont sur le ruisseau limité à 3,5 tonnes",
                    "les camions-citernes (CCF) ne peuvent pas traverser",
                    "les véhicules légers (VL) peuvent traverser",
                ],
                urgency="medium",
                confidence=0.9,
                evidence_text=(
                    "Les camions-citernes ne passent pas, seuls les véhicules légers peuvent traverser."
                ),
            )
        ],
        "confidence": 0.9,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_12", extraction)

    facts = result.events[0]["facts"]
    # CCF side: mentioned AND negated (cannot cross).
    assert_fact_negated(facts, "camions-citernes", ["ne peuvent pas", "ne passent pas"])
    # VL side: mentioned WITHOUT negation (can cross).
    vl_facts = facts_matching(facts, "véhicules légers")
    assert vl_facts and all("peuvent traverser" in normalize_text(f) or "peuvent" in normalize_text(f) for f in vl_facts)
    assert not any("ne peuvent pas" in normalize_text(f) for f in vl_facts)
    # The bridge is NOT summarized as flatly blocked/closed.
    for fact in facts:
        norm = normalize_text(fact)
        assert "bloque" not in norm and "ferme" not in norm, (
            f"fact '{fact}' flattens the conditional restriction into a full closure"
        )
    # The tonnage limit survives as a structured fact.
    assert facts_matching(facts, "3,5 tonnes")


@respx.mock
async def test_vehicle_restriction_4x4_only_forest_track():
    # msg_13 — two roads mentioned; the restriction is on the forest track, not the D17.
    extraction = {
        "events": [
            llm_event(
                unit_id="alpha-3",
                event_type="road_status",
                location_reference="chemin forestier nord",
                facts=[
                    "chemin forestier nord praticable uniquement pour les 4x4",
                    "le fourgon pompe-tonne ne peut pas s'engager",
                ],
                urgency="medium",
                confidence=0.88,
                evidence_text="Le chemin forestier nord est praticable uniquement pour les 4x4.",
            )
        ],
        "confidence": 0.88,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_13", extraction)

    event = result.events[0]
    # The restriction is anchored on the right road.
    assert normalize_text(event["location_reference"]) == normalize_text("chemin forestier nord")
    assert facts_matching(event["facts"], "4x4")
    assert_fact_negated(event["facts"], "fourgon pompe-tonne", ["ne peut pas"])


# ---------------------------------------------------------------------------
# Ambiguous numbers — normalization + uncertainty preserved
# ---------------------------------------------------------------------------


@respx.mock
async def test_noisy_number_truande_normalized_to_30_percent_with_uncertainty():
    # msg_27 — « truande pour cent » (STT) lifted to 30% by the clear repetition.
    extraction = {
        "events": [
            llm_event(
                unit_id="delta-4",
                event_type="resource_update",
                facts=["environ 30% d'eau restante", "ravitaillement nécessaire sous 30 minutes"],
                urgency="high",
                confidence=0.85,
                uncertainties=["'truande pour cent' interprété comme 'trente pour cent' (répétition claire)"],
                evidence_text="il nous reste truande pour cent d'eau je répète trente pour cent",
            )
        ],
        "confidence": 0.85,
        "uncertainties": ["'truande pour cent' interprété comme 'trente pour cent'"],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_27", extraction)

    event = result.events[0]
    # Normalized figure present, STT garbage absent from the FACTS.
    assert facts_matching(event["facts"], "30")
    assert not facts_matching(event["facts"], "truande")
    # The STT interpretation stays visible as an uncertainty.
    assert any("truande" in u for u in event["uncertainties"])
    # The noisy evidence IS a real transcript span -> no degradation.
    assert event["confidence"] == pytest.approx(0.85)
    assert not any(EVIDENCE_NOT_FOUND in u for u in event["uncertainties"])


@respx.mock
async def test_unresolved_30_vs_13_keeps_both_figures_uncertain():
    # msg_15 — the speaker HIMSELF cannot decide between 30% and 13%.
    extraction = {
        "events": [
            llm_event(
                unit_id="delta-4",
                event_type="resource_update",
                facts=[
                    "niveau de carburant du groupe électrogène incertain : 30% ou 13%",
                    "vérification en cours, nouveau contact à venir",
                ],
                urgency="medium",
                confidence=0.6,
                uncertainties=["ambiguïté non résolue entre 30% et 13% de carburant"],
                evidence_text="je ne sais plus si c'est trente ou treize pour cent de carburant",
            )
        ],
        "confidence": 0.6,
        "uncertainties": ["ambiguïté non résolue entre 30% et 13% de carburant"],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_15", extraction)

    event = result.events[0]
    # Neither figure may be presented as certain: any fact quoting one figure
    # must carry the other one (or the ambiguity would be silently resolved).
    fuel_facts = facts_matching(event["facts"], "carburant")
    assert fuel_facts
    for fact in fuel_facts:
        norm = normalize_text(fact)
        if "30" in norm or "13" in norm:
            assert "30" in norm and "13" in norm, (
                f"fact '{fact}' resolves the 30/13 ambiguity to a single figure"
            )
    assert event["uncertainties"], "the unresolved ambiguity must be flagged"
    assert result.confidence <= 0.6


# ---------------------------------------------------------------------------
# Missing speaker — unit_id forced to 'unknown' + uncertainty, never invented
# ---------------------------------------------------------------------------


@respx.mock
async def test_missing_speaker_hallucinated_unit_forced_to_unknown():
    # msg_17 — nobody identifies themselves; the model INVENTS 'echo-5'.
    extraction = {
        "events": [
            llm_event(
                unit_id="echo-5",  # hallucinated: not part of known_units
                event_type="road_status",
                location_reference="piste d'accès sud",
                facts=["arbre en travers de la piste d'accès sud", "camion ne peut pas passer"],
                urgency="medium",
                confidence=0.8,
                evidence_text="on a un arbre en travers de la piste d'accès sud",
            )
        ],
        "confidence": 0.8,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_17", extraction)

    event = result.events[0]
    assert event["unit_id"] == UNKNOWN_UNIT
    assert any("echo-5" in u for u in event["uncertainties"])
    # The road fact itself is intact and not degraded (evidence is real).
    assert event["confidence"] == pytest.approx(0.8)


@respx.mock
async def test_missing_speaker_pc_is_not_a_field_unit():
    # msg_18 — cut transmission, the PC itself asks who is talking; the model
    # wrongly attributes the message to 'PC'.
    extraction = {
        "events": [
            llm_event(
                unit_id="PC",  # the command post is not a known field unit
                event_type="wind_update",
                location_reference="sommet",
                facts=["rafales très violentes au sommet", "vent en renforcement"],
                urgency="high",
                confidence=0.75,
                uncertainties=["locuteur non identifié, transmission coupée"],
                evidence_text="Le vent forcit encore, rafales très violentes au sommet.",
            )
        ],
        "confidence": 0.75,
        "uncertainties": ["locuteur non identifié"],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_18", extraction)

    event = result.events[0]
    assert event["unit_id"] == UNKNOWN_UNIT
    # Both the model's own doubt AND the guardrail's unit uncertainty are kept.
    assert any("locuteur non identifié" in u for u in event["uncertainties"])
    assert any("PC" in u for u in event["uncertainties"])


# ---------------------------------------------------------------------------
# Contradictory reports — 2nd event flagged, NO silent fusion
# ---------------------------------------------------------------------------

MSG19_EXTRACTION = {
    "events": [
        llm_event(
            unit_id="alpha-3",
            event_type="road_status",
            location_reference="D17",
            facts=["D17 de nouveau totalement bloquée", "pin tombé au niveau du virage"],
            urgency="high",
            confidence=0.9,
            evidence_text="la D17 est de nouveau totalement bloquée",
        )
    ],
    "confidence": 0.9,
    "uncertainties": [],
    "proposed_tool_calls": [],
}


def msg20_extraction(**event_overrides) -> dict:
    return {
        "events": [
            llm_event(
                unit_id="bravo-2",
                event_type="road_status",
                location_reference="D17",
                facts=[
                    "D17 dégagée côté sud au niveau du virage selon Bravo 2",
                    "demande de confirmation de position à Alpha 3",
                ],
                urgency="high",
                confidence=0.85,
                uncertainties=[
                    "contradiction avec le rapport précédent d'Alpha 3 (D17 bloquée)"
                ],
                evidence_text="nous venons de passer la D17 au virage, la voie est dégagée côté sud",
                **event_overrides,
            )
        ],
        "confidence": 0.85,
        "uncertainties": ["rapports contradictoires sur l'état de la D17"],
        "proposed_tool_calls": [],
    }


@respx.mock
async def test_contradictory_reports_second_event_flagged_not_fused():
    # msg_19 then msg_20: two units report OPPOSITE states of the D17.
    first = await run_msg("msg_19", MSG19_EXTRACTION)
    blocked_event = first.events[0]
    assert facts_matching(blocked_event["facts"], "bloquée")

    second = await run_msg("msg_20", msg20_extraction(), recent_context=[blocked_event])

    cleared_event = second.events[0]
    # Two DISTINCT events from two units — neither corrects the other.
    assert cleared_event["event_id"] != blocked_event["event_id"]
    assert cleared_event["is_correction"] is False
    assert cleared_event["corrects_event_id"] is None
    # The contradiction stays an OPEN uncertainty on the 2nd event.
    assert any("contradiction" in u.lower() for u in cleared_event["uncertainties"])
    assert any("contradictoire" in u.lower() for u in second.uncertainties)
    # The first report was NOT silently mutated by the second extraction.
    assert facts_matching(blocked_event["facts"], "bloquée")
    assert blocked_event["confidence"] == pytest.approx(0.9)


@respx.mock
async def test_contradiction_context_is_visible_to_the_model():
    first = await run_msg("msg_19", MSG19_EXTRACTION)
    blocked_event = first.events[0]

    await run_msg("msg_20", msg20_extraction(), recent_context=[blocked_event])

    request = json.loads(respx.calls.last.request.content)
    user_msg = request["messages"][1]["content"]
    # The model DID see the contradictory prior event (id + facts).
    assert blocked_event["event_id"] in user_msg
    assert "totalement bloquée" in user_msg
    assert DATASET["msg_20"]["transcript"] in user_msg


@respx.mock
async def test_non_correction_event_cannot_silently_link_a_prior_event():
    # Silent-fusion attempt: the model returns is_correction=false BUT still
    # sets corrects_event_id on the contradictory prior event. Keeping that
    # dangling link would let downstream consumers overwrite Alpha 3's report
    # without any correction semantics. The guardrail must strip it and flag it.
    first = await run_msg("msg_19", MSG19_EXTRACTION)
    blocked_event = first.events[0]

    sneaky = msg20_extraction(corrects_event_id=blocked_event["event_id"])
    second = await run_msg("msg_20", sneaky, recent_context=[blocked_event])

    cleared_event = second.events[0]
    assert cleared_event["is_correction"] is False
    assert cleared_event["corrects_event_id"] is None  # link stripped
    assert any("lien supprimé" in u for u in cleared_event["uncertainties"])


# ---------------------------------------------------------------------------
# Confirmed vs unconfirmed — hearsay stays reported, confirmed is never downgraded
# ---------------------------------------------------------------------------

#: A field-CONFIRMED prior event (msg_21: power line down, direct visual).
CONFIRMED_LINE_EVENT = {
    "event_id": "evt-msg21-line",
    "audio_id": "msg_21",
    "unit_id": "charlie-1",
    "event_type": "confirmation",
    "location_reference": "route de la carrière",
    "facts": ["ligne électrique tombée sur la route de la carrière"],
    "urgency": "critical",
    "confidence": 0.93,
    "confirmation_status": "confirmed",
    "is_correction": False,
    "corrects_event_id": None,
    "uncertainties": [],
    "evidence_text": "confirmation visuelle : la ligne électrique est bien tombée sur la route de la carrière",
    "observed_at": "2026-07-25T10:30:00+00:00",
    "source_type": "human_report",
}


@respx.mock
async def test_visual_confirmation_yields_confirmed_status():
    # msg_21 — explicit direct visual -> confirmed.
    extraction = {
        "events": [
            llm_event(
                unit_id="charlie-1",
                event_type="confirmation",
                location_reference="route de la carrière",
                facts=["ligne électrique tombée sur la route de la carrière"],
                urgency="critical",
                confidence=0.93,
                confirmation_status="confirmed",
                evidence_text=(
                    "confirmation visuelle : la ligne électrique est bien tombée sur la route de la carrière"
                ),
            )
        ],
        "confidence": 0.93,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_21", extraction)

    event = result.events[0]
    assert event["confirmation_status"] == "confirmed"
    assert event["confidence"] == pytest.approx(0.93)  # real evidence, no degradation


@respx.mock
async def test_third_party_hearsay_stays_reported_never_confirmed():
    # msg_22 — inhabitants report a gas bottle, explicitly NO visual.
    extraction = {
        "events": [
            llm_event(
                unit_id="delta-4",
                event_type="hazard_report",
                location_reference="maison en pierre",
                facts=[
                    "bouteille de gaz signalée par des habitants dans la remise",
                    "aucune confirmation visuelle",
                ],
                urgency="high",
                confidence=0.7,
                confirmation_status="reported",
                uncertainties=["signalement de tiers non vérifié"],
                evidence_text="Des habitants nous signalent une bouteille de gaz dans la remise",
            )
        ],
        "confidence": 0.7,
        "uncertainties": ["signalement de tiers non vérifié"],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_22", extraction)

    event = result.events[0]
    assert event["confirmation_status"] == "reported"
    assert event["confirmation_status"] != "confirmed"
    assert event["uncertainties"], "unverified hearsay must carry an uncertainty"


@respx.mock
async def test_confirmed_prior_event_cannot_be_downgraded_by_new_hearsay():
    # Downgrade attempt: with the CONFIRMED power-line event in context, the
    # model links new unrelated hearsay to it (corrects_event_id) while
    # is_correction=false. If the link survived, downstream would replace a
    # CONFIRMED event with a mere 'reported' one — a forbidden retrogradation.
    baseline = json.loads(json.dumps(CONFIRMED_LINE_EVENT))
    extraction = {
        "events": [
            llm_event(
                unit_id="delta-4",
                event_type="hazard_report",
                location_reference="maison en pierre",
                facts=["bouteille de gaz signalée par des habitants dans la remise"],
                urgency="high",
                confidence=0.7,
                confirmation_status="reported",
                is_correction=False,
                corrects_event_id="evt-msg21-line",  # illegitimate downgrade link
                evidence_text="Des habitants nous signalent une bouteille de gaz dans la remise",
            )
        ],
        "confidence": 0.7,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_22", extraction, recent_context=[CONFIRMED_LINE_EVENT])

    new_event = result.events[0]
    # The new event stands alone: reported, no link to the confirmed event.
    assert new_event["confirmation_status"] == "reported"
    assert new_event["corrects_event_id"] is None
    assert any("lien supprimé" in u for u in new_event["uncertainties"])
    # The confirmed prior event is untouched (the agent never mutates context).
    assert CONFIRMED_LINE_EVENT == baseline
    assert CONFIRMED_LINE_EVENT["confirmation_status"] == "confirmed"


# ---------------------------------------------------------------------------
# Guardrails under stress — mixed real + invented evidence in one batch
# ---------------------------------------------------------------------------


@respx.mock
async def test_only_events_with_invented_evidence_are_degraded():
    # msg_16 — 3 events in one answer: two grounded, one hallucinated
    # ('les flammes ont atteint la scierie' appears NOWHERE in the transcript).
    extraction = {
        "events": [
            llm_event(
                unit_id="charlie-1",
                event_type="hazard_report",
                location_reference="scierie",
                facts=["deux foyers distincts visibles derrière la scierie"],
                urgency="high",
                confidence=0.85,
                evidence_text="On voit deux, peut-être trois foyers distincts derrière la scierie",
            ),
            llm_event(
                unit_id="charlie-1",
                event_type="hazard_report",
                location_reference="scierie",
                facts=["les flammes ont atteint la scierie"],  # INVENTED
                urgency="critical",
                confidence=0.8,
                evidence_text="les flammes ont atteint la scierie",  # not in transcript
            ),
            llm_event(
                unit_id="charlie-1",
                event_type="hazard_report",
                location_reference="scierie",
                facts=["un troisième foyer possible non confirmé"],
                urgency="high",
                confidence=0.75,
                confirmation_status="inferred",
                evidence_text="Impossible de confirmer le troisième depuis notre position",
            ),
        ],
        "confidence": 0.8,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_16", extraction)

    grounded_1, invented, grounded_2 = result.events
    # ONLY the invented-evidence event is degraded.
    assert invented["confidence"] <= DEGRADED_CONFIDENCE
    assert any(EVIDENCE_NOT_FOUND in u for u in invented["uncertainties"])
    assert grounded_1["confidence"] == pytest.approx(0.85)
    assert not any(EVIDENCE_NOT_FOUND in u for u in grounded_1["uncertainties"])
    assert grounded_2["confidence"] == pytest.approx(0.75)
    assert not any(EVIDENCE_NOT_FOUND in u for u in grounded_2["uncertainties"])
    # The hallucination drags the GLOBAL confidence down with it.
    assert result.confidence <= DEGRADED_CONFIDENCE


# ---------------------------------------------------------------------------
# Noisy STT — normalization to canonical entities, garbage kept out of facts
# ---------------------------------------------------------------------------


@respx.mock
async def test_noisy_stt_dedicite_normalized_to_d17():
    # msg_24 — « la dédicite » = la D17, « pécé » = PC (real whisper-small output).
    extraction = {
        "events": [
            llm_event(
                unit_id="alpha-3",
                event_type="road_status",
                location_reference="D17",
                facts=["D17 bloquée au niveau du pont", "camion-citerne fait demi-tour"],
                urgency="high",
                confidence=0.8,
                uncertainties=["'dédicite' interprété comme D17 (STT bruité)"],
                evidence_text="la dédicite est bloquée au niveau du pont",
            )
        ],
        "confidence": 0.8,
        "uncertainties": ["'dédicite' interprété comme D17 (STT bruité)"],
        "proposed_tool_calls": [],
    }

    result = await run_msg("msg_24", extraction)

    event = result.events[0]
    # Canonical entity in location + facts; the STT garbage never leaks there.
    assert event["location_reference"] == "D17"
    assert facts_matching(event["facts"], "D17")
    assert not facts_matching(event["facts"], "dédicite")
    # The noisy-but-REAL evidence span is accepted -> no degradation.
    assert event["confidence"] == pytest.approx(0.8)
    assert not any(EVIDENCE_NOT_FOUND in u for u in event["uncertainties"])
    # The STT interpretation is auditable via uncertainties.
    assert any("dédicite" in u for u in event["uncertainties"])


# ---------------------------------------------------------------------------
# Partially valid batches — documented behaviour: batch-level repair, all-or-nothing
# ---------------------------------------------------------------------------

VALID_GAS_EVENT = llm_event(
    unit_id="charlie-1",
    event_type="hazard_report",
    location_reference="bâtiment",
    facts=["bouteilles de gaz à l'arrière du bâtiment", "évacuation du périmètre en cours"],
    urgency="critical",
    confidence=0.85,
    evidence_text="les bouteilles de gars sont à l'arrière du bâtiment",
)


def batch_with_one_invalid_event() -> dict:
    invalid = llm_event(
        unit_id="charlie-1",
        event_type="hazard_report",
        facts=["évacuation en cours"],
        urgency="urgente",  # NOT in the urgency enum -> schema violation
        confidence=0.8,
        evidence_text="évacuation du périmètre en cours",
    )
    return {
        "events": [VALID_GAS_EVENT, invalid],
        "confidence": 0.85,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }


@respx.mock
async def test_partially_valid_batch_triggers_repair_then_succeeds():
    # DOCUMENTED BEHAVIOUR: schema validation is BATCH-LEVEL. One invalid event
    # rejects the whole answer; the client re-prompts with the exact validation
    # error and the repaired answer (valid events only) is accepted. The valid
    # event is NOT extracted from the broken batch (no partial acceptance).
    repaired = {
        "events": [VALID_GAS_EVENT],
        "confidence": 0.85,
        "uncertainties": [],
        "proposed_tool_calls": [],
    }
    respx.post(CHAT_URL).mock(
        side_effect=[
            httpx.Response(
                200, json=completion_body(json.dumps(batch_with_one_invalid_event(), ensure_ascii=False))
            ),
            httpx.Response(200, json=completion_body(json.dumps(repaired, ensure_ascii=False))),
        ]
    )
    client = GemmaClient(base_url=BASE_URL, retry_backoff_s=0.0, repair_attempts=1)
    agent = RadioIntelligenceAgent(client, known_units=KNOWN_UNITS)
    try:
        result = await agent.extract(message_input("msg_26"))
    finally:
        await client.aclose()

    assert result.attempts == 2
    assert respx.calls.call_count == 2
    assert len(result.events) == 1
    assert result.events[0]["event_type"] == "hazard_report"
    assert result.events[0]["confidence"] == pytest.approx(0.85)
    # The repair prompt carried the validator error back to the model.
    repair_request = json.loads(respx.calls.last.request.content)
    repair_msg = repair_request["messages"][-1]["content"]
    assert "rejected by the JSON validator" in repair_msg
    assert "urgente" in repair_msg or "urgency" in repair_msg


@respx.mock
async def test_partially_valid_batch_twice_is_all_or_nothing():
    # DOCUMENTED BEHAVIOUR: if the batch NEVER validates, the agent raises a
    # typed StructuredOutputError — it never silently returns the valid subset.
    broken = json.dumps(batch_with_one_invalid_event(), ensure_ascii=False)
    respx.post(CHAT_URL).mock(
        side_effect=[
            httpx.Response(200, json=completion_body(broken)),
            httpx.Response(200, json=completion_body(broken)),
        ]
    )
    client = GemmaClient(base_url=BASE_URL, retry_backoff_s=0.0, repair_attempts=1)
    agent = RadioIntelligenceAgent(client, known_units=KNOWN_UNITS)
    try:
        with pytest.raises(StructuredOutputError) as exc_info:
            await agent.extract(message_input("msg_26"))
    finally:
        await client.aclose()

    assert exc_info.value.attempts == 2
    assert respx.calls.call_count == 2
    # The schema violation is precisely reported for observability.
    assert "urgente" in exc_info.value.last_error or "urgency" in exc_info.value.last_error


# ---------------------------------------------------------------------------
# Dataset coverage sanity — this suite really exercises >= 10 NEW transcripts
# ---------------------------------------------------------------------------


def test_adversarial_suite_covers_at_least_10_new_dataset_transcripts():
    used_ids = {
        "msg_06", "msg_07", "msg_08",          # negation
        "msg_10",                                # implicit correction
        "msg_12", "msg_13",                      # vehicle restriction
        "msg_15", "msg_27",                      # ambiguous numbers
        "msg_16",                                # ambiguous count + invented evidence
        "msg_17", "msg_18",                      # missing speaker
        "msg_19", "msg_20",                      # contradiction
        "msg_21", "msg_22",                      # confirmed vs unconfirmed
        "msg_24", "msg_26",                      # noisy STT / partial batches
    }
    demo_ids = {mid for mid, row in DATASET.items() if row["category"] == "demo"}
    assert used_ids <= set(DATASET), "all adversarial ids must exist in the #19 dataset"
    assert not (used_ids & demo_ids), "adversarial suite must not re-test the 5 demo messages"
    assert len(used_ids) >= 10
