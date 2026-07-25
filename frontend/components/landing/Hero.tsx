// Ticket #111 — landing hero: the thesis in one screen, radio-transmission
// voice (mono eyebrows, callsign texture) over the control-room tokens.

"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

const TRACK_BADGES = [
  { label: "Kaggle · Autonomous Agents", color: "var(--blaze-src-model)" },
  { label: "NVIDIA GPU Challenge", color: "var(--blaze-ok)" },
  { label: "100% local — 0 cloud LLM calls", color: "var(--blaze-accent)" },
];

/** Real scenario radio lines, used as ambient texture behind the hero. */
const RADIO_TEXTURE = [
  "ALPHA 3 → PC · fumée noire très dense près du hangar",
  "BRAVO 2 → PC · le vent vient de tourner vers le sud-est",
  "ALPHA 3 → PC · correction concernant la D17",
  "BRAVO 2 → PC · confirmation visuelle, bouteilles de gaz suspectées",
];

export default function Hero() {
  const reduced = useReducedMotion();

  return (
    <header className="relative min-h-[80vh] overflow-hidden">

      {/* ambient radio traffic, barely-there texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex flex-col justify-between py-6 opacity-[0.07]"
      >
        {RADIO_TEXTURE.map((line, i) => (
          <motion.p
            key={line}
            className="whitespace-nowrap font-mono text-sm uppercase tracking-[0.3em]"
            style={{ color: "var(--blaze-text)" }}
            animate={reduced ? {} : { x: i % 2 ? ["-15%", "0%"] : ["0%", "-15%"] }}
            transition={{ duration: 60, repeat: Infinity, repeatType: "mirror", ease: "linear" }}
          >
            {`${line} · `.repeat(6)}
          </motion.p>
        ))}
      </div>

      <div className="relative z-10 mx-auto flex min-h-[80vh] max-w-6xl flex-col justify-center px-6 pb-10 pt-14 lg:px-10">
        <div className="flex flex-wrap items-center gap-2">
          {TRACK_BADGES.map((badge) => (
            <span
              key={badge.label}
              className="rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]"
              style={{ borderColor: "var(--blaze-border-strong)", color: badge.color }}
            >
              {badge.label}
            </span>
          ))}
        </div>

        <motion.h1
          className="mt-8 max-w-4xl text-5xl font-bold leading-[1.02] tracking-tight lg:text-7xl"
          style={{ color: "var(--blaze-text)" }}
          initial={reduced ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          BLAZE
          <span className="block" style={{ color: "var(--blaze-accent-strong)" }}>
            turns radio chatter into command decisions.
          </span>
        </motion.h1>

        <motion.p
          className="mt-6 max-w-2xl text-lg leading-relaxed"
          style={{ color: "var(--blaze-text-muted)" }}
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          Firefighters already describe the battlefield every second — over the
          radio. BLAZE listens, structures every report with five local Gemma
          agents, drafts and stress-tests a tactical plan, then waits for a
          human commander before a single order goes out.
        </motion.p>

        <motion.p
          className="mt-5 font-mono text-[11px] uppercase tracking-[0.22em]"
          style={{ color: "var(--blaze-text-faint)" }}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          Wildfire response · Civil protection · Emergency operations
        </motion.p>

        <motion.div
          className="mt-8 flex flex-wrap items-center gap-4"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.35 }}
        >
          <Link
            href="/workflow"
            className="rounded-md border px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-[0.12em] transition-colors"
            style={{
              background: "var(--blaze-accent)",
              borderColor: "var(--blaze-accent)",
              color: "#140d02",
            }}
          >
            Open demo →
          </Link>
          <a
            href="#how-it-works"
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById("how-it-works")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="rounded-md border px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-[0.12em] transition-colors"
            style={{
              borderColor: "var(--blaze-border-strong)",
              color: "var(--blaze-text)",
            }}
          >
            See how it works ↓
          </a>
          <span className="font-mono text-[11px]" style={{ color: "var(--blaze-text-faint)" }}>
            live demo · 5 audios · expert control room inside
          </span>
        </motion.div>
      </div>
    </header>
  );
}
