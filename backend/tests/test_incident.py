import asyncio

import pytest

from backend.api.demo import DemoController, DemoState
from backend.streaming.bus import EventBus


def make_demo() -> DemoController:
    return DemoController(EventBus("wildfire-demo-01"))


async def run_to_completion(demo: DemoController) -> list[dict]:
    await demo.start(speed_factor=0)
    await asyncio.wait_for(demo._run_task, timeout=10)
    return list(demo.bus.history)


@pytest.mark.asyncio
async def test_start_emits_full_run_then_completes():
    demo = make_demo()
    events = await run_to_completion(demo)
    assert demo.state is DemoState.COMPLETED
    assert [e["sequence"] for e in events] == list(range(1, 71))
    assert events[0]["event_type"] == "incident.started"
    assert events[-1]["event_type"] == "incident.completed"


@pytest.mark.asyncio
async def test_reset_returns_to_idle_and_sequence_restarts():
    demo = make_demo()
    await run_to_completion(demo)
    await demo.reset()
    assert demo.state is DemoState.IDLE
    assert demo.bus.last_sequence == 0
    events = await run_to_completion(demo)
    assert events[0]["sequence"] == 1  # sequence restarted


@pytest.mark.asyncio
async def test_two_consecutive_runs_are_consistent():
    demo = make_demo()
    first = await run_to_completion(demo)
    await demo.reset()
    second = await run_to_completion(demo)
    fingerprint = lambda events: [(e["sequence"], e["event_type"]) for e in events]
    assert fingerprint(first) == fingerprint(second)


@pytest.mark.asyncio
async def test_audio_variant_reflected_in_emitted_events():
    demo = make_demo()
    demo.audio_variant = "clean"
    events = await run_to_completion(demo)
    audio_events = [e for e in events if e["event_type"] == "audio.received"]
    assert len(audio_events) == 5
    for e in audio_events:
        assert e["payload"]["audio_variant"] == "clean"
        assert e["payload"]["audio_path"].endswith("_clean.wav")


@pytest.mark.asyncio
async def test_network_mode_toggle_emits_event_during_run():
    demo = make_demo()
    events = await run_to_completion(demo)
    assert events[0]["payload"]["network_mode"] == "online"
    # Toggle while "running" (state forced, run already emitted): emits the event
    demo.state = DemoState.RUNNING
    await demo.set_network_mode("offline")
    last = demo.bus.history[-1]
    assert last["event_type"] == "network.mode.changed"
    assert last["payload"] == {"previous_mode": "online", "network_mode": "offline"}
    # Next run reflects the new mode in incident.started
    demo.state = DemoState.COMPLETED
    await demo.reset()
    events = await run_to_completion(demo)
    assert events[0]["payload"]["network_mode"] == "offline"


@pytest.mark.asyncio
async def test_start_while_running_raises():
    demo = make_demo()
    demo.state = DemoState.RUNNING
    with pytest.raises(RuntimeError):
        await demo.start()
