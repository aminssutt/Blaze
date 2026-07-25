/**
 * Local verification of the incident store + header status derivation
 * (ticket #38). Zero dependencies: Node 22.6+ strips the TypeScript types, so
 * this imports the REAL `lib/incidentStore.ts` and `lib/systemStatus.ts` —
 * never a reimplementation — and replays the frozen mock stream through them.
 *
 *   npm run verify-store
 *
 * What it guards:
 *   - every event of contracts/mocks/demo_event_stream.jsonl reduces cleanly,
 *   - PRODUCT INVARIANT #1: dispatch stays inert until an approve decision,
 *   - the restart rule (a non-increasing sequence rebuilds from scratch),
 *   - the header pills are honest: nothing is claimed before it is reported,
 *     and self-declared placeholder metrics are never shown as measured.
 *
 * The frontend has no browser-test runner in the hackathon scope; this is the
 * regression net for the store/derivation logic the whole UI is built on.
 */

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

/*
 * The app's TypeScript uses extensionless relative imports ("./contracts"),
 * which the TS/bundler resolver accepts but Node's ESM resolver does not.
 * Rather than change the app's import style for the sake of a test, resolve
 * the extensionless specifiers here: on failure, retry with ".ts".
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

// Dynamic, so the hook above is registered before the modules are resolved.
const { INITIAL_INCIDENT_STATE, IncidentStore, reduceEvent } = await import(
  "../lib/incidentStore.ts"
);
const { deriveSystemStatuses, metricsAreMock } = await import(
  "../lib/systemStatus.ts"
);

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(frontendRoot, "..");
const MOCK_PATH = join(repoRoot, "contracts", "mocks", "demo_event_stream.jsonl");

/** The frozen demo stream, parsed. */
const EVENTS = readFileSync(MOCK_PATH, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Line ${index + 1} of demo_event_stream.jsonl is not JSON: ${error.message}`);
    }
  });

/** Reduce the whole stream, returning the final state. */
function replayAll() {
  return EVENTS.reduce(reduceEvent, INITIAL_INCIDENT_STATE);
}

/** Reduce up to and including `sequence`. */
function replayThrough(sequence) {
  return EVENTS.filter((e) => e.sequence <= sequence).reduce(
    reduceEvent,
    INITIAL_INCIDENT_STATE,
  );
}

const byId = (statuses, id) => statuses.find((s) => s.id === id);

/* -------------------------------------------------------------------------- */
/* Stream sanity                                                              */
/* -------------------------------------------------------------------------- */

test("mock stream is well-formed and strictly ordered", () => {
  assert.ok(EVENTS.length > 0, "stream is empty");
  EVENTS.forEach((event, i) => {
    assert.equal(
      event.sequence,
      i + 1,
      `sequence must be dense and 1-based (event ${i + 1})`,
    );
    for (const field of ["event_id", "incident_id", "event_type", "timestamp", "payload"]) {
      assert.ok(field in event, `event ${event.sequence} is missing ${field}`);
    }
  });
});

test("every event reduces and bookkeeping matches the stream", () => {
  const state = replayAll();
  assert.equal(state.eventsReceived, EVENTS.length);
  assert.equal(state.lastSequence, EVENTS.length);
  assert.equal(state.events.length, EVENTS.length);

  const expected = new Map();
  for (const event of EVENTS) {
    expected.set(event.event_type, (expected.get(event.event_type) ?? 0) + 1);
  }
  for (const [type, count] of expected) {
    assert.equal(state.countsByType[type], count, `countsByType[${type}]`);
  }
});

/* -------------------------------------------------------------------------- */
/* PRODUCT INVARIANT #1 — nothing is dispatched without human approval        */
/* -------------------------------------------------------------------------- */

test("dispatch stays locked until an approve decision is reduced", () => {
  const approval = EVENTS.find((e) => e.event_type === "approval.received");
  assert.ok(approval, "the demo stream must contain approval.received");
  assert.equal(approval.payload.decision, "approve");

  // Every prefix BEFORE the approval must leave dispatch locked — including
  // the prefixes where the plan and the passing safety review already exist.
  for (let seq = 1; seq < approval.sequence; seq += 1) {
    const state = replayThrough(seq);
    assert.equal(
      state.dispatchUnlocked,
      false,
      `dispatch was unlocked at sequence ${seq}, before approval.received`,
    );
  }

  assert.equal(replayThrough(approval.sequence).dispatchUnlocked, true);
});

test("no dispatch instruction is emitted before approval", () => {
  const approval = EVENTS.find((e) => e.event_type === "approval.received");
  const early = EVENTS.filter(
    (e) =>
      e.sequence < approval.sequence &&
      (e.event_type === "dispatch.instruction.ready" ||
        e.event_type === "dispatch.sent"),
  );
  assert.deepEqual(early, [], "dispatch events appear before the approval");
});

test("final state reflects the whole scenario", () => {
  const state = replayAll();
  assert.equal(state.incidentStatus, "completed");
  assert.equal(state.dispatchUnlocked, true);
  assert.equal(state.dispatches.length, 3);
  assert.equal(state.dispatchesSent, 3);
  assert.equal(state.plans.length, 2, "the demo shows two plan versions");
  assert.equal(state.safetyReviews.length, 2);
  assert.equal(state.safetyReviews[0].status, "revise");
  assert.equal(state.safetyReviews[1].status, "pass");
  assert.ok(state.snapshot, "a situation snapshot must be built");
  assert.ok(state.radioEvents.length > 0);
});

/* -------------------------------------------------------------------------- */
/* Ticket #38 store extension — the slices the eleven panels read             */
/* -------------------------------------------------------------------------- */

test("the five audios are merged into one progress record each", () => {
  const state = replayAll();
  assert.equal(state.audios.length, 5, "one record per audio_id");
  assert.equal(
    state.audios.filter((a) => a.status === "transcribed").length,
    5,
    "every audio must reach the transcribed stage",
  );
  assert.equal(state.audios.filter((a) => a.transcript !== null).length, 5);
  assert.equal(state.transcripts.length, 5, "legacy transcripts slice kept");

  // audio.received announces the variant; incident.started sets the mode.
  assert.equal(state.audioMode, "radio");
  for (const audio of state.audios) {
    assert.equal(audio.audio_mode, "radio", `${audio.audio_id} variant`);
    assert.ok(audio.speaker_hint, `${audio.audio_id} has a speaker hint`);
  }

  // Every extracted RadioEvent is linked back to the audio it came from.
  const linked = state.audios.reduce((n, a) => n + a.extracted_event_ids.length, 0);
  assert.equal(linked, state.radioEvents.length);
});

test("six radio events, exactly one correction, history preserved", () => {
  const state = replayAll();
  assert.equal(state.radioEvents.length, 6);

  const corrections = state.radioEvents.filter((e) => e.is_correction);
  assert.equal(corrections.length, 1, "the demo has exactly one correction");
  assert.equal(corrections[0].corrects_event_id, "re-002");

  // PRODUCT INVARIANT #3 — the corrected event is never removed.
  assert.ok(
    state.radioEvents.some((e) => e.event_id === "re-002"),
    "the corrected event must stay visible for the audit trail",
  );
});

test("tool requests and results are merged by tool_call_id", () => {
  const state = replayAll();
  assert.equal(state.toolCalls.length, 7, "seven distinct tool calls");
  assert.equal(
    state.toolCalls.filter((c) => c.completed).length,
    7,
    "every tool call completes in the demo",
  );

  // Legacy ticket #39 slices are untouched alongside the merged view.
  assert.equal(state.toolRequests.length, 7);
  assert.equal(state.toolResults.length, 7);

  for (const call of state.toolCalls) {
    assert.ok(call.agent_id, `${call.tool_call_id} keeps its requesting agent`);
    assert.ok(call.arguments, `${call.tool_call_id} keeps its arguments`);
    assert.equal(call.status, "success");
    // PRODUCT INVARIANT #2 — a result without provenance is unusable.
    assert.ok(call.source_type, `${call.tool_call_id} carries a source_type`);
    assert.ok(call.source_name, `${call.tool_call_id} carries a source_name`);
    assert.equal(
      typeof call.latency_ms,
      "number",
      `${call.tool_call_id} has a computed latency`,
    );
    assert.ok(call.latency_ms >= 0, `${call.tool_call_id} latency is not negative`);
  }

  // tc-001: requested 10:00:02.500, retrieved 10:00:03.400 => 900 ms.
  const weather = state.toolCalls.find((c) => c.tool_call_id === "tc-001");
  assert.equal(weather.tool_name, "weather");
  assert.equal(weather.latency_ms, 900);
  assert.equal(weather.is_cached, true);
  assert.equal(weather.staleness_seconds, 540);
});

test("agent runs are ordered and all close by the end of the scenario", () => {
  const state = replayAll();
  const started = EVENTS.filter((e) =>
    [
      "context_agent.started",
      "radio_agent.started",
      "planning.started",
      "safety_review.started",
      "dispatch.started",
    ].includes(e.event_type),
  );
  assert.equal(state.agentRuns.length, started.length);
  assert.equal(
    state.agentRuns.filter((r) => r.finished).length,
    started.length,
    "every agent run is closed by its completion event",
  );
  assert.equal(state.activeAgentId, null, "no agent is left running");

  // Runs keep the arrival order of their starting events.
  assert.deepEqual(
    state.agentRuns.map((r) => r.sequence),
    started.map((e) => e.sequence),
  );

  // While the context agent is collecting tools it is the active one.
  const midway = replayThrough(5);
  assert.equal(midway.activeAgentId, "situation_context");
});

test("plan revisions and TTS are tracked per id", () => {
  const state = replayAll();

  assert.equal(state.planRevisionRequests.length, 1);
  assert.equal(state.planRevisionRequests[0].review_id, "sr-001");
  assert.equal(state.planRevisionRequests[0].requested_by, "safety_critic");
  assert.equal(state.plan.plan_id, "plan-v2", "`plan` stays the latest version");
  assert.deepEqual(
    state.plans.map((p) => p.version),
    [1, 2],
    "every plan version is kept in arrival order",
  );

  const tts = Object.values(state.ttsByDispatchId);
  assert.equal(tts.length, 3, "one TTS record per dispatch instruction");
  assert.equal(tts.filter((t) => t.status === "ready").length, 3);
  for (const entry of tts) {
    assert.ok(entry.tts_audio_path, `${entry.dispatch_id} has a generated WAV`);
    assert.equal(typeof entry.latency_ms, "number");
  }
});

test("the map receives its geographic frame from incident.started", () => {
  const state = replayAll();
  assert.deepEqual(state.incidentLocation, {
    lat: 43.455,
    lon: 3.756,
    label: "Hangar Zone, sector B12",
  });
  assert.deepEqual(state.boundingBox, {
    min_lat: 43.44,
    min_lon: 3.73,
    max_lat: 43.47,
    max_lon: 3.77,
  });
});

test("no banner is raised by the nominal scenario", () => {
  const state = replayAll();
  assert.deepEqual(state.banners, []);
  assert.equal(state.fallbackCount, 0);
  assert.equal(state.errorCount, 0);

  // A fallback event feeds both the counter and the ordered banner list.
  const withFallback = reduceEvent(state, {
    event_id: "evt-fallback-test",
    incident_id: "wildfire-demo-01",
    event_type: "fallback.activated",
    timestamp: "2026-07-25T10:03:00.000Z",
    sequence: 71,
    payload: { reason: "cloud unreachable", level: "cached_data" },
  });
  assert.equal(withFallback.fallbackCount, 1);
  assert.equal(withFallback.banners.length, 1);
  assert.equal(withFallback.banners[0].kind, "fallback");
  assert.equal(withFallback.banners[0].sequence, 71);
});

test("the reducer is pure — folding twice yields the same state", () => {
  assert.deepEqual(replayAll(), replayAll());
  // The initial state is never mutated by a fold.
  replayAll();
  assert.equal(INITIAL_INCIDENT_STATE.eventsReceived, 0);
  assert.deepEqual(INITIAL_INCIDENT_STATE.events, []);
  assert.equal(INITIAL_INCIDENT_STATE.dispatchUnlocked, false);
});

/* -------------------------------------------------------------------------- */
/* Restart rule                                                               */
/* -------------------------------------------------------------------------- */

test("a non-increasing sequence rebuilds the state from scratch", () => {
  const store = new IncidentStore();
  for (const event of EVENTS) store.ingest(event);
  assert.equal(store.getSnapshot().eventsReceived, EVENTS.length);

  // Replay from the beginning, as a player jump or an SSE reconnect would.
  store.ingest(EVENTS[0]);
  const restarted = store.getSnapshot();
  assert.equal(restarted.eventsReceived, 1, "store did not rebuild on replay");
  assert.equal(restarted.lastSequence, EVENTS[0].sequence);
  assert.equal(restarted.dispatchUnlocked, false, "approval leaked across a restart");
  assert.equal(restarted.dispatches.length, 0);
});

test("explicit reset returns the initial state", () => {
  const store = new IncidentStore();
  for (const event of EVENTS) store.ingest(event);
  store.reset();
  assert.deepEqual(store.getSnapshot(), INITIAL_INCIDENT_STATE);
});

/* -------------------------------------------------------------------------- */
/* Header statuses (ticket #38) — honesty rules                               */
/* -------------------------------------------------------------------------- */

test("before any event every derived pill is unknown and unmeasured", () => {
  const statuses = deriveSystemStatuses(INITIAL_INCIDENT_STATE);
  assert.equal(statuses.length, 5);

  for (const id of ["gemma", "vllm", "gpu"]) {
    const pill = byId(statuses, id);
    assert.equal(pill.level, "unknown", `${id} must start unknown`);
    assert.equal(pill.measured, false, `${id} must not claim a measurement`);
  }
  // Network mode and incident lifecycle are reported by the stream itself.
  assert.equal(byId(statuses, "network").level, "unknown");
  assert.equal(byId(statuses, "incident").value, "en attente");
});

test("GPU is never claimed before a metric.updated carries it", () => {
  const firstMetric = EVENTS.find((e) => e.event_type === "metric.updated");
  assert.ok(firstMetric, "the demo stream must contain metric.updated");

  const before = deriveSystemStatuses(replayThrough(firstMetric.sequence - 1));
  const gpuBefore = byId(before, "gpu");
  assert.equal(gpuBefore.level, "unknown");
  assert.equal(gpuBefore.measured, false);
  assert.match(gpuBefore.value, /en attente/);

  const after = deriveSystemStatuses(replayThrough(firstMetric.sequence));
  const gpuAfter = byId(after, "gpu");
  assert.equal(gpuAfter.value, firstMetric.payload.gpu_name);
  assert.equal(gpuAfter.level, "ok");
});

test("placeholder metrics are surfaced as unmeasured", () => {
  const state = replayAll();
  assert.equal(
    metricsAreMock(state.metrics),
    true,
    "the demo metrics declare themselves unmeasured — the UI must say so",
  );

  for (const id of ["gpu", "vllm"]) {
    assert.equal(
      byId(deriveSystemStatuses(state), id).measured,
      false,
      `${id} must not present placeholder values as measured`,
    );
  }

  // A payload without the note is a real measurement and must read as one.
  const measured = { ...state, metrics: { gpu_name: "NVIDIA L4", tokens_per_second: 61.2 } };
  assert.equal(byId(deriveSystemStatuses(measured), "gpu").measured, true);
});

test("network and incident pills follow the stream", () => {
  const start = EVENTS.find((e) => e.event_type === "incident.started");

  const atStart = deriveSystemStatuses(replayThrough(start.sequence));
  assert.equal(byId(atStart, "network").value, "en ligne");
  assert.equal(byId(atStart, "network").measured, true);
  assert.equal(byId(atStart, "incident").value, "en cours");

  const atEnd = deriveSystemStatuses(replayAll());
  assert.equal(byId(atEnd, "incident").value, "terminé");
  assert.equal(byId(atEnd, "incident").level, "ok");
});

test("Gemma reports the model id announced by the agents", () => {
  const firstAgent = EVENTS.find((e) => typeof e.payload?.model_id === "string");
  assert.ok(firstAgent, "agent events must announce a model_id");

  const pill = byId(deriveSystemStatuses(replayThrough(firstAgent.sequence)), "gemma");
  assert.equal(pill.value, firstAgent.payload.model_id);
  assert.equal(
    pill.measured,
    true,
    "a model id read off an agent event is reported, not inferred",
  );
});

test("vLLM is marked inferred while only agent activity is observed", () => {
  const firstAgent = EVENTS.find((e) => typeof e.payload?.model_id === "string");
  const firstMetric = EVENTS.find((e) => e.event_type === "metric.updated");

  const early = byId(deriveSystemStatuses(replayThrough(firstAgent.sequence)), "vllm");
  assert.equal(early.measured, false, "inference must not be presented as measured");
  assert.match(early.detail, /déduit/);

  const late = byId(deriveSystemStatuses(replayThrough(firstMetric.sequence)), "vllm");
  assert.equal(late.value, firstMetric.payload.inference_engine);
});
