/**
 * BLAZE header system statuses (ticket #38, region 1).
 *
 * Pure derivation from the incident store: Gemma 4, vLLM, NVIDIA GPU, network
 * and incident state, each reduced to one pill for the control-room header.
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
 * The header status pills, in display order. Pure function of store state, so
 * the header is fully driven by the stream (mock today, SSE after #54).
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
