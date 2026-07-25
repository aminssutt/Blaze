#!/usr/bin/env python3
"""Rerun-stability harness (ticket #58) — prove the demo is deterministic.

Drives the live backend API through N full cycles of
reset → start → COMPLETED, fingerprints each run from the event history
(sequence, event_type, and stable payload keys), and reports any divergence.

Works against the mock pipeline today and, unchanged, against the real
orchestrator once integrations #52/#53 land.

Usage:
    python3 scripts/platform/rerun_stability.py [runs] [backend_url]
    # defaults: 5 runs, http://localhost:8080
Exit code 0 = all runs identical.
"""

import json
import sys
import time
import urllib.request

STABLE_PAYLOAD_KEYS = (
    "audio_id", "audio_variant", "plan_id", "version", "unit_id",
    "decision", "tool_name", "network_mode", "event_count",
)


def call(base: str, method: str, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{base}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as resp:
        return json.load(resp)


def read_history(base: str, expected: int) -> list[dict]:
    """Drain the SSE stream (history replay) until `expected` events."""
    events = []
    request = urllib.request.Request(f"{base}/events/stream")
    with urllib.request.urlopen(request, timeout=30) as resp:
        for raw in resp:
            line = raw.decode().strip()
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
                if len(events) >= expected:
                    break
    return events


def fingerprint(events: list[dict]) -> list[tuple]:
    return [
        (
            e["sequence"],
            e["event_type"],
            tuple(
                (k, e["payload"][k])
                for k in STABLE_PAYLOAD_KEYS
                if k in e["payload"]
            ),
        )
        for e in events
    ]


def one_run(base: str, run_index: int) -> list[tuple]:
    call(base, "POST", "/incident/reset")
    call(base, "POST", "/incident/start", {"speed_factor": 100})
    for _ in range(240):
        status = call(base, "GET", "/incident/status")
        if status["state"] == "COMPLETED":
            break
        time.sleep(0.5)
    else:
        raise RuntimeError(f"run {run_index}: never completed ({status})")
    events = read_history(base, status["last_sequence"])
    print(f"  run {run_index}: COMPLETED, {len(events)} events")
    return fingerprint(events)


def main() -> int:
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    base = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8080"
    print(f"rerun stability: {runs} consecutive runs against {base}")

    reference = one_run(base, 1)
    divergences = 0
    for i in range(2, runs + 1):
        current = one_run(base, i)
        if current == reference:
            continue
        divergences += 1
        for a, b in zip(reference, current):
            if a != b:
                print(f"  DIVERGENCE run {i} at seq {a[0]}:\n    ref: {a}\n    got: {b}")
                break
        if len(current) != len(reference):
            print(f"  DIVERGENCE run {i}: {len(current)} events vs {len(reference)}")

    call(base, "POST", "/incident/reset")
    if divergences:
        print(f"\n{divergences}/{runs - 1} reruns diverged ✗")
        return 1
    print(f"\nall {runs} runs identical ✔")
    return 0


if __name__ == "__main__":
    sys.exit(main())
