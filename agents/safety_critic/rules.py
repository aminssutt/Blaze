"""Deterministic safety-rule engine for the BLAZE Safety Critic agent.

Pure code, NO LLM. Loads the seeded rules from ``data/scenario/safety_rules.json``
and mechanically checks every :class:`UnitAction` of a draft tactical plan against
the situation snapshot and the current unit states.

Every check produces a :class:`RuleCheck` with::

    {rule_id, status: pass|fail|warning, details, evidence}

plus an ``escalation`` hint (``revise`` or ``block``) used by the agent's hard
merge policy: any mechanical ``fail`` forces the final review status to at least
``revise`` (or ``block``), whatever the LLM critique says.

Implemented mechanical rules (seeded ids from safety_rules.json):

- ``sr-retreat-route``       every engaged unit has a valid, vehicle-compatible retreat option
- ``sr-vehicle-road-compat`` unit routes crossed with road status / vehicle restrictions
- ``sr-min-water``           suppression forbidden < 20% water; refill plan required < 35%
- ``sr-visibility``          no offensive tasking in near-zero visibility
- ``sr-hazmat-perimeter``    unconfirmed hazmat nearby => exclusion perimeter required
- ``sr-human-approval``      every action must carry human_approval_required = true

Additional critic-local flags (ids prefixed ``sc-``, warnings only):

- ``sc-data-staleness``      snapshot provenance older than the staleness threshold
- ``sc-single-weak-source``  action relying on zero or a single weak evidence source
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RULES_PATH = REPO_ROOT / "data" / "scenario" / "safety_rules.json"

PASS = "pass"
FAIL = "fail"
WARNING = "warning"

ESCALATE_REVISE = "revise"
ESCALATE_BLOCK = "block"

#: Action types that mean the unit is actively engaged on the fire (offensive).
OFFENSIVE_ACTION_TYPES = frozenset(
    {
        "attack",
        "direct_attack",
        "offensive",
        "offensive_attack",
        "suppress",
        "suppression",
        "extinguish",
        "fire_attack",
        "engage",
    }
)

#: Action types that mean the unit is engaged on scene (offensive or holding).
ENGAGED_ACTION_TYPES = OFFENSIVE_ACTION_TYPES | frozenset({"hold_position", "defend"})

#: Action types that count as a retreat / withdrawal move.
RETREAT_ACTION_TYPES = frozenset({"retreat", "withdraw", "withdrawal", "fallback", "evacuate"})

#: Action types that count as a water refill / resupply move.
REFILL_ACTION_TYPES = frozenset({"refill", "water_refill", "resupply", "replenish"})

#: Action types that establish an exclusion perimeter / cordon.
PERIMETER_ACTION_TYPES = frozenset(
    {"perimeter", "exclusion_perimeter", "cordon", "establish_perimeter", "secure_perimeter"}
)

#: Road statuses considered unusable.
BLOCKED_ROAD_STATUSES = frozenset({"closed", "blocked", "cut", "impassable"})

#: Weather visibility values considered near-zero / critical.
CRITICAL_VISIBILITY_VALUES = frozenset({"near_zero", "near-zero", "zero", "none", "critical"})
#: Numeric visibility (metres) at or below which visibility is critical.
CRITICAL_VISIBILITY_M = 50.0

#: Keywords marking a hazmat mention in snapshot facts / assets.
HAZMAT_KEYWORDS = ("hazmat", "hazardous", "gas cylinder", "gas cylinders", "chemical", "explosive")

#: Default staleness threshold for snapshot provenance entries.
DEFAULT_STALENESS_THRESHOLD_S = 15 * 60

#: Below this confidence, a single-source action is considered weakly supported.
WEAK_SINGLE_SOURCE_CONFIDENCE = 0.6

STALENESS_RULE_ID = "sc-data-staleness"
WEAK_SOURCE_RULE_ID = "sc-single-weak-source"


@dataclass
class RuleCheck:
    """Result of one mechanical rule check."""

    rule_id: str
    status: str  # pass | fail | warning
    details: str
    evidence: list[str] = field(default_factory=list)
    #: If status == fail, how hard the merge policy must react (revise | block).
    escalation: str = ESCALATE_REVISE

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "status": self.status,
            "details": self.details,
            "evidence": list(self.evidence),
            "escalation": self.escalation,
        }


def load_safety_rules(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Load the seeded safety rules from data/scenario/safety_rules.json."""
    rules_path = Path(path) if path is not None else DEFAULT_RULES_PATH
    payload = json.loads(rules_path.read_text(encoding="utf-8"))
    return list(payload.get("rules", []))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _rule_param(rules: Sequence[Mapping[str, Any]], rule_id: str, key: str, default: Any) -> Any:
    for rule in rules:
        if rule.get("rule_id") == rule_id:
            return (rule.get("parameters") or {}).get(key, default)
    return default


def _unit_index(units: Iterable[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    return {str(u.get("unit_id")): u for u in units if u.get("unit_id")}


def _road_index(snapshot: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    return {
        str(r.get("road_id")): r
        for r in (snapshot.get("roads") or [])
        if isinstance(r, Mapping) and r.get("road_id")
    }


def _action_type(action: Mapping[str, Any]) -> str:
    return str(action.get("action_type") or "").strip().lower()


def _is_offensive(action: Mapping[str, Any]) -> bool:
    return _action_type(action) in OFFENSIVE_ACTION_TYPES


def _is_engaged(action: Mapping[str, Any]) -> bool:
    return _action_type(action) in ENGAGED_ACTION_TYPES


def _is_retreat(action: Mapping[str, Any]) -> bool:
    return _action_type(action) in RETREAT_ACTION_TYPES


def _is_refill(action: Mapping[str, Any]) -> bool:
    if _action_type(action) in REFILL_ACTION_TYPES:
        return True
    if _action_type(action) in RETREAT_ACTION_TYPES:
        return False  # a retreat toward a water point is an escape, not a refill plan
    destination = str(action.get("destination") or "").lower()
    return destination.startswith("water-point") or destination.startswith("water_point")


def _is_perimeter(action: Mapping[str, Any]) -> bool:
    atype = _action_type(action)
    if atype in PERIMETER_ACTION_TYPES:
        return True
    return "perimeter" in atype or "cordon" in atype


def _road_compatible(road: Mapping[str, Any], vehicle_type: str) -> tuple[bool, str]:
    """Check one road against one vehicle type. Returns (ok, reason)."""
    status = str(road.get("status") or road.get("initial_status") or "open").lower()
    if status in BLOCKED_ROAD_STATUSES:
        return False, f"road {road.get('road_id')} is {status}"
    allowed = road.get("allowed_vehicle_types")
    if allowed is not None and vehicle_type and vehicle_type not in allowed:
        return False, (
            f"vehicle type {vehicle_type!r} not in allowed types {sorted(allowed)} "
            f"for road {road.get('road_id')}"
        )
    for restriction in road.get("restrictions") or []:
        if str(restriction.get("vehicle_type")) == vehicle_type:
            reason = restriction.get("reason") or "restricted"
            return False, f"road {road.get('road_id')} restricted for {vehicle_type}: {reason}"
    return True, f"road {road.get('road_id')} is {status} and allows {vehicle_type or 'any vehicle'}"


def _action_ref(action: Mapping[str, Any]) -> str:
    return f"action:{action.get('action_id', '?')}/unit:{action.get('unit_id', '?')}"


def _parse_dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _visibility_is_critical(snapshot: Mapping[str, Any]) -> tuple[bool, list[str]]:
    evidence: list[str] = []
    weather = snapshot.get("weather") or {}
    if isinstance(weather, Mapping):
        for key in ("visibility", "visibility_status"):
            value = weather.get(key)
            if isinstance(value, str) and value.strip().lower() in CRITICAL_VISIBILITY_VALUES:
                evidence.append(f"weather.{key}={value}")
        for key in ("visibility_m", "visibility_meters"):
            value = weather.get(key)
            if isinstance(value, (int, float)) and value <= CRITICAL_VISIBILITY_M:
                evidence.append(f"weather.{key}={value}")
    for fact in list(snapshot.get("known_facts") or []):
        text = str(fact).lower()
        if "visibility" in text and any(
            marker in text for marker in ("near-zero", "near zero", "zero", "nulle", "critical")
        ):
            evidence.append(f"known_fact:{fact}")
    return bool(evidence), evidence


def _hazmat_mentions(snapshot: Mapping[str, Any]) -> tuple[list[str], list[str]]:
    """Return (confirmed_mentions, unconfirmed_mentions) of hazmat in the snapshot."""
    confirmed: list[str] = []
    unconfirmed: list[str] = []
    for fact in list(snapshot.get("known_facts") or []):
        if any(k in str(fact).lower() for k in HAZMAT_KEYWORDS):
            confirmed.append(f"known_fact:{fact}")
    for fact in list(snapshot.get("uncertain_facts") or []):
        if any(k in str(fact).lower() for k in HAZMAT_KEYWORDS):
            unconfirmed.append(f"uncertain_fact:{fact}")
    for asset in list(snapshot.get("critical_assets") or []):
        if not isinstance(asset, Mapping):
            continue
        text = " ".join(
            str(asset.get(key, "")) for key in ("type", "category", "name", "description")
        ).lower()
        if any(k in text for k in HAZMAT_KEYWORDS):
            ref = f"critical_asset:{asset.get('asset_id') or asset.get('name') or 'unknown'}"
            if asset.get("confirmed") is True:
                confirmed.append(ref)
            else:
                unconfirmed.append(ref)
    return confirmed, unconfirmed


# ---------------------------------------------------------------------------
# Individual rule checks
# ---------------------------------------------------------------------------


def check_retreat_routes(
    plan: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    units: Sequence[Mapping[str, Any]],
) -> RuleCheck:
    """sr-retreat-route — every engaged unit must have a vehicle-compatible retreat option."""
    unit_by_id = _unit_index(units)
    roads = _road_index(snapshot)
    actions = list(plan.get("unit_actions") or [])

    engaged_units = {str(a.get("unit_id")) for a in actions if _is_engaged(a)}
    failures: list[str] = []
    evidence: list[str] = []

    for unit_id in sorted(engaged_units):
        unit_actions = [a for a in actions if str(a.get("unit_id")) == unit_id]
        retreat_routes: list[str] = []
        has_retreat = False
        for action in unit_actions:
            if _is_retreat(action):
                has_retreat = True
                if action.get("route"):
                    retreat_routes.append(str(action["route"]))
            for key in ("retreat_route", "retreat_option"):
                value = action.get(key)
                if value:
                    has_retreat = True
                    if isinstance(value, str):
                        retreat_routes.append(value)

        if not has_retreat:
            failures.append(f"engaged unit {unit_id} has no retreat option in the plan")
            evidence.extend(_action_ref(a) for a in unit_actions if _is_engaged(a))
            continue

        vehicle_type = str(unit_by_id.get(unit_id, {}).get("vehicle_type") or "")
        for route_id in retreat_routes:
            road = roads.get(route_id)
            if road is None:
                continue  # unknown road: cannot mechanically disprove, left to the LLM critique
            ok, reason = _road_compatible(road, vehicle_type)
            if not ok:
                failures.append(f"retreat route for {unit_id} unusable: {reason}")
                evidence.append(f"road:{route_id}")

    if failures:
        return RuleCheck(
            rule_id="sr-retreat-route",
            status=FAIL,
            details="; ".join(failures),
            evidence=evidence,
            escalation=ESCALATE_BLOCK,
        )
    detail = (
        f"all {len(engaged_units)} engaged unit(s) have a retreat option"
        if engaged_units
        else "no engaged units in the plan"
    )
    return RuleCheck(rule_id="sr-retreat-route", status=PASS, details=detail)


def check_vehicle_road_compatibility(
    plan: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    units: Sequence[Mapping[str, Any]],
) -> RuleCheck:
    """sr-vehicle-road-compat — every routed action crossed with road state/restrictions."""
    unit_by_id = _unit_index(units)
    roads = _road_index(snapshot)
    failures: list[str] = []
    evidence: list[str] = []
    checked = 0

    for action in list(plan.get("unit_actions") or []):
        route_id = action.get("route")
        if not route_id:
            continue
        checked += 1
        unit_id = str(action.get("unit_id"))
        vehicle_type = str(unit_by_id.get(unit_id, {}).get("vehicle_type") or "")
        road = roads.get(str(route_id))
        if road is None:
            failures.append(
                f"route {route_id!r} for unit {unit_id} is unknown in the snapshot road state"
            )
            evidence.append(_action_ref(action))
            continue
        ok, reason = _road_compatible(road, vehicle_type)
        if not ok:
            failures.append(f"unit {unit_id} ({vehicle_type or 'unknown vehicle'}): {reason}")
            evidence.append(_action_ref(action))
            evidence.append(f"road:{route_id}")

    if failures:
        return RuleCheck(
            rule_id="sr-vehicle-road-compat",
            status=FAIL,
            details="; ".join(failures),
            evidence=evidence,
            escalation=ESCALATE_BLOCK,
        )
    return RuleCheck(
        rule_id="sr-vehicle-road-compat",
        status=PASS,
        details=f"{checked} routed action(s) compatible with current road state",
    )


def check_water_thresholds(
    plan: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    units: Sequence[Mapping[str, Any]],
    rules: Sequence[Mapping[str, Any]],
) -> RuleCheck:
    """sr-min-water — no suppression < min threshold; refill plan required below refill level."""
    min_pct = float(_rule_param(rules, "sr-min-water", "min_engagement_water_pct", 20))
    refill_pct = float(_rule_param(rules, "sr-min-water", "refill_plan_water_pct", 35))
    unit_by_id = _unit_index(units)
    actions = list(plan.get("unit_actions") or [])

    failures: list[str] = []
    evidence: list[str] = []
    escalation = ESCALATE_REVISE

    for action in actions:
        if not _is_offensive(action):
            continue
        unit_id = str(action.get("unit_id"))
        water = unit_by_id.get(unit_id, {}).get("water_pct")
        if water is None:
            continue
        water = float(water)
        if water < min_pct:
            failures.append(
                f"unit {unit_id} tasked with {_action_type(action)} at {water:.0f}% water, "
                f"below the hard minimum of {min_pct:.0f}% — offensive engagement forbidden"
            )
            evidence.append(_action_ref(action))
            escalation = ESCALATE_BLOCK
        elif water < refill_pct:
            has_refill_plan = any(
                _is_refill(a) for a in actions if str(a.get("unit_id")) == unit_id
            )
            if not has_refill_plan:
                failures.append(
                    f"unit {unit_id} engaged at {water:.0f}% water (< {refill_pct:.0f}%) "
                    f"with no refill plan in the tactical plan"
                )
                evidence.append(_action_ref(action))

    if failures:
        return RuleCheck(
            rule_id="sr-min-water",
            status=FAIL,
            details="; ".join(failures),
            evidence=evidence,
            escalation=escalation,
        )
    return RuleCheck(
        rule_id="sr-min-water",
        status=PASS,
        details=f"all offensive taskings satisfy water thresholds (min {min_pct:.0f}%, refill {refill_pct:.0f}%)",
    )


def check_visibility(
    plan: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    units: Sequence[Mapping[str, Any]],
) -> RuleCheck:
    """sr-visibility — no offensive tasking while visibility is near-zero."""
    critical, vis_evidence = _visibility_is_critical(snapshot)
    if not critical:
        return RuleCheck(
            rule_id="sr-visibility",
            status=PASS,
            details="no near-zero visibility condition in the snapshot",
        )
    offensive = [a for a in list(plan.get("unit_actions") or []) if _is_offensive(a)]
    if offensive:
        return RuleCheck(
            rule_id="sr-visibility",
            status=FAIL,
            details=(
                "near-zero visibility reported while the plan tasks "
                f"{len(offensive)} unit(s) offensively: "
                + ", ".join(str(a.get("unit_id")) for a in offensive)
                + " — reassess mission and consider withdrawal"
            ),
            evidence=vis_evidence + [_action_ref(a) for a in offensive],
            escalation=ESCALATE_REVISE,
        )
    return RuleCheck(
        rule_id="sr-visibility",
        status=WARNING,
        details="near-zero visibility reported; plan has no offensive tasking but conditions must be monitored",
        evidence=vis_evidence,
    )


def check_hazmat_perimeter(
    plan: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    units: Sequence[Mapping[str, Any]],
    rules: Sequence[Mapping[str, Any]],
) -> RuleCheck:
    """sr-hazmat-perimeter — suspected/confirmed hazmat requires an exclusion perimeter."""
    radius_m = _rule_param(rules, "sr-hazmat-perimeter", "default_perimeter_radius_m", 300)
    confirmed, unconfirmed = _hazmat_mentions(snapshot)
    mentions = confirmed + unconfirmed
    if not mentions:
        return RuleCheck(
            rule_id="sr-hazmat-perimeter",
            status=PASS,
            details="no hazardous-material mention in the snapshot",
        )
    actions = list(plan.get("unit_actions") or [])
    has_perimeter = any(_is_perimeter(a) for a in actions)
    if not has_perimeter:
        kind = "unconfirmed" if unconfirmed and not confirmed else "reported"
        return RuleCheck(
            rule_id="sr-hazmat-perimeter",
            status=FAIL,
            details=(
                f"{kind} hazardous material in the snapshot but the plan establishes no "
                f"exclusion perimeter (default radius {radius_m} m) and no unit is tasked to "
                "assess before entry"
            ),
            evidence=mentions,
            escalation=ESCALATE_BLOCK,
        )
    return RuleCheck(
        rule_id="sr-hazmat-perimeter",
        status=PASS,
        details=f"hazmat mention covered by an exclusion-perimeter action (radius {radius_m} m)",
        evidence=mentions,
    )


def check_human_approval(
    plan: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    units: Sequence[Mapping[str, Any]],
) -> RuleCheck:
    """sr-human-approval — every action must require explicit human approval."""
    offenders = [
        a
        for a in list(plan.get("unit_actions") or [])
        if a.get("human_approval_required") is not True
    ]
    if offenders:
        return RuleCheck(
            rule_id="sr-human-approval",
            status=FAIL,
            details=(
                "actions marked as not requiring human approval: "
                + ", ".join(str(a.get("action_id")) for a in offenders)
                + " — no dispatch may bypass the incident commander"
            ),
            evidence=[_action_ref(a) for a in offenders],
            escalation=ESCALATE_BLOCK,
        )
    return RuleCheck(
        rule_id="sr-human-approval",
        status=PASS,
        details="all actions require explicit human commander approval before dispatch",
    )


def check_data_staleness(
    plan: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    *,
    threshold_s: float = DEFAULT_STALENESS_THRESHOLD_S,
    now: datetime | None = None,
) -> RuleCheck:
    """sc-data-staleness — flag snapshot provenance entries older than the threshold."""
    reference = now or _parse_dt(plan.get("created_at")) or datetime.now(timezone.utc)
    stale: list[str] = []
    for entry in list(snapshot.get("provenance") or []):
        if not isinstance(entry, Mapping):
            continue
        retrieved_at = _parse_dt(entry.get("retrieved_at"))
        if retrieved_at is None:
            continue
        age = (reference - retrieved_at).total_seconds()
        if age > threshold_s:
            stale.append(
                f"{entry.get('field', '?')} ({entry.get('source_name', '?')}) is "
                f"{timedelta(seconds=int(age))} old"
            )
    if stale:
        return RuleCheck(
            rule_id=STALENESS_RULE_ID,
            status=WARNING,
            details=(
                "stale data (older than "
                f"{timedelta(seconds=int(threshold_s))}): " + "; ".join(stale)
            ),
            evidence=stale,
        )
    return RuleCheck(
        rule_id=STALENESS_RULE_ID,
        status=PASS,
        details="no snapshot data older than the staleness threshold",
    )


def check_single_weak_source(plan: Mapping[str, Any]) -> RuleCheck:
    """sc-single-weak-source — flag actions relying on zero or one weak evidence source."""
    flagged: list[str] = []
    evidence: list[str] = []
    for action in list(plan.get("unit_actions") or []):
        evidence_ids = list(action.get("evidence_ids") or [])
        confidence = float(action.get("confidence") or 0.0)
        if len(evidence_ids) == 0:
            flagged.append(f"action {action.get('action_id')} cites no supporting evidence")
            evidence.append(_action_ref(action))
        elif len(evidence_ids) == 1 and confidence < WEAK_SINGLE_SOURCE_CONFIDENCE:
            flagged.append(
                f"action {action.get('action_id')} relies on a single source "
                f"({evidence_ids[0]}) with low confidence {confidence:.2f}"
            )
            evidence.append(_action_ref(action))
    if flagged:
        return RuleCheck(
            rule_id=WEAK_SOURCE_RULE_ID,
            status=WARNING,
            details="; ".join(flagged),
            evidence=evidence,
        )
    return RuleCheck(
        rule_id=WEAK_SOURCE_RULE_ID,
        status=PASS,
        details="every action is supported by evidence (multiple sources or high confidence)",
    )


# ---------------------------------------------------------------------------
# Engine entry point
# ---------------------------------------------------------------------------


def run_rule_checks(
    plan: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    units: Sequence[Mapping[str, Any]],
    *,
    rules: Sequence[Mapping[str, Any]] | None = None,
    staleness_threshold_s: float = DEFAULT_STALENESS_THRESHOLD_S,
    now: datetime | None = None,
) -> list[RuleCheck]:
    """Run every mechanical rule check against the plan. Deterministic, no LLM."""
    seeded = list(rules) if rules is not None else load_safety_rules()
    return [
        check_retreat_routes(plan, snapshot, units),
        check_vehicle_road_compatibility(plan, snapshot, units),
        check_water_thresholds(plan, snapshot, units, seeded),
        check_visibility(plan, snapshot, units),
        check_hazmat_perimeter(plan, snapshot, units, seeded),
        check_human_approval(plan, snapshot, units),
        check_data_staleness(plan, snapshot, threshold_s=staleness_threshold_s, now=now),
        check_single_weak_source(plan),
    ]


def mechanical_status(checks: Sequence[RuleCheck]) -> str:
    """Hard merge floor derived from mechanical checks only.

    - any ``fail`` with escalation ``block``  -> ``block``
    - any other ``fail``                      -> ``revise``
    - otherwise                               -> ``pass``
    """
    failed = [c for c in checks if c.status == FAIL]
    if any(c.escalation == ESCALATE_BLOCK for c in failed):
        return "block"
    if failed:
        return "revise"
    return "pass"
