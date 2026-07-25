// Landing v2 — Section 02 · HOW BLAZE WORKS. The signature animated diagram.
//
// Eight numbered nodes (radio → STT → 4 Gemma stages → human veto → dispatch)
// laid out on a serpentine SVG rail. Data dots travel the rail on an endless
// ~8 s loop (SVG animateMotion — zero JS per frame); each node lights up as
// the flow passes through it (motion/react keyframes synced to the same
// loop); nodes reveal in stagger on scroll and show a one-line tooltip on
// hover/focus. Reduced motion: no dots, every node lit, tooltips intact.
//
// The section closes with two short additions: what actually comes OUT of
// the pipeline (per-unit voice orders, Piper, radio) and a demo-orientation
// teaser — a decorative mini agent node telling visitors what to click for
// in /workflow.

"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Eyebrow, Reveal, fadeUp, staggerParent } from "./primitives";

const LOOP_S = 8;

/** Serpentine rail through the 8 node centers (viewBox 1000×460). */
const RAIL_PATH = "M 125 100 L 875 100 C 985 100 985 360 875 360 L 125 360";

type Node = {
  id: string;
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
    title: "Radio",
    tip: "Five French voice reports from the fireground — corrections, contradictions, stress.",
    x: 125,
    y: 100,
    at: 0.02,
  },
  {
    id: "stt",
    title: "faster-whisper STT",
    tip: "Local speech-to-text — timestamped French transcripts, fully offline.",
    x: 375,
    y: 100,
    at: 0.13,
  },
  {
    id: "radio-intel",
    title: "Radio Intelligence",
    tip: "Gemma extracts structured facts — evidence must quote the transcript.",
    x: 625,
    y: 100,
    at: 0.27,
  },
  {
    id: "context",
    title: "Situation Context + tools",
    tip: "7 allowlisted tools — weather, terrain, hotspots, cadastre — every field provenance-labeled.",
    x: 875,
    y: 100,
    at: 0.4,
  },
  {
    id: "planning",
    title: "Tactical Planning",
    tip: "Facts and context fused into a versioned draft plan — evidence IDs verified by code.",
    x: 875,
    y: 360,
    at: 0.6,
  },
  {
    id: "critic",
    title: "Safety Critic",
    tip: "8 hard-coded safety rules attack the plan — pass, revise or block.",
    x: 625,
    y: 360,
    at: 0.73,
  },
  {
    id: "veto",
    title: "HUMAN VETO",
    tip: "Dispatch is structurally impossible until the commander approves.",
    x: 375,
    y: 360,
    at: 0.86,
    veto: true,
  },
  {
    id: "dispatch",
    title: "Dispatch + Piper TTS",
    tip: "One French voice order per unit, synthesized locally.",
    x: 125,
    y: 360,
    at: 0.96,
  },
];

const VERDICTS = [
  { label: "pass", color: "var(--blaze-ok)" },
  { label: "revise", color: "var(--blaze-warn)" },
  { label: "block", color: "var(--blaze-alert)" },
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
          <Eyebrow index="02" label="How it works" />
          <h2
            id="how-title"
            className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight lg:text-4xl"
            style={{ color: "var(--blaze-text)" }}
          >
            One radio message, end to end — on one machine.
          </h2>
          <p
            className="mt-5 max-w-2xl text-[15px] leading-relaxed"
            style={{ color: "var(--blaze-text-muted)" }}
          >
            Hover any stage for the one-line explanation.
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
                {node.title}
              </p>
              <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--blaze-text-muted)" }}>
                {node.tip}
              </p>
            </motion.li>
          ))}
        </motion.ol>

        <Reveal delay={0.15} className="mt-14">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <p
              className="text-[15px] font-semibold"
              style={{ color: "var(--blaze-text)" }}
            >
              The AI proposes.{" "}
              <span style={{ color: "var(--blaze-accent)" }}>
                The commander decides.
              </span>
            </p>
            <span
              className="flex items-center gap-2"
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

          {/* What comes out: the approved plan as per-unit voice radio orders. */}
          <p
            className="mx-auto mt-6 max-w-2xl text-center text-[14px] leading-relaxed"
            style={{ color: "var(--blaze-text-muted)" }}
          >
            Once approved, the plan becomes personalized voice radio messages
            per unit — generated locally with Piper and transmitted over the
            radio. Alpha 3 receives its fallback order, Bravo 2 its perimeter,
            Charlie 1 its verification mission — each unit hears only what
            concerns it, with acknowledgment of receipt.
          </p>
        </Reveal>

        {/* Demo-orientation teaser: what to do once you open /workflow. */}
        <Reveal delay={0.2} className="mx-auto mt-12 max-w-3xl">
          <div
            className="flex flex-col items-center gap-5 rounded-lg border px-6 py-6 text-center sm:flex-row sm:text-left"
            style={{ borderColor: "var(--blaze-border)" }}
          >
            <div
              aria-hidden
              className="relative shrink-0 rounded-lg border px-4 py-3"
              style={{
                background: "var(--blaze-bg-raised)",
                borderColor: "var(--blaze-border-strong)",
              }}
            >
              <span
                className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border font-mono text-[10px] font-bold"
                style={{
                  background: "var(--blaze-bg-overlay)",
                  borderColor: "var(--blaze-accent)",
                  color: "var(--blaze-accent)",
                }}
              >
                SC
              </span>
              <p
                className="font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{ color: "var(--blaze-text-faint)" }}
              >
                06
              </p>
              <p
                className="mt-1 text-[12.5px] font-semibold leading-tight"
                style={{ color: "var(--blaze-text)" }}
              >
                Safety Critic
              </p>
            </div>
            <div>
              <p
                className="text-[14px] leading-relaxed"
                style={{ color: "var(--blaze-text-muted)" }}
              >
                In the demo, click any agent to open its technical terminal and
                a plain-language account of what it received and decided.
              </p>
              <Link
                href="/workflow"
                className="mt-3 inline-block rounded-md border px-4 py-2 font-mono text-[12px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  borderColor: "var(--blaze-accent)",
                  color: "var(--blaze-accent)",
                }}
              >
                Open demo →
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
