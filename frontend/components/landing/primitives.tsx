// Landing shared motion primitives — one section grammar everywhere: a
// numbered mono eyebrow, a fade+y reveal on scroll (whileInView, once) and
// staggered children. All of it degrades to static content under
// prefers-reduced-motion.

"use client";

import { type ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";

export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

/** Numbered mono eyebrow — « 01 · WHY NOW ». */
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
