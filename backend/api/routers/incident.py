"""Incident endpoints — demo controller API (start/reset/status + toggles)."""

import asyncio
import contextlib
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from backend.api.demo import DemoController

router = APIRouter(prefix="/incident", tags=["incident"])


def get_demo(request: Request) -> DemoController:
    return request.app.state.demo


class StartRequest(BaseModel):
    audio_variant: Literal["clean", "radio"] | None = None
    speed_factor: float = 10.0


class NetworkModeRequest(BaseModel):
    network_mode: Literal["online", "offline"]


@router.post("/start")
async def start_incident(request: Request, body: StartRequest | None = None):
    demo = get_demo(request)
    body = body or StartRequest()
    if body.audio_variant is not None:
        demo.audio_variant = body.audio_variant
    try:
        await demo.start(speed_factor=body.speed_factor)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return demo.status()


@router.post("/reset")
async def reset_incident(request: Request):
    demo = get_demo(request)
    # Dev publishers (replay, audio ingest) must die BEFORE the bus resets,
    # or they keep pushing pre-reset events into the clean run.
    state = request.app.state
    for attr in ("replay_task", "audio_ingest_task"):
        task: asyncio.Task | None = getattr(state, attr, None)
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        setattr(state, attr, None)
    await demo.reset()
    request.app.state.plans.reset()  # plans + decisions wiped with the run
    return demo.status()


@router.get("/status")
async def incident_status(request: Request):
    return get_demo(request).status()


@router.post("/network-mode")
async def set_network_mode(request: Request, body: NetworkModeRequest):
    demo = get_demo(request)
    await demo.set_network_mode(body.network_mode)
    return demo.status()
