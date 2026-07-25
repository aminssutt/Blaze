// Ticket #50 — métriques NVIDIA. Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #50 owns this file from now on.
// PRODUCT INVARIANT #4 — mock metric values are PLACEHOLDERS and are flagged
// as such; they are never presented as measured.

"use client";

import { areMetricsPlaceholder, getMetricsNote } from "@/lib/incidentStore";
import { useIncidentState } from "@/lib/session";
import { Badge, Panel } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

/** Metric keys with a French label, in display order. */
const METRIC_LABELS: [key: string, label: string][] = [
  ["gpu_name", "GPU"],
  ["inference_engine", "moteur"],
  ["model_id", "modèle"],
  ["gemma_agent_calls", "appels agents"],
  ["concurrent_requests_peak", "pic simultané"],
  ["avg_request_latency_ms", "latence moy. (ms)"],
  ["end_to_end_latency_ms", "bout-en-bout (ms)"],
  ["tokens_per_second", "tokens/s"],
  ["stt_avg_latency_ms", "STT moy. (ms)"],
  ["tts_avg_latency_ms", "TTS moy. (ms)"],
  ["tool_calls_total", "appels outils"],
  ["tool_calls_cached", "outils en cache"],
  ["cloud_llm_calls", "appels LLM cloud"],
];

export default function NvidiaMetricsPanel({ className }: PanelComponentProps) {
  const { metrics } = useIncidentState();
  const placeholder = areMetricsPlaceholder(metrics);
  const note = getMetricsNote(metrics);

  const rows = METRIC_LABELS.filter(
    ([key]) => metrics?.[key] !== undefined && metrics?.[key] !== null,
  );

  return (
    <Panel
      className={className}
      id="nvidia-metrics"
      title="Métriques NVIDIA"
      subtitle={note ?? undefined}
      right={
        placeholder ? (
          <Badge variant="warn" filled title={note ?? undefined}>
            valeurs mock
          </Badge>
        ) : null
      }
      empty={rows.length === 0}
      emptyLabel="aucune métrique…"
      emptyHint="alimenté par metric.updated"
    >
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 font-mono text-[10px]">
        {rows.map(([key, label]) => (
          <div key={key} className="col-span-2 grid grid-cols-subgrid">
            <dt className="truncate text-faint">{label}</dt>
            <dd
              className={
                key === "cloud_llm_calls" ? "text-accent-strong" : "text-foreground"
              }
            >
              {String(metrics?.[key])}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
