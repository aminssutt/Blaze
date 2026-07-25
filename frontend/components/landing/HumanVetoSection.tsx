// Landing v2 — Section 04 · THE HUMAN VETO. Spotlight block.
// Three pass/revise/block pills animate in sequence (6 s loop), then the real
// story of the Safety Critic blocking our own first live runs.

"use client";

import { motion, useReducedMotion } from "motion/react";
import { Eyebrow, Reveal } from "./primitives";

const CYCLE_S = 6;

const VERDICTS = [
  { label: "pass", color: "var(--blaze-ok)", at: 0 },
  { label: "revise", color: "var(--blaze-warn)", at: 1 / 3 },
  { label: "block", color: "var(--blaze-alert)", at: 2 / 3 },
];

function verdictTimes(at: number): number[] {
  return [0, at, Math.min(at + 0.05, 0.99), Math.min(at + 0.3, 0.995), 1];
}

export default function HumanVetoSection() {
  const reduced = useReducedMotion();

  return (
    <section
      id="human-veto"
      aria-labelledby="veto-title"
      className="scroll-mt-20 py-24 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal>
          <div
            className="rounded-xl border px-6 py-14 text-center lg:px-16 lg:py-20"
            style={{
              borderColor: "var(--blaze-accent-dim)",
              background:
                "linear-gradient(180deg, rgba(245, 158, 11, 0.05), rgba(17, 20, 26, 0.6))",
            }}
          >
            <Eyebrow index="04" label="The human veto" />
            <h2
              id="veto-title"
              className="mx-auto mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight lg:text-5xl"
              style={{ color: "var(--blaze-text)" }}
            >
              The AI proposes.{" "}
              <span style={{ color: "var(--blaze-accent)" }}>
                The commander decides.
              </span>
            </h2>

            {/* pass / revise / block cycle */}
            <div
              className="mt-10 flex items-center justify-center gap-3"
              aria-label="Safety review verdicts: pass, revise, block"
            >
              {VERDICTS.map((verdict) => (
                <motion.span
                  key={verdict.label}
                  className="rounded-full border px-4 py-1.5 font-mono text-[12px] uppercase tracking-[0.16em]"
                  style={{ borderColor: verdict.color, color: verdict.color }}
                  animate={
                    reduced
                      ? { opacity: 1 }
                      : { opacity: [0.3, 0.3, 1, 1, 0.3], scale: [1, 1, 1.06, 1.06, 1] }
                  }
                  transition={{
                    duration: CYCLE_S,
                    times: verdictTimes(verdict.at),
                    repeat: Infinity,
                  }}
                >
                  {verdict.label}
                </motion.span>
              ))}
            </div>

            <p
              className="mx-auto mt-10 max-w-2xl text-[15px] leading-relaxed"
              style={{ color: "var(--blaze-text-muted)" }}
            >
              In our first live runs, the Safety Critic blocked the model&apos;s
              plans — no retreat route for an engaged unit. We didn&apos;t
              soften the rule; we taught the planner. After two bounded
              revisions, remaining objections escalate to the commander — the
              critic informs, never commands.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
