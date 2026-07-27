// Landing hero — the thesis on the left, the product in your hand on the right.
//
// The right column is a working radio (WalkieTalkie): press it and a real
// scenario call from the fixture manifest plays, transcribing live. That puts
// something true about BLAZE on screen before the first scroll, and it fills
// the half of the fold the old text-only hero left empty.
//
// The French radio marquee behind everything stays — it is the page's most
// authentic texture. Every string the visitor reads is English; only the radio
// traffic itself is French, because that is what the fireground sounds like.

"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import WalkieTalkie from "./WalkieTalkie";

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
    <header className="relative overflow-hidden">
      {/* ambient radio traffic, barely-there texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex flex-col justify-between py-8 opacity-[0.07]"
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

      <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-6 pb-12 pt-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-6 lg:px-10 lg:pb-14 lg:pt-11">
        {/* ---------------------------------------------------------------- */}
        {/* Thesis                                                           */}
        {/* ---------------------------------------------------------------- */}
        <div>
          <motion.h1
            className="text-[2.6rem] font-bold leading-[1.03] tracking-tight lg:text-[3.35rem] xl:text-[3.7rem]"
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
            className="mt-5 max-w-lg text-[17px] leading-relaxed"
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
            className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3"
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

        {/* ---------------------------------------------------------------- */}
        {/* The product, in hand                                             */}
        {/* ---------------------------------------------------------------- */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <WalkieTalkie />
        </motion.div>
      </div>
    </header>
  );
}
