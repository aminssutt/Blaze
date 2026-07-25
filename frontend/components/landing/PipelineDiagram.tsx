// Landing v2 — Section 02 · HOW BLAZE WORKS. The signature animated diagram.
//
// Eight numbered nodes (radio → STT → 4 Gemma stages → human veto → dispatch)
// laid out on a serpentine SVG rail. Data dots travel the rail on an endless
// ~8 s loop (SVG animateMotion — zero JS per frame); each node lights up as
// the flow passes through it (motion/react keyframes synced to the same
// loop); nodes reveal in stagger on scroll and show a one-line tooltip on
// hover/focus. Reduced motion: no dots, every node lit, tooltips intact.

"use client";

import { motion, useReducedMotion } from "motion/react";
import { Eyebrow, Reveal, fadeUp, staggerParent } from "./primitives";

const LOOP_S = 8;

/** Serpentine rail through the 8 node centers (viewBox 1000×460). */
const RAIL_PATH = "M 125 100 L 875 100 C 985 100 985 360 875 360 L 125 360";

type Node = {
  id: string;
  emoji: string;
  title: string;
  tip: string;
  /** Node center in viewBox coordinates. */
  x: number;
  y: number;
  /** Fraction of the loop at which the traveling dot reaches this node. */
  at: number;
  veto?: boolean;
};

const NODES: Node[] = [
  {
    id: "radio",
    emoji: "📻",
    title: "Radio",
    tip: "Five French voice reports from the fireground — corrections, contradictions, stress.",
    x: 125,
    y: 100,
    at: 0.02,
  },
  {
    id: "stt",
    emoji: "📝",
    title: "faster-whisper STT",
    tip: "Local speech-to-text — timestamped French transcripts, fully offline.",
    x: 375,
    y: 100,
    at: 0.13,
  },
  {
    id: "radio-intel",
    emoji: "🤖",
    title: "Radio Intelligence",
    tip: "Gemma extracts structured facts — evidence must quote the transcript.",
    x: 625,
    y: 100,
    at: 0.27,
  },
  {
    id: "context",
    emoji: "🌍",
    title: "Situation Context + tools",
    tip: "7 allowlisted tools — weather, terrain, hotspots, cadastre — every field provenance-labeled.",
    x: 875,
    y: 100,
    at: 0.4,
  },
  {
    id: "planning",
    emoji: "🗺️",
    title: "Tactical Planning",
    tip: "Facts and context fused into a versioned draft plan — evidence IDs verified by code.",
    x: 875,
    y: 360,
    at: 0.6,
  },
  {
    id: "critic",
    emoji: "🛡️",
    title: "Safety Critic",
    tip: "8 hard-coded safety rules attack the plan — pass, revise or block.",
    x: 625,
    y: 360,
    at: 0.73,
  },
  {
    id: "veto",
    emoji: "👤",
    title: "HUMAN VETO",
    tip: "Dispatch is structurally impossible until the commander approves.",
    x: 375,
    y: 360,
    at: 0.86,
    veto: true,
  },
  {
    id: "dispatch",
    emoji: "📢",
    title: "Dispatch + Piper TTS",
    tip: "One French voice order per unit, synthesized locally.",
    x: 125,
    y: 360,
    at: 0.96,
  },
];

const TAGS = [
  "schema-validated",
  "provenance-labeled",
  "guardrail-checked",
  "HUMAN VETO",
  "offline-first",
];

/** Keyframe times: node is hot from `at` for ~14% of the loop, then cools. */
function hotTimes(at: number): number[] {
  const rise = Math.min(at + 0.04, 0.995);
  const fall = Math.min(at + 0.16, 0.998);
  return [0, at, rise, fall, 1];
}

function DiagramNode({ node, index }: { node: Node; index: number }) {
  const reduced = useReducedMotion();
  const accent = "var(--blaze-accent)";

  return (
    <motion.div
      variants={fadeUp}
      className="group absolute w-[21%] -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${node.x / 10}%`, top: `${(node.y / 460) * 100}%` }}
    >
      <motion.div
        className="rounded-lg border px-3 py-2.5 text-center"
        style={{
          background: "var(--blaze-bg-raised)",
          borderColor: node.veto ? "var(--blaze-accent-dim)" : "var(--blaze-border)",
        }}
        animate={
          reduced
            ? { opacity: 1 }
            : {
                opacity: [0.55, 0.55, 1, 1, 0.55],
                borderColor: node.veto
                  ? ["var(--blaze-accent-dim)", "var(--blaze-accent-dim)", accent, accent, "var(--blaze-accent-dim)"]
                  : ["var(--blaze-border)", "var(--blaze-border)", accent, accent, "var(--blaze-border)"],
              }
        }
        transition={{ duration: LOOP_S, times: hotTimes(node.at), repeat: Infinity }}
        tabIndex={0}
        aria-label={`${node.title} — ${node.tip}`}
      >
        <p
          className="font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: node.veto ? accent : "var(--blaze-text-faint)" }}
        >
          {String(index + 1).padStart(2, "0")}
        </p>
        <p className="mt-0.5 text-base leading-none" aria-hidden>
          {node.emoji}
        </p>
        <p
          className="mt-1 text-[12.5px] font-semibold leading-tight"
          style={{ color: node.veto ? accent : "var(--blaze-text)" }}
        >
          {node.title}
        </p>
      </motion.div>

      {/* hover / focus tooltip */}
      <div
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-md border px-3 py-2 text-left text-[12px] leading-snug opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
        style={{
          background: "var(--blaze-bg-overlay)",
          borderColor: "var(--blaze-border-strong)",
          color: "var(--blaze-text-muted)",
        }}
      >
        {node.tip}
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
      className="scroll-mt-20 py-24 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal>
          <Eyebrow index="02" label="How BLAZE works" />
          <h2
            id="how-title"
            className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight lg:text-5xl"
            style={{ color: "var(--blaze-text)" }}
          >
            One radio message, end to end — on one machine.
          </h2>
          <p
            className="mt-6 max-w-2xl text-[16px] leading-relaxed"
            style={{ color: "var(--blaze-text-muted)" }}
          >
            Every transmission travels the same audited path: transcribed
            locally, structured by Gemma agents, stress-tested by hard-coded
            safety rules — and stopped dead until a human commander approves.
          </p>
        </Reveal>

        {/* ------------------------------------------------------------- */}
        {/* Desktop: serpentine rail with traveling data dots              */}
        {/* ------------------------------------------------------------- */}
        <motion.div
          className="relative mt-16 hidden lg:block"
          style={{ aspectRatio: "1000 / 460" }}
          variants={staggerParent}
          initial={reduced ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          aria-label="BLAZE pipeline: radio, speech-to-text, radio intelligence, situation context, tactical planning, safety critic, human veto, dispatch"
        >
          <svg
            viewBox="0 0 1000 460"
            className="absolute inset-0 size-full"
            aria-hidden
          >
            <path
              d={RAIL_PATH}
              fill="none"
              stroke="var(--blaze-border-strong)"
              strokeWidth="1.5"
              strokeDasharray="4 6"
            />
            {!reduced &&
              [0, 1, 2].map((i) => (
                <circle key={i} r="5" fill="var(--blaze-accent)">
                  <animateMotion
                    dur={`${LOOP_S}s`}
                    begin={`${(-i * LOOP_S) / 3}s`}
                    repeatCount="indefinite"
                    path={RAIL_PATH}
                  />
                </circle>
              ))}
            {!reduced &&
              [0, 1, 2].map((i) => (
                <circle key={`halo-${i}`} r="10" fill="var(--blaze-accent)" opacity="0.18">
                  <animateMotion
                    dur={`${LOOP_S}s`}
                    begin={`${(-i * LOOP_S) / 3}s`}
                    repeatCount="indefinite"
                    path={RAIL_PATH}
                  />
                </circle>
              ))}
          </svg>

          {NODES.map((node, index) => (
            <DiagramNode key={node.id} node={node} index={index} />
          ))}
        </motion.div>

        {/* ------------------------------------------------------------- */}
        {/* Mobile: vertical rail, details always visible                  */}
        {/* ------------------------------------------------------------- */}
        <motion.ol
          className="relative mt-12 space-y-4 border-l pl-6 lg:hidden"
          style={{ borderColor: "var(--blaze-border-strong)" }}
          variants={staggerParent}
          initial={reduced ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
        >
          {NODES.map((node, index) => (
            <motion.li key={node.id} variants={fadeUp} className="relative">
              <span
                aria-hidden
                className="absolute -left-[30px] top-1.5 size-2 rounded-full"
                style={{
                  background: node.veto ? "var(--blaze-accent)" : "var(--blaze-border-strong)",
                }}
              />
              <p
                className="font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{
                  color: node.veto ? "var(--blaze-accent)" : "var(--blaze-text-faint)",
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </p>
              <p
                className="mt-0.5 text-[15px] font-semibold"
                style={{ color: node.veto ? "var(--blaze-accent)" : "var(--blaze-text)" }}
              >
                {node.emoji} {node.title}
              </p>
              <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--blaze-text-muted)" }}>
                {node.tip}
              </p>
            </motion.li>
          ))}
        </motion.ol>

        <Reveal delay={0.15} className="mt-14 flex flex-wrap items-center justify-center gap-2">
          {TAGS.map((tag) => (
            <span
              key={tag}
              className="rounded-sm border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{
                borderColor: tag === "HUMAN VETO" ? "var(--blaze-accent-dim)" : "var(--blaze-border-strong)",
                color: tag === "HUMAN VETO" ? "var(--blaze-accent)" : "var(--blaze-text-faint)",
              }}
            >
              {tag}
            </span>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
