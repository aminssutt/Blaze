// Ticket #44 — trace agents & outils. Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #44 owns this file from now on.
// Real slices: `agentRuns` / `activeAgentId` and `toolCalls` (requests and
// results merged by tool_call_id, with the computed latency).

"use client";

import { useIncidentState } from "@/lib/session";
import {
  Badge,
  Panel,
  SourceBadge,
  StatusDot,
  toolStatusVariant,
} from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

export default function AgentTracePanel({ className }: PanelComponentProps) {
  const { agentRuns, activeAgentId, toolCalls, events } = useIncidentState();
  const completed = toolCalls.filter((c) => c.completed).length;
  const cached = toolCalls.filter((c) => c.is_cached).length;

  return (
    <Panel
      className={className}
      id="agent-trace"
      title="Trace agents & outils"
      subtitle={
        events.length > 0
          ? `${agentRuns.length} exécutions · ${completed}/${toolCalls.length} outils · ${cached} en cache`
          : undefined
      }
      live={activeAgentId !== null}
      empty={agentRuns.length === 0 && toolCalls.length === 0}
      emptyLabel="aucune activité agent…"
      emptyHint="alimenté par *_agent.started / tool.call.*"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {agentRuns.map((run) => (
            <span
              key={`${run.agent_id}-${run.sequence}`}
              title={`${run.started_by} · ${run.started_at}`}
              className="inline-flex items-center gap-1 rounded-sm border border-edge bg-overlay px-1.5 py-px font-mono text-[10px]"
            >
              <StatusDot
                tone={run.finished ? "ok" : "running"}
                pulse={!run.finished}
              />
              <span className={run.finished ? "text-muted" : "text-info"}>
                {run.agent_id}
              </span>
            </span>
          ))}
        </div>

        <table className="w-full table-fixed border-collapse font-mono text-[10px]">
          <tbody>
            {toolCalls.map((call) => (
              <tr key={call.tool_call_id} className="border-t border-edge">
                <td className="w-20 truncate py-0.5 text-accent" title={call.tool_name}>
                  {call.tool_name}
                </td>
                <td className="w-16 truncate py-0.5 text-faint">
                  {call.tool_call_id}
                </td>
                <td className="w-16 py-0.5">
                  {call.status ? (
                    <Badge variant={toolStatusVariant(call.status)}>
                      {call.status}
                    </Badge>
                  ) : (
                    <span className="text-faint">en cours</span>
                  )}
                </td>
                <td className="w-14 py-0.5 text-right text-muted">
                  {call.latency_ms !== null ? `${call.latency_ms} ms` : "—"}
                </td>
                <td className="py-0.5 pl-2">
                  {call.source_type ? (
                    <SourceBadge
                      source={call.source_type}
                      sourceName={call.source_name}
                      cached={call.is_cached}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
