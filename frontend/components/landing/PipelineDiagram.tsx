// Landing — Section 02 · HOW BLAZE WORKS. The signature animated diagram.
//
// Eight stages (radio → STT → four Gemma stages → human veto → dispatch) on ONE
// continuous left-to-right rail. Reading order is the reading order of the page:
// no serpentine, no row that has to be read backwards, no need to follow the dot
// to work out what happens next.
//
// A single data packet travels the rail on a ~9 s loop and STOPS DEAD at stage
// 07 for a sixth of the loop before the last segment lights up. That dwell is
// the product's core claim made literal: dispatch is structurally impossible
// until the commander approves. The rail is drawn dimmed past the gate for the
// same reason.
//
// Cards light up as the packet reaches them (motion keyframes on the same loop
// — no per-frame JS) and expose a one-line explanation on hover/focus.
// Reduced motion: no packet, every card lit, tooltips and the mobile list
// intact.

"use client";

import { motion, useReducedMotion } from "motion/react";
import { Eyebrow, Reveal, fadeUp, staggerParent } from "./primitives";

const LOOP_S = 9;

type Stage = {
  id: string;
  /** Short label on the card. */
  title: string;
  /** Tiny mono qualifier under the title. */
  sub: string;
  tip: string;
  /** Fraction of the loop at which the packet reaches this stage. */
  at: number;
  /** How long the stage stays lit, as a fraction of the loop. */
  hold?: number;
  veto?: boolean;
};

/**
 * Eight evenly spaced stages. Card i is centred at (i + 0.5) / 8 of the rail,
 * so the packet keyframes below are just those same centres.
 */
const STAGES: Stage[] = [
  {
    id: "radio",
    title: "Radio",
    sub: "fireground",
    tip: "Five French voice reports from the fireground — corrections, contradictions, stress.",
    at: 0,
  },
  {
    id: "stt",
    title: "Speech to text",
    sub: "faster-whisper",
    tip: "Local speech-to-text — timestamped French transcripts, fully offline.",
    at: 0.125,
  },
  {
    id: "radio-intel",
    title: "Radio intel",
    sub: "gemma",
    tip: "Gemma extracts structured facts — evidence must quote the transcript.",
    at: 0.25,
  },
  {
    id: "context",
    title: "Situation context",
    sub: "7 tools",
    tip: "7 allowlisted tools — weather, terrain, hotspots, cadastre — every field provenance-labeled.",
    at: 0.375,
  },
  {
    id: "planning",
    title: "Tactical planning",
    sub: "gemma",
    tip: "Facts and context fused into a versioned draft plan — evidence IDs verified by code.",
    at: 0.5,
  },
  {
    id: "critic",
    title: "Safety critic",
    sub: "8 rules",
    tip: "8 hard-coded safety rules attack the plan — pass, revise or block.",
    at: 0.625,
  },
  {
    id: "veto",
    title: "Human veto",
    sub: "commander",
    tip: "Dispatch is structurally impossible until the commander approves. The pipeline stops here, every time.",
    at: 0.75,
    hold: 0.19,
    veto: true,
  },
  {
    id: "dispatch",
    title: "Dispatch",
    sub: "piper tts",
    tip: "One French voice order per unit, synthesized locally.",
    at: 0.95,
  },
];

/** Rail centre of stage i, as a percentage string. */
const centre = (i: number) => `${(i + 0.5) * 12.5}%`;

/** Packet keyframes — reaches stage 07 at 75% of the loop and waits until 90%. */
const PACKET_LEFT = [
  ...STAGES.slice(0, 7).map((_, i) => centre(i)),
  centre(6), // the dwell: same position, later time
  centre(7),
];
const PACKET_TIMES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.9, 1];

const VERDICTS = [
  { label: "pass", color: "var(--blaze-ok)" },
  { label: "revise", color: "var(--blaze-warn)" },
  { label: "block", color: "var(--blaze-alert)" },
];

/** Keyframe times: the stage is hot from `at`, then cools. */
function hotTimes(at: number, hold: number): number[] {
  const rise = Math.min(at + 0.03, 0.99);
  const fall = Math.min(rise + hold, 0.995);
  return [0, at, rise, fall, 1];
}

function StageCard({ stage, index }: { stage: Stage; index: number }) {
  const reduced = useReducedMotion();
  const accent = "var(--blaze-accent)";
  const idle = stage.veto ? "var(--blaze-accent-dim)" : "var(--blaze-border)";

  return (
    <motion.div variants={fadeUp} className="group relative h-full px-1.5">
      <motion.div
        className="relative flex h-full flex-col justify-center rounded-lg border px-2.5 py-3 text-center"
        style={{
          background: stage.veto ? "rgba(124, 74, 3, 0.16)" : "var(--blaze-bg-raised)",
          borderColor: idle,
        }}
        animate={
          reduced
            ? { opacity: 1 }
            : {
                opacity: [0.5, 0.5, 1, 1, 0.5],
                borderColor: [idle, idle, accent, accent, idle],
              }
        }
        transition={{
          duration: LOOP_S,
          times: hotTimes(stage.at, stage.hold ?? 0.13),
          repeat: Infinity,
        }}
        tabIndex={0}
        aria-label={`Stage ${index + 1}: ${stage.title} — ${stage.tip}`}
      >
        <p
          className="font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: stage.veto ? accent : "var(--blaze-text-faint)" }}
        >
          {String(index + 1).padStart(2, "0")}
        </p>
        <p
          className="mt-1 text-[12.5px] font-semibold leading-tight"
          style={{ color: stage.veto ? accent : "var(--blaze-text)" }}
        >
          {stage.title}
        </p>
        <p
          className="mt-1 truncate font-mono text-[9.5px] uppercase tracking-[0.1em]"
          style={{ color: "var(--blaze-text-faint)" }}
        >
          {stage.sub}
        </p>
      </motion.div>

      {/* hover / focus tooltip.
          The 240px bubble is centred on its stage, but the first and last
          stages sit against the container edge — centring there pushed the
          bubble ~21px past the viewport and gave the whole page a horizontal
          scrollbar at 1024px. The two end stages anchor to their own edge
          instead. */}
      <div
        role="tooltip"
        className={`pointer-events-none absolute top-full z-20 mt-2 w-60 rounded-md border px-3 py-2 text-left text-[12px] leading-snug opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 ${
          index === 0
            ? "left-0"
            : index === STAGES.length - 1
              ? "right-0"
              : "left-1/2 -translate-x-1/2"
        }`}
        style={{
          background: "var(--blaze-bg-overlay)",
          borderColor: "var(--blaze-border-strong)",
          color: "var(--blaze-text-muted)",
        }}
      >
        {stage.tip}
      </div>
    </motion.div>
  );
}

export default function PipelineDiagram() {
  const reduced = useReducedMotion();

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="scroll-mt-20 py-12 lg:py-14"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal>
          <div className="grid gap-x-12 gap-y-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-end">
            <div>
              <Eyebrow index="02" label="How it works" />
              <h2
                id="how-title"
                className="mt-3 text-3xl font-semibold leading-tight tracking-tight lg:text-4xl"
                style={{ color: "var(--blaze-text)" }}
              >
                One radio message, end to end — on one machine.
              </h2>
            </div>
            <p
              className="text-[14px] leading-relaxed lg:pb-1"
              style={{ color: "var(--blaze-text-muted)" }}
            >
              Eight stages, left to right. Hover any of them for the one-line
              explanation — and watch what happens at stage 07.
            </p>
          </div>
        </Reveal>

        {/* ------------------------------------------------------------- */}
        {/* Desktop: one continuous rail, one packet, one gate            */}
        {/* ------------------------------------------------------------- */}
        <motion.div
          className="relative mt-10 hidden lg:block"
          variants={staggerParent}
          initial={reduced ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          aria-label="BLAZE pipeline, in order: radio, speech to text, radio intelligence, situation context, tactical planning, safety critic, human veto, dispatch"
        >
          {/* the rail */}
          <div className="relative h-10" aria-hidden>
            {/* segment 01 → 07 */}
            <div
              className="absolute top-1/2 h-px -translate-y-1/2"
              style={{
                left: centre(0),
                right: `${100 - 81.25}%`,
                backgroundImage:
                  "repeating-linear-gradient(90deg, var(--blaze-border-strong) 0 5px, transparent 5px 13px)",
              }}
            />
            {/* segment 07 → 08, dimmed: it only exists once a human says yes */}
            <div
              className="absolute top-1/2 h-px -translate-y-1/2"
              style={{
                left: centre(6),
                right: `${100 - 93.75}%`,
                backgroundImage:
                  "repeating-linear-gradient(90deg, var(--blaze-accent-dim) 0 5px, transparent 5px 13px)",
              }}
            />

            {/* stage markers, each with a tick down to its own card */}
            {STAGES.map((stage, i) => (
              <span key={stage.id}>
                <span
                  className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: centre(i),
                    background: stage.veto
                      ? "var(--blaze-accent)"
                      : "var(--blaze-border-strong)",
                  }}
                />
                <span
                  className="absolute top-1/2 h-5 w-px -translate-x-1/2"
                  style={{
                    left: centre(i),
                    background: stage.veto
                      ? "var(--blaze-accent-dim)"
                      : "var(--blaze-border)",
                  }}
                />
              </span>
            ))}

            {/* the gate at stage 07 — two uprights the packet has to wait at */}
            <span
              className="absolute top-1/2 h-8 w-[2px] -translate-y-1/2 rounded-full"
              style={{ left: `calc(${centre(6)} - 12px)`, background: "var(--blaze-accent)" }}
            />
            <span
              className="absolute top-1/2 h-8 w-[2px] -translate-y-1/2 rounded-full"
              style={{ left: `calc(${centre(6)} + 10px)`, background: "var(--blaze-accent)" }}
            />
            <span
              className="absolute -top-1 font-mono text-[9px] uppercase tracking-[0.2em]"
              style={{
                left: centre(6),
                translate: "-50% -100%",
                color: "var(--blaze-accent)",
              }}
            >
              Human veto
            </span>

            {/* the travelling packet */}
            {!reduced && (
              <>
                <motion.span
                  className="absolute top-1/2 size-2.5 rounded-full"
                  style={{
                    translate: "-50% -50%",
                    background: "var(--blaze-accent)",
                    boxShadow: "0 0 12px 3px rgba(245,158,11,0.55)",
                  }}
                  animate={{ left: PACKET_LEFT }}
                  transition={{
                    duration: LOOP_S,
                    times: PACKET_TIMES,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
                <motion.span
                  className="absolute top-1/2 size-6 rounded-full"
                  style={{
                    translate: "-50% -50%",
                    background: "var(--blaze-accent)",
                    opacity: 0.16,
                  }}
                  animate={{ left: PACKET_LEFT }}
                  transition={{
                    duration: LOOP_S,
                    times: PACKET_TIMES,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
              </>
            )}
          </div>

          {/* the cards, exactly under their markers */}
          <div className="grid grid-cols-8">
            {STAGES.map((stage, i) => (
              <StageCard key={stage.id} stage={stage} index={i} />
            ))}
          </div>
        </motion.div>

        {/* ------------------------------------------------------------- */}
        {/* Mobile: same order, vertical rail, details always visible      */}
        {/* ------------------------------------------------------------- */}
        <motion.ol
          className="relative mt-10 space-y-4 border-l pl-6 lg:hidden"
          style={{ borderColor: "var(--blaze-border-strong)" }}
          variants={staggerParent}
          initial={reduced ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
        >
          {STAGES.map((stage, index) => (
            <motion.li key={stage.id} variants={fadeUp} className="relative">
              <span
                aria-hidden
                className="absolute -left-[30px] top-1.5 size-2 rounded-full"
                style={{
                  background: stage.veto
                    ? "var(--blaze-accent)"
                    : "var(--blaze-border-strong)",
                }}
              />
              <p
                className="font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{
                  color: stage.veto ? "var(--blaze-accent)" : "var(--blaze-text-faint)",
                }}
              >
                {String(index + 1).padStart(2, "0")} · {stage.sub}
              </p>
              <p
                className="mt-0.5 text-[15px] font-semibold"
                style={{
                  color: stage.veto ? "var(--blaze-accent)" : "var(--blaze-text)",
                }}
              >
                {stage.title}
              </p>
              <p
                className="mt-1 text-[13px] leading-snug"
                style={{ color: "var(--blaze-text-muted)" }}
              >
                {stage.tip}
              </p>
            </motion.li>
          ))}
        </motion.ol>

        {/* ------------------------------------------------------------- */}
        {/* The claim, and what actually comes out the far end             */}
        {/* ------------------------------------------------------------- */}
        <Reveal delay={0.15} className="mt-12">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
            <div>
              <p
                className="text-[19px] font-semibold leading-snug"
                style={{ color: "var(--blaze-text)" }}
              >
                The AI proposes.{" "}
                <span style={{ color: "var(--blaze-accent)" }}>
                  The commander decides.
                </span>
              </p>
              <span
                className="mt-3 flex items-center gap-2"
                aria-label="Safety review verdicts: pass, revise, block"
              >
                {VERDICTS.map((verdict) => (
                  <span
                    key={verdict.label}
                    className="rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em]"
                    style={{ borderColor: verdict.color, color: verdict.color }}
                  >
                    {verdict.label}
                  </span>
                ))}
              </span>
            </div>

            <p
              className="text-[14px] leading-relaxed"
              style={{ color: "var(--blaze-text-muted)" }}
            >
              Once approved, the plan becomes personalized voice radio messages
              per unit — generated locally with Piper and transmitted over the
              radio. Alpha 3 receives its fallback order, Bravo 2 its perimeter,
              Charlie 1 its verification mission — each unit hears only what
              concerns it, with acknowledgment of receipt.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
