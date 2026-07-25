"""Rerun stability (#58): 5 consecutive runs, reset semantics, no state leakage."""

import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from backend.api.demo import DemoController, DemoState
from backend.api.main import app
from backend.streaming.bus import EventBus


def make_demo() -> DemoController:
    return DemoController(EventBus("wildfire-demo-01"))


async def run_to_completion(demo: DemoController) -> list[dict]:
    await demo.start(speed_factor=0)
    await asyncio.wait_for(demo._run_task, timeout=10)
    return list(demo.bus.history)


@pytest.mark.asyncio
async def test_five_consecutive_runs_are_identical():
    demo = make_demo()
    fingerprints = []
    for _ in range(5):
        events = await run_to_completion(demo)
        fingerprints.append([(e["sequence"], e["event_type"]) for e in events])
        await demo.reset()
        assert demo.state is DemoState.IDLE
        assert demo.bus.last_sequence == 0
        assert demo.bus.history == []
    assert all(fp == fingerprints[0] for fp in fingerprints)


@pytest.mark.asyncio
async def test_subscriber_connected_across_reset_sees_the_next_run():
    # Leak: sequences restart at 1 after reset, but the subscribe guard
    # (sequence > last_sent) silently dropped them — a second connected viewer
    # went permanently silent after any reset. The SSE adapter contract expects
    # to RECEIVE a non-increasing sequence to detect the restart.
    bus = EventBus("wildfire-demo-01")
    events = bus.subscribe(after_sequence=0)
    await bus.publish("incident.started", {"run": 1})
    first = await asyncio.wait_for(events.__anext__(), timeout=1)
    assert first["sequence"] == 1

    await bus.reset()
    await bus.publish("incident.started", {"run": 2})
    second = await asyncio.wait_for(events.__anext__(), timeout=1)
    assert second["sequence"] == 1  # restart visible to the connected client
    assert second["payload"]["run"] == 2
    await events.aclose()


def test_reset_cancels_dev_replay_task():
    # Leak: /dev/replay's background task survived /incident/reset and kept
    # publishing pre-reset envelopes into the "clean" bus.
    with TestClient(app) as client:
        resp = client.post("/dev/replay", params={"speed_factor": 0.01})  # ~slow
        assert resp.status_code == 200
        resp = client.post("/incident/reset")
        assert resp.status_code == 200
        task = client.app.state.replay_task
        assert task is None or task.done()


def test_reset_cancels_audio_ingest_task():
    with TestClient(app) as client:
        resp = client.post("/audio/ingest", json={"speed_factor": 0.01})
        assert resp.status_code == 200
        resp = client.post("/incident/reset")
        assert resp.status_code == 200
        task = client.app.state.audio_ingest_task
        assert task is None or task.done()


def test_full_cycle_via_api_five_times_and_reset_under_10s():
    with TestClient(app) as client:
        for _ in range(5):
            resp = client.post("/incident/start", json={"speed_factor": 0})
            assert resp.status_code == 200
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                status = client.get("/incident/status").json()
                if status["state"] == "COMPLETED":
                    break
                time.sleep(0.05)
            assert status["state"] == "COMPLETED"
            assert status["last_sequence"] == 70

            t0 = time.monotonic()
            resp = client.post("/incident/reset")
            reset_s = time.monotonic() - t0
            assert resp.status_code == 200
            assert reset_s < 10
            status = resp.json()
            assert status["state"] == "IDLE"
            assert status["last_sequence"] == 0
