"use client";

/**
 * BLAZE /workflow — the agent-control view (asked by Lakhdar, Astyr pattern).
 *
 * ROUTES — / landing, /expert full control room (legacy), /system health,
 * /demo guided cinematic. THIS page is the default way to watch the agents
 * work: a live pipeline graph (services → Gemma agents → HUMAN GATE →
 * dispatch/TTS) + the commander's aside (approval + dispatch), with a
 * per-node overlay (terminal + expert panel) raised on click.
 *
 * Everything renders from the SAME incident store as /expert: mock replay or
 * live SSE is chosen by lib/session (env default / localStorage override in
 * lib/streamMode — no visual toggle here on purpose), the store never knows
 * which — so this page works identically in both modes.
 *
 * LAYOUT — OpsNav, header (incident identity + compact player controls +
 * status chip, Lakhdar's spec: play/pause · reset · speed, top right), then
 * the main row: graph (flex-1) + commander aside (fixed width at xl). The
 * approval act is always fully visible — only the dispatch list may scroll.
 * Never scrolls horizontally.
 */

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useIncidentState, usePlayerState, useSessionControls } from "@/lib/session";
import {
  deriveNodeStatuses,
  type MonitorNodeId,
} from "@/lib/monitorPipeline";
import OpsNav from "@/components/ops/OpsNav";
import SystemBanners from "@/components/banners/SystemBanners";
import { PLAYER_SPEEDS, type PlayerSpeed } from "@/lib/streamPlayer";
import ApprovalGate from "@/components/approval/ApprovalGate";
import DispatchPanel from "@/components/dispatch/DispatchPanel";
import PipelineGraph from "@/components/monitor/PipelineGraph";
import NodeDetailOverlay from "@/components/monitor/NodeDetailOverlay";
import { StatusDot } from "@/components/ui";

/** Incident status chip of the monitor header. */
function IncidentStatusChip() {
  const { incidentStatus, approvalRequested, approval } = useIncidentState();
  const pendingDecision = approvalRequested && !approval;
  const chip =
    incidentStatus === "waiting"
      ? { label: "standby", cls: "border-edge-strong text-faint", tone: "idle" as const, pulse: false }
      : incidentStatus === "completed"
        ? { label: "completed", cls: "border-ok/70 bg-ok-dim/50 text-ok", tone: "ok" as const, pulse: false }
        : pendingDecision
          ? { label: "decision pending", cls: "border-accent bg-accent-dim/30 text-accent", tone: "warn" as const, pulse: true }
          : { label: "incident live", cls: "border-info/60 bg-info/10 text-info", tone: "running" as const, pulse: true };
  return (
    <span
      data-testid="monitor-status-chip"
      className={`flex items-center gap-2 whitespace-nowrap rounded-sm border px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] ${chip.cls}`}
    >
      <StatusDot tone={chip.tone} pulse={chip.pulse} />
      {chip.label}
    </span>
  );
}

export default function MonitorPage() {
  const state = useIncidentState();
  const controls = useSessionControls();
  const [selected, setSelected] = useState<MonitorNodeId | null>(null);

  // Arm the player on mount (same contract as /expert): loads + validates the
  // stream so totals and jump points are ready before the first Play.
  useEffect(() => {
    controls.start();
  }, [controls]);

  const statuses = useMemo(() => deriveNodeStatuses(state), [state]);
  const decisionPending = state.approvalRequested && !state.approval;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden p-2 xl:h-screen xl:flex-none xl:overflow-hidden">
      <OpsNav />

      {/* header — incident identity + live status chip */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-edge bg-surface px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src="/logo-blaze.png"
            alt="BLAZE logo"
            width={34}
            height={34}
            className="shrink-0 rounded-full"
            loading="eager"
          />
          <span className="font-mono text-[12px] font-bold leading-none tracking-[0.24em] text-accent">
            BLAZE
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-faint md:inline">
            agent workflow
          </span>
          <div className="min-w-0 border-l border-edge pl-3">
            <div
              className="truncate text-[13px] font-semibold text-foreground"
              title={state.incidentName ?? undefined}
            >
              {state.incidentName ?? "awaiting incident.started"}
            </div>
            <div className="truncate font-mono text-[10px] text-faint">
              {state.incidentId ?? "—"}
              {state.lastSequence > 0 ? ` · seq ${state.lastSequence}` : ""}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* compact player controls — play/pause · reset · speed (Lakhdar) */}
          <HeaderPlayerControls />
          <IncidentStatusChip />
        </div>
      </header>

      {/* zero height until a fallback/error is reduced */}
      <SystemBanners />

      {/* main row — pipeline graph + commander aside */}
      <main
        className="flex min-h-0 flex-col gap-2 xl:flex-1 xl:flex-row xl:overflow-hidden"
        aria-label="Multi-agent pipeline monitor"
      >
        {/* the living graph — every node is clickable */}
        <section
          aria-label="Pipeline graph"
          className="min-h-[420px] overflow-hidden rounded-md border border-edge bg-background xl:h-auto xl:min-h-0 xl:flex-1"
        >
          <PipelineGraph
            statuses={statuses}
            revisionRequested={state.planRevisionRequests.length > 0}
            selected={selected}
            onSelect={setSelected}
          />
        </section>

        {/* commander aside — validation then the dispatched voice messages.
            Same amber commander identity as /expert, escalating while the
            decision is pending. The approval act is the centre of the demo:
            it stays FULLY visible (natural height, never scrolls) — when
            height runs out, only the dispatch list below scrolls internally. */}
        <aside
          aria-label="Commander station"
          className={`flex w-full shrink-0 flex-col gap-2 rounded-md border p-1.5 xl:min-h-0 xl:w-[400px] ${
            decisionPending
              ? "blaze-cta-pulse border-accent bg-accent-dim/15"
              : "border-accent-dim/60 bg-accent-dim/10"
          }`}
        >
          <div className="flex min-w-0 shrink-0 items-baseline gap-1.5 rounded-sm border border-edge bg-surface px-2 py-1">
            <span className="whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              Commander station
            </span>
            <span className="min-w-0 truncate font-mono text-[10px] text-faint">
              — approval, then dispatch
            </span>
          </div>
          <ResidualObjections />
          <ApprovalGate className="shrink-0" />
          <DispatchPanel className="xl:min-h-0 xl:flex-1" />
        </aside>
      </main>

      {/* clicking a node raises the detail overlay OVER the live graph —
          the stream keeps running behind it (X / Esc / click-outside closes) */}
      <NodeDetailOverlay nodeId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/**
 * Compact player controls of the header (Lakhdar's spec) — play/pause toggle,
 * reset and the x1/x2/x5 speed mini-segments, nothing else. Stream mode is
 * driven by env/localStorage (lib/streamMode), not by the UI.
 */
function HeaderPlayerControls() {
  const controls = useSessionControls();
  const player = usePlayerState();
  const playing = player.status === "playing";
  return (
    <div
      className="flex items-center gap-1.5"
      role="group"
      aria-label="Replay controls"
    >
      <button
        type="button"
        onClick={() => controls.toggle()}
        aria-label={playing ? "Pause replay" : "Start replay"}
        title={playing ? "Pause" : "Start / resume"}
        className={`rounded-sm border px-2.5 py-1 font-mono text-[11px] font-semibold leading-none ${
          playing
            ? "border-accent bg-accent-dim/30 text-accent"
            : "border-accent-dim text-accent hover:border-accent"
        }`}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button
        type="button"
        onClick={() => controls.reset()}
        aria-label="Reset replay"
        title="Reset"
        className="rounded-sm border border-edge px-2.5 py-1 font-mono text-[11px] leading-none text-muted hover:border-edge-strong hover:text-foreground"
      >
        ↺
      </button>
      <div
        className="flex items-center overflow-hidden rounded-sm border border-edge"
        role="group"
        aria-label="Replay speed"
      >
        {PLAYER_SPEEDS.map((speed: PlayerSpeed) => (
          <button
            key={speed}
            type="button"
            onClick={() => controls.setSpeed(speed)}
            aria-pressed={player.speed === speed}
            className={`px-2 py-1 font-mono text-[10px] leading-none ${
              player.speed === speed
                ? "bg-accent-dim/40 font-semibold text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            x{speed}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Residual safety objections surfaced right above the approval act while the
 * commander's decision is pending — local wrapper so the SHARED ApprovalGate
 * (also used by /expert) stays byte-for-byte untouched.
 */
function ResidualObjections() {
  const { safetyReview, approvalRequested, approval } = useIncidentState();
  const pending = approvalRequested && !approval;
  const objections = safetyReview?.critical_objections ?? [];
  if (!pending || objections.length === 0) return null;
  return (
    <div
      data-testid="workflow-residual-objections"
      className="shrink-0 rounded-sm border border-warn/60 bg-warn/10 p-2"
    >
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-warn">
        objections résiduelles ({objections.length})
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {objections.map((o) => (
          <li key={o} className="text-[11px] leading-snug text-foreground">
            ✗ {o}
          </li>
        ))}
      </ul>
    </div>
  );
}
