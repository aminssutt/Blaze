// Landing v2 — Section 03 · FIVE AGENTS, ONE DEPLOYMENT.
// Five numbered cards in stagger; each carries its REAL deterministic
// guardrail (from docs/KAGGLE_WRITEUP.md §5) in an amber inset.

"use client";

import { motion, useReducedMotion } from "motion/react";
import { Eyebrow, Reveal, fadeUp, staggerParent } from "./primitives";

const AGENTS = [
  {
    id: "radio_intelligence",
    name: "Radio Intelligence",
    mission: "Turns raw French radio transcripts into structured operational events.",
    io: "transcript → RadioEvent[]",
    guardrail:
      "Evidence must quote the transcript — invented evidence caps confidence at 0.3.",
  },
  {
    id: "situation_context",
    name: "Situation Context",
    mission: "Assembles one provenance-labeled picture of the incident area.",
    io: "tool results → SituationSnapshot",
    guardrail:
      "Provenance rewritten from real tool results — the model cannot claim cached data is live.",
  },
  {
    id: "tactical_planning",
    name: "Tactical Planning",
    mission: "Correlates radio events with territorial context into a versioned draft plan.",
    io: "RadioEvent[] + snapshot → DraftTacticalPlan",
    guardrail:
      "Invented evidence IDs are stripped; versions are code-generated, never model-claimed.",
  },
  {
    id: "safety_critic",
    name: "Safety Critic",
    mission: "Adversarially attacks the draft plan before any human sees it.",
    io: "DraftTacticalPlan → SafetyReview",
    guardrail:
      "8 hard-coded safety rules override the LLM — a mechanical fail can never be talked away.",
  },
  {
    id: "dispatch",
    name: "Dispatch",
    mission: "Converts the approved plan into one concise voice order per unit.",
    io: "approved plan → DispatchInstruction[]",
    guardrail:
      "Refuses to run without an approve decision; closed location vocabulary blocks invented routes.",
  },
];

export default function AgentsSection() {
  const reduced = useReducedMotion();

  return (
    <section
      id="agents"
      aria-labelledby="agents-title"
      className="scroll-mt-20 py-24 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal>
          <Eyebrow index="03" label="Five agents, one deployment" />
          <h2
            id="agents-title"
            className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight lg:text-5xl"
            style={{ color: "var(--blaze-text)" }}
          >
            Five Gemma specialists share one local vLLM — each wrapped in
            deterministic guardrails.
          </h2>
          <p
            className="mt-6 max-w-2xl text-[16px] leading-relaxed"
            style={{ color: "var(--blaze-text-muted)" }}
          >
            Prompts reduce error rates. Code bounds them. Every agent pairs its
            prompt with post-LLM validation that cannot be talked out of.
          </p>
        </Reveal>

        <motion.div
          className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          variants={staggerParent}
          initial={reduced ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {AGENTS.map((agent, index) => (
            <motion.article
              key={agent.id}
              variants={fadeUp}
              className="flex flex-col rounded-lg border p-5"
              style={{
                borderColor: "var(--blaze-border)",
                background: "var(--blaze-bg-raised)",
              }}
            >
              <p
                className="font-mono text-[10px] uppercase tracking-[0.2em]"
                style={{ color: "var(--blaze-accent)" }}
              >
                {String(index + 1).padStart(2, "0")} · {agent.id}
              </p>
              <h3
                className="mt-2 text-lg font-semibold"
                style={{ color: "var(--blaze-text)" }}
              >
                {agent.name}
              </h3>
              <p
                className="mt-1.5 text-[13.5px] leading-snug"
                style={{ color: "var(--blaze-text-muted)" }}
              >
                {agent.mission}
              </p>
              <p
                className="mt-3 rounded-sm border px-2 py-1 font-mono text-[11px]"
                style={{
                  borderColor: "var(--blaze-border)",
                  color: "var(--blaze-text-faint)",
                }}
              >
                {agent.io}
              </p>
              <p
                className="mt-3 rounded-sm border-l-2 py-1.5 pl-3 text-[12.5px] leading-snug"
                style={{
                  borderColor: "var(--blaze-accent)",
                  background: "rgba(245, 158, 11, 0.06)",
                  color: "var(--blaze-text-muted)",
                }}
              >
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: "var(--blaze-accent)" }}
                >
                  guardrail ·{" "}
                </span>
                {agent.guardrail}
              </p>
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
