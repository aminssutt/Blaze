"use client";

import { useEffect } from "react";
import type { EventEnvelope, EventType } from "@/lib/contracts";
import type { IncidentState } from "@/lib/incidentStore";
import { useIncidentState, useSessionControls } from "@/lib/session";
import PlayerBar from "@/components/PlayerBar";

/**
 * The 10 required control-room regions (docs/prompts roadmap — "Required
 * product experience"). Region 1 is the header; regions 2–10 are panels.
 *
 * Ticket #39 keeps them minimal on purpose: each panel proves the incident
 * store fills up during replay by showing the live count of its event types
 * and the last received payload as compact JSON. The real views land in
 * tickets #40–#51 on top of the same store slices.
 */
interface RegionDef {
  id: string;
  title: string;
  hint: string;
  /** Envelope event types this region listens to. */
  eventTypes: EventType[];
  /** Optional one-line derived summary from the typed store slices. */
  summary?: (s: IncidentState) => string | null;
}

const REGIONS: RegionDef[] = [
  {
    id: "tactical-map",
    title: "2 · Tactical Map",
    hint: "D17 / Hangar Zone / units / routes",
    eventTypes: ["situation.snapshot.ready"],
    summary: (s) =>
      s.snapshot
        ? `snapshot v${s.snapshot.version} · ${s.snapshot.known_facts.length} known facts · ${s.snapshot.conflicts.length} conflicts`
        : null,
  },
  {
    id: "radio-timeline",
    title: "3 · Radio Timeline",
    hint: "audio, transcripts, processing status",
    eventTypes: ["audio.received", "transcription.started", "transcript.ready"],
    summary: (s) =>
      s.transcripts.length > 0
        ? `${s.transcripts.length} transcripts · last: "${s.transcripts[s.transcripts.length - 1].text.slice(0, 60)}…"`
        : null,
  },
  {
    id: "structured-events",
    title: "4 · Structured Events",
    hint: "extracted facts, corrections, confidence",
    eventTypes: ["radio_event.extracted"],
    summary: (s) =>
      s.radioEvents.length > 0
        ? `${s.radioEvents.length} radio events · ${s.radioEvents.filter((e) => e.is_correction).length} corrections`
        : null,
  },
  {
    id: "agent-tool-trace",
    title: "5 · Agent & Tool Trace",
    hint: "Gemma agents, tool calls, provenance",
    eventTypes: [
      "context_agent.started",
      "radio_agent.started",
      "tool.call.requested",
      "tool.call.completed",
    ],
    summary: (s) =>
      s.toolRequests.length > 0
        ? `${s.toolRequests.length} tool calls requested · ${s.toolResults.length} completed`
        : null,
  },
  {
    id: "tactical-roadmap",
    title: "6 · Tactical Roadmap",
    hint: "plan version, objectives, unit actions",
    eventTypes: ["planning.started", "plan.draft.ready", "plan.revision.requested"],
    summary: (s) =>
      s.plan
        ? `plan v${s.plan.version} · ${s.plan.unit_actions.length} unit actions · ${s.plan.objectives.length} objectives`
        : null,
  },
  {
    id: "safety-critic",
    title: "7 · Safety Critic",
    hint: "pass / revise / block, objections, rule checks",
    eventTypes: ["safety_review.started", "safety_review.ready"],
    summary: (s) =>
      s.safetyReview
        ? `${s.safetyReview.status.toUpperCase()} · ${s.safetyReview.critical_objections.length} objections`
        : null,
  },
  {
    id: "human-approval",
    title: "8 · Human Approval",
    hint: "approve / modify / reject",
    eventTypes: ["approval.requested", "approval.received"],
    summary: (s) =>
      s.approval
        ? `${s.approval.decision.toUpperCase()} by ${s.approval.operator_name}`
        : s.approvalRequested
          ? "approval pending…"
          : null,
  },
  {
    id: "dispatch-output",
    title: "9 · Dispatch Output",
    hint: "per-unit messages, TTS playback",
    eventTypes: [
      "dispatch.started",
      "dispatch.instruction.ready",
      "tts.started",
      "tts.ready",
      "dispatch.sent",
    ],
    summary: (s) =>
      s.dispatches.length > 0
        ? `${s.dispatches.length} instructions · ${s.dispatchesSent} sent`
        : null,
  },
  {
    id: "nvidia-metrics",
    title: "10 · NVIDIA Metrics",
    hint: "GPU, engine, latency, tokens/s",
    eventTypes: ["metric.updated"],
    summary: (s) =>
      s.metrics ? `${Object.keys(s.metrics).length} metric fields` : null,
  },
];

/** Event types owned by the header region (1). */
const HEADER_EVENT_TYPES: EventType[] = [
  "incident.started",
  "network.mode.changed",
  "fallback.activated",
  "error",
  "incident.completed",
];

function countFor(state: IncidentState, types: EventType[]): number {
  return types.reduce((n, t) => n + (state.countsByType[t] ?? 0), 0);
}

function lastEventFor(
  state: IncidentState,
  types: EventType[],
): EventEnvelope | null {
  let last: EventEnvelope | null = null;
  for (const t of types) {
    const e = state.lastByType[t];
    if (e && (last === null || e.sequence > last.sequence)) last = e;
  }
  return last;
}

function RegionPanel({ region, state }: { region: RegionDef; state: IncidentState }) {
  const count = countFor(state, region.eventTypes);
  const last = lastEventFor(state, region.eventTypes);
  const summary = region.summary?.(state) ?? null;

  return (
    <section
      id={region.id}
      className={`flex flex-col gap-2 rounded-lg border border-edge bg-surface p-4 ${
        region.id === "tactical-map" ? "md:col-span-2 md:row-span-2" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {region.title}
        </h2>
        <span
          data-testid={`${region.id}-count`}
          className={`font-mono text-xs ${count > 0 ? "text-accent" : "text-faint"}`}
        >
          {count} events
        </span>
      </div>
      <p className="font-mono text-xs text-faint">{region.hint}</p>

      {summary && <p className="font-mono text-xs text-info">{summary}</p>}

      {last ? (
        <div className="mt-auto min-h-0 pt-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-faint">
            last · {last.event_type} · seq {last.sequence}
          </div>
          <pre className="max-h-28 overflow-auto rounded-sm border border-edge bg-background p-2 font-mono text-[10px] leading-relaxed text-muted">
            {JSON.stringify(last.payload)}
          </pre>
        </div>
      ) : (
        <div className="mt-auto pt-4 font-mono text-xs text-faint/60">
          awaiting data…
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const state = useIncidentState();
  const controls = useSessionControls();

  // Arm the player on mount: loads + validates the mock stream (paused at
  // event 0) so the jump index and totals are ready before the first Play.
  useEffect(() => {
    controls.start();
  }, [controls]);

  const headerLast = lastEventFor(state, HEADER_EVENT_TYPES);
  const statusTone =
    state.incidentStatus === "active"
      ? "text-ok"
      : state.incidentStatus === "completed"
        ? "text-accent"
        : "text-faint";

  return (
    <div className="flex flex-1 flex-col">
      {/* Region 1 — Header / status */}
      <header
        id="header-status"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-surface px-6 py-3"
      >
        <h1 className="text-2xl font-bold tracking-[0.3em] text-accent">
          BLAZE
        </h1>
        <span className="text-sm text-muted">Wildfire Control Room</span>

        <PlayerBar />

        <div className="ml-auto flex items-center gap-3 font-mono text-xs">
          <span className="text-faint">
            {state.incidentName ?? "1 · Header / Status — Gemma · vLLM · GPU · network · incident"}
          </span>
          {state.networkMode && (
            <span className="text-info">net: {state.networkMode}</span>
          )}
          <span data-testid="incident-status" className={statusTone}>
            {state.incidentStatus.toUpperCase()}
            {headerLast ? ` · seq ${headerLast.sequence}` : ""}
          </span>
        </div>
      </header>

      {/* Regions 2–10 — minimal live panels fed by the incident store */}
      <main className="grid flex-1 auto-rows-[minmax(8rem,auto)] grid-cols-1 gap-3 p-3 md:grid-cols-3">
        {REGIONS.map((region) => (
          <RegionPanel key={region.id} region={region} state={state} />
        ))}
      </main>
    </div>
  );
}
