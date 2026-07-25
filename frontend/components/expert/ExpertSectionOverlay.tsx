// Page /expert — section overlay (product/expert-buttons).
//
// The expert view is a grid of large title-only buttons; clicking one raises
// this overlay, which mounts the matching EXISTING panel — reused as-is, in
// large — over the page (same pattern as monitor/NodeDetailOverlay: centered
// dialog, backdrop, X / Esc / click-outside to close). The shared session
// store keeps reducing events behind the backdrop; every mounted panel reads
// the store itself, so the overlay is always live and closing loses nothing.
//
// This file is LOCAL to /expert: it composes shared panels but modifies none.

"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import TacticalMap from "@/components/map/TacticalMap";
import RadioTimeline from "@/components/radio/RadioTimeline";
import RadioEventCards from "@/components/radio/RadioEventCards";
import AgentTracePanel from "@/components/trace/AgentTracePanel";
import SituationSnapshotPanel from "@/components/situation/SituationSnapshotPanel";
import TacticalPlanPanel from "@/components/plan/TacticalPlanPanel";
import SafetyCriticPanel from "@/components/safety/SafetyCriticPanel";
import ApprovalGate from "@/components/approval/ApprovalGate";
import DispatchPanel from "@/components/dispatch/DispatchPanel";

/* -------------------------------------------------------------------------- */
/* Section registry — one entry per big button of the /expert grid            */
/* -------------------------------------------------------------------------- */

export type ExpertSectionId =
  | "radio"
  | "events"
  | "map"
  | "synthesis"
  | "trace"
  | "plan"
  | "safety"
  | "decision"
  | "dispatch";

export interface ExpertSection {
  id: ExpertSectionId;
  title: string;
  /** One-line role, shown in the overlay header under the title. */
  role: string;
}

/** Grid order: sources → situation → decision, left to right, top to bottom. */
export const EXPERT_SECTIONS: readonly ExpertSection[] = [
  { id: "radio", title: "Radio feed", role: "raw radio transmissions, transcribed in arrival order" },
  { id: "events", title: "Structured events", role: "facts extracted from the radio traffic" },
  { id: "map", title: "Tactical map", role: "fire, units and zones on the operational picture" },
  { id: "synthesis", title: "Situation synthesis", role: "what the system currently understands" },
  { id: "trace", title: "Agent & tool trace", role: "every agent activation and tool call, in order" },
  { id: "plan", title: "Tactical plan", role: "the draft plan and its successive versions" },
  { id: "safety", title: "Safety review", role: "the safety critic's verdict on the plan" },
  { id: "decision", title: "Commander decision", role: "the human gate — approve or reject the plan" },
  { id: "dispatch", title: "Dispatch", role: "orders sent to the trucks once approved" },
] as const;

/** The existing panel behind one section — reused as-is, mounted in large. */
function SectionContent({ id }: { id: ExpertSectionId }) {
  const cls = "min-h-0 flex-1";
  switch (id) {
    case "radio":
      return <RadioTimeline className={cls} />;
    case "events":
      return <RadioEventCards className={cls} />;
    case "map":
      return <TacticalMap className={cls} />;
    case "synthesis":
      return <SituationSnapshotPanel className={cls} />;
    case "trace":
      return <AgentTracePanel className={cls} />;
    case "plan":
      return <TacticalPlanPanel className={cls} />;
    case "safety":
      return <SafetyCriticPanel className={cls} />;
    case "decision":
      return <ApprovalGate className={cls} />;
    case "dispatch":
      return <DispatchPanel className={cls} />;
  }
}

/* -------------------------------------------------------------------------- */
/* Overlay                                                                    */
/* -------------------------------------------------------------------------- */

export default function ExpertSectionOverlay({
  sectionId,
  onClose,
}: {
  sectionId: ExpertSectionId | null;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();

  // Esc closes — bound only while open.
  useEffect(() => {
    if (!sectionId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sectionId, onClose]);

  const section = sectionId
    ? EXPERT_SECTIONS.find((s) => s.id === sectionId)
    : undefined;

  return (
    <AnimatePresence>
      {section && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* backdrop — click-outside closes; the stream keeps living behind */}
          <button
            type="button"
            aria-label="Close section"
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[3px]"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={section.title}
            initial={reduce ? false : { opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="relative flex h-[86vh] max-h-[900px] w-full max-w-[1200px] flex-col overflow-hidden rounded-lg border border-edge-strong bg-background shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]"
          >
            {/* header */}
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-edge bg-surface px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold text-foreground">
                  {section.title}
                </h2>
                <p className="mt-0.5 truncate text-[12px] leading-snug text-muted">
                  {section.role}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid size-8 shrink-0 place-items-center rounded-md border border-edge bg-overlay font-mono text-[13px] text-muted transition-colors hover:border-edge-strong hover:text-foreground"
              >
                ✕
              </button>
            </header>

            {/* body — the existing panel, in large; it absorbs its own overflow */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
              <SectionContent id={section.id} />
            </div>

            {/* footer hint */}
            <footer className="flex shrink-0 items-center justify-end border-t border-edge bg-surface px-4 py-2">
              <span className="font-mono text-[10px] text-faint">
                esc / click outside to close
              </span>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
