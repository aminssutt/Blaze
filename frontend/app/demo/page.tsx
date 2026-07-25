"use client";

/**
 * BLAZE guided demo view (ticket #110) — /demo.
 *
 * ONE cinematic story for the jury, instead of the eleven-panel control room
 * (which lives intact at /expert — the landing of ticket #111 owns /): a
 * BLAZE hero with a single
 * « Launch demo » button, then a vertical 8-step pipeline that lights up as
 * the scenario events flow through it, ending on the three per-unit dispatch
 * audio players.
 *
 * DATA PATH — identical to the control room: this view consumes ONLY the
 * derived `IncidentState` (lib/incidentStore.ts) through the session hooks
 * (lib/session.ts). It never touches `MockStreamSource` directly, so when
 * ticket #54 swaps the session's source for the real SSE + `POST /incident/
 * start`, « Launch demo » starts the real incident with zero changes here.
 *
 * STEP MODEL — each of the 8 steps derives, from the reduced state:
 *   - an "activity" sequence (the last envelope sequence that touched it);
 *   - 1–3 content lines MAX (the ticket's hard cap).
 * The step with the highest activity is the CURRENT one (amber pulse); any
 * step with earlier activity stays lit; the rest wait dimmed. Connectors
 * animate a flowing dot once the downstream step has been reached, so the
 * "current" visibly travels down the pipe — and travels BACK UP between
 * Safety Critic and Plan during the on-stage "à réviser" beat.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type {
  DispatchInstruction,
  DraftTacticalPlan,
  EventType,
  SafetyReviewStatus,
  TranscriptResult,
} from "@/lib/contracts";
import type { IncidentState, TtsState } from "@/lib/incidentStore";
import { useTypewriter, useTypewriterLines, type TypedLine } from "@/lib/useTypewriter";
import { PLAYER_SPEEDS, type PlayerSpeed } from "@/lib/streamPlayer";
import {
  useIncidentState,
  usePlayerState,
  useSessionControls,
} from "@/lib/session";
import { isLiveMode } from "@/lib/streamMode";
import { postApprovalDecision } from "@/lib/backendApi";
import { Badge, safetyLabel, safetyVariant, urgencyVariant } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* Derivation helpers                                                         */
/* -------------------------------------------------------------------------- */

/** Highest envelope sequence among the given event types (0 = never seen). */
function seqOf(state: IncidentState, types: EventType[]): number {
  let max = 0;
  for (const t of types) {
    const seq = state.lastByType[t]?.sequence ?? 0;
    if (seq > max) max = seq;
  }
  return max;
}

function asNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * tts_audio_path is repo-relative ("data/audio/tts/dispatch_alpha3.wav") and
 * sync-data.mjs mirrors it under public/ — same mapping as DispatchPanel
 * (ticket #49). Ticket #54 swaps this for GET /dispatch/audio/{unit_id}.
 */
function audioUrl(ttsAudioPath: string | null | undefined): string | null {
  return ttsAudioPath ? `/${ttsAudioPath.replace(/^\/+/, "")}` : null;
}

/* -------------------------------------------------------------------------- */
/* Step definitions                                                           */
/* -------------------------------------------------------------------------- */

type StepStatus = "pending" | "done" | "active";

interface StepDef {
  id: string;
  icon: string;
  title: string;
  /** Event types whose latest sequence marks this step as "touched". */
  activity: EventType[];
}

/** The 8 chapters of the story, in pipeline order (ticket #110). */
const STEPS: StepDef[] = [
  { id: "radio", icon: "📻", title: "Audios radio", activity: ["audio.received"] },
  {
    id: "transcription",
    icon: "📝",
    title: "Transcription",
    activity: ["transcription.started", "transcript.ready"],
  },
  {
    id: "radio-agent",
    icon: "🤖",
    title: "Agent Radio",
    activity: ["radio_agent.started", "radio_event.extracted"],
  },
  {
    id: "context",
    icon: "🌍",
    title: "Contexte terrain",
    activity: [
      "context_agent.started",
      "tool.call.requested",
      "tool.call.completed",
      "situation.snapshot.ready",
    ],
  },
  {
    id: "plan",
    icon: "🗺️",
    title: "Plan tactique",
    activity: ["planning.started", "plan.draft.ready", "plan.revision.requested"],
  },
  {
    id: "safety",
    icon: "🛡️",
    title: "Safety Critic",
    activity: ["safety_review.started", "safety_review.ready"],
  },
  {
    id: "approval",
    icon: "👤",
    title: "Validation humaine",
    activity: ["approval.requested", "approval.received"],
  },
  {
    id: "dispatch",
    icon: "📢",
    title: "Dispatch vocal",
    activity: [
      "dispatch.started",
      "dispatch.instruction.ready",
      "tts.started",
      "tts.ready",
      "dispatch.sent",
    ],
  },
];

const PLAN_STEP_INDEX = STEPS.findIndex((s) => s.id === "plan");
const SAFETY_STEP_INDEX = STEPS.findIndex((s) => s.id === "safety");

/* -------------------------------------------------------------------------- */
/* Small presentational pieces                                                */
/* -------------------------------------------------------------------------- */

/** One content line inside a step card (the 1–3 lines budget). */
function Line({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <p
      className={`min-w-0 truncate text-[13px] leading-snug text-foreground ${
        mono ? "font-mono text-[12px]" : ""
      }`}
    >
      {children}
    </p>
  );
}

/** Muted variant for secondary info lines. */
function FaintLine({ children }: { children: ReactNode }) {
  return (
    <p className="min-w-0 truncate font-mono text-[11px] leading-snug text-muted">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Typewriter presentation (ticket #120)                                      */
/* -------------------------------------------------------------------------- */

/** Blinking amber block cursor at the end of the line being typed. */
function Cursor() {
  return (
    <motion.span
      aria-hidden="true"
      className="ml-0.5 inline-block h-[1em] w-[0.55em] translate-y-[0.18em] rounded-[1px]"
      style={{ background: "var(--blaze-accent)" }}
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 0.9, times: [0, 0.5, 0.5, 1], repeat: Infinity, ease: "linear" }}
    />
  );
}

/**
 * One typewritten line. Keyed on the line's FULL text inside an
 * AnimatePresence: when a plan v2 changes a line, the v1 text exits with a
 * fast fade and the v2 text types itself in its place (mode="wait").
 */
function TypedLineView({ line, mono = false }: { line: TypedLine; mono?: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.p
        key={line.full}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className={`min-w-0 break-words leading-snug text-foreground ${
          mono ? "font-mono text-[12px]" : "text-[13px]"
        }`}
      >
        {line.text}
        {line.typing && <Cursor />}
      </motion.p>
    </AnimatePresence>
  );
}

/**
 * Skip affordance shared by the typewritten areas: one click on the text
 * reveals everything instantly (the jury never waits on the animation).
 */
function SkipArea({
  done,
  skip,
  children,
}: {
  done: boolean;
  skip: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={skip}
      disabled={done}
      aria-label="Afficher le texte complet immédiatement"
      title={done ? undefined : "Cliquer pour tout afficher"}
      className="block w-full cursor-text text-left disabled:cursor-auto"
    >
      {children}
    </button>
  );
}

/**
 * Étape 05 — the tactical plan "writes itself": summary first, then each
 * unit action, character by character (~32 chars/s wall-clock, capped
 * independently of the replay speed), 150 ms breath between lines. On a new
 * plan version, unchanged lines stay printed and only the changed lines
 * fade out and re-type (see useTypewriterLines' diff).
 */
function PlanTypewriter({ plan }: { plan: DraftTacticalPlan }) {
  const lines = useMemo(
    () => [
      plan.summary,
      ...plan.unit_actions
        .slice(0, 3)
        .map((a) => `${a.unit_id} — ${truncate(a.instruction, 72)}`),
    ],
    [plan],
  );
  const tw = useTypewriterLines(lines, { charsPerSecond: 32, lineDelayMs: 150 });
  return (
    <SkipArea done={tw.done} skip={tw.skip}>
      {tw.lines.map(
        (line) =>
          // A line only appears once its typing starts — the list "grows".
          !line.pending && (
            <TypedLineView key={line.index} line={line} mono={line.index > 0} />
          ),
      )}
    </SkipArea>
  );
}

/**
 * Étape 02 — the current transcript "transcribes itself" as whisper would
 * emit it. Keyed on audio_id: a new radio message fades the previous
 * transcript out and types the new one.
 */
function TranscriptTypewriter({ transcript }: { transcript: TranscriptResult }) {
  const tw = useTypewriter(transcript.text, { charsPerSecond: 32 });
  return (
    <SkipArea done={tw.done} skip={tw.skip}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={transcript.audio_id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="min-w-0 break-words text-[13px] leading-snug text-foreground"
        >
          « {tw.text}
          {tw.typing && <Cursor />}
          {tw.done && " »"}
        </motion.p>
      </AnimatePresence>
      <FaintLine>
        {transcript.model_name} · {transcript.latency_ms} ms
      </FaintLine>
    </SkipArea>
  );
}

/**
 * Connector between two step cards. Once the current has passed, the line
 * "fills" top-to-bottom (directional flow, astyr-style) and a dot keeps
 * travelling while flow is live; `reverse` runs it UPWARD in warn yellow —
 * the visible Safety → Plan "révision demandée" beat.
 */
function Connector({
  flowing,
  reverse = false,
  label,
}: {
  flowing: boolean;
  reverse?: boolean;
  label?: string;
}) {
  const color = reverse ? "var(--blaze-warn)" : "var(--blaze-accent)";
  return (
    <div className="relative ml-[19px] flex h-12 items-center" aria-hidden="true">
      <div className="relative h-full w-0.5 overflow-hidden rounded-full bg-edge">
        {/* directional fill: the pipe "loads up" when the current reaches it */}
        <motion.div
          className="absolute inset-x-0 rounded-full"
          style={{
            background: `${color}55`,
            [reverse ? "bottom" : "top"]: 0,
          }}
          initial={false}
          animate={{ height: flowing ? "100%" : "0%" }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        {flowing && (
          <motion.span
            className="absolute left-1/2 h-2.5 w-1 -translate-x-1/2 rounded-full"
            style={{ background: color, boxShadow: `0 0 6px 1px ${color}` }}
            animate={{ top: reverse ? ["100%", "-15%"] : ["-15%", "100%"] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
          />
        )}
      </div>
      {label && (
        <motion.span
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          className="ml-4 whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-warn"
        >
          {label}
        </motion.span>
      )}
    </div>
  );
}

/** Per-unit TTS audio player, degrading to text + disabled note (ticket #110). */
function DispatchAudio({
  dispatch,
  tts,
}: {
  dispatch: DispatchInstruction;
  tts: TtsState | undefined;
}) {
  const [failed, setFailed] = useState(false);
  const src = audioUrl(tts?.tts_audio_path ?? dispatch.tts_audio_path);
  const ready = tts?.status === "ready" && src !== null;

  return (
    <div className="rounded-md border border-edge bg-overlay p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[12px] font-semibold text-accent">
          {dispatch.unit_id}
        </span>
        <Badge variant={urgencyVariant(dispatch.priority)}>{dispatch.priority}</Badge>
        {tts?.status === "generating" && (
          <Badge variant="warn">synthèse vocale…</Badge>
        )}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-foreground">
        « {dispatch.message_text} »
      </p>
      {ready && !failed ? (
        <audio
          controls
          preload="none"
          src={src}
          onError={() => setFailed(true)}
          className="mt-1.5 h-8 w-full"
          aria-label={`Message audio TTS pour ${dispatch.unit_id}`}
        />
      ) : (
        (failed || (tts?.status === "ready" && !src)) && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <audio controls className="h-8 w-full opacity-30" aria-hidden="true" />
            <Badge variant="warn" title={src ?? "pas de fichier TTS"}>
              audio indisponible — texte seul
            </Badge>
          </div>
        )
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step card                                                                  */
/* -------------------------------------------------------------------------- */

function StepCard({
  step,
  index,
  status,
  produced = false,
  highlight = false,
  badge,
  children,
}: {
  step: StepDef;
  /** 0-based position — rendered as the "01 → 08" step number. */
  index: number;
  status: StepStatus;
  /**
   * True once the step has real output to show. The "✓" only appears on a
   * done step that produced something — a step merely *started* (e.g. a
   * transcription in flight) must not read as finished.
   */
  produced?: boolean;
  /** Amber "revision in progress" ring on the Plan card during the beat. */
  highlight?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const active = status === "active";
  return (
    <div className="flex items-stretch gap-4">
      {/* Icon node on the pipeline spine */}
      <motion.div
        className="flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-full border text-lg"
        animate={
          active
            ? {
                borderColor: "var(--blaze-accent)",
                backgroundColor: "#f59e0b22",
                scale: [1, 1.08, 1],
              }
            : {
                borderColor:
                  status === "done"
                    ? "var(--blaze-border-strong)"
                    : "var(--blaze-border)",
                backgroundColor: "var(--blaze-bg-raised)",
                scale: 1,
              }
        }
        transition={active ? { duration: 1.4, repeat: Infinity } : { duration: 0.3 }}
        aria-hidden="true"
      >
        <span className={status === "pending" ? "opacity-40 grayscale" : ""}>
          {step.icon}
        </span>
      </motion.div>

      {/* Card */}
      <motion.section
        aria-label={step.title}
        aria-current={active ? "step" : undefined}
        className={`min-w-0 flex-1 rounded-lg border bg-surface px-4 py-3 ${
          highlight
            ? "border-warn/70"
            : active
              ? "border-accent/70"
              : status === "done"
                ? "border-edge-strong"
                : "border-edge"
        }`}
        animate={{
          // Soft reveal when the step's events arrive: fade + translateY,
          // ease-out (design direction, ticket #110).
          opacity: status === "pending" ? 0.35 : 1,
          y: status === "pending" ? 12 : 0,
          boxShadow: active
            ? [
                "0 0 0px 0px rgba(245,158,11,0)",
                "0 0 22px 2px rgba(245,158,11,0.22)",
                "0 0 0px 0px rgba(245,158,11,0)",
              ]
            : highlight
              ? "0 0 18px 1px rgba(234,179,8,0.18)"
              : "0 0 0px 0px rgba(245,158,11,0)",
        }}
        transition={{
          boxShadow: active
            ? { duration: 1.4, repeat: Infinity }
            : { duration: 0.3 },
          default: { duration: 0.45, ease: "easeOut" },
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-[11px] tracking-widest ${
              active ? "text-accent" : "text-faint"
            }`}
            aria-hidden="true"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <h2 className="truncate text-[14px] font-semibold tracking-wide text-foreground">
            {step.title}
          </h2>
          {status === "done" && produced && !badge && (
            <span className="font-mono text-[11px] text-ok" aria-label="terminé">
              ✓
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">{badge}</span>
        </div>
        {children}
      </motion.section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DemoPage() {
  const state = useIncidentState();
  const player = usePlayerState();
  const controls = useSessionControls();
  const [launchedLocal, setLaunchedLocal] = useState(false);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Pre-arm the source on mount (loads + validates the stream, emits nothing)
  // so « Launch demo » starts instantly. In live mode (ticket #54) the same
  // controls.start() maps to the incident start API — nothing changes here.
  useEffect(() => {
    controls.start();
  }, [controls]);

  // The view survives a round-trip to /expert mid-replay: any emitted event
  // means the demo is running, with or without the local click flag.
  const launched = launchedLocal || player.position > 0;

  /* ---------------------- derived step activity/status --------------------- */

  const activity = useMemo(
    () => STEPS.map((s) => seqOf(state, s.activity)),
    [state],
  );
  const currentIdx = useMemo(() => {
    let idx = -1;
    let best = 0;
    activity.forEach((seq, i) => {
      if (seq > best) {
        best = seq;
        idx = i;
      }
    });
    return idx;
  }, [activity]);

  const statusOf = (i: number): StepStatus =>
    activity[i] === 0 ? "pending" : i === currentIdx ? "active" : "done";

  // The on-stage beat: a "revise" review exists and plan v2 is not out yet —
  // the current visibly flows BACK from Safety Critic to Plan tactique.
  const reviseBeat =
    state.safetyReviews.some((r) => r.status === "revise") &&
    state.plans.length < 2;

  // Cinematic guidance: keep the active step centered while the story plays.
  const scrollTarget = reviseBeat ? PLAN_STEP_INDEX : currentIdx;
  useEffect(() => {
    if (scrollTarget < 0 || player.status !== "playing") return;
    stepRefs.current[scrollTarget]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [scrollTarget, player.status]);

  /* --------------------------- per-step content ---------------------------- */

  const lastAudio = state.audios[state.audios.length - 1];
  const lastTranscript = state.transcripts[state.transcripts.length - 1];
  const lastRadioEvent = state.radioEvents[state.radioEvents.length - 1];
  const weather = state.snapshot?.weather as Record<string, unknown> | undefined;
  const toolsDone = state.toolCalls.filter((c) => c.completed).length;
  const latestReview = state.safetyReview;
  const approvalPending = state.approvalRequested && !state.approval;
  const live = isLiveMode();
  const canApprove = live
    ? state.plan !== null
    : player.jumpPoints.some((p) => p.id === "dispatch");
  const completed = state.lastByType["incident.completed"]?.payload as
    | { plan_versions?: number; dispatches_sent?: number; cloud_llm_calls?: number }
    | undefined;
  const cloudCalls =
    asNum(state.metrics?.cloud_llm_calls) ?? completed?.cloud_llm_calls ?? 0;

  // Same decision path as ApprovalGate (ticket #48, live-wired by #54).
  // Mock: drive the replay to the dispatch phase and let approval.received
  // flow back through the store. Live: POST the real /approval/decision —
  // no local state is set, the events come back through the SSE stream.
  const approve = () => {
    if (!live) {
      controls.jumpTo("dispatch");
      return;
    }
    if (!state.plan) return;
    void postApprovalDecision(state.plan, "approve", null).catch(
      (err: unknown) => console.error("[demo] approval failed:", err),
    );
  };

  const restart = () => {
    controls.reset();
    setLaunchedLocal(false);
    window.scrollTo({ top: 0 });
  };

  /* ------------------------------- render ---------------------------------- */

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <AnimatePresence mode="wait">
        {!launched ? (
          /* ------------------------------ HERO ------------------------------ */
          <motion.main
            key="hero"
            className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center"
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.35 }}
          >
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-b from-accent to-accent-strong bg-clip-text text-7xl font-black tracking-[0.35em] text-transparent sm:text-8xl"
            >
              BLAZE
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="max-w-xl text-balance text-[15px] leading-relaxed text-muted"
            >
              Du trafic radio des pompiers à l’ordre vocal validé — transcription,
              agents Gemma, plan tactique, critique sécurité et dispatch,
              entièrement en local.
            </motion.p>
            <motion.button
              type="button"
              onClick={() => {
                setLaunchedLocal(true);
                controls.toggle();
              }}
              disabled={player.status === "error"}
              initial={{ opacity: 0, y: 8 }}
              animate={{
                opacity: 1,
                y: 0,
                boxShadow: [
                  "0 0 0px 0px rgba(249,115,22,0.0)",
                  "0 0 40px 4px rgba(249,115,22,0.35)",
                  "0 0 0px 0px rgba(249,115,22,0.0)",
                ],
              }}
              transition={{ boxShadow: { duration: 2, repeat: Infinity } }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="rounded-lg border border-accent bg-accent-dim/40 px-10 py-4 font-mono text-xl font-bold uppercase tracking-widest text-accent hover:bg-accent-dim/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ▶ Launch demo
            </motion.button>
            {player.status === "error" && (
              <p className="font-mono text-[12px] text-alert">
                flux indisponible : {player.error}
              </p>
            )}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-center gap-4 font-mono text-[12px] text-faint"
            >
              <Badge variant="ok" filled title="Aucun appel LLM cloud — inférence 100 % locale">
                Cloud LLM calls: 0
              </Badge>
              <Link href="/expert" className="underline-offset-4 hover:text-muted hover:underline">
                Expert view →
              </Link>
            </motion.div>
          </motion.main>
        ) : (
          /* ---------------------------- PIPELINE ---------------------------- */
          <motion.main
            key="pipeline"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
            className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-6"
          >
            <header className="mb-5 flex items-baseline gap-3">
              <span className="bg-gradient-to-b from-accent to-accent-strong bg-clip-text font-black tracking-[0.3em] text-transparent">
                BLAZE
              </span>
              <span className="truncate font-mono text-[12px] text-muted">
                {state.incidentName ?? "démo guidée"}
              </span>
              {state.incidentStatus === "completed" && (
                <Badge variant="ok" filled className="ml-auto">
                  incident terminé
                </Badge>
              )}
            </header>

            <ol className="flex flex-col">
              {STEPS.map((step, i) => {
                const status = statusOf(i);
                // Safety → Plan return beat: the connector ABOVE the safety
                // card reverses and turns warn-yellow while v2 is rebuilt.
                const isReturnConnector = i === SAFETY_STEP_INDEX && reviseBeat;
                return (
                  <li key={step.id} className="flex flex-col">
                    {i > 0 && (
                      <Connector
                        flowing={activity[i] > 0 || isReturnConnector}
                        reverse={isReturnConnector}
                        label={
                          isReturnConnector
                            ? "révision demandée → plan v2"
                            : undefined
                        }
                      />
                    )}
                    <motion.div
                      ref={(el) => {
                        stepRefs.current[i] = el;
                      }}
                      // Staggered pipeline reveal on launch (~80 ms per step).
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.45,
                        ease: "easeOut",
                        delay: i * 0.08,
                      }}
                    >
                      {step.id === "radio" && (
                        <StepCard
                          step={step} index={i}
                          status={status}
                          produced={state.audios.length > 0}
                          badge={
                            state.audios.length > 0 && (
                              <Badge variant="accent">
                                {state.audios.length} reçu{state.audios.length > 1 ? "s" : ""}
                              </Badge>
                            )
                          }
                        >
                          {lastAudio ? (
                            <>
                              <Line mono>
                                ▶ {lastAudio.speaker_hint ?? lastAudio.audio_id}
                                {lastAudio.duration_seconds !== null &&
                                  ` · ${lastAudio.duration_seconds}s`}
                                {lastAudio.audio_mode && ` · ${lastAudio.audio_mode}`}
                              </Line>
                              <FaintLine>
                                dernier message : {lastAudio.audio_id}
                              </FaintLine>
                            </>
                          ) : (
                            <FaintLine>en attente du premier message radio…</FaintLine>
                          )}
                        </StepCard>
                      )}

                      {step.id === "transcription" && (
                        <StepCard
                          step={step} index={i}
                          status={status}
                          produced={state.transcripts.length > 0}
                        >
                          {lastTranscript ? (
                            <TranscriptTypewriter transcript={lastTranscript} />
                          ) : (
                            <FaintLine>speech-to-text local en attente…</FaintLine>
                          )}
                        </StepCard>
                      )}

                      {step.id === "radio-agent" && (
                        <StepCard
                          step={step} index={i}
                          status={status}
                          produced={state.radioEvents.length > 0}
                          badge={
                            state.radioEvents.length > 0 && (
                              <Badge variant="accent">
                                {state.radioEvents.length} fait
                                {state.radioEvents.length > 1 ? "s" : ""}
                              </Badge>
                            )
                          }
                        >
                          {lastRadioEvent ? (
                            <>
                              <div className="flex min-w-0 items-center gap-1.5">
                                <Line mono>
                                  {lastRadioEvent.unit_id ?? "?"} ·{" "}
                                  {lastRadioEvent.event_type}
                                </Line>
                                <Badge variant={urgencyVariant(lastRadioEvent.urgency)}>
                                  {lastRadioEvent.urgency}
                                </Badge>
                              </div>
                              <Line>{lastRadioEvent.facts[0] ?? ""}</Line>
                            </>
                          ) : (
                            <FaintLine>
                              extraction des faits structurés en attente…
                            </FaintLine>
                          )}
                        </StepCard>
                      )}

                      {step.id === "context" && (
                        <StepCard
                          step={step} index={i}
                          status={status}
                          produced={state.snapshot !== null}
                          badge={
                            state.snapshot && (
                              <Badge variant="ok">
                                snapshot v{state.snapshot.version}
                              </Badge>
                            )
                          }
                        >
                          {state.snapshot && weather ? (
                            <>
                              <Line mono>
                                Vent {asNum(weather.wind_speed_kmh) ?? "?"} km/h ·
                                rafales {asNum(weather.wind_gusts_kmh) ?? "?"} · HR{" "}
                                {asNum(weather.relative_humidity_pct) ?? "?"} %
                              </Line>
                              <Line mono>
                                {(state.snapshot.roads ?? []).filter(
                                  (r) => r.status === "blocked",
                                ).length}{" "}
                                route bloquée ·{" "}
                                {(state.snapshot.fire_hotspots ?? []).length} foyer
                                détecté
                              </Line>
                              <FaintLine>
                                {toolsDone}/{state.toolCalls.length} outils (météo,
                                satellite, routes…)
                              </FaintLine>
                            </>
                          ) : state.toolCalls.length > 0 ? (
                            <Line mono>
                              {toolsDone}/{state.toolCalls.length} appels outils…{" "}
                              {state.toolCalls[state.toolCalls.length - 1]?.tool_name}
                            </Line>
                          ) : (
                            <FaintLine>
                              météo, satellite et routes en attente…
                            </FaintLine>
                          )}
                        </StepCard>
                      )}

                      {step.id === "plan" && (
                        <StepCard
                          step={step} index={i}
                          status={status}
                          produced={state.plan !== null}
                          highlight={reviseBeat}
                          badge={
                            <>
                              {state.plan && (
                                <Badge variant="accent" filled>
                                  v{state.plan.version}
                                </Badge>
                              )}
                              {reviseBeat && (
                                <Badge variant="warn" filled>
                                  révision en cours
                                </Badge>
                              )}
                            </>
                          }
                        >
                          {state.plan ? (
                            <PlanTypewriter plan={state.plan} />
                          ) : (
                            <FaintLine>
                              l’agent de planification attend le contexte…
                            </FaintLine>
                          )}
                        </StepCard>
                      )}

                      {step.id === "safety" && (
                        <StepCard
                          step={step} index={i}
                          status={status}
                          produced={latestReview !== null}
                          badge={
                            latestReview && (
                              <motion.span
                                key={latestReview.review_id}
                                initial={{ scale: 1.6, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ type: "spring", stiffness: 300 }}
                              >
                                <Badge
                                  variant={safetyVariant(latestReview.status)}
                                  filled
                                >
                                  {safetyLabel(latestReview.status)}
                                </Badge>
                              </motion.span>
                            )
                          }
                        >
                          {latestReview ? (
                            <>
                              <Line>
                                {latestReview.status === "revise"
                                  ? latestReview.critical_objections[0]
                                  : `${latestReview.rule_checks.filter((r) => r.passed).length}/${latestReview.rule_checks.length} règles de sécurité respectées`}
                              </Line>
                              {state.safetyReviews.length > 1 && (
                                <FaintLine>
                                  {state.safetyReviews
                                    .map(
                                      (r) =>
                                        `${r.plan_id}: ${safetyLabel(r.status as SafetyReviewStatus)}`,
                                    )
                                    .join(" → ")}
                                </FaintLine>
                              )}
                            </>
                          ) : (
                            <FaintLine>
                              le critique de sécurité attend un plan…
                            </FaintLine>
                          )}
                        </StepCard>
                      )}

                      {step.id === "approval" && (
                        <StepCard
                          step={step}
                          index={i}
                          status={status}
                          produced={state.approval !== null}
                          badge={
                            <Badge
                              variant={approvalPending ? "accent" : "neutral"}
                              title="Rien n'est diffusé sans décision humaine — l'argument signature de BLAZE"
                            >
                              human veto
                            </Badge>
                          }
                        >
                          {approvalPending ? (
                            <div className="flex items-center gap-3 py-0.5">
                              <span className="text-[13px] text-accent">
                                l’IA propose — le commandant décide
                              </span>
                              <motion.button
                                type="button"
                                onClick={approve}
                                disabled={!canApprove}
                                animate={{
                                  boxShadow: [
                                    "0 0 0px 0px rgba(34,197,94,0)",
                                    "0 0 18px 2px rgba(34,197,94,0.35)",
                                    "0 0 0px 0px rgba(34,197,94,0)",
                                  ],
                                }}
                                transition={{ duration: 1.5, repeat: Infinity }}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.96 }}
                                className="ml-auto rounded-md border border-ok bg-ok-dim/60 px-5 py-2 font-mono text-[13px] font-bold uppercase tracking-wider text-ok hover:bg-ok-dim disabled:cursor-not-allowed disabled:opacity-40"
                                title="Valide le plan v2 et déclenche la diffusion (invariant produit #1)"
                              >
                                ✓ Approve
                              </motion.button>
                            </div>
                          ) : state.approval ? (
                            <>
                              <Line mono>
                                ✓ {state.approval.decision} —{" "}
                                {state.approval.operator_name}
                              </Line>
                              {state.approval.operator_note && (
                                <FaintLine>
                                  « {state.approval.operator_note} »
                                </FaintLine>
                              )}
                            </>
                          ) : (
                            <FaintLine>
                              la diffusion reste verrouillée sans validation
                              humaine…
                            </FaintLine>
                          )}
                        </StepCard>
                      )}

                      {step.id === "dispatch" && (
                        <StepCard
                          step={step} index={i}
                          status={status}
                          produced={state.dispatches.length > 0}
                          badge={
                            state.dispatchesSent > 0 && (
                              <Badge variant="ok">
                                {state.dispatchesSent}/{state.dispatches.length}{" "}
                                transmis · simulé
                              </Badge>
                            )
                          }
                        >
                          {state.dispatches.length > 0 ? (
                            <div className="mt-1 flex flex-col gap-1.5">
                              {state.dispatches.map((d) => (
                                <motion.div
                                  key={d.dispatch_id}
                                  initial={{ opacity: 0, y: 6 }}
                                  animate={{ opacity: 1, y: 0 }}
                                >
                                  <DispatchAudio
                                    dispatch={d}
                                    tts={state.ttsByDispatchId[d.dispatch_id]}
                                  />
                                </motion.div>
                              ))}
                            </div>
                          ) : (
                            <FaintLine>
                              messages vocaux par unité en attente de la
                              validation…
                            </FaintLine>
                          )}
                        </StepCard>
                      )}
                    </motion.div>
                  </li>
                );
              })}
            </ol>

            {/* Closing beat once the scenario is over */}
            {completed && (
              <motion.footer
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-ok/40 bg-ok-dim/20 px-4 py-3 font-mono text-[12px] text-ok"
              >
                <span>Incident clos</span>
                <span aria-hidden="true">·</span>
                <span>{completed.plan_versions ?? "?"} versions de plan</span>
                <span aria-hidden="true">·</span>
                <span>{completed.dispatches_sent ?? "?"} unités dispatchées</span>
                <span aria-hidden="true">·</span>
                <span className="font-bold">
                  Cloud LLM calls: {completed.cloud_llm_calls ?? 0}
                </span>
              </motion.footer>
            )}
          </motion.main>
        )}
      </AnimatePresence>

      {/* -------------------- discreet bottom bar (pipeline) ------------------ */}
      {launched && (
        <div className="fixed inset-x-0 bottom-0 border-t border-edge bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-12 w-full max-w-2xl items-center gap-3 px-4 font-mono text-[11px] text-muted">
            <div className="flex items-center gap-1" role="group" aria-label="Vitesse du replay">
              {PLAYER_SPEEDS.map((speed: PlayerSpeed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => controls.setSpeed(speed)}
                  aria-pressed={player.speed === speed}
                  className={`rounded-sm border px-2 py-0.5 ${
                    player.speed === speed
                      ? "border-accent bg-accent-dim/40 text-accent"
                      : "border-edge hover:border-edge-strong"
                  }`}
                >
                  x{speed}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={restart}
              className="rounded-sm border border-edge px-2 py-0.5 hover:border-edge-strong"
              title="Revenir à l’écran de lancement"
            >
              ↺
            </button>
            {/* replay progress */}
            <div
              className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-overlay"
              role="progressbar"
              aria-label="Progression du replay"
              aria-valuemin={0}
              aria-valuemax={player.total}
              aria-valuenow={player.position}
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{
                  width: `${player.total > 0 ? (player.position / player.total) * 100 : 0}%`,
                }}
              />
            </div>
            <Badge
              variant="ok"
              filled
              title="Aucun appel LLM cloud — toute l’inférence est locale"
            >
              Cloud LLM calls: {cloudCalls}
            </Badge>
            <Link
              href="/expert"
              className="shrink-0 underline-offset-4 hover:text-foreground hover:underline"
            >
              Expert view →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
