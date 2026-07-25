"""Tests for the deterministic safety-rule engine (pure code, no LLM, no network)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from agents.safety_critic.rules import (
    ESCALATE_BLOCK,
    FAIL,
    PASS,
    STALENESS_RULE_ID,
    WARNING,
    WEAK_SOURCE_RULE_ID,
    load_safety_rules,
    mechanical_status,
    run_rule_checks,
)

NOW = datetime(2026, 7, 25, 14, 0, 0, tzinfo=timezone.utc)

SEEDED_RULES = load_safety_rules()

UNITS = [
    {"unit_id": "alpha-3", "callsign": "Alpha 3", "vehicle_type": "CCF", "water_pct": 65},
    {"unit_id": "bravo-2", "callsign": "Bravo 2", "vehicle_type": "light_vehicle", "water_pct": None},
    {"unit_id": "charlie-1", "callsign": "Charlie 1", "vehicle_type": "light_vehicle", "water_pct": None},
]


def make_snapshot(**overrides) -> dict:
    snapshot = {
        "incident_id": "wildfire-demo-01",
        "version": 3,
        "radio_events": ["re-001", "re-002"],
        "weather": {"temperature_c": 34, "wind_speed_kmh": 30, "visibility": "good"},
        "roads": [
            {
                "road_id": "d17",
                "status": "open",
                "allowed_vehicle_types": ["CCF", "light_vehicle", "command_post"],
                "restrictions": [],
            },
            {
                "road_id": "north-access",
                "status": "open",
                "allowed_vehicle_types": ["CCF", "light_vehicle", "command_post"],
                "restrictions": [],
            },
            {
                "road_id": "forest-track-5",
                "status": "open",
                "allowed_vehicle_types": ["light_vehicle"],
                "restrictions": [{"vehicle_type": "CCF", "reason": "not rated for heavy vehicles"}],
            },
        ],
        "known_facts": [],
        "uncertain_facts": [],
        "conflicts": [],
        "missing_information": [],
        "provenance": [
            {
                "field": "roads",
                "source_type": "seeded_demo",
                "source_name": "scenario-roads",
                "retrieved_at": (NOW - timedelta(minutes=2)).isoformat(),
            }
        ],
        "generated_at": NOW.isoformat(),
    }
    snapshot.update(overrides)
    return snapshot


def make_action(**overrides) -> dict:
    action = {
        "action_id": "act-1",
        "unit_id": "alpha-3",
        "action_type": "attack",
        "instruction": "Direct attack on the fire edge in sector B12.",
        "route": "north-access",
        "destination": "sector-b12",
        "reason": "Contain the head of the fire.",
        "priority": "high",
        "evidence_ids": ["re-001", "re-002"],
        "confidence": 0.85,
        "human_approval_required": True,
        "acknowledgement_required": True,
    }
    action.update(overrides)
    return action


def make_plan(actions: list[dict], **overrides) -> dict:
    plan = {
        "plan_id": "plan-demo-v1",
        "incident_id": "wildfire-demo-01",
        "version": 1,
        "summary": "Test plan",
        "objectives": ["Contain sector B12"],
        "unit_actions": actions,
        "created_at": NOW.isoformat(),
    }
    plan.update(overrides)
    return plan


def checks_by_id(checks) -> dict:
    return {c.rule_id: c for c in checks}


def retreat_action(unit_id: str = "alpha-3", route: str = "north-access") -> dict:
    return make_action(
        action_id=f"act-retreat-{unit_id}",
        unit_id=unit_id,
        action_type="retreat",
        route=route,
        instruction="Retreat toward Water Point 2 via North Access.",
        reason="Mandatory retreat option.",
    )


# ---------------------------------------------------------------------------
# Rules loading
# ---------------------------------------------------------------------------


def test_seeded_rules_load_with_expected_ids():
    ids = {r["rule_id"] for r in SEEDED_RULES}
    assert ids == {
        "sr-retreat-route",
        "sr-vehicle-road-compat",
        "sr-min-water",
        "sr-visibility",
        "sr-hazmat-perimeter",
        "sr-human-approval",
    }
    water = next(r for r in SEEDED_RULES if r["rule_id"] == "sr-min-water")
    # The seeded hard threshold really is 20% (35% for the refill plan).
    assert water["parameters"]["min_engagement_water_pct"] == 20
    assert water["parameters"]["refill_plan_water_pct"] == 35


# ---------------------------------------------------------------------------
# sr-retreat-route
# ---------------------------------------------------------------------------


def test_engaged_unit_without_retreat_option_fails():
    plan = make_plan([make_action()])  # attack, no retreat anywhere
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), UNITS, rules=SEEDED_RULES))
    check = checks["sr-retreat-route"]
    assert check.status == FAIL
    assert check.escalation == ESCALATE_BLOCK
    assert "alpha-3" in check.details


def test_engaged_unit_with_retreat_action_passes():
    plan = make_plan([make_action(), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), UNITS, rules=SEEDED_RULES))
    assert checks["sr-retreat-route"].status == PASS


def test_retreat_route_incompatible_with_vehicle_fails():
    # CCF retreat over forest-track-5, which is light-vehicles only.
    plan = make_plan([make_action(), retreat_action(route="forest-track-5")])
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), UNITS, rules=SEEDED_RULES))
    check = checks["sr-retreat-route"]
    assert check.status == FAIL
    assert "forest-track-5" in check.details


# ---------------------------------------------------------------------------
# sr-vehicle-road-compat
# ---------------------------------------------------------------------------


def test_ccf_routed_on_restricted_d17_fails_compatibility():
    # Scenario update: D17 becomes light-vehicles only.
    snapshot = make_snapshot(
        roads=[
            {
                "road_id": "d17",
                "status": "open",
                "allowed_vehicle_types": ["light_vehicle"],
                "restrictions": [{"vehicle_type": "CCF", "reason": "restricted to light vehicles"}],
            },
            {
                "road_id": "north-access",
                "status": "open",
                "allowed_vehicle_types": ["CCF", "light_vehicle", "command_post"],
                "restrictions": [],
            },
        ]
    )
    plan = make_plan([make_action(route="d17"), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, snapshot, UNITS, rules=SEEDED_RULES))
    check = checks["sr-vehicle-road-compat"]
    assert check.status == FAIL
    assert check.escalation == ESCALATE_BLOCK
    assert "d17" in check.details and "CCF" in check.details


def test_closed_road_fails_compatibility():
    snapshot = make_snapshot(
        roads=[
            {"road_id": "d17", "status": "closed", "allowed_vehicle_types": ["CCF"], "restrictions": []},
            {
                "road_id": "north-access",
                "status": "open",
                "allowed_vehicle_types": ["CCF", "light_vehicle", "command_post"],
                "restrictions": [],
            },
        ]
    )
    plan = make_plan([make_action(route="d17"), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, snapshot, UNITS, rules=SEEDED_RULES))
    assert checks["sr-vehicle-road-compat"].status == FAIL


def test_compatible_route_passes():
    plan = make_plan([make_action(route="north-access"), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), UNITS, rules=SEEDED_RULES))
    assert checks["sr-vehicle-road-compat"].status == PASS


# ---------------------------------------------------------------------------
# sr-min-water (seeded thresholds: hard 20%, refill plan 35%)
# ---------------------------------------------------------------------------


def test_attack_below_hard_water_threshold_fails_with_block():
    units = [dict(UNITS[0], water_pct=15)] + UNITS[1:]  # 15% < 20% hard minimum
    plan = make_plan([make_action(), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), units, rules=SEEDED_RULES))
    check = checks["sr-min-water"]
    assert check.status == FAIL
    assert check.escalation == ESCALATE_BLOCK
    assert "15" in check.details and "20" in check.details


def test_attack_at_30pct_without_refill_plan_fails():
    # 30% is ABOVE the 20% hard threshold but below 35%: a refill plan is required.
    units = [dict(UNITS[0], water_pct=30)] + UNITS[1:]
    plan = make_plan([make_action(), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), units, rules=SEEDED_RULES))
    check = checks["sr-min-water"]
    assert check.status == FAIL
    assert check.escalation == "revise"  # not an immediate block, but must be revised
    assert "refill" in check.details.lower()


def test_attack_at_30pct_with_refill_plan_passes():
    units = [dict(UNITS[0], water_pct=30)] + UNITS[1:]
    refill = make_action(
        action_id="act-refill",
        action_type="refill",
        destination="water-point-2",
        route="north-access",
        instruction="Refill at Water Point 2 after first pass.",
    )
    plan = make_plan([make_action(), refill, retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), units, rules=SEEDED_RULES))
    assert checks["sr-min-water"].status == PASS


def test_water_ok_passes():
    plan = make_plan([make_action(), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), UNITS, rules=SEEDED_RULES))
    assert checks["sr-min-water"].status == PASS


# ---------------------------------------------------------------------------
# sr-visibility
# ---------------------------------------------------------------------------


def test_offensive_tasking_in_near_zero_visibility_fails():
    snapshot = make_snapshot(weather={"visibility": "near_zero"})
    plan = make_plan([make_action(), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, snapshot, UNITS, rules=SEEDED_RULES))
    check = checks["sr-visibility"]
    assert check.status == FAIL
    assert "alpha-3" in check.details


def test_near_zero_visibility_without_offensive_tasking_warns():
    snapshot = make_snapshot(weather={"visibility": "near_zero"})
    plan = make_plan([make_action(action_type="reconnaissance", unit_id="bravo-2", route=None)])
    checks = checks_by_id(run_rule_checks(plan, snapshot, UNITS, rules=SEEDED_RULES))
    assert checks["sr-visibility"].status == WARNING


# ---------------------------------------------------------------------------
# sr-hazmat-perimeter
# ---------------------------------------------------------------------------


def test_unconfirmed_hazmat_without_perimeter_fails():
    snapshot = make_snapshot(
        uncertain_facts=["Gas cylinders reported near the hangar — unconfirmed"]
    )
    plan = make_plan([make_action(), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, snapshot, UNITS, rules=SEEDED_RULES))
    check = checks["sr-hazmat-perimeter"]
    assert check.status == FAIL
    assert check.escalation == ESCALATE_BLOCK
    assert "300" in check.details


def test_hazmat_with_perimeter_action_passes():
    snapshot = make_snapshot(
        uncertain_facts=["Gas cylinders reported near the hangar — unconfirmed"]
    )
    perimeter = make_action(
        action_id="act-perimeter",
        unit_id="bravo-2",
        action_type="establish_perimeter",
        route=None,
        instruction="Establish a 300 m exclusion perimeter around the hangar.",
    )
    plan = make_plan([make_action(), retreat_action(), perimeter])
    checks = checks_by_id(run_rule_checks(plan, snapshot, UNITS, rules=SEEDED_RULES))
    assert checks["sr-hazmat-perimeter"].status == PASS


# ---------------------------------------------------------------------------
# sr-human-approval
# ---------------------------------------------------------------------------


def test_action_without_human_approval_fails():
    plan = make_plan([make_action(human_approval_required=False), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), UNITS, rules=SEEDED_RULES))
    check = checks["sr-human-approval"]
    assert check.status == FAIL
    assert check.escalation == ESCALATE_BLOCK


# ---------------------------------------------------------------------------
# Staleness + single weak source flags (warnings)
# ---------------------------------------------------------------------------


def test_stale_provenance_is_flagged():
    snapshot = make_snapshot(
        provenance=[
            {
                "field": "fire_hotspots",
                "source_type": "cached_public",
                "source_name": "nasa-firms-cache",
                "retrieved_at": (NOW - timedelta(hours=3)).isoformat(),
            }
        ]
    )
    plan = make_plan([make_action(), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, snapshot, UNITS, rules=SEEDED_RULES))
    check = checks[STALENESS_RULE_ID]
    assert check.status == WARNING
    assert "fire_hotspots" in check.details


def test_single_weak_source_action_is_flagged():
    weak = make_action(evidence_ids=["re-radio-noisy-1"], confidence=0.4)
    plan = make_plan([weak, retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), UNITS, rules=SEEDED_RULES))
    check = checks[WEAK_SOURCE_RULE_ID]
    assert check.status == WARNING
    assert "act-1" in check.details


def test_action_without_evidence_is_flagged():
    plan = make_plan([make_action(evidence_ids=[]), retreat_action()])
    checks = checks_by_id(run_rule_checks(plan, make_snapshot(), UNITS, rules=SEEDED_RULES))
    assert checks[WEAK_SOURCE_RULE_ID].status == WARNING


# ---------------------------------------------------------------------------
# Engine output shape + mechanical status floor
# ---------------------------------------------------------------------------


def test_every_check_has_required_fields():
    plan = make_plan([make_action(), retreat_action()])
    checks = run_rule_checks(plan, make_snapshot(), UNITS, rules=SEEDED_RULES)
    assert len(checks) == 8  # 6 seeded rules + staleness + weak-source flags
    for check in checks:
        payload = check.to_dict()
        assert set(payload) == {"rule_id", "status", "details", "evidence", "escalation"}
        assert payload["status"] in {"pass", "fail", "warning"}


def test_mechanical_status_floor():
    plan_ok = make_plan([make_action(), retreat_action()])
    assert mechanical_status(run_rule_checks(plan_ok, make_snapshot(), UNITS, rules=SEEDED_RULES)) == "pass"

    units_low = [dict(UNITS[0], water_pct=30)] + UNITS[1:]
    assert (
        mechanical_status(run_rule_checks(plan_ok, make_snapshot(), units_low, rules=SEEDED_RULES))
        == "revise"
    )

    units_critical = [dict(UNITS[0], water_pct=15)] + UNITS[1:]
    assert (
        mechanical_status(run_rule_checks(plan_ok, make_snapshot(), units_critical, rules=SEEDED_RULES))
        == "block"
    )
