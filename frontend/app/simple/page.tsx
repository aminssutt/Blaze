"use client";

/**
 * Vue Essentiel (/simple) — the whole incident for a firefighter who is NOT
 * at the command post: five plain-French steps, the commander's decision, and
 * the orders per unit. Big type, no jargon, zero technical readouts — those
 * live in /expert (full control room) and /system (machine health).
 *
 * Same store/session as the other views: the PlayerBar drives the run here
 * exactly like in /expert.
 */

import { useEffect } from "react";
import { useIncidentState, useSessionControls } from "@/lib/session";
import type { IncidentState } from "@/lib/incidentStore";
import OpsNav from "@/components/ops/OpsNav";
import PlayerBar from "@/components/PlayerBar";
import StreamModeToggle from "@/components/controls/StreamModeToggle";

type StepTone = "done" | "active" | "waiting" | "blocked";

interface Step {
  title: string;
  plain: string;
  tone: StepTone;
  /** One concrete, current fact — or null while nothing happened yet. */
  fact: string | null;
}

const TONE_COLOR: Record<StepTone, string> = {
  done: "var(--blaze-ok)",
  active: "var(--blaze-accent)",
  waiting: "var(--blaze-text-faint)",
  blocked: "var(--blaze-alert)",
};

const TONE_LABEL: Record<StepTone, string> = {
  done: "done",
  active: "running",
  waiting: "waiting",
  blocked: "blocked",
};

/** The five pipeline stages, derived from real stream state — nothing invented. */
function deriveSteps(s: IncidentState): Step[] {
  const safetyTone: StepTone =
    s.safetyReview == null
      ? s.plan
        ? "active"
        : "waiting"
      : s.safetyReview.status === "block"
        ? "blocked"
        : "done";

  return [
    {
      title: "Radio listening",
      plain: "Radio messages are transcribed and understood.",
      tone: s.radioEvents.length > 0 ? "done" : s.transcripts.length > 0 ? "active" : "waiting",
      fact:
        s.radioEvents.length > 0
          ? `${s.transcripts.length} message(s) · ${s.radioEvents.length} fact(s) extracted`
          : null,
    },
    {
      title: "Field analysis",
      plain: "Weather, roads, buildings and water points are checked.",
      tone: s.snapshot ? "done" : s.toolCalls.length > 0 ? "active" : "waiting",
      fact: s.toolCalls.length > 0 ? `${s.toolCalls.length} field check(s)` : null,
    },
    {
      title: "Action plan",
      plain: "A plan is proposed for every crew.",
      tone: s.plan ? "done" : "waiting",
      fact: s.plan ? `version ${s.plan.version} — ${s.plan.summary}` : null,
    },
    {
      title: "Safety check",
      plain: "The plan is challenged point by point before anything is sent.",
      tone: safetyTone,
      fact:
        s.safetyReview == null
          ? null
          : s.safetyReview.status === "pass"
            ? "no blocking risk"
            : s.safetyReview.status === "revise"
              ? "revision requested"
              : "plan blocked",
    },
    {
      title: "Orders to the crews",
      plain: "Every crew receives its own voice message.",
      tone: s.dispatchesSent > 0 ? "done" : s.dispatchUnlocked ? "active" : "waiting",
      fact: s.dispatchesSent > 0 ? `${s.dispatchesSent} order(s) sent` : null,
    },
  ];
}

function ApprovalBanner({ s }: { s: IncidentState }) {
  if (s.approval?.decision === "approve") {
    return (
      <div
        className="rounded-2xl border px-4 py-3 text-lg font-semibold"
        style={{
          borderColor: "var(--blaze-ok)",
          background: "var(--blaze-ok-dim)",
          color: "var(--blaze-ok)",
        }}
      >
        ✓ Plan approved by {s.approval.operator_name}
      </div>
    );
  }
  if (s.approvalRequested && !s.approval) {
    return (
      <div
        className="blaze-cta-pulse rounded-2xl border px-4 py-3 text-lg font-semibold"
        style={{
          borderColor: "var(--blaze-accent)",
          background: "var(--blaze-accent-dim)",
          color: "var(--blaze-accent)",
        }}
      >
        Waiting for the commander&apos;s approval — nothing goes out without it.
      </div>
    );
  }
  return (
    <div
      className="rounded-2xl border border-edge px-4 py-3 text-lg"
      style={{ color: "var(--blaze-text-faint)" }}
    >
      No plan to approve yet.
    </div>
  );
}

export default function SimpleView() {
  const state = useIncidentState();
  const controls = useSessionControls();

  useEffect(() => {
    controls.start();
  }, [controls]);

  const steps = deriveSteps(state);
  const statusLabel =
    state.incidentStatus === "active"
      ? "incident in progress"
      : state.incidentStatus === "completed"
        ? "incident completed"
        : "waiting to start";

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-3 p-3">
      <OpsNav />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-full border border-edge bg-surface px-4 py-1.5">
        <div className="ml-auto flex items-center gap-3">
          <StreamModeToggle />
          <PlayerBar />
        </div>
      </div>

      {/* Incident, in one line anyone can read */}
      <header className="mt-2">
        <p
          className="text-[11px] font-medium"
          style={{ color: "var(--blaze-text-faint)" }}
        >
          {statusLabel}
          {state.networkMode ? ` · ${state.networkMode === "offline" ? "offline — everything runs on site" : "online"}` : ""}
        </p>
        <h1 className="mt-1 text-2xl font-bold" style={{ color: "var(--blaze-text)" }}>
          {state.incidentName ?? "No incident in progress"}
        </h1>
      </header>

      <ApprovalBanner s={state} />

      {/* The five steps, plainly */}
      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="flex items-start gap-4 rounded-2xl border border-edge bg-surface px-4 py-3.5"
          >
            <span
              className="mt-0.5 font-mono text-[13px] font-bold"
              style={{ color: TONE_COLOR[step.tone] }}
              aria-hidden
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 className="text-lg font-semibold" style={{ color: "var(--blaze-text)" }}>
                  {step.title}
                </h2>
                <span
                  className="text-[11px] font-medium"
                  style={{ color: TONE_COLOR[step.tone] }}
                >
                  {TONE_LABEL[step.tone]}
                </span>
              </div>
              <p className="text-sm" style={{ color: "var(--blaze-text-muted)" }}>
                {step.plain}
              </p>
              {step.fact && (
                <p className="mt-1 font-mono text-[12px]" style={{ color: "var(--blaze-text)" }}>
                  {step.fact}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* Orders per unit — the part a field crew actually cares about */}
      {state.dispatches.length > 0 && (
        <section aria-labelledby="orders-title" className="mt-1">
          <h2
            id="orders-title"
            className="text-[12px] font-semibold"
            style={{ color: "var(--blaze-text-faint)" }}
          >
            {"Orders sent"}
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {state.dispatches.map((d) => (
              <li
                key={d.dispatch_id}
                className="rounded-2xl border border-edge bg-surface px-4 py-3"
              >
                <div className="flex items-baseline gap-3">
                  <span
                    className="text-[13px] font-bold"
                    style={{ color: "var(--blaze-accent)" }}
                  >
                    {d.unit_id}
                  </span>
                  {d.acknowledgement_required && (
                    <span
                      className="text-[11px]"
                      style={{ color: "var(--blaze-warn)" }}
                    >
                      acknowledgement required
                    </span>
                  )}
                </div>
                <p className="mt-1 text-base" style={{ color: "var(--blaze-text)" }}>
                  {d.message_text}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
