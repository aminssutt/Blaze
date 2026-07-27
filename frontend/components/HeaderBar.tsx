// Ticket #38 — header / status region (region 1). Owner: @six-16.
//
// THE header of the control room. Composes:
//   - the BLAZE mark and the incident identity,
//   - the state-machine phase derived from reduced events,
//   - agent activity and replay progress (counts of events actually reduced),
//   - the network and audio modes of the scenario (a blackout must be
//     unmistakable from the back row).
//
// WHAT IS DELIBERATELY ABSENT: Gemma / vLLM / NVIDIA-GPU pills and the
// "cloud LLM calls" claim. This deployment serves a REPLAY of a frozen event
// stream — no model is loaded, no inference engine is running, no GPU is
// attached. Those pills described a hackathon machine that no longer exists,
// so they were removed rather than restated (see lib/systemStatus.ts).
//
// Every value below is read from the incident store. Nothing is hardcoded,
// nothing is invented: an unknown value renders "—" or "standby".

"use client";

import Image from "next/image";
import type { IncidentState } from "@/lib/incidentStore";
import { useIncidentState } from "@/lib/session";
import { deriveHeaderStatuses } from "@/lib/systemStatus";
import type { StatusLevel } from "@/lib/systemStatus";
import { StatusDot } from "@/components/ui";
import type { StatusTone } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* Derived header values                                                      */
/* -------------------------------------------------------------------------- */

/** Coarse phase of the incident state machine, derived from reduced events. */
interface Phase {
  label: string;
  tone: "idle" | "running" | "ok" | "warn" | "alert";
}

/**
 * The scenario is one linear run, so the furthest milestone reached IS the
 * phase. Checked from the most advanced backwards; every branch is backed by a
 * real store slice, none is guessed.
 */
function derivePhase(s: IncidentState): Phase {
  if (s.incidentStatus === "waiting") return { label: "standby", tone: "idle" };
  if (s.incidentStatus === "completed") return { label: "complete", tone: "ok" };
  if (s.dispatchesSent > 0) return { label: "dispatched", tone: "ok" };
  if (s.dispatchUnlocked) return { label: "dispatching", tone: "running" };
  if (s.approvalRequested) return { label: "approval", tone: "warn" };
  if (s.safetyReviews.length > 0) return { label: "safety review", tone: "warn" };
  if (s.plans.length > 0) return { label: "planning", tone: "running" };
  if (s.snapshot) return { label: "context", tone: "running" };
  if (s.audios.length > 0) return { label: "radio intake", tone: "running" };
  return { label: "starting", tone: "running" };
}

const PHASE_CLASS: Record<Phase["tone"], string> = {
  alert: "border-alert bg-alert-dim/50 text-alert",
  warn: "border-warn/70 bg-warn/15 text-warn",
  ok: "border-ok/70 bg-ok-dim/50 text-ok",
  running: "border-accent-dim bg-accent-dim/30 text-accent",
  idle: "border-edge-strong text-faint",
};

/** Status level → dot tone / value colour, shared by every header chip. */
const LEVEL_TONE: Record<StatusLevel, StatusTone> = {
  unknown: "idle",
  ok: "ok",
  active: "running",
  warn: "warn",
  alert: "alert",
};

const LEVEL_TEXT: Record<StatusLevel, string> = {
  unknown: "text-faint",
  ok: "text-foreground",
  active: "text-info",
  warn: "text-warn",
  alert: "text-alert",
};

/* -------------------------------------------------------------------------- */
/* Header building blocks                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One header chip. Values are never clipped: the chip sizes to its content
 * (`whitespace-nowrap`, no max-width), so nothing is ever cut mid-word.
 */
function HeaderChip({
  label,
  value,
  level,
  detail,
  testId,
  className = "",
}: {
  label: string;
  value: string;
  level: StatusLevel;
  detail: string;
  testId?: string;
  className?: string;
}) {
  const tone = LEVEL_TONE[level];
  return (
    <div
      data-testid={testId ? `status-${testId}` : undefined}
      data-level={level}
      title={`${label}: ${value} — ${detail}`}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-edge bg-overlay px-2.5 py-1 ${className}`}
    >
      <StatusDot tone={tone} pulse={level === "active" || level === "alert"} />
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
        {label}
      </span>
      <span className={`font-mono text-[11px] ${LEVEL_TEXT[level]}`}>
        {value}
      </span>
      <span className="sr-only">{detail}</span>
    </div>
  );
}

/** Compact mode readout (network / audio), stacked label over value. */
function ModePill({
  label,
  value,
  className,
  title,
  testId,
  dot = false,
  wrapperClassName = "flex",
}: {
  label: string;
  value: string;
  className: string;
  title?: string;
  testId?: string;
  dot?: boolean;
  /** Controls the whole pill (label included) at a given breakpoint. */
  wrapperClassName?: string;
}) {
  return (
    <div className={`shrink-0 flex-col gap-0.5 ${wrapperClassName}`}>
      <span className="whitespace-nowrap text-[9px] uppercase tracking-[0.16em] text-faint">
        {label}
      </span>
      <span
        data-testid={testId}
        title={title}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${className}`}
      >
        {dot && <StatusDot tone="alert" pulse />}
        {value}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* HeaderBar                                                                  */
/* -------------------------------------------------------------------------- */

export default function HeaderBar() {
  const state = useIncidentState();

  const phase = derivePhase(state);
  const statuses = deriveHeaderStatuses(state);

  const network = state.networkMode;
  const networkKnown = network !== null;
  const online = network?.toLowerCase() === "online";

  return (
    <header
      id="header-status"
      // `motion-reduce:` neutralises every pulse inside the header (dots are
      // rendered by a shared primitive that animates unconditionally).
      className="flex shrink-0 items-center gap-3 rounded-md border border-edge bg-surface px-3 py-2 motion-reduce:[&_*]:animate-none"
    >
      {/* Identity + incident — the only elastic block, so the chips never
          steal room from a name they would otherwise clip. */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Logo only — the wordmark is carried by the mark itself. */}
        <div className="flex shrink-0 items-center gap-2">
          <Image
            src="/logo-blaze.png"
            alt="BLAZE"
            width={34}
            height={34}
            className="shrink-0 rounded-full"
            loading="eager"
          />
          <span className="hidden text-[10px] uppercase tracking-[0.2em] text-faint 2xl:inline">
            control room
          </span>
        </div>

        <div className="min-w-0 border-l border-edge pl-3">
          <div
            data-testid="incident-name"
            className="truncate text-[13px] font-semibold text-foreground"
            title={state.incidentName ?? undefined}
          >
            {state.incidentName ?? "waiting for incident.started"}
          </div>
          <div className="truncate font-mono text-[10px] text-faint">
            {state.incidentId ?? "—"}
          </div>
        </div>
      </div>

      {/* State machine — the single most important readout on the screen */}
      <div
        data-testid="incident-status"
        title="Phase of the incident state machine, derived from reduced events"
        className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm border px-3 py-1 text-sm font-bold uppercase tracking-[0.14em] ${PHASE_CLASS[phase.tone]}`}
      >
        <StatusDot
          tone={phase.tone}
          pulse={phase.tone === "running" || phase.tone === "warn"}
        />
        {phase.label}
      </div>

      {/* Measured counts: agent activations and replay progress */}
      <div
        className="flex shrink-0 items-center gap-1.5"
        role="status"
        aria-label="Scenario progress"
      >
        {statuses.map((status) => (
          <HeaderChip
            key={status.id}
            testId={status.id}
            label={status.label}
            value={status.value}
            level={status.level}
            detail={status.detail}
            className={status.id === "agents" ? "hidden lg:flex" : "hidden xl:flex"}
          />
        ))}
      </div>

      {/* Scenario modes — a network blackout must be unmistakable */}
      <div className="flex shrink-0 items-center gap-2.5 border-l border-edge pl-2.5">
        <ModePill
          label="network"
          testId="network-mode"
          title={
            networkKnown
              ? `network_mode = ${network}`
              : "no network event received"
          }
          className={
            !networkKnown
              ? "border-edge-strong text-faint"
              : online
                ? "border-ok/70 bg-ok-dim/50 text-ok"
                : "animate-pulse border-alert bg-alert-dim text-alert"
          }
          dot={networkKnown && !online}
          value={!networkKnown ? "—" : online ? "online" : "offline"}
        />

        <ModePill
          label="audio"
          testId="audio-mode"
          title={
            state.audioMode
              ? `audio_mode = ${state.audioMode}`
              : "no audio mode announced"
          }
          wrapperClassName="hidden lg:flex"
          className={
            state.audioMode
              ? "border-accent-dim bg-accent-dim/30 text-accent"
              : "border-edge-strong text-faint"
          }
          value={state.audioMode ?? "—"}
        />
      </div>
    </header>
  );
}
