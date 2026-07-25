// Landing v3 hero — the thesis in one screen: wordmark, one phrase, one
// two-line subtitle, one CTA. Ambient radio texture kept, barely there.

"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

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
    <header className="relative min-h-[72vh] overflow-hidden">
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

      <div className="relative z-10 mx-auto flex min-h-[72vh] max-w-6xl flex-col justify-center px-6 pb-12 pt-16 lg:px-10">
        <motion.h1
          className="max-w-4xl text-5xl font-bold leading-[1.02] tracking-tight lg:text-7xl"
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
          Firefighters already describe the fire over the radio. Five local
          Gemma agents structure every report, stress-test a tactical plan —
          and wait for the commander before any order goes out.
        </motion.p>

        <motion.div
          className="mt-8 flex flex-wrap items-center gap-4"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
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
          <span
            className="font-mono text-[11px] uppercase tracking-[0.18em]"
            style={{ color: "var(--blaze-text-faint)" }}
          >
            100% local · 0 cloud LLM calls
          </span>
        </motion.div>
      </div>
    </header>
  );
}
