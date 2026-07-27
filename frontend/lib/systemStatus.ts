/**
 * BLAZE header system statuses (ticket #38, region 1).
 *
 * TWO derivations live here:
 *
 *   - `deriveHeaderStatuses` — CURRENT. What the control-room header shows
 *     today: things this deployment genuinely observes in the event stream.
 *   - `deriveSystemStatuses` — LEGACY, no longer rendered anywhere. It also
 *     derived Gemma / vLLM / NVIDIA-GPU pills. Those describe a hackathon
 *     machine (an L40S serving Gemma through vLLM) that is NOT running: the
 *     deployment replays a frozen event stream, there is no model and no GPU.
 *     Advertising them — even flagged "~inferred" — claims a stack that does
 *     not exist, so the header dropped them. The function is kept because
 *     `scripts/verify-store.mjs` still asserts on it; delete both together.
 *
 * Pure derivation from the incident store: no fetch, no clock, no globals.
 *
 * HONESTY RULE (product invariant #4 — see also ticket #50 "measured values
 * only"): a status is never invented. Every pill carries how it was obtained:
 *   - `measured: true`  — a stream field reported this value,
 *   - `measured: false` — the value is INFERRED from observed activity, or the
 *     payload itself declared it unmeasured (`note: "mock placeholder …"`).
 * `unknown` is a first-class level and renders as "en attente", never as a
 * reassuring green. A demo that fakes GPU telemetry is worse than one that
 * admits it is still waiting for it.
 */

import { areMetricsPlaceholder, type IncidentState } from "./incidentStore";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** Visual severity of a status pill. */
export type StatusLevel = "unknown" | "ok" | "active" | "warn" | "alert";

export interface SystemStatus {
  /** Stable id, also used as the pill's `data-testid` suffix. */
  id: "gemma" | "vllm" | "gpu" | "network" | "incident";
  /** Short label shown faint before the value. */
  label: string;
  /** Primary value. */
  value: string;
  level: StatusLevel;
  /** Secondary line — how the value was obtained, counts, throughput. */
  detail: string;
  /** False when the value is inferred or explicitly declared unmeasured. */
  measured: boolean;
}

/* -------------------------------------------------------------------------- */
/* Payload readers                                                            */
/* -------------------------------------------------------------------------- */

type Metrics = Record<string, unknown> | null;

function readString(source: Metrics, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readNumber(source: Metrics, key: string): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * True when the metrics payload declares itself unmeasured. The mock stream
 * ships `note: "mock placeholder values, not measured"`; the real collector
 * (ticket #11) omits it. Anything matching is surfaced as unmeasured.
 */
export function metricsAreMock(metrics: Metrics): boolean {
  // Single source of truth for invariant #4 lives in the store.
  return areMetricsPlaceholder(metrics);
}

/** Model id of the most recent agent run that reported one. */
function lastReportedModelId(state: IncidentState): string | null {
  for (let i = state.agentRuns.length - 1; i >= 0; i -= 1) {
    const modelId = state.agentRuns[i].model_id;
    if (modelId) return modelId;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Individual statuses                                                        */
/* -------------------------------------------------------------------------- */

function gemmaStatus(state: IncidentState): SystemStatus {
  const metrics = state.metrics;
  const runs = state.agentRuns.length;
  const fromEvents = lastReportedModelId(state);
  const modelId = fromEvents ?? readString(metrics, "model_id");

  if (!modelId) {
    return {
      id: "gemma",
      label: "GEMMA 4",
      value: "en attente",
      level: "unknown",
      detail: "aucune activité agent",
      measured: false,
    };
  }

  const active = state.activeAgentId;
  return {
    id: "gemma",
    label: "GEMMA 4",
    value: modelId,
    level: active ? "active" : "ok",
    detail: active
      ? `${active} en cours · ${runs} activation${runs === 1 ? "" : "s"}`
      : `${runs} activation${runs === 1 ? "" : "s"}`,
    // A model id read off an agent-start event is reported by the stream;
    // falling back to the metrics payload inherits that payload's honesty.
    measured: fromEvents !== null || !metricsAreMock(metrics),
  };
}

function vllmStatus(state: IncidentState): SystemStatus {
  const metrics = state.metrics;
  const engine = readString(metrics, "inference_engine");

  if (engine) {
    const latency = readNumber(metrics, "avg_request_latency_ms");
    const peak = readNumber(metrics, "concurrent_requests_peak");
    const detail =
      [
        latency !== null ? `${Math.round(latency)} ms en moyenne` : null,
        peak !== null ? `pic ${peak} simultanés` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "moteur signalé";

    return {
      id: "vllm",
      label: "vLLM",
      value: engine,
      level: "ok",
      detail,
      measured: !metricsAreMock(metrics),
    };
  }

  // No engine field yet. Agent turns running IS evidence the local server is
  // serving — but that is an inference, and the pill says so.
  if (state.agentRuns.length > 0) {
    return {
      id: "vllm",
      label: "vLLM",
      value: "en service",
      level: "active",
      detail: "déduit de l'activité agent — moteur non encore signalé",
      measured: false,
    };
  }

  return {
    id: "vllm",
    label: "vLLM",
    value: "en attente",
    level: "unknown",
    detail: "aucune inférence observée",
    measured: false,
  };
}

function gpuStatus(state: IncidentState): SystemStatus {
  const metrics = state.metrics;
  const gpuName = readString(metrics, "gpu_name");

  // GPU state cannot be inferred from anything else in the stream: without a
  // metric.updated event carrying it, the honest answer is "not yet known".
  if (!gpuName) {
    return {
      id: "gpu",
      label: "GPU NVIDIA",
      value: "en attente",
      level: "unknown",
      detail: "aucune télémétrie reçue",
      measured: false,
    };
  }

  const tokensPerSecond = readNumber(metrics, "tokens_per_second");
  return {
    id: "gpu",
    label: "GPU NVIDIA",
    value: gpuName,
    level: "ok",
    detail:
      tokensPerSecond !== null
        ? `${tokensPerSecond} tok/s`
        : "débit non signalé",
    measured: !metricsAreMock(metrics),
  };
}

function networkStatus(state: IncidentState): SystemStatus {
  const mode = state.networkMode ?? readString(state.metrics, "network_mode");
  const fallbacks = state.fallbackCount;

  if (mode === null) {
    return {
      id: "network",
      label: "RÉSEAU",
      value: "en attente",
      level: "unknown",
      detail: "mode non encore signalé",
      measured: false,
    };
  }

  const offline = mode.toLowerCase() === "offline";
  const audio = state.audioMode ? ` · audio ${state.audioMode}` : "";
  const base = offline
    ? "local uniquement — sources en cache et préchargées"
    : "sources publiques joignables";

  return {
    id: "network",
    label: "RÉSEAU",
    value: offline ? "hors ligne" : "en ligne",
    // Offline is a supported demo mode, not a failure — warn, never alert.
    level: offline || fallbacks > 0 ? "warn" : "ok",
    detail:
      (fallbacks > 0
        ? `${fallbacks} repli${fallbacks === 1 ? "" : "s"} activé${fallbacks === 1 ? "" : "s"}`
        : base) + audio,
    measured: true,
  };
}

/** French label of the incident lifecycle. */
const INCIDENT_LABEL: Record<IncidentState["incidentStatus"], string> = {
  waiting: "en attente",
  active: "en cours",
  completed: "terminé",
};

function incidentStatus(state: IncidentState): SystemStatus {
  const name = state.incidentName ?? state.incidentId;
  const errors = state.errorCount;

  const level: StatusLevel =
    errors > 0
      ? "alert"
      : state.incidentStatus === "active"
        ? "active"
        : state.incidentStatus === "completed"
          ? "ok"
          : "unknown";

  return {
    id: "incident",
    label: "INCIDENT",
    value: INCIDENT_LABEL[state.incidentStatus],
    level,
    detail:
      errors > 0
        ? `${errors} erreur${errors === 1 ? "" : "s"} · ${name ?? "aucun incident"}`
        : (name ?? "en attente de incident.started"),
    measured: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * LEGACY status set — see the module header. No UI renders this any more;
 * `scripts/verify-store.mjs` is its only remaining consumer. French strings
 * below are frozen for those assertions and never reach a screen.
 *
 * @deprecated Use `deriveHeaderStatuses`.
 */
export function deriveSystemStatuses(state: IncidentState): SystemStatus[] {
  return [
    gemmaStatus(state),
    vllmStatus(state),
    gpuStatus(state),
    networkStatus(state),
    incidentStatus(state),
  ];
}

/* -------------------------------------------------------------------------- */
/* Header statuses — what this deployment can actually observe                */
/* -------------------------------------------------------------------------- */

/** Stable ids of the pills the header renders today. */
export type HeaderStatusId = "agents" | "replay";

/** Same shape as `SystemStatus`, restricted to the ids the header renders. */
export interface HeaderStatus extends Omit<SystemStatus, "id"> {
  id: HeaderStatusId;
}

/**
 * Agent activity, counted from `*_agent.started` / completion events reduced
 * by the store. This is a count of events actually replayed — it says nothing
 * about a model, an engine or a device, and claims nothing about either.
 */
function agentsStatus(state: IncidentState): HeaderStatus {
  const total = state.agentRuns.length;
  const done = state.agentRuns.filter((r) => r.finished).length;

  if (total === 0) {
    return {
      id: "agents",
      label: "agents",
      value: "idle",
      level: "unknown",
      detail: "no agent activation replayed yet",
      measured: true,
    };
  }

  const active = state.activeAgentId;
  return {
    id: "agents",
    label: "agents",
    value: active ?? `${done} done`,
    level: active ? "active" : "ok",
    detail: active
      ? `${active} running · ${done}/${total} activations complete`
      : `${done}/${total} agent activations complete`,
    measured: true,
  };
}

/**
 * Stream progress. The value is the number of envelopes the store has reduced
 * — a measured count. The label says "replay" because that is what this
 * deployment serves: a recorded scenario re-emitted event by event.
 */
function replayStatus(state: IncidentState): HeaderStatus {
  const received = state.eventsReceived;

  if (received === 0) {
    return {
      id: "replay",
      label: "replay",
      value: "standby",
      level: "unknown",
      detail: "recorded scenario — no event received yet",
      measured: true,
    };
  }

  const issues = state.errorCount + state.fallbackCount;
  return {
    id: "replay",
    label: "replay",
    value: `${received} events`,
    level: state.incidentStatus === "completed" ? "ok" : "active",
    detail:
      `recorded scenario · last sequence ${state.lastSequence}` +
      (issues > 0
        ? ` · ${state.errorCount} error(s), ${state.fallbackCount} fallback(s)`
        : ""),
    measured: true,
  };
}

/**
 * The header pills, in display order. Every value here is either a count of
 * events the store reduced or an id carried by one of those events — nothing
 * describes hardware, a model or an inference engine, because this deployment
 * runs none of them.
 */
export function deriveHeaderStatuses(state: IncidentState): HeaderStatus[] {
  return [agentsStatus(state), replayStatus(state)];
}
