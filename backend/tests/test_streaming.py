import asyncio
import json

import pytest
from jsonschema import Draft7Validator

from backend.api.config import REPO_ROOT
from backend.streaming.bus import EventBus
from backend.streaming.replay import load_mock_envelopes, replay_mock_stream
from backend.streaming.sse import event_stream, format_sse

ENVELOPE_SCHEMA = json.loads(
    (REPO_ROOT / "contracts" / "schemas" / "event_envelope.schema.json").read_text()
)
VALIDATOR = Draft7Validator(ENVELOPE_SCHEMA)


async def collect(bus: EventBus, after: int, count: int) -> list[dict]:
    events = bus.subscribe(after_sequence=after)
    received = []
    try:
        while len(received) < count:
            received.append(await asyncio.wait_for(events.__anext__(), timeout=5))
    finally:
        await events.aclose()
    return received


@pytest.mark.asyncio
async def test_full_mock_stream_in_order():
    bus = EventBus("wildfire-demo-01")
    subscriber = asyncio.create_task(collect(bus, after=0, count=70))
    published = await replay_mock_stream(bus, speed_factor=0)  # no pacing in tests
    received = await subscriber
    assert published == 70
    assert [e["sequence"] for e in received] == list(range(1, 71))


def test_mock_events_validate_against_frozen_envelope_schema():
    envelopes = load_mock_envelopes()
    assert len(envelopes) == 70
    for envelope in envelopes:
        VALIDATOR.validate(envelope)


@pytest.mark.asyncio
async def test_reconnect_resumes_without_duplicates():
    bus = EventBus("wildfire-demo-01")
    await replay_mock_stream(bus, speed_factor=0)
    # Client reconnects claiming it already saw sequences up to 35
    resumed = await collect(bus, after=35, count=35)
    assert [e["sequence"] for e in resumed] == list(range(36, 71))


@pytest.mark.asyncio
async def test_bus_rejects_non_monotonic_sequences():
    bus = EventBus("wildfire-demo-01")
    await bus.publish("incident.started", {"x": 1})
    with pytest.raises(ValueError):
        await bus.publish_envelope({"sequence": 1, "event_type": "error", "payload": {}})


def test_sse_wire_format_carries_sequence_as_id():
    envelope = load_mock_envelopes()[0]
    wire = format_sse(envelope)
    assert wire.startswith("id: 1\nevent: incident.started\ndata: ")
    assert json.loads(wire.split("data: ", 1)[1].strip()) == envelope


@pytest.mark.asyncio
async def test_heartbeat_silence_does_not_kill_the_stream():
    # Regression (found in PR #114): wait_for cancelled the pending __anext__ on
    # heartbeat timeout, killing the subscription generator — after one silent
    # interval the stream went dead air and events published later never arrived.
    bus = EventBus("wildfire-demo-01")
    await bus.publish("incident.started", {"x": 1})

    async def never_disconnected() -> bool:
        return False

    chunks: list[str] = []

    async def consume() -> None:
        async for chunk in event_stream(
            bus, 0, never_disconnected, heartbeat_interval_s=0.05
        ):
            chunks.append(chunk)
            if '"incident.updated"' in chunk:
                return

    consumer = asyncio.create_task(consume())
    await asyncio.sleep(0.2)  # several heartbeat intervals of pure silence
    await bus.publish("incident.updated", {"x": 2})
    await asyncio.wait_for(consumer, timeout=2)

    data_chunks = [c for c in chunks if c.startswith("id: ")]
    heartbeats = [c for c in chunks if c.startswith(": heartbeat")]
    assert [c.split("\n", 1)[0] for c in data_chunks] == ["id: 1", "id: 2"]
    assert len(heartbeats) >= 2  # the silence produced heartbeats, not a dead stream
