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


async def event_stream(
    bus: EventBus,
    resume_after: int,
    is_disconnected,
    heartbeat_interval_s: float = HEARTBEAT_INTERVAL_S,
):
    """Yield SSE-formatted chunks from the bus, with heartbeats during silence.

    The pending ``__anext__`` lives in a task that survives heartbeat timeouts:
    ``wait_for`` would cancel it, and a cancelled ``__anext__`` kills the whole
    subscription generator — one silent interval and the stream went dead air.
    """
    events = bus.subscribe(after_sequence=resume_after)
    pending: asyncio.Task | None = None
    try:
        while True:
            if await is_disconnected():
                return
            if pending is None:
                pending = asyncio.ensure_future(events.__anext__())
            done, _ = await asyncio.wait({pending}, timeout=heartbeat_interval_s)
            if not done:
                yield ": heartbeat\n\n"
                continue
            finished, pending = pending, None
            try:
                envelope = finished.result()
            except StopAsyncIteration:
                return
            yield format_sse(envelope)
    finally:
        if pending is not None:
            pending.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await pending
        with suppress(Exception):
            await events.aclose()


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

    return StreamingResponse(
        event_stream(bus, resume_after, request.is_disconnected),
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
