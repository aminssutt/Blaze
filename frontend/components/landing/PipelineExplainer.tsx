// Ticket #111 — the landing signature: the agentic pipeline, animated.
//
// A radio "transmission" pulse travels the chain Radio → STT → 5 Gemma agents
// → human gate → TTS dispatch, lighting each stage as it arrives, on an
// endless loop (the jury should get the whole story without scrolling or
// clicking). Pure motion/react on token colors; honors prefers-reduced-motion
// by rendering every stage lit and the pulse static.

"use client";

import { motion, useReducedMotion } from "motion/react";

/** One full pulse journey, in seconds. Stage i lights at STAGE_AT[i]. */
const LOOP_S = 12;
const STAGES = [
  {
    id: "radio",
    at: 0.5,
    eyebrow: "TERRAIN",
    title: "Radio du feu",
    detail: "« Alpha 3 au PC, fumée noire très dense près du hangar… »",
    color: "var(--blaze-src-human)",
  },
  {
    id: "stt",
    at: 2.2,
    eyebrow: "LOCAL STT",
    title: "faster-whisper",
    detail: "French speech → timestamped transcripts, fully offline",
    color: "var(--blaze-info)",
  },
  {
    id: "agents",
    at: 4.0,
    eyebrow: "5 GEMMA AGENTS",
    title: "Radio intel → context → plan → safety critic",
    detail: "vLLM-served: structured facts, provenance-tagged tools, versioned plans, adversarial review",
    color: "var(--blaze-src-model)",
  },
  {
    id: "human",
    at: 7.6,
    eyebrow: "HUMAN GATE",
    title: "Commander approval",
    detail: "Dispatch is provably inert until a human approves — invariant #1",
    color: "var(--blaze-accent)",
  },
  {
    id: "tts",
    at: 9.6,
    eyebrow: "PIPER TTS",
    title: "Per-unit radio orders",
    detail: "One French voice message per unit — simulated dispatch, zero real traffic",
    color: "var(--blaze-ok)",
  },
] as const;

const AGENT_CHIPS = [
  "radio_intelligence",
  "situation_context",
  "tactical_planning",
  "safety_critic",
  "dispatch",
];

/** Times (0-1 fractions of the loop) when a stage is "hot". */
function window01(atSeconds: number) {
  const start = atSeconds / LOOP_S;
  return [0, start, Math.min(start + 0.06, 1), Math.min(start + 0.22, 1), 1];
}

export default function PipelineExplainer() {
  const reduced = useReducedMotion();

  return (
    <div aria-label="How BLAZE works, from radio message to dispatched orders">
      {/* the rail the pulse travels */}
      <div className="relative">
        <div
          className="absolute left-0 right-0 top-4 hidden h-px lg:block"
          style={{ background: "var(--blaze-border-strong)" }}
          aria-hidden
        />
        {!reduced && (
          <motion.div
            aria-hidden
            className="absolute top-4 hidden h-px w-24 -translate-y-1/2 lg:block"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--blaze-accent-strong), transparent)",
              boxShadow: "0 0 18px 2px var(--blaze-accent-dim)",
            }}
            animate={{ left: ["-6%", "102%"] }}
            transition={{ duration: LOOP_S, ease: "linear", repeat: Infinity }}
          />
        )}

        <ol className="relative grid gap-3 lg:grid-cols-5 lg:gap-4">
          {STAGES.map((stage, index) => (
            <motion.li
              key={stage.id}
              className="rounded-md border p-3 lg:pt-7"
              style={{
                borderColor: "var(--blaze-border)",
                background: "var(--blaze-bg-raised)",
              }}
              animate={
                reduced
                  ? { opacity: 1 }
                  : {
                      opacity: [0.45, 0.45, 1, 1, 0.45],
                      borderColor: [
                        "var(--blaze-border)",
                        "var(--blaze-border)",
                        stage.color,
                        stage.color,
                        "var(--blaze-border)",
                      ],
                    }
              }
              transition={{
                duration: LOOP_S,
                times: [...window01(stage.at)],
                repeat: Infinity,
              }}
            >
              {/* node on the rail */}
              <span
                aria-hidden
                className="absolute -top-1 left-1/2 hidden size-2 -translate-x-1/2 rounded-full lg:block"
                style={{ background: stage.color }}
              />
              <p
                className="font-mono text-[10px] uppercase tracking-[0.18em]"
                style={{ color: stage.color }}
              >
                {String(index + 1).padStart(2, "0")} · {stage.eyebrow}
              </p>
              <h3
                className="mt-1 text-[15px] font-semibold leading-tight"
                style={{ color: "var(--blaze-text)" }}
              >
                {stage.title}
              </h3>
              <p
                className="mt-1 text-[12px] leading-snug"
                style={{ color: "var(--blaze-text-muted)" }}
              >
                {stage.detail}
              </p>

              {stage.id === "agents" && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {AGENT_CHIPS.map((agent, agentIndex) => (
                    <motion.span
                      key={agent}
                      className="rounded-sm border px-1.5 py-px font-mono text-[9px]"
                      style={{
                        borderColor: "var(--blaze-border)",
                        color: "var(--blaze-src-model)",
                      }}
                      animate={
                        reduced
                          ? { opacity: 1 }
                          : { opacity: [0.35, 0.35, 1, 1, 0.35] }
                      }
                      transition={{
                        duration: LOOP_S,
                        times: [
                          ...window01(stage.at + 0.4 + agentIndex * 0.5),
                        ],
                        repeat: Infinity,
                      }}
                    >
                      {agent}
                    </motion.span>
                  ))}
                </div>
              )}

              {stage.id === "human" && (
                <motion.p
                  className="mt-2 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
                  style={{
                    borderColor: "var(--blaze-accent-dim)",
                    color: "var(--blaze-accent)",
                  }}
                  animate={reduced ? {} : { opacity: [1, 1, 0, 0, 1, 1] }}
                  transition={{
                    duration: LOOP_S,
                    times: [0, stage.at / LOOP_S, (stage.at + 0.4) / LOOP_S, (stage.at + 2) / LOOP_S, (stage.at + 2.4) / LOOP_S, 1],
                    repeat: Infinity,
                  }}
                >
                  🔒 locked until approval
                </motion.p>
              )}
            </motion.li>
          ))}
        </ol>
      </div>
    </div>
  );
}
