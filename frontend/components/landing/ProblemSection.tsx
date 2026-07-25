// Landing v2 — Section 01 · THE PROBLEM.
// Short narrative + four count-up stat cards, all from the real demo scenario.

"use client";

import { motion, useReducedMotion } from "motion/react";
import { Eyebrow, Reveal, StatCard, staggerParent } from "./primitives";

const STATS = [
  { value: 5, caption: "voice reports" },
  { value: 12, suffix: "+", caption: "structured facts extracted" },
  { value: 1, caption: "correction that silently invalidates the plan" },
  { value: 0, caption: "network required" },
];

export default function ProblemSection() {
  const reduced = useReducedMotion();

  return (
    <section
      id="problem"
      aria-labelledby="problem-title"
      className="scroll-mt-20 py-24 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal>
          <Eyebrow index="01" label="The problem" />
          <h2
            id="problem-title"
            className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight lg:text-5xl"
            style={{ color: "var(--blaze-text)" }}
          >
            When a wildfire spreads, the radio never stops — and correlation is
            the slow part.
          </h2>
          <p
            className="mt-6 max-w-2xl text-[16px] leading-relaxed"
            style={{ color: "var(--blaze-text-muted)" }}
          >
            The command post correlates fragmented voice messages in its head:
            corrections, contradictions, wind shifts — under stress, and often
            with no network at all. One missed correction, and the plan on the
            table is already wrong.
          </p>
        </Reveal>

        <motion.div
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          variants={staggerParent}
          initial={reduced ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {STATS.map((stat) => (
            <StatCard
              key={stat.caption}
              value={stat.value}
              suffix={stat.suffix}
              caption={stat.caption}
            />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
