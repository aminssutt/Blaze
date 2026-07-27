// /settings — what the replay actually contains. Owner: @six-16.
//
// This deployment does NOT run a model. It re-emits a frozen event stream
// recorded for the hackathon demo, so there is no GPU telemetry, no inference
// engine and no token throughput to report. Anything shaped like a live
// metric would be a fabrication.
//
// What IS real and worth showing is the stream itself: how many envelopes were
// replayed, which agents the scenario activated, and how long each activation
// took according to the timestamps carried by the recorded events. Both panels
// below are derived 100% from the incident store — no `metric.updated` payload
// is read here, because that payload declares itself
// ("note": "mock placeholder values, not measured") and carries literal
// placeholders ("NVIDIA GPU (mock)", "vLLM (mock)", "gemma-4-local (mock)").
//
// PRODUCT INVARIANT #4 — not one value is invented. Anything the stream has
// not delivered renders as "—", and every duration is labelled as a recorded
// scenario timing, never as a measured inference latency.

"use client";

import type { AgentRun, IncidentState } from "@/lib/incidentStore";
import { useIncidentState } from "@/lib/session";
import { Meter, Panel, StatusDot } from "@/components/ui";

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

interface AgentActivity {
  agent_id: string;
  label: string;
  /** Number of `*_agent.started` (or equivalent) events reduced for this agent. */
  activations: number;
  /** Activations whose completion event arrived with parseable timestamps. */
  timed: number;
  /** Mean started→ready delta in ms, null when nothing is timeable. */
  avgDurationMs: number | null;
  /** Sum of timed activation durations, for the share-of-scenario bar. */
  busyMs: number;
  /** True while this agent has a started, not-yet-completed activation. */
  running: boolean;
}

/** started→finished delta of one activation, null when not computable. */
function runDurationMs(run: AgentRun): number | null {
  if (!run.finished || run.finished_at === null) return null;
  const start = Date.parse(run.started_at);
  const end = Date.parse(run.finished_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

/** Groups the store's agentRuns into one activity row per agent. */
function deriveActivity(state: IncidentState): AgentActivity[] {
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
    return {
      agent_id: agentId,
      label: labels.get(agentId) ?? agentId,
      activations: runs.length,
      timed: durations.length,
      avgDurationMs: durations.length > 0 ? busyMs / durations.length : null,
      busyMs,
      running: runs.some((r) => !r.finished),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Formatting — stream values only, "—" when absent                           */
/* -------------------------------------------------------------------------- */

const DASH = "—";

/** ms → display. Long durations read better in seconds. */
function fmtMs(ms: number | null): string {
  if (ms === null) return DASH;
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms).toLocaleString("en-US")} ms`;
}

/** Elapsed scenario time → "N min SS s" (or "N s" under a minute). */
function fmtElapsed(ms: number): string {
  const totalS = Math.round(ms / 1000);
  const min = Math.floor(totalS / 60);
  const s = totalS % 60;
  return min > 0 ? `${min} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

/** Counter → display. Zero is a legitimate reading and prints as "0". */
function fmtCount(value: number | null): string {
  return value === null ? DASH : value.toLocaleString("en-US");
}

/* -------------------------------------------------------------------------- */
/* Per-agent table                                                            */
/* -------------------------------------------------------------------------- */

function AgentStatusCell({ row }: { row: AgentActivity }) {
  if (row.running) {
    return (
      <span className="flex items-center gap-1.5 text-info">
        <StatusDot tone="running" pulse />
        running
      </span>
    );
  }
  if (row.activations > 0) {
    return (
      <span className="flex items-center gap-1.5 text-ok">
        <StatusDot tone="ok" />
        done
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-faint">
      <StatusDot tone="idle" />
      waiting
    </span>
  );
}

function AgentActivityPanel({ state }: { state: IncidentState }) {
  const rows = deriveActivity(state);
  const totalBusyMs = rows.reduce((sum, r) => sum + r.busyMs, 0);
  const totalRuns = state.agentRuns.length;

  return (
    <Panel
      id="agent-activity"
      className="min-h-[16rem]"
      title="Agent activity in the recorded scenario"
      subtitle="durations read off the recorded event timestamps (started → ready)"
      live={totalRuns > 0}
      empty={totalRuns === 0}
      emptyLabel="no agent activation yet…"
      emptyHint="the table fills from the first *_agent.started event"
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-edge text-left text-[10px] uppercase tracking-wider text-faint">
              <th className="py-1 pr-3 font-normal">agent</th>
              <th className="py-1 pr-3 text-right font-normal">activations</th>
              <th
                className="py-1 pr-3 text-right font-normal"
                title="mean started → ready delta of the same activation, as recorded"
              >
                recorded duration
              </th>
              <th className="py-1 pr-3 font-normal">share of scenario time</th>
              <th className="py-1 font-normal">status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.agent_id}
                data-testid={`agent-activity-${row.agent_id}`}
                className="border-b border-edge/50 last:border-b-0"
              >
                <td className="py-1.5 pr-3">
                  <div className="text-foreground">{row.agent_id}</div>
                  <div className="text-[10px] text-faint">{row.label}</div>
                </td>
                <td
                  className={`py-1.5 pr-3 text-right ${row.activations > 0 ? "text-foreground" : "text-faint"}`}
                >
                  {row.activations > 0 ? row.activations : DASH}
                </td>
                <td
                  className={`py-1.5 pr-3 text-right ${row.avgDurationMs !== null ? "text-foreground" : "text-faint"}`}
                  title={
                    row.avgDurationMs !== null
                      ? `${row.timed}/${row.activations} timed activation(s) · ${Math.round(row.avgDurationMs)} ms`
                      : "no completed activation with usable timestamps yet"
                  }
                >
                  {fmtMs(row.avgDurationMs)}
                </td>
                <td className="min-w-[10rem] py-1.5 pr-3">
                  {row.busyMs > 0 && totalBusyMs > 0 ? (
                    <Meter
                      value={row.busyMs}
                      max={totalBusyMs}
                      tone="accent"
                      valueLabel={`${Math.round((row.busyMs / totalBusyMs) * 100)} %`}
                      title={`${fmtMs(row.busyMs)} busy out of ${fmtMs(totalBusyMs)} total`}
                    />
                  ) : (
                    <span className="text-faint">{DASH}</span>
                  )}
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
        These are scenario timings carried by the recorded stream, not inference
        latencies measured on this deployment.
      </p>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Replay counters                                                            */
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

interface CounterRow {
  key: string;
  label: string;
  value: string;
  title: string;
}

/** Every row is a count of things the store reduced — no payload is trusted. */
function deriveCounters(state: IncidentState): CounterRow[] {
  const elapsed = elapsedMs(state);
  const completedTools = state.toolCalls.filter((c) => c.completed).length;
  const cachedTools = state.toolCalls.filter((c) => c.is_cached === true).length;

  return [
    {
      key: "events",
      label: "events replayed",
      value: fmtCount(state.eventsReceived),
      title: "envelopes reduced by the incident store since the run started",
    },
    {
      key: "sequence",
      label: "last sequence",
      value: fmtCount(state.lastSequence),
      title: "sequence number of the most recent envelope",
    },
    {
      key: "elapsed",
      label: "scenario time covered",
      value: elapsed !== null ? fmtElapsed(elapsed) : DASH,
      title: "incident.started → last event, using the recorded timestamps",
    },
    {
      key: "activations",
      label: "agent activations",
      value: fmtCount(state.agentRuns.length),
      title: "number of *_agent.started events reduced from the stream",
    },
    {
      key: "tools",
      label: "tool calls completed",
      value: fmtCount(completedTools),
      title: "tool.call.completed events matched to a request",
    },
    {
      key: "cached",
      label: "tool calls served from cache",
      value: fmtCount(cachedTools),
      title: "tool results whose payload carries is_cached = true",
    },
    {
      key: "transcripts",
      label: "radio transcripts",
      value: fmtCount(state.transcripts.length),
      title: "transcript.ready events reduced from the stream",
    },
    {
      key: "plans",
      label: "plan versions",
      value: fmtCount(state.plans.length),
      title: "distinct plan.draft.ready versions reduced from the stream",
    },
    {
      key: "reviews",
      label: "safety reviews",
      value: fmtCount(state.safetyReviews.length),
      title: "safety_review.ready events reduced from the stream",
    },
    {
      key: "dispatches",
      label: "dispatches sent",
      value: fmtCount(state.dispatchesSent),
      title: "dispatch.sent events reduced from the stream",
    },
    {
      key: "issues",
      label: "fallbacks / errors",
      value: `${fmtCount(state.fallbackCount)} / ${fmtCount(state.errorCount)}`,
      title: "fallback.activated and error events reduced from the stream",
    },
  ];
}

function ReplayCountersPanel({ state }: { state: IncidentState }) {
  const rows = deriveCounters(state);

  return (
    <Panel
      id="replay-counters"
      className="min-h-[16rem]"
      title="Replay counters"
      subtitle="counted by the store as the recorded stream is re-emitted"
      live={state.incidentStatus === "active"}
      empty={state.events.length === 0}
      emptyLabel="no events yet…"
      emptyHint="counters fill from the first replayed envelope"
    >
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 font-mono text-[10px]">
        {rows.map((row) => (
          <div key={row.key} className="col-span-2 grid grid-cols-subgrid">
            <dt className="truncate text-faint" title={row.title}>
              {row.label}
            </dt>
            <dd
              data-testid={`replay-counter-${row.key}`}
              className={`text-right ${row.value === DASH ? "text-faint" : "text-foreground"}`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                    */
/* -------------------------------------------------------------------------- */

/** The two honest panels of /settings: agent activity + replay counters. */
export default function ReplayActivityPanels({
  className = "",
}: {
  className?: string;
}) {
  const state = useIncidentState();

  return (
    <div className={`grid gap-3 lg:grid-cols-[3fr_2fr] ${className}`}>
      <AgentActivityPanel state={state} />
      <ReplayCountersPanel state={state} />
    </div>
  );
}
