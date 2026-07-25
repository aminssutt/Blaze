// Ticket #44 — trace agents & outils. Owner: @six-16.
//
// The Autonomous Agents showcase: a chronological, auditable trace of the
// multi-agent pipeline. Two layers:
//   1. Agent rail — the 5 Gemma agents in pipeline order; the running agent
//      is highlighted and animated, finished agents show their run count.
//   2. Tool trace — one row per tool call, merged request→result: tool name,
//      status (requested → completed with measured latency), provenance badge
//      (5 distinct SourceType colours from design/tokens.css), cached/live
//      indicator, and a concise one-line result.
//
// PRODUCT RULE (#44) — NO chain-of-thought is ever rendered. The only text
// shown is auditable: tool names, arguments-derived summaries, statuses,
// provenance, and the contract `reason` field (a concise rationale, exposed
// as a tooltip, never raw model reasoning).
//
// Auto-scroll: the trace follows the newest entry, and pauses while the
// operator hovers the panel so nothing jumps under their cursor.

"use client";

import { useEffect, useRef } from "react";
import type { AgentRun, ToolCall } from "@/lib/incidentStore";
import { useIncidentState } from "@/lib/session";
import {
  Badge,
  Panel,
  SourceBadge,
  StatusDot,
  toolStatusVariant,
} from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* Agent rail                                                                 */
/* -------------------------------------------------------------------------- */

/** The 5 pipeline agents, in operational order. French display labels. */
const PIPELINE_AGENTS: [agentId: string, label: string][] = [
  ["radio_intelligence", "radio"],
  ["situation_context", "contexte"],
  ["tactical_planning", "planification"],
  ["safety_critic", "critique sécu"],
  ["dispatch", "dispatch"],
];

interface AgentRailState {
  agent_id: string;
  label: string;
  runs: number;
  running: boolean;
  model_id: string | null;
}

/** Folds the run history into one rail cell per pipeline agent. */
function buildRail(runs: AgentRun[]): AgentRailState[] {
  const known = new Map(PIPELINE_AGENTS);
  const order = PIPELINE_AGENTS.map(([id]) => id);
  // Agents outside the known 5 (defensive) are appended in arrival order.
  for (const run of runs) {
    if (!known.has(run.agent_id)) {
      known.set(run.agent_id, run.agent_id);
      order.push(run.agent_id);
    }
  }
  return order.map((agent_id) => {
    const agentRuns = runs.filter((r) => r.agent_id === agent_id);
    return {
      agent_id,
      label: known.get(agent_id) ?? agent_id,
      runs: agentRuns.length,
      running: agentRuns.some((r) => !r.finished),
      model_id: agentRuns.at(-1)?.model_id ?? null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Chronological trace rows                                                   */
/* -------------------------------------------------------------------------- */

type TraceRow =
  | { kind: "agent"; sequence: number; run: AgentRun }
  | { kind: "tool"; sequence: number; call: ToolCall };

/** Agent starts and tool requests interleaved by envelope sequence. */
function buildRows(runs: AgentRun[], calls: ToolCall[]): TraceRow[] {
  const rows: TraceRow[] = [
    ...runs.map((run): TraceRow => ({ kind: "agent", sequence: run.sequence, run })),
    ...calls.map(
      (call): TraceRow => ({
        kind: "tool",
        // A result whose request was never seen still gets a stable slot.
        sequence: call.requested_sequence ?? Number.MAX_SAFE_INTEGER,
        call,
      }),
    ),
  ];
  return rows.sort((a, b) => a.sequence - b.sequence);
}

/** "10:00:02" from an ISO timestamp, or "—" when absent. */
function clock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(11, 19);
}

/** One primitive rendered compactly for the one-line result summary. */
function compactValue(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "string") return value.length > 24 ? `${value.slice(0, 24)}…` : value;
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return `{${Object.keys(value as object).length}}`;
  return String(value);
}

/**
 * Concise ONE-LINE summary of a tool result — auditable data only, never
 * model text. Objects show their first entries, arrays their length.
 */
function summarizeResult(call: ToolCall): string {
  if (call.error) return `erreur: ${call.error}`;
  const data = call.data;
  if (data === null || data === undefined) return "—";
  if (Array.isArray(data)) return `${data.length} éléments`;
  const entries = Object.entries(data);
  if (entries.length === 0) return "∅";
  const shown = entries
    .slice(0, 4)
    .map(([k, v]) => `${k}=${compactValue(v)}`)
    .join(" · ");
  return entries.length > 4 ? `${shown} · +${entries.length - 4}` : shown;
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

export default function AgentTracePanel({ className }: PanelComponentProps) {
  const { agentRuns, activeAgentId, toolCalls } = useIncidentState();

  const rail = buildRail(agentRuns);
  const rows = buildRows(agentRuns, toolCalls);
  const completed = toolCalls.filter((c) => c.completed).length;
  const cached = toolCalls.filter((c) => c.is_cached).length;

  // Auto-scroll to the newest entry, paused while the operator hovers.
  // Panel owns the scrolling body: it is the direct parent of our root div.
  const bodyRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);
  const rowCount = rows.length;
  const completedCount = completed;
  useEffect(() => {
    const scroller = bodyRef.current?.parentElement;
    if (scroller && !hoveredRef.current) scroller.scrollTop = scroller.scrollHeight;
  }, [rowCount, completedCount]);

  return (
    <Panel
      className={className}
      id="agent-trace"
      title="Trace agents & outils"
      subtitle={
        agentRuns.length > 0 || toolCalls.length > 0
          ? `${agentRuns.length} exécutions · ${completed}/${toolCalls.length} outils · ${cached} en cache`
          : undefined
      }
      live={activeAgentId !== null}
      empty={agentRuns.length === 0 && toolCalls.length === 0}
      emptyLabel="aucune activité agent…"
      emptyHint="alimenté par *_agent.started / tool.call.*"
    >
      <div
        ref={bodyRef}
        className="flex flex-col gap-2"
        onMouseEnter={() => {
          hoveredRef.current = true;
        }}
        onMouseLeave={() => {
          hoveredRef.current = false;
        }}
      >
        {/* agent rail — the running agent is highlighted and pulses */}
        <div className="flex flex-wrap gap-1" aria-label="Agents du pipeline">
          {rail.map((agent) => (
            <span
              key={agent.agent_id}
              title={
                agent.model_id
                  ? `${agent.agent_id} · ${agent.model_id}`
                  : agent.agent_id
              }
              className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[10px] transition-colors ${
                agent.running
                  ? "animate-pulse border-info/60 bg-info/15 text-info"
                  : agent.runs > 0
                    ? "border-edge bg-overlay text-muted"
                    : "border-edge text-faint"
              }`}
            >
              <StatusDot
                tone={agent.running ? "running" : agent.runs > 0 ? "ok" : "idle"}
                pulse={agent.running}
              />
              {agent.label}
              {agent.runs > 1 && (
                <span className="opacity-60">×{agent.runs}</span>
              )}
            </span>
          ))}
        </div>

        {/* chronological trace — agent starts interleaved with tool calls */}
        <ol className="flex flex-col font-mono text-[10px]">
          {rows.map((row) =>
            row.kind === "agent" ? (
              <li
                key={`run-${row.run.agent_id}-${row.run.sequence}`}
                className="flex items-center gap-2 border-t border-edge py-0.5"
              >
                <span className="w-14 shrink-0 text-faint">
                  {clock(row.run.started_at)}
                </span>
                <StatusDot
                  tone={row.run.finished ? "ok" : "running"}
                  pulse={!row.run.finished}
                />
                <span
                  className={`truncate ${row.run.finished ? "text-muted" : "text-info"}`}
                >
                  {row.run.agent_id}
                  {row.run.finished ? " — terminé" : " — en cours"}
                </span>
                {row.run.model_id && (
                  <span className="ml-auto truncate text-faint">
                    {row.run.model_id}
                  </span>
                )}
              </li>
            ) : (
              <li
                key={`tc-${row.call.tool_call_id}`}
                title={row.call.reason ?? undefined}
                className="border-t border-edge py-0.5"
              >
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-faint">
                    {clock(row.call.requested_at)}
                  </span>
                  <span className="w-20 shrink-0 truncate text-accent">
                    {row.call.tool_name}
                  </span>
                  <span className="w-14 shrink-0">
                    {row.call.status ? (
                      <Badge variant={toolStatusVariant(row.call.status)}>
                        {row.call.status}
                      </Badge>
                    ) : (
                      <StatusDot tone="running" pulse label="requête" />
                    )}
                  </span>
                  <span className="w-16 shrink-0 text-right text-muted">
                    {row.call.latency_ms !== null
                      ? `${row.call.latency_ms} ms`
                      : "—"}
                  </span>
                  {row.call.source_type && (
                    <SourceBadge
                      source={row.call.source_type}
                      sourceName={row.call.source_name}
                    />
                  )}
                  {row.call.is_cached !== null && (
                    <Badge
                      variant={row.call.is_cached ? "info" : "ok"}
                      title={
                        row.call.is_cached
                          ? `servi depuis le cache local${
                              row.call.staleness_seconds !== null
                                ? ` · âge ${row.call.staleness_seconds}s`
                                : ""
                            }`
                          : "récupéré en direct"
                      }
                    >
                      {row.call.is_cached ? "cache" : "live"}
                    </Badge>
                  )}
                </div>
                {row.call.completed && (
                  <div className="truncate pl-16 text-faint" title={summarizeResult(row.call)}>
                    ↳ {summarizeResult(row.call)}
                  </div>
                )}
              </li>
            ),
          )}
        </ol>
      </div>
    </Panel>
  );
}
