// Page /monitor — node detail overlay (Astyr AgentDetailOverlay pattern).
//
// Raised when a node of the pipeline graph is clicked. It centers a large
// panel OVER the live graph without touching the stream: the store keeps
// reducing events behind the backdrop and this component re-renders from the
// fresh state every tick, so closing (X / Esc / click-outside) returns to the
// already-advanced live view. Two panes side by side:
//   LEFT  — the node's terminal (NodeTerminal): the REAL event log of this
//           node replayed as stdout;
//   RIGHT — the matching expert panel, REUSED as-is from /expert (RadioEvent
//           cards, plan, safety critic, dispatch…), all reading the store
//           themselves.

"use client";

import { useEffect, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useIncidentState } from "@/lib/session";
import {
  buildTerminalLines,
  deriveNodeStatuses,
  nodeInfo,
  type MonitorNodeId,
  type NodeStatus,
} from "@/lib/monitorPipeline";
import NodeTerminal from "./NodeTerminal";
import RadioTimeline from "@/components/radio/RadioTimeline";
import RadioEventCards from "@/components/radio/RadioEventCards";
import AgentTracePanel from "@/components/trace/AgentTracePanel";
import SituationSnapshotPanel from "@/components/situation/SituationSnapshotPanel";
import TacticalPlanPanel from "@/components/plan/TacticalPlanPanel";
import SafetyCriticPanel from "@/components/safety/SafetyCriticPanel";
import ApprovalGate from "@/components/approval/ApprovalGate";
import DispatchPanel from "@/components/dispatch/DispatchPanel";
import type { ApprovalDecision } from "@/lib/contracts";

const STATUS_LABEL: Record<NodeStatus, { label: string; cls: string }> = {
  standby: { label: "standby", cls: "text-faint" },
  active: { label: "actif", cls: "text-info" },
  done: { label: "terminé", cls: "text-ok" },
};

/** Decision history block of the HUMAN GATE pane (approval.received events). */
function DecisionHistory() {
  const { events } = useIncidentState();
  const decisions = useMemo(
    () =>
      events
        .filter((e) => e.event_type === "approval.received")
        .map((e) => e.payload as unknown as ApprovalDecision),
    [events],
  );
  if (decisions.length === 0) return null;
  return (
    <div className="shrink-0 rounded-md border border-edge bg-surface px-3 py-2">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        historique des décisions
      </h3>
      <ul className="mt-1 flex flex-col gap-1">
        {decisions.map((d) => (
          <li
            key={d.decision_id}
            className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px]"
          >
            <span className={d.decision === "approve" ? "text-ok" : "text-alert"}>
              {d.decision === "approve" ? "⇒" : "✗"} {d.decision}
            </span>
            <span className="text-foreground">{d.operator_name}</span>
            <span className="text-faint">plan {d.plan_id}</span>
            <span className="ml-auto text-[10px] text-faint">{d.decided_at}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The expert pane matching one node — existing /expert panels, reused as-is. */
function ExpertPane({ nodeId }: { nodeId: MonitorNodeId }) {
  if (nodeId.startsWith("tool:"))
    return <AgentTracePanel className="min-h-0 flex-1" />;
  switch (nodeId) {
    case "ingestion":
    case "stt":
      return <RadioTimeline className="min-h-0 flex-1" />;
    case "radio_intelligence":
      return <RadioEventCards className="min-h-0 flex-1" />;
    case "situation_context":
      return (
        <>
          <AgentTracePanel className="min-h-0 flex-1" />
          <SituationSnapshotPanel className="min-h-0 flex-1" />
        </>
      );
    case "tactical_planning":
      return <TacticalPlanPanel className="min-h-0 flex-1" />;
    case "safety_critic":
      return <SafetyCriticPanel className="min-h-0 flex-1" />;
    case "human_gate":
      return (
        <>
          <ApprovalGate className="min-h-0 flex-1" />
          <DecisionHistory />
        </>
      );
    case "dispatch":
    case "tts":
      return <DispatchPanel className="min-h-0 flex-1" />;
    default:
      return null;
  }
}

export default function NodeDetailOverlay({
  nodeId,
  onClose,
}: {
  nodeId: MonitorNodeId | null;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const state = useIncidentState();

  // Esc closes — bound only while open.
  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodeId, onClose]);

  const info = nodeId ? nodeInfo(nodeId) : null;
  const statuses = useMemo(() => deriveNodeStatuses(state), [state]);
  const status: NodeStatus = nodeId ? (statuses[nodeId] ?? "standby") : "standby";
  const lines = useMemo(
    () => (nodeId ? buildTerminalLines(nodeId, state) : []),
    [nodeId, state],
  );

  return (
    <AnimatePresence>
      {nodeId && info && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* backdrop — click-outside closes; the graph keeps living behind */}
          <button
            type="button"
            aria-label="Fermer le détail"
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[3px]"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${info.label} — détail live`}
            initial={reduce ? false : { opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="relative flex h-[86vh] max-h-[860px] w-full max-w-[1480px] flex-col overflow-hidden rounded-lg border border-edge-strong bg-background shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]"
          >
            {/* header */}
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge bg-surface px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-2xl leading-none" aria-hidden>
                  {info.emoji}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[15px] font-semibold text-foreground">
                      {info.label}
                    </h2>
                    <span
                      className={`font-mono text-[10px] uppercase tracking-wider ${STATUS_LABEL[status].cls}`}
                    >
                      ● {STATUS_LABEL[status].label}
                    </span>
                    {info.kind === "human" && (
                      <span className="rounded-sm border border-accent-dim bg-accent-dim/25 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-accent">
                        human-in-the-loop
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] leading-snug text-muted">
                    {info.role}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="grid size-8 shrink-0 place-items-center rounded-md border border-edge bg-overlay font-mono text-[13px] text-muted transition-colors hover:border-edge-strong hover:text-foreground"
              >
                ✕
              </button>
            </header>

            {/* body — terminal | expert pane */}
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden">
              <div className="flex h-[45vh] min-h-0 flex-col lg:h-auto">
                <NodeTerminal info={info} status={status} lines={lines} />
              </div>
              <div className="flex min-h-0 flex-col gap-3">
                <ExpertPane nodeId={nodeId} />
              </div>
            </div>

            {/* footer hint */}
            <footer className="flex shrink-0 items-center justify-between border-t border-edge bg-surface px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                live · le flux continue derrière
              </span>
              <span className="font-mono text-[10px] text-faint">
                esc / clic à l&apos;extérieur pour fermer
              </span>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
