"""BLAZE Agent 5 — Dispatch.

Converts an APPROVED tactical plan (plus operator modifications) into one concise,
unambiguous, TTS-ready French radio message per unit, via a schema-constrained
Gemma call (``GemmaClient.chat_structured``) followed by DETERMINISTIC post-LLM
guardrails (plain code, no LLM):

0. HARD PRECONDITION — ``approval_decision.decision`` must be ``"approve"`` (or
   ``"modify"``, whose ``modified_actions`` are merged in). Anything else raises
   :class:`DispatchNotAuthorizedError` BEFORE any LLM call leaves the process.
1. Exactly one instruction per unit that has an approved action. Any surplus LLM
   instruction for a unit outside the approved plan is rejected and logged as an
   error — the Dispatch Agent can NEVER invent an action absent from the plan.
2. Anti-invention lexical check against the closed location vocabulary of the
   scenario (``data/scenario/roads.json`` + ``resources.json``): locations/routes
   mentioned in the message must come from the approved action's fields, the
   action's route/destination must appear in the message, and the numbers of the
   approved instruction must be preserved verbatim. A violating message is
   rejected and regenerated (bounded); on exhaustion a typed
   :class:`DispatchGuardrailError` is raised.
3. ``acknowledgement_required`` is forced to ``True`` for ``high``/``critical``
   priority actions.
4. ``dispatch_status`` starts at ``"pending"`` and ``tts_audio_path`` is ``null``
   (filled later by the TTS service).
5. Every instruction is validated against
   ``contracts/schemas/dispatch_instruction.schema.json``.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

import jsonschema

from agents.common.inference_client import GemmaClient

logger = logging.getLogger("blaze.dispatch")

AGENT_ID = "dispatch"

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROMPT_PATH = REPO_ROOT / "inference" / "prompts" / "dispatch.md"
DEFAULT_SCHEMA_PATH = REPO_ROOT / "contracts" / "schemas" / "dispatch_instruction.schema.json"
DEFAULT_SCENARIO_DIR = REPO_ROOT / "data" / "scenario"

#: How many times a guardrail-violating unit message is regenerated before the
#: typed :class:`DispatchGuardrailError` is raised.
DEFAULT_MAX_REGENERATIONS = 2

#: Priorities for which acknowledgement is always demanded, whatever the LLM said.
FORCED_ACK_PRIORITIES = frozenset({"high", "critical"})

#: Decisions that unlock dispatch. Everything else (reject, missing, unknown) blocks it.
AUTHORIZING_DECISIONS = frozenset({"approve", "modify"})


# ---------------------------------------------------------------------------
# Typed errors
# ---------------------------------------------------------------------------


class DispatchError(Exception):
    """Base class for Dispatch Agent failures."""


class DispatchNotAuthorizedError(DispatchError):
    """Raised when generate() is called without a valid human approval. No LLM call is made."""


class DispatchGuardrailError(DispatchError):
    """A unit message still violates the anti-invention guardrails after all regenerations."""

    def __init__(
        self, message: str, *, unit_id: str, violations: Sequence[str], attempts: int
    ) -> None:
        super().__init__(message)
        self.unit_id = unit_id
        self.violations = list(violations)
        self.attempts = attempts


# ---------------------------------------------------------------------------
# LLM output contracts (structured output schemas for chat_structured)
# ---------------------------------------------------------------------------

MESSAGE_ITEM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "unit_id": {"type": "string"},
        "message_text": {"type": "string"},
        "acknowledgement_required": {"type": "boolean"},
    },
    "required": ["unit_id", "message_text", "acknowledgement_required"],
}

BATCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "instructions": {"type": "array", "items": MESSAGE_ITEM_SCHEMA},
    },
    "required": ["instructions"],
}


# ---------------------------------------------------------------------------
# Closed location vocabulary + lexical normalization
# ---------------------------------------------------------------------------

#: Known French/TTS spellings of the seeded demo locations, pre-normalized
#: (see :func:`_normalize`). Keys are entity ids from roads.json / resources.json.
EXTRA_LOCATION_ALIASES: dict[str, tuple[str, ...]] = {
    "d17": ("route d17",),
    "north-access": ("acces nord",),
    "forest-track-5": ("piste forestiere 5", "piste 5"),
    "water-point-2": ("point d eau 2",),
    "hangar-zone": ("hangar",),
    "camping-les-pins": ("camping",),
}

_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_MULTI_SPACE_RE = re.compile(r"\s+")
# "d 17" -> "d17" so «route D 17» (TTS spelling) still matches the D17 road token.
_LETTER_DIGIT_RE = re.compile(r"\b([a-z])\s+(\d+)\b")
_DIGITS_RE = re.compile(r"\d+")


def _normalize(text: str) -> str:
    """Lowercased, accent-stripped, alnum-only spelling used for lexical matching."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = _NON_ALNUM_RE.sub(" ", text.lower()).strip()
    text = _MULTI_SPACE_RE.sub(" ", text)
    text = _LETTER_DIGIT_RE.sub(r"\1\2", text)
    return f" {text} "


def load_location_vocabulary(scenario_dir: Path) -> dict[str, set[str]]:
    """Closed vocabulary of scenario locations: entity id -> normalized aliases.

    Built from ``roads.json`` + ``resources.json`` (ids, display names, plus the
    known French/TTS spellings). This is the ONLY reference used by the
    anti-invention check: a location outside this world simply cannot be verified,
    a location inside it must be traceable to the approved action.
    """
    vocab: dict[str, set[str]] = {}

    def add(entity_id: str, name: str | None) -> None:
        aliases = vocab.setdefault(entity_id, set())
        aliases.add(_normalize(entity_id).strip())
        if name:
            aliases.add(_normalize(name).strip())
        aliases.update(EXTRA_LOCATION_ALIASES.get(entity_id, ()))

    roads = json.loads((scenario_dir / "roads.json").read_text(encoding="utf-8"))
    for road in roads.get("roads", []):
        add(road["road_id"], road.get("name"))

    resources = json.loads((scenario_dir / "resources.json").read_text(encoding="utf-8"))
    for resource in resources.get("resources", []):
        add(resource["resource_id"], resource.get("name"))

    return vocab


def _mentioned_locations(vocab: Mapping[str, set[str]], text: str) -> set[str]:
    normalized = _normalize(text)
    return {
        entity_id
        for entity_id, aliases in vocab.items()
        if any(f" {alias} " in normalized for alias in aliases)
    }


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class DispatchAgent:
    """Agent 5 — approved-plan-only per-unit dispatch messages.

    Usage::

        agent = DispatchAgent(client)
        instructions = await agent.generate(approved_plan, approval_decision, units)
    """

    def __init__(
        self,
        client: GemmaClient,
        *,
        prompt_path: Path | str | None = None,
        schema_path: Path | str | None = None,
        scenario_dir: Path | str | None = None,
        max_regenerations: int = DEFAULT_MAX_REGENERATIONS,
    ) -> None:
        self.client = client
        self.max_regenerations = int(max_regenerations)
        self._prompt = Path(prompt_path or DEFAULT_PROMPT_PATH).read_text(encoding="utf-8")
        self._schema = json.loads(
            Path(schema_path or DEFAULT_SCHEMA_PATH).read_text(encoding="utf-8")
        )
        self._vocab = load_location_vocabulary(Path(scenario_dir or DEFAULT_SCENARIO_DIR))

    # -- public API --------------------------------------------------------

    async def generate(
        self,
        approved_plan: Mapping[str, Any],
        approval_decision: Mapping[str, Any],
        units: Sequence[Mapping[str, Any]] | Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """One validated DispatchInstruction per approved unit action.

        Raises :class:`DispatchNotAuthorizedError` (before ANY LLM call) unless the
        human decision authorizes dispatch, and :class:`DispatchGuardrailError` when
        a unit message keeps violating the anti-invention guardrails.
        """
        # HARD PRECONDITION — no LLM call can leave without human authorization.
        actions = self._authorized_actions(approved_plan, approval_decision)
        if not actions:
            logger.warning("Approved plan %r has no unit actions; nothing to dispatch.",
                           approved_plan.get("plan_id"))
            return []

        callsigns = self._callsigns(units, actions)

        expected: dict[str, dict[str, Any]] = {}
        for action in actions:
            unit_id = action["unit_id"]
            if unit_id in expected:
                logger.error(
                    "Approved plan contains several actions for unit %r; keeping the first.",
                    unit_id,
                )
                continue
            expected[unit_id] = action

        candidates = await self._llm_batch(
            approved_plan, list(expected.values()), callsigns, approval_decision
        )

        # Guardrail 1 — one instruction per approved unit, NO unit outside the plan.
        by_unit: dict[str, dict[str, Any]] = {}
        for item in candidates:
            unit_id = item.get("unit_id")
            if unit_id not in expected:
                logger.error(
                    "Dispatch guardrail: LLM produced an instruction for unit %r which has "
                    "no approved action — rejected (the Dispatch Agent can never invent an "
                    "action absent from the approved plan).",
                    unit_id,
                )
                continue
            if unit_id in by_unit:
                logger.error(
                    "Dispatch guardrail: duplicate LLM instruction for unit %r — rejected.",
                    unit_id,
                )
                continue
            by_unit[unit_id] = item

        generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        instructions: list[dict[str, Any]] = []
        for index, (unit_id, action) in enumerate(expected.items(), start=1):
            # Guardrail 2 — anti-invention lexical check, bounded regeneration.
            item = await self._validated_item(
                approved_plan, action, by_unit.get(unit_id), callsigns[unit_id]
            )
            instructions.append(
                self._build_instruction(index, approved_plan, action, item, generated_at)
            )

        # Guardrail 5 — contract validation before anything reaches the TTS/dispatch pipeline.
        for instruction in instructions:
            jsonschema.validate(instruction, self._schema)

        logger.info(
            "Dispatch generated %d instruction(s) for plan %r.",
            len(instructions),
            approved_plan.get("plan_id"),
        )
        return instructions

    # -- authorization ------------------------------------------------------

    @staticmethod
    def _authorized_actions(
        plan: Mapping[str, Any], decision: Mapping[str, Any] | None
    ) -> list[dict[str, Any]]:
        if not isinstance(decision, Mapping) or not decision.get("decision"):
            raise DispatchNotAuthorizedError(
                "Dispatch requires an explicit human approval decision; none was provided."
            )
        if decision.get("plan_id") != plan.get("plan_id"):
            raise DispatchNotAuthorizedError(
                f"Approval decision {decision.get('decision_id')!r} targets plan "
                f"{decision.get('plan_id')!r}, not {plan.get('plan_id')!r} — dispatch refused."
            )
        verdict = decision["decision"]
        if verdict not in AUTHORIZING_DECISIONS:
            raise DispatchNotAuthorizedError(
                f"Dispatch is not authorized: commander decision is {verdict!r} "
                "(only 'approve' or 'modify' unlock dispatch)."
            )
        actions = [dict(action) for action in plan.get("unit_actions", [])]
        if verdict == "modify":
            # The human operator is the authority: modified actions replace the
            # planned ones (matched by action_id) and may add new human-authored ones.
            merged = {action["action_id"]: action for action in actions}
            for modified in decision.get("modified_actions") or []:
                merged[modified["action_id"]] = dict(modified)
            actions = list(merged.values())
        return actions

    # -- LLM calls ----------------------------------------------------------

    async def _llm_batch(
        self,
        plan: Mapping[str, Any],
        actions: Sequence[Mapping[str, Any]],
        callsigns: Mapping[str, str],
        decision: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        payload = {
            "plan_id": plan.get("plan_id"),
            "incident_id": plan.get("incident_id"),
            "operator_note": decision.get("operator_note"),
            "approved_actions": [self._action_view(action, callsigns) for action in actions],
        }
        messages = [
            {"role": "system", "content": self._prompt},
            {
                "role": "user",
                "content": (
                    "Plan approuvé par le commandant des opérations. Génère exactement un "
                    "message radio par action approuvée, rien de plus.\n"
                    + json.dumps(payload, ensure_ascii=False, indent=2)
                ),
            },
        ]
        result = await self.client.chat_structured(
            messages,
            schema=BATCH_SCHEMA,
            schema_name="dispatch_messages",
            agent=AGENT_ID,
            temperature=0.2,
        )
        return [dict(item) for item in result.data["instructions"]]

    async def _llm_regenerate(
        self,
        plan: Mapping[str, Any],
        action: Mapping[str, Any],
        callsign: str,
        violations: Sequence[str],
    ) -> dict[str, Any]:
        payload = {
            "plan_id": plan.get("plan_id"),
            "approved_action": self._action_view(action, {action["unit_id"]: callsign}),
        }
        messages = [
            {"role": "system", "content": self._prompt},
            {
                "role": "user",
                "content": (
                    "Ton message précédent pour cette unité a été REJETÉ par les garde-fous "
                    "anti-invention : "
                    + "; ".join(violations)
                    + ".\nRégénère UN message radio strictement fidèle à l'action approuvée "
                    "ci-dessous : aucun lieu, aucune route, aucune restriction absents de "
                    "l'action, et tous ses nombres/routes préservés.\n"
                    + json.dumps(payload, ensure_ascii=False, indent=2)
                ),
            },
        ]
        result = await self.client.chat_structured(
            messages,
            schema=MESSAGE_ITEM_SCHEMA,
            schema_name="dispatch_message",
            agent=AGENT_ID,
            temperature=0.2,
        )
        item = dict(result.data)
        # Regeneration is scoped to this action; the recipient is not negotiable.
        item["unit_id"] = action["unit_id"]
        return item

    @staticmethod
    def _action_view(
        action: Mapping[str, Any], callsigns: Mapping[str, str]
    ) -> dict[str, Any]:
        """What the LLM is allowed to see: the approved action, nothing more.

        ``reason`` is intentionally excluded to keep the invention surface minimal —
        the radio message must carry the order, not the justification.
        """
        unit_id = action["unit_id"]
        return {
            "unit_id": unit_id,
            "callsign": callsigns.get(unit_id, unit_id),
            "action_type": action.get("action_type"),
            "instruction": action.get("instruction"),
            "route": action.get("route"),
            "destination": action.get("destination"),
            "priority": action.get("priority"),
            "acknowledgement_required": bool(action.get("acknowledgement_required"))
            or action.get("priority") in FORCED_ACK_PRIORITIES,
        }

    # -- deterministic guardrails -------------------------------------------

    async def _validated_item(
        self,
        plan: Mapping[str, Any],
        action: Mapping[str, Any],
        item: Mapping[str, Any] | None,
        callsign: str,
    ) -> dict[str, Any]:
        unit_id = action["unit_id"]
        attempts = 0
        while True:
            if item is None:
                violations = ["the model returned no instruction for this approved unit"]
            else:
                violations = self._lexical_violations(action, str(item["message_text"]))
            if not violations:
                return dict(item)  # type: ignore[arg-type]
            if attempts >= self.max_regenerations:
                raise DispatchGuardrailError(
                    f"Dispatch message for unit {unit_id!r} still violates the "
                    f"anti-invention guardrails after {attempts + 1} attempt(s): "
                    + "; ".join(violations),
                    unit_id=unit_id,
                    violations=violations,
                    attempts=attempts + 1,
                )
            attempts += 1
            logger.error(
                "Dispatch guardrail: instruction for unit %s rejected (%s) — regenerating (%d/%d).",
                unit_id,
                "; ".join(violations),
                attempts,
                self.max_regenerations,
            )
            item = await self._llm_regenerate(plan, action, callsign, violations)

    def _lexical_violations(
        self, action: Mapping[str, Any], message_text: str
    ) -> list[str]:
        """Anti-invention check against the closed scenario vocabulary.

        - every scenario location mentioned in the message must come from the
          approved action's fields (instruction / route / destination / reason);
        - the action's route and destination must appear in the message;
        - the numbers of the approved instruction must be preserved verbatim.
        """
        violations: list[str] = []

        action_text = " ".join(
            str(action.get(field) or "")
            for field in ("instruction", "route", "destination", "reason")
        )
        allowed = _mentioned_locations(self._vocab, action_text)

        required: set[str] = set()
        for field in ("route", "destination"):
            value = action.get(field)
            if value:
                required |= _mentioned_locations(self._vocab, str(value))
        allowed |= required

        mentioned = _mentioned_locations(self._vocab, message_text)

        invented = sorted(mentioned - allowed)
        if invented:
            violations.append(
                "mentions locations absent from the approved action: " + ", ".join(invented)
            )
        missing = sorted(required - mentioned)
        if missing:
            violations.append(
                "omits the approved route/destination: " + ", ".join(missing)
            )

        required_numbers = set(_DIGITS_RE.findall(str(action.get("instruction") or "")))
        message_numbers = set(_DIGITS_RE.findall(message_text))
        lost = sorted(required_numbers - message_numbers)
        if lost:
            violations.append(
                "does not preserve the approved numbers verbatim: " + ", ".join(lost)
            )
        return violations

    # -- assembly -----------------------------------------------------------

    def _build_instruction(
        self,
        index: int,
        plan: Mapping[str, Any],
        action: Mapping[str, Any],
        item: Mapping[str, Any],
        generated_at: str,
    ) -> dict[str, Any]:
        priority = action["priority"]
        # Guardrail 3 — acknowledgement is never optional on high/critical actions.
        acknowledgement_required = (
            bool(action.get("acknowledgement_required")) or priority in FORCED_ACK_PRIORITIES
        )
        return {
            "dispatch_id": f"di-{index:03d}",
            "plan_id": plan["plan_id"],
            "unit_id": action["unit_id"],
            "priority": priority,
            "message_text": str(item["message_text"]).strip(),
            "acknowledgement_required": acknowledgement_required,
            # Guardrail 4 — the TTS service owns these two fields.
            "tts_audio_path": None,
            "generated_at": generated_at,
            "dispatch_status": "pending",
        }

    @staticmethod
    def _callsigns(
        units: Sequence[Mapping[str, Any]] | Mapping[str, Any] | None,
        actions: Sequence[Mapping[str, Any]],
    ) -> dict[str, str]:
        table: dict[str, str] = {}
        unit_list: Sequence[Mapping[str, Any]]
        if isinstance(units, Mapping):
            unit_list = units.get("units", [])
        else:
            unit_list = units or []
        for unit in unit_list:
            unit_id = unit.get("unit_id")
            if unit_id:
                table[unit_id] = unit.get("callsign") or unit_id.replace("-", " ").title()
        for action in actions:
            table.setdefault(action["unit_id"], action["unit_id"].replace("-", " ").title())
        return table
