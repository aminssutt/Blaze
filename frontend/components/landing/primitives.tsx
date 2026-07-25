// Landing v2 shared motion primitives — Astyr-grade section grammar.
//
// Every section uses the same vocabulary: a numbered mono eyebrow, a fade+y
// reveal on scroll (whileInView, once), staggered children, and count-up
// stat values. All of it degrades to static content under
// prefers-reduced-motion.

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  animate,
  motion,
  useInView,
  useReducedMotion,
  type Variants,
} from "motion/react";

export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

/** Numbered mono eyebrow — « 01 · THE PROBLEM ». */
export function Eyebrow({ index, label }: { index: string; label: string }) {
  return (
    <p
      className="font-mono text-[11px] uppercase tracking-[0.24em]"
      style={{ color: "var(--blaze-accent)" }}
    >
      {index} · {label}
    </p>
  );
}

/** Fade + translate-y reveal when the element scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.65, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Number that counts up from 0 when scrolled into view. */
export function CountUp({
  value,
  prefix = "",
  suffix = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView || reduced) return;
    const controls = animate(0, value, {
      duration: 1.5,
      ease: EASE,
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, reduced, value]);

  return (
    <span ref={ref}>
      {prefix}
      {reduced ? value : display}
      {suffix}
    </span>
  );
}

/** Astyr-style stat card: big mono number on top, caption below. */
export function StatCard({
  value,
  prefix,
  suffix,
  caption,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  caption: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      className="rounded-lg border p-5"
      style={{
        borderColor: "var(--blaze-border)",
        background: "var(--blaze-bg-raised)",
      }}
    >
      <p
        className="font-mono text-4xl font-semibold tracking-tight lg:text-5xl"
        style={{ color: "var(--blaze-text)" }}
      >
        <CountUp value={value} prefix={prefix} suffix={suffix} />
      </p>
      <p
        className="mt-2 text-[13px] leading-snug"
        style={{ color: "var(--blaze-text-muted)" }}
      >
        {caption}
      </p>
    </motion.div>
  );
}
