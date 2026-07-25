"""Approval endpoints — plan submission, versioning, human decisions (issue #34)."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from backend.api.plans import PlanStore

router = APIRouter(tags=["approval"])


def get_plans(request: Request) -> PlanStore:
    return request.app.state.plans


class PlanSubmission(BaseModel):
    """DraftTacticalPlan (contract) — extra agent fields pass through."""

    model_config = {"extra": "allow"}

    plan_id: str
    incident_id: str
    version: int
    summary: str
    objectives: list
    unit_actions: list
    created_at: str


class DecisionRequest(BaseModel):
    plan_id: str
    decision: Literal["approve", "modify", "reject"]
    operator_name: str
    operator_note: str | None = None
    modified_actions: list[dict] | None = None


@router.post("/plans")
async def submit_plan(request: Request, body: PlanSubmission):
    """Register a new draft plan version (orchestrator or mock injection)."""
    try:
        plan = get_plans(request).submit(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await request.app.state.event_bus.publish("plan.draft.ready", plan)
    return plan


@router.get("/plans")
async def list_plans(request: Request):
    store = get_plans(request)
    return {
        "plans": store.all_plans(),
        "approved_plan_id": store.approved_plan_id(),
        "decisions": store.decisions,
    }


@router.get("/plans/{plan_id}")
async def get_plan(request: Request, plan_id: str):
    try:
        return get_plans(request).get(plan_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/approval/decision")
async def record_decision(request: Request, body: DecisionRequest):
    store = get_plans(request)
    bus = request.app.state.event_bus
    try:
        record, new_plan = store.decide(
            plan_id=body.plan_id,
            decision=body.decision,
            operator_name=body.operator_name,
            operator_note=body.operator_note,
            modified_actions=body.modified_actions,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    await bus.publish("approval.received", record)
    if new_plan is not None:
        await bus.publish(
            "plan.revision.requested",
            {"previous_plan_id": body.plan_id, "new_plan_id": new_plan["plan_id"]},
        )
        await bus.publish("plan.draft.ready", new_plan)
    return {"decision": record, "new_plan": new_plan}
