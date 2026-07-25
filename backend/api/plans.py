"""Plan store — versioned tactical plans + human approval decisions (issue #34).

Holds every DraftTacticalPlan version (modification never deletes history) and
the audit trail of contract-valid ApprovalDecision records. Dispatch stays
locked until a plan has an explicit `approve` decision.
"""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class PlanStore:
    def __init__(self) -> None:
        self._plans: dict[str, dict] = {}  # plan_id -> DraftTacticalPlan
        self._order: list[str] = []
        self.decisions: list[dict] = []  # ApprovalDecision audit trail

    # -- plans --------------------------------------------------------------

    def submit(self, plan: dict) -> dict:
        plan_id = plan["plan_id"]
        if plan_id in self._plans:
            raise ValueError(f"plan {plan_id!r} already exists")
        self._plans[plan_id] = copy.deepcopy(plan)
        self._order.append(plan_id)
        return self.get(plan_id)

    def get(self, plan_id: str) -> dict:
        if plan_id not in self._plans:
            raise KeyError(f"unknown plan {plan_id!r}")
        return copy.deepcopy(self._plans[plan_id])

    def all_plans(self) -> list[dict]:
        return [copy.deepcopy(self._plans[p]) for p in self._order]

    def latest(self) -> Optional[dict]:
        return self.get(self._order[-1]) if self._order else None

    # -- decisions ----------------------------------------------------------

    def decide(
        self,
        plan_id: str,
        decision: str,
        operator_name: str,
        operator_note: Optional[str] = None,
        modified_actions: Optional[list[dict]] = None,
    ) -> tuple[dict, Optional[dict]]:
        """Record an ApprovalDecision. On modify, create version N+1.

        Returns (decision_record, new_plan_or_None).
        """
        base = self.get(plan_id)  # KeyError on unknown plan
        record = {
            "decision_id": f"ad-{uuid.uuid4().hex[:8]}",
            "plan_id": plan_id,
            "decision": decision,
            "operator_name": operator_name,
            "operator_note": operator_note,
            "modified_actions": modified_actions or [],
            "decided_at": _now(),
        }
        new_plan = None
        if decision == "modify":
            if not modified_actions:
                raise ValueError("modify requires modified_actions")
            version = base["version"] + 1
            new_plan = {
                **copy.deepcopy(base),
                "plan_id": f"plan-v{version}",
                "version": version,
                "unit_actions": copy.deepcopy(modified_actions),
                "created_at": _now(),
            }
            self.submit(new_plan)
        self.decisions.append(record)
        return copy.deepcopy(record), new_plan

    def is_approved(self, plan_id: str) -> bool:
        return any(
            d["plan_id"] == plan_id and d["decision"] == "approve"
            for d in self.decisions
        )

    def approved_plan_id(self) -> Optional[str]:
        for d in reversed(self.decisions):
            if d["decision"] == "approve":
                return d["plan_id"]
        return None

    def reset(self) -> None:
        self._plans.clear()
        self._order.clear()
        self.decisions.clear()
