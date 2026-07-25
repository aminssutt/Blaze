"""BLAZE Agent 4 — Safety Critic (hybrid: deterministic rules + adversarial LLM critique).

:class:`SafetyCriticAgent.review` produces a ``SafetyReview``:

1. runs the deterministic rule engine (:mod:`agents.safety_critic.rules`) — pure code;
2. asks the local Gemma model (via the shared :class:`GemmaClient`) for an adversarial
   critique (``chat_structured`` with a strict JSON schema);
3. merges both with a HARD priority policy:

   - any mechanical ``fail`` forces the final status to ``revise`` or ``block``
     (``block`` when the failed rule carries a ``block`` escalation) — the LLM can
     NEVER turn a mechanical fail into a pass;
   - the LLM can only ADD objections / changes / confirmations, and escalate
     (``pass`` -> ``revise``; its own ``block`` recommendation is capped at ``revise``
     unless the mechanical checks already block);
   - if the LLM call fails, the review degrades to mechanical-only and is floored at
     ``revise`` (missing adversarial layer => extra caution), never silently passed;

4. reports the complete mechanical output in ``rule_checks``;
5. validates the result against ``contracts/schemas/safety_review.schema.json``.

A ``pass`` means "ready for human review", never "approved": the Safety Critic NEVER
replaces the human incident commander.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

import jsonschema

from agents.common.inference_client import GemmaClient, GemmaClientError
from agents.safety_critic.rules import (
    FAIL,
    WARNING,
    RuleCheck,
    load_safety_rules,
    mechanical_status,
    run_rule_checks,
)

logger = logging.getLogger("blaze.safety_critic")

REPO_ROOT = Path(__file__).resolve().parents[2]
SAFETY_REVIEW_SCHEMA_PATH = REPO_ROOT / "contracts" / "schemas" / "safety_review.schema.json"
PROMPT_PATH = REPO_ROOT / "inference" / "prompts" / "safety_critic.md"

#: Severity ordering used by the merge policy.
_STATUS_ORDER = {"pass": 0, "revise": 1, "block": 2}

#: Strict schema for the LLM adversarial critique (chat_structured).
LLM_CRITIQUE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "recommended_status": {"type": "string", "enum": ["pass", "revise", "block"]},
        "objections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "objection": {"type": "string"},
                    "severity": {"type": "string", "enum": ["material", "minor"]},
                    "evidence": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["objection", "severity"],
            },
        },
        "required_changes": {"type": "array", "items": {"type": "string"}},
        "required_confirmations": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["recommended_status", "objections", "required_changes", "required_confirmations"],
}


def load_safety_review_schema() -> dict[str, Any]:
    return json.loads(SAFETY_REVIEW_SCHEMA_PATH.read_text(encoding="utf-8"))


def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


class SafetyCriticAgent:
    """Hybrid safety critic: deterministic rule engine + adversarial Gemma critique."""

    agent_name = "safety_critic"

    def __init__(
        self,
        client: GemmaClient,
        *,
        rules: Sequence[Mapping[str, Any]] | None = None,
        prompt: str | None = None,
    ) -> None:
        self.client = client
        self.rules = list(rules) if rules is not None else load_safety_rules()
        self.prompt = prompt if prompt is not None else load_prompt()
        self.review_schema = load_safety_review_schema()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def review(
        self,
        plan: Mapping[str, Any],
        snapshot: Mapping[str, Any],
        units: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any]:
        """Review a draft tactical plan. Returns a schema-valid ``SafetyReview`` dict."""
        # (1) Deterministic rule engine — pure code, always runs, always authoritative.
        checks = run_rule_checks(plan, snapshot, units, rules=self.rules)
        floor = mechanical_status(checks)  # pass | revise | block — hard floor

        # (2) Adversarial LLM critique.
        critique, llm_failed = await self._llm_critique(plan, snapshot, units, checks)

        # (3) Hard-priority merge.
        review = self._merge(plan, checks, floor, critique, llm_failed)

        # (5) Schema validation — a non-conforming review must never leave the agent.
        jsonschema.validate(review, self.review_schema)
        return review

    # ------------------------------------------------------------------
    # LLM critique
    # ------------------------------------------------------------------

    async def _llm_critique(
        self,
        plan: Mapping[str, Any],
        snapshot: Mapping[str, Any],
        units: Sequence[Mapping[str, Any]],
        checks: Sequence[RuleCheck],
    ) -> tuple[dict[str, Any] | None, bool]:
        """Ask Gemma for the adversarial critique. Returns (critique, llm_failed)."""
        user_payload = {
            "draft_tactical_plan": plan,
            "situation_snapshot": snapshot,
            "units": list(units),
            "mechanical_rule_checks": [c.to_dict() for c in checks],
        }
        messages = [
            {"role": "system", "content": self.prompt},
            {
                "role": "user",
                "content": (
                    "Review the following draft tactical plan. Actively try to prove it is "
                    "dangerous. The mechanical rule-check results are included — do not "
                    "repeat their failures, find what they cannot see.\n\n"
                    + json.dumps(user_payload, ensure_ascii=False, default=str)
                ),
            },
        ]
        try:
            result = await self.client.chat_structured(
                messages,
                schema=LLM_CRITIQUE_SCHEMA,
                schema_name="safety_critique",
                temperature=0.2,
                agent=self.agent_name,
            )
        except GemmaClientError as exc:
            logger.warning("Safety critic LLM critique unavailable, degrading to rules-only: %s", exc)
            return None, True
        data = result.data if isinstance(result.data, dict) else None
        return data, data is None

    # ------------------------------------------------------------------
    # Merge policy
    # ------------------------------------------------------------------

    def _merge(
        self,
        plan: Mapping[str, Any],
        checks: Sequence[RuleCheck],
        floor: str,
        critique: Mapping[str, Any] | None,
        llm_failed: bool,
    ) -> dict[str, Any]:
        objections: list[str] = []
        required_changes: list[str] = []
        required_confirmations: list[str] = []

        # Mechanical failures become objections + required changes (they set the floor).
        for check in checks:
            if check.status == FAIL:
                objections.append(f"[{check.rule_id}] {check.details}")
                required_changes.append(f"Resolve mechanical rule failure {check.rule_id}: {check.details}")
            elif check.status == WARNING:
                required_confirmations.append(f"[{check.rule_id}] {check.details}")

        # LLM contribution: additive only.
        llm_status = "pass"
        if critique is not None:
            has_material = False
            for objection in critique.get("objections") or []:
                text = str(objection.get("objection", "")).strip()
                if not text:
                    continue
                severity = str(objection.get("severity", "minor"))
                evidence = [str(e) for e in objection.get("evidence") or []]
                suffix = f" (evidence: {', '.join(evidence)})" if evidence else ""
                objections.append(f"[llm-critique/{severity}] {text}{suffix}")
                if severity == "material":
                    has_material = True
            required_changes.extend(str(c) for c in critique.get("required_changes") or [] if str(c).strip())
            required_confirmations.extend(
                str(c) for c in critique.get("required_confirmations") or [] if str(c).strip()
            )
            recommended = str(critique.get("recommended_status", "pass"))
            if recommended not in _STATUS_ORDER:
                recommended = "pass"
            # The LLM alone can escalate at most to "revise" (never straight to block),
            # and a material objection floors the review at "revise" too.
            llm_status = "revise" if (has_material or _STATUS_ORDER[recommended] > 0) else "pass"
        elif llm_failed:
            # Adversarial layer missing: degrade conservatively, never silently pass.
            llm_status = "revise"
            required_confirmations.append(
                "Adversarial LLM critique unavailable — mechanical checks only; "
                "manual adversarial review required before approval."
            )

        # HARD PRIORITY: mechanical floor wins; the LLM can only raise, never lower.
        status = floor if _STATUS_ORDER[floor] >= _STATUS_ORDER[llm_status] else llm_status
        assert _STATUS_ORDER[status] >= _STATUS_ORDER[floor]  # fail can never become pass

        # (4) rule_checks = the COMPLETE mechanical output, schema-shaped, with the
        # full {status, details, evidence} kept as extra fields for the UI.
        rule_checks = [
            {
                "rule_id": check.rule_id,
                "passed": check.status != FAIL,
                "detail": (f"WARNING: {check.details}" if check.status == WARNING else check.details),
                "status": check.status,
                "evidence": list(check.evidence),
            }
            for check in checks
        ]

        review: dict[str, Any] = {
            "review_id": f"sr-{uuid.uuid4().hex[:12]}",
            "plan_id": str(plan.get("plan_id", "")),
            "status": status,
            "critical_objections": objections,
            "required_changes": required_changes,
            "required_confirmations": required_confirmations,
            "rule_checks": rule_checks,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        }
        if status == "pass":
            review["required_confirmations"].append(
                "Status 'pass' means ready for human review — dispatch still requires "
                "explicit approval by the human incident commander."
            )
        return review
