// Vue Système — consommation Gemma par agent (demande Lakhdar).
//
// Two panels, both derived 100% from the incident store (i.e. from the event
// stream — mock replay or live SSE, the component never knows which):
//
//   1. "Consommation Gemma par agent" — one row per pipeline agent, built by
//      grouping `state.agentRuns` (started/finished by the reducer from the
//      `*_agent.started` → completion events). Latency = finished_at −
//      started_at of the SAME run (the reducer already correlates runs per
//      agent/audio); the share bar is that agent's busy time over the total.
//   2. "Budget scénario" — elapsed incident time (incident.started → last
//      event), total Gemma activations observed in the stream, plus the
//      counters the `metric.updated` payload actually carries.
//
// PRODUCT INVARIANT #4 — NOT ONE value is invented. Anything the stream has
// not (yet) delivered renders as "—" (per-agent tokens are absent from both
// the mock payload and the real collector snapshot → "—" with a "pending
// live metrics" note). Mock `metric.updated` values carry the payload's own
// "mock placeholder" note and are flagged with the "valeurs mock" badge.

"use client";

import {
  areMetricsPlaceholder,
  getMetricsNote,
  type AgentRun,
  type IncidentState,
} from "@/lib/incidentStore";
import { useIncidentState } from "@/lib/session";
import { Badge, Meter, Panel, StatusDot } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* Derivation — store state only, "—" when absent                             */
/* -------------------------------------------------------------------------- */

/**
 * The five pipeline agents, in pipeline order. The table always renders the
 * full grid (zero layout jumps during replay); agents the stream has not yet
 * activated show "—" everywhere. Any UNKNOWN agent_id observed in the stream
 * is appended after these, so nothing is ever dropped.
 */
const KNOWN_AGENTS: { id: string; label: string }[] = [
  { id: "radio_intelligence", label: "Radio Intelligence" },
  { id: "situation_context", label: "Situation Context" },
  { id: "tactical_planning", label: "Tactical Planning" },
  { id: "safety_critic", label: "Safety Critic" },
  { id: "dispatch", label: "Dispatch" },
];

interface AgentConsumption {
  agent_id: string;
  label: string;
  /** Number of `*_agent.started` (or equivalent) events reduced for this agent. */
  executions: number;
  /** Runs whose completion event arrived with parseable timestamps. */
  measurable: number;
  /** Mean started→ready latency in ms, null when no run is measurable. */
  avgLatencyMs: number | null;
  /** Sum of measurable run durations, for the share-of-total bar. */
  busyMs: number;
  /** True while this agent has a started, not-yet-completed run. */
  running: boolean;
  /** model_id reported by the most recent run, null when never reported. */
  modelId: string | null;
}

/** started→finished delta of one run, null when not (yet) computable. */
function runDurationMs(run: AgentRun): number | null {
  if (!run.finished || run.finished_at === null) return null;
  const start = Date.parse(run.started_at);
  const end = Date.parse(run.finished_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

/** Groups the store's agentRuns into one consumption row per agent. */
function deriveConsumption(state: IncidentState): AgentConsumption[] {
  const order = KNOWN_AGENTS.map((a) => a.id);
  const labels = new Map(KNOWN_AGENTS.map((a) => [a.id, a.label]));
  // Preserve pipeline order, then append unknown agent ids in arrival order.
  for (const run of state.agentRuns) {
    if (!order.includes(run.agent_id)) order.push(run.agent_id);
  }

  return order.map((agentId) => {
    const runs = state.agentRuns.filter((r) => r.agent_id === agentId);
    const durations = runs
      .map(runDurationMs)
      .filter((d): d is number => d !== null);
    const busyMs = durations.reduce((sum, d) => sum + d, 0);
    let modelId: string | null = null;
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      if (runs[i].model_id) {
        modelId = runs[i].model_id;
        break;
      }
    }
    return {
      agent_id: agentId,
      label: labels.get(agentId) ?? agentId,
      executions: runs.length,
      measurable: durations.length,
      avgLatencyMs:
        durations.length > 0 ? busyMs / durations.length : null,
      busyMs,
      running: runs.some((r) => !r.finished),
      modelId,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Formatting — payload/stream values only, "—" when absent                   */
/* -------------------------------------------------------------------------- */

const DASH = "—";

/** ms → display. Long durations read better in seconds. */
function fmtMs(ms: number | null): string {
  if (ms === null) return DASH;
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms).toLocaleString("fr-FR")} ms`;
}

/** Elapsed incident time → "N min SS s" (or "N s" under a minute). */
function fmtElapsed(ms: number): string {
  const totalS = Math.round(ms / 1000);
  const min = Math.floor(totalS / 60);
  const s = totalS % 60;
  return min > 0 ? `${min} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

type Metrics = Record<string, unknown> | null;

/** metric.updated payload value → display string. Absent = "—", never invented. */
function fmtMetric(metrics: Metrics, key: string, unit?: "toks"): string {
  const value = metrics?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (unit === "toks") return `${value.toLocaleString("fr-FR")} tok/s`;
    return value.toLocaleString("fr-FR");
  }
  return DASH;
}

/* -------------------------------------------------------------------------- */
/* Per-agent table                                                            */
/* -------------------------------------------------------------------------- */

function AgentStatusCell({ row }: { row: AgentConsumption }) {
  if (row.running) {
    return (
      <span className="flex items-center gap-1.5 text-info">
        <StatusDot tone="running" pulse />
        en cours
      </span>
    );
  }
  if (row.executions > 0) {
    return (
      <span className="flex items-center gap-1.5 text-ok">
        <StatusDot tone="ok" />
        terminé
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-faint">
      <StatusDot tone="idle" />
      en attente
    </span>
  );
}

function ConsumptionTable({ state }: { state: IncidentState }) {
  const rows = deriveConsumption(state);
  const totalBusyMs = rows.reduce((sum, r) => sum + r.busyMs, 0);
  const totalRuns = state.agentRuns.length;
  const placeholder = areMetricsPlaceholder(state.metrics);

  return (
    <Panel
      id="gemma-consumption"
      className="min-h-[16rem]"
      title="Consommation Gemma par agent"
      subtitle="latences dérivées des horodatages du flux (started → ready)"
      live={totalRuns > 0}
      right={
        placeholder ? (
          <Badge
            variant="warn"
            filled
            title={getMetricsNote(state.metrics) ?? undefined}
          >
            valeurs mock
          </Badge>
        ) : undefined
      }
      empty={totalRuns === 0}
      emptyLabel="aucune activation agent…"
      emptyHint="la table se remplit dès le premier *_agent.started du flux"
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr
              className="border-b border-edge text-left text-[10px] uppercase tracking-wider text-faint"
            >
              <th className="py-1 pr-3 font-normal">agent</th>
              <th className="py-1 pr-3 text-right font-normal">exéc.</th>
              <th
                className="py-1 pr-3 text-right font-normal"
                title="moyenne des deltas started → ready du même agent/run"
              >
                latence / exéc.
              </th>
              <th className="py-1 pr-3 font-normal">part du temps total</th>
              <th
                className="py-1 pr-3 text-right font-normal"
                title="tokens par agent absents du payload metric.updated — pending live metrics"
              >
                tokens
              </th>
              <th className="py-1 font-normal">statut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.agent_id}
                data-testid={`gemma-agent-${row.agent_id}`}
                className="border-b border-edge/50 last:border-b-0"
              >
                <td className="py-1.5 pr-3">
                  <div className="text-foreground">{row.agent_id}</div>
                  <div className="text-[10px] text-faint">
                    {row.modelId ?? row.label}
                  </div>
                </td>
                <td
                  className={`py-1.5 pr-3 text-right ${row.executions > 0 ? "text-foreground" : "text-faint"}`}
                >
                  {row.executions > 0 ? row.executions : DASH}
                </td>
                <td
                  className={`py-1.5 pr-3 text-right ${row.avgLatencyMs !== null ? "text-foreground" : "text-faint"}`}
                  title={
                    row.avgLatencyMs !== null
                      ? `${row.measurable}/${row.executions} exécution(s) mesurable(s) · ${Math.round(row.avgLatencyMs)} ms`
                      : "aucune exécution terminée avec horodatages exploitables"
                  }
                >
                  {fmtMs(row.avgLatencyMs)}
                </td>
                <td className="min-w-[10rem] py-1.5 pr-3">
                  {row.busyMs > 0 && totalBusyMs > 0 ? (
                    <Meter
                      value={row.busyMs}
                      max={totalBusyMs}
                      tone="accent"
                      valueLabel={`${Math.round((row.busyMs / totalBusyMs) * 100)} %`}
                      title={`${fmtMs(row.busyMs)} cumulés sur ${fmtMs(totalBusyMs)} au total`}
                    />
                  ) : (
                    <span className="text-faint">{DASH}</span>
                  )}
                </td>
                <td
                  className="py-1.5 pr-3 text-right text-faint"
                  title="tokens par agent absents du payload — pending live metrics"
                >
                  {DASH}
                </td>
                <td className="py-1.5">
                  <AgentStatusCell row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-[10px] text-faint">
        champs absents = « {DASH} » · tokens par agent : pending live metrics
        (ni le mock ni le collecteur n&apos;exposent encore de compteur par
        agent)
      </p>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Scenario budget card                                                       */
/* -------------------------------------------------------------------------- */

/** incident.started → last reduced event, null before the incident starts. */
function elapsedMs(state: IncidentState): number | null {
  const startEvt = state.lastByType["incident.started"];
  const lastEvt =
    state.events.length > 0 ? state.events[state.events.length - 1] : null;
  if (!startEvt || !lastEvt) return null;
  const start = Date.parse(startEvt.timestamp);
  const end = Date.parse(lastEvt.timestamp);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

/** Budget rows fed by the metric.updated payload (absent = "—"). */
const METRIC_ROWS: { key: string; label: string; unit?: "toks" }[] = [
  { key: "gemma_agent_calls", label: "appels Gemma (compteur métriques)" },
  { key: "concurrent_requests_peak", label: "pic de concurrence" },
  { key: "tokens_in_total", label: "tokens prompt (total)" },
  { key: "tokens_out_total", label: "tokens complétion (total)" },
  { key: "tokens_per_second", label: "tokens/s", unit: "toks" },
];

function BudgetCard({ state }: { state: IncidentState }) {
  const metrics = state.metrics;
  const placeholder = areMetricsPlaceholder(metrics);
  const note = getMetricsNote(metrics);
  const elapsed = elapsedMs(state);
  const totalRuns = state.agentRuns.length;

  // Hero — cloud calls, from the metric.updated payload only. Green ONLY
  // when measured at exactly 0 (the local-GPU proof), red otherwise.
  const cloudCalls = metrics?.cloud_llm_calls;
  const cloudMeasured =
    typeof cloudCalls === "number" && Number.isFinite(cloudCalls);
  const cloudZero = cloudMeasured && cloudCalls === 0;

  return (
    <Panel
      id="gemma-budget"
      className="min-h-[16rem]"
      title="Budget scénario"
      subtitle={note ?? undefined}
      live={state.incidentStatus === "active"}
      right={
        placeholder ? (
          <Badge variant="warn" filled title={note ?? undefined}>
            valeurs mock
          </Badge>
        ) : undefined
      }
      empty={state.events.length === 0}
      emptyLabel="aucun événement…"
      emptyHint="temps écoulé et appels Gemma dès incident.started"
    >
      <div className="flex flex-col gap-2 font-mono">
        {/* hero — the local-GPU proof, same pattern as the NVIDIA cockpit */}
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
            {cloudMeasured ? cloudCalls : DASH}
          </span>
        </div>

        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[10px]">
          <div className="col-span-2 grid grid-cols-subgrid">
            <dt
              className="truncate text-faint"
              title="incident.started → dernier événement reçu"
            >
              temps écoulé de l&apos;incident
            </dt>
            <dd
              className={`text-right ${elapsed !== null ? "text-foreground" : "text-faint"}`}
              data-testid="gemma-budget-elapsed"
            >
              {elapsed !== null ? fmtElapsed(elapsed) : DASH}
            </dd>
          </div>
          <div className="col-span-2 grid grid-cols-subgrid">
            <dt
              className="truncate text-faint"
              title="nombre d'événements *_agent.started réduits depuis le flux"
            >
              appels Gemma (démarrages observés)
            </dt>
            <dd
              className={`text-right ${totalRuns > 0 ? "text-foreground" : "text-faint"}`}
              data-testid="gemma-budget-calls"
            >
              {totalRuns > 0 ? totalRuns : DASH}
            </dd>
          </div>
          {METRIC_ROWS.map(({ key, label, unit }) => {
            const display = fmtMetric(metrics, key, unit);
            const rawValue = metrics?.[key];
            return (
              <div key={key} className="col-span-2 grid grid-cols-subgrid">
                <dt className="truncate text-faint" title={key}>
                  {label}
                </dt>
                <dd
                  className={`text-right ${display === DASH ? "text-faint" : "text-foreground"}`}
                  title={
                    rawValue !== undefined && rawValue !== null
                      ? String(rawValue)
                      : "absent du payload — pending live metrics"
                  }
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

/* -------------------------------------------------------------------------- */
/* Section                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The "Consommation Gemma" section of /system: per-agent table + scenario
 * budget card. The page owns placement (className forwarded as-is).
 */
export default function GemmaConsumptionTable({
  className = "",
}: {
  className?: string;
}) {
  const state = useIncidentState();

  return (
    <div className={`grid gap-3 lg:grid-cols-[3fr_2fr] ${className}`}>
      <ConsumptionTable state={state} />
      <BudgetCard state={state} />
    </div>
  );
}
