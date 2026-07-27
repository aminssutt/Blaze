// Page /workflow — first-run "the nodes are clickable" hint.
//
// WHY IT EXISTS — the graph auto-plays on arrival, so a first visitor watches
// nodes go working → done and never discovers that a node OPENS: its terminal,
// its decision, the evidence it quoted. The cards were <button>s with nothing
// on screen saying so.
//
// CONTRACT — this is a one-shot coach mark, never a tutorial. It is shown only
// while the visitor has never opened a node ("seen" persisted in localStorage
// by the page), it says one short sentence, and it disappears for good the
// moment a node is opened (or dismissed). Reduced motion: appears/leaves with
// no transform, no fade loop.

"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import InspectGlyph from "./InspectGlyph";

export default function InspectHint({
  show,
  onDismiss,
  className = "",
}: {
  show: boolean;
  onDismiss: () => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          data-testid="workflow-inspect-hint"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={`z-20 flex items-center gap-2.5 rounded-md border border-accent bg-surface/95 px-3 py-2 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)] backdrop-blur-[2px] ${className}`}
        >
          <span
            aria-hidden
            className="grid size-6 shrink-0 place-items-center rounded-sm border border-accent bg-accent-dim/40 text-accent"
          >
            <InspectGlyph size={11} />
          </span>
          <p className="min-w-0 text-[12px] leading-tight text-foreground">
            <span className="font-semibold text-accent">Click any agent</span> to
            open its terminal
            <span className="hidden text-muted sm:inline">
              {" "}
              — what it received, what it decided, the evidence it quoted
            </span>
          </p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss hint"
            title="Dismiss"
            className="ml-1 shrink-0 cursor-pointer rounded-sm border border-edge px-1.5 py-0.5 font-mono text-[11px] leading-none text-faint outline-offset-2 transition-colors hover:border-edge-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
          >
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
