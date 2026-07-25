// Landing v2 — Section 05 · PROOF, MEASURED.
// Only real measured numbers from our demo VM. No invented benchmarks, ever.

"use client";

import { motion, useReducedMotion } from "motion/react";
import { Eyebrow, Reveal, StatCard, staggerParent } from "./primitives";

const STATS = [
  { value: 183, suffix: " s", caption: "end-to-end (audio → voice order)" },
  { value: 63, prefix: "~", caption: "tokens/s on NVIDIA L40S" },
  { value: 0, caption: "cloud LLM calls" },
  { value: 5, caption: "Gemma agents · 7 allowlisted tools" },
  { value: 45, caption: "contract-valid events per run" },
  { value: 3, caption: "Piper voice orders generated" },
];

const BADGES = [
  { label: "Kaggle · Autonomous Agents", color: "var(--blaze-src-model)" },
  { label: "NVIDIA GPU Challenge", color: "var(--blaze-ok)" },
];

export default function ProofSection() {
  const reduced = useReducedMotion();

  return (
    <section
      id="proof"
      aria-labelledby="proof-title"
      className="scroll-mt-20 py-24 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal>
          <Eyebrow index="05" label="Proof, measured" />
          <h2
            id="proof-title"
            className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight lg:text-5xl"
            style={{ color: "var(--blaze-text)" }}
          >
            Real runs, real numbers — nothing else.
          </h2>
        </Reveal>

        <motion.div
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerParent}
          initial={reduced ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {STATS.map((stat) => (
            <StatCard
              key={stat.caption}
              value={stat.value}
              prefix={stat.prefix}
              suffix={stat.suffix}
              caption={stat.caption}
            />
          ))}
        </motion.div>

        <Reveal delay={0.1} className="mt-10">
          <p
            className="font-mono text-[11px] uppercase tracking-[0.16em]"
            style={{ color: "var(--blaze-text-faint)" }}
          >
            vLLM · google/gemma-4-E4B-it · measured on our demo VM — no
            invented benchmarks, ever.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {BADGES.map((badge) => (
              <span
                key={badge.label}
                className="rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]"
                style={{ borderColor: "var(--blaze-border-strong)", color: badge.color }}
              >
                {badge.label}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
