"""SSE endpoint streaming envelope events, with Last-Event-ID reconnection."""

import asyncio
import json
from contextlib import suppress

from fastapi import APIRouter, Header, Request
from fastapi.responses import StreamingResponse

from backend.streaming.bus import EventBus
from backend.streaming.replay import replay_mock_stream

router = APIRouter()

HEARTBEAT_INTERVAL_S = 15.0


def get_bus(request: Request) -> EventBus:
    return request.app.state.event_bus


def format_sse(envelope: dict) -> str:
    # id: carries the sequence so browsers send Last-Event-ID on reconnect.
    return (
        f"id: {envelope['sequence']}\n"
        f"event: {envelope['event_type']}\n"
        f"data: {json.dumps(envelope, ensure_ascii=False)}\n\n"
    )


@router.get("/events/stream")
async def stream_events(
    request: Request,
    after: int = 0,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
):
    """SSE stream of event envelopes.

    Resume point = Last-Event-ID header (browser reconnect) or ?after= (manual),
    both meaning "I already have sequences up to N".
    """
    resume_after = after
    if last_event_id and last_event_id.isdigit():
        resume_after = max(resume_after, int(last_event_id))
    bus = get_bus(request)

    async def generator():
        events = bus.subscribe(after_sequence=resume_after)
        try:
            while True:
                if await request.is_disconnected():
                    return
                try:
                    envelope = await asyncio.wait_for(
                        events.__anext__(), timeout=HEARTBEAT_INTERVAL_S
                    )
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                yield format_sse(envelope)
        finally:
            with suppress(Exception):
                await events.aclose()

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/dev/replay")
async def dev_replay(request: Request, speed_factor: float = 10.0):
    """Dev mode: replay the frozen mock stream through the bus (background task)."""
    bus = get_bus(request)
    task = asyncio.create_task(replay_mock_stream(bus, speed_factor=speed_factor))
    request.app.state.replay_task = task
    return {"status": "replay_started", "speed_factor": speed_factor}
