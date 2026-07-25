// Ticket #50 — métriques NVIDIA. Owner: @six-16.
//
// The GPU Challenge showcase: a "cockpit" readout of the local inference
// stack, driven 100% by `metric.updated` events — NOT ONE hardcoded value.
// Every field the payload has not (yet) delivered renders as "—"; a value is
// NEVER invented. The full row grid is always rendered so live updates cause
// zero layout jumps (issue #50 acceptance).
//
// The hero figure is "Appels LLM cloud: 0" (green when it is measured at 0)
// plus the online/offline badge — the proof the pipeline runs on local GPU.
//
// PRODUCT INVARIANT #4 — mock metric values are PLACEHOLDERS and are flagged
// as such ("valeurs mock" badge); they are never presented as measured.

"use client";

import { areMetricsPlaceholder, getMetricsNote } from "@/lib/incidentStore";
import { useIncidentState } from "@/lib/session";
import { Badge, Panel, StatusDot } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* Formatting — payload values only, "—" when absent                          */
/* -------------------------------------------------------------------------- */

type Metrics = Record<string, unknown> | null;

/** Raw payload value → display string. Absent/invalid = "—", never invented. */
function fmt(metrics: Metrics, key: string, unit?: "ms" | "toks"): string {
  const value = metrics?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (unit === "ms") {
      // Long durations read better in seconds; the raw ms stays in the title.
      return value >= 10_000
        ? `${(value / 1000).toFixed(1)} s`
        : `${value.toLocaleString("fr-FR")} ms`;
    }
    if (unit === "toks") return `${value.toLocaleString("fr-FR")} tok/s`;
    return value.toLocaleString("fr-FR");
  }
  return "—";
}

/** Cockpit rows, in display order. Missing payload fields render "—". */
const ROWS: { key: string; label: string; unit?: "ms" | "toks" }[] = [
  { key: "gpu_name", label: "GPU" },
  { key: "model_id", label: "modèle" },
  { key: "inference_engine", label: "moteur" },
  { key: "gemma_agent_calls", label: "appels agents Gemma" },
  { key: "concurrent_requests_peak", label: "requêtes simultanées (pic)" },
  { key: "avg_request_latency_ms", label: "latence Gemma (moy.)", unit: "ms" },
  { key: "end_to_end_latency_ms", label: "latence bout-en-bout", unit: "ms" },
  { key: "tokens_per_second", label: "tokens/s", unit: "toks" },
  { key: "stt_avg_latency_ms", label: "latence STT (moy.)", unit: "ms" },
  { key: "tts_avg_latency_ms", label: "latence TTS (moy.)", unit: "ms" },
  { key: "tool_calls_total", label: "appels outils" },
  { key: "tool_calls_cached", label: "outils en cache" },
];

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

export default function NvidiaMetricsPanel({ className }: PanelComponentProps) {
  const { metrics } = useIncidentState();
  const placeholder = areMetricsPlaceholder(metrics);
  const note = getMetricsNote(metrics);

  // Hero figure — only ever the payload value, "—" until it arrives.
  const cloudCalls = metrics?.cloud_llm_calls;
  const cloudMeasured =
    typeof cloudCalls === "number" && Number.isFinite(cloudCalls);
  const cloudZero = cloudMeasured && cloudCalls === 0;

  // Online/offline — from the metric.updated payload only.
  const networkMode =
    typeof metrics?.network_mode === "string" ? metrics.network_mode : null;

  return (
    <Panel
      className={className}
      id="nvidia-metrics"
      title="NVIDIA metrics"
      subtitle={note ?? undefined}
      live={metrics !== null}
      right={
        <>
          {networkMode !== null && (
            <StatusDot
              tone={networkMode === "online" ? "ok" : "warn"}
              pulse={networkMode !== "online"}
              label={networkMode === "online" ? "en ligne" : "hors ligne"}
              title={`network_mode: ${networkMode}`}
            />
          )}
          {placeholder && (
            <Badge variant="warn" filled title={note ?? undefined}>
              valeurs mock
            </Badge>
          )}
        </>
      }
      empty={metrics === null}
      emptyLabel="no metrics yet…"
      emptyHint="inference latencies and GPU load — from the first measurement"
    >
      <div className="flex flex-col gap-2 font-mono">
        {/* hero — the local-GPU proof, big and green when measured at 0 */}
        <div
          className={`flex items-baseline justify-between gap-2 rounded-sm border px-2 py-1.5 ${
            cloudZero
              ? "border-ok/50 bg-ok-dim/40"
              : cloudMeasured
                ? "border-alert/60 bg-alert-dim/40"
                : "border-edge bg-overlay"
          }`}
          title="cloud_llm_calls — nombre d'appels LLM cloud effectués"
        >
          <span className="text-[10px] uppercase tracking-wider text-muted">
            Appels LLM cloud
          </span>
          <span
            className={`text-xl font-bold leading-none ${
              cloudZero ? "text-ok" : cloudMeasured ? "text-alert" : "text-faint"
            }`}
          >
            {cloudMeasured ? cloudCalls : "—"}
          </span>
        </div>

        {/* cockpit grid — all rows always present: zero layout jumps */}
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[10px]">
          {ROWS.map(({ key, label, unit }) => {
            const display = fmt(metrics, key, unit);
            const raw = metrics?.[key];
            return (
              <div key={key} className="col-span-2 grid grid-cols-subgrid">
                <dt className="truncate text-faint" title={key}>
                  {label}
                </dt>
                <dd
                  className={`text-right ${
                    display === "—" ? "text-faint" : "text-foreground"
                  }`}
                  title={raw !== undefined && raw !== null ? String(raw) : undefined}
                >
                  {display}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </Panel>
  );
}
