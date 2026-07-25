"use client";

/**
 * BLAZE control room — the expert view (ticket #38, moved here by #110,
 * simplified to a button grid by product/expert-buttons).
 *
 * ROUTES — / is the landing (#111), /demo is the guided cinematic demo
 * (#110, links here as « Expert view »), /expert is this full control room
 * (live-wired by #114).
 *
 * PURE CONSULTATION VIEW: this page carries NO demo controls. The replay or
 * live session is driven from /workflow; both pages read the same shared
 * session store, so whatever runs there is displayed here.
 *
 * SHAPE — one screen, radically simple:
 *   HeaderBar + OpsNav   unchanged (logo/BLAZE, incident, status chip, tabs)
 *   SystemBanners        0 or auto — fallback / error strip
 *   3×3 grid             NINE large buttons, ONE title each, nothing inline
 *   ExpertSectionOverlay clicking a button mounts the matching EXISTING
 *                        panel in large over the page (X / Esc / click-outside
 *                        to close — monitor/NodeDetailOverlay pattern)
 *
 * Buttons carry only their title, plus at most a discreet counter (« 6 events »)
 * and a small colored dot once their section holds data; a section still empty
 * shows its title greyed, and clicking it opens the overlay where the panel's
 * existing one-line empty hint explains what will appear there. The shared
 * store feeds everything exactly as before — this page owns placement only.
 */

import { useState } from "react";
import { useIncidentState } from "@/lib/session";
import OpsNav from "@/components/ops/OpsNav";
import HeaderBar from "@/components/HeaderBar";
import SystemBanners from "@/components/banners/SystemBanners";
import ExpertSectionOverlay, {
  EXPERT_SECTIONS,
  type ExpertSectionId,
} from "@/components/expert/ExpertSectionOverlay";

/**
 * Page-scoped readability overrides — the expert view is a consultation
 * screen read from a distance, so the smallest utility sizes used inside the
 * shared panels (mounted here inside the overlay) are raised without touching
 * the shared files, which /workflow keeps at its denser sizing.
 */
const READABILITY_CSS = `
.expert-readable .text-\\[9px\\]  { font-size: 11px; }
.expert-readable .text-\\[10px\\] { font-size: 12px; }
.expert-readable .text-\\[11px\\] { font-size: 13px; }
.expert-readable .blaze-scroll   { padding: 0.625rem 0.875rem; }
`;

/** What one big button knows about its section: has data? which counter? */
interface SectionPulse {
  active: boolean;
  /** Discreet counter under the title (« 6 events ») — omitted when empty. */
  count?: string;
  /** Decision awaited — the button becomes the visual call to action. */
  urgent?: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function Home() {
  const state = useIncidentState();
  const [openSection, setOpenSection] = useState<ExpertSectionId | null>(null);

  const decisionPending = state.approvalRequested && !state.approval;

  // Derived per-section liveness — same store fields the panels themselves read.
  const pulses: Record<ExpertSectionId, SectionPulse> = {
    radio: {
      active: state.transcripts.length > 0 || state.audios.length > 0,
      count:
        state.transcripts.length > 0
          ? plural(state.transcripts.length, "transmission")
          : undefined,
    },
    events: {
      active: state.radioEvents.length > 0,
      count:
        state.radioEvents.length > 0
          ? plural(state.radioEvents.length, "event")
          : undefined,
    },
    map: { active: state.snapshot !== null || state.incidentLocation !== null },
    synthesis: { active: state.snapshot !== null },
    trace: {
      active: state.agentRuns.length > 0 || state.toolCalls.length > 0,
      count:
        state.toolCalls.length > 0
          ? plural(state.toolCalls.length, "tool call")
          : undefined,
    },
    plan: {
      active: state.plans.length > 0,
      count:
        state.plans.length > 0
          ? plural(state.plans.length, "version")
          : undefined,
    },
    safety: {
      active: state.safetyReviews.length > 0,
      count:
        state.safetyReviews.length > 0
          ? plural(state.safetyReviews.length, "review")
          : undefined,
    },
    decision: {
      active: state.approvalRequested || state.approval !== null,
      count: state.approval
        ? state.approval.decision === "approve"
          ? "approved"
          : "rejected"
        : decisionPending
          ? "awaiting decision"
          : undefined,
      urgent: decisionPending,
    },
    dispatch: {
      active: state.dispatches.length > 0,
      count:
        state.dispatches.length > 0
          ? plural(state.dispatches.length, "order")
          : undefined,
    },
  };

  return (
    <div className="expert-readable flex min-h-0 flex-1 flex-col gap-2.5 overflow-x-hidden p-2.5 xl:h-screen xl:flex-none xl:overflow-hidden">
      <style>{READABILITY_CSS}</style>

      {/* operator tabs (Essentiel / Intervention / Système) */}
      <OpsNav />

      {/* region 1 — BLAZE wordmark, incident identity, status chip */}
      <HeaderBar />

      {/* zero height until a fallback/error is reduced (#51) */}
      <SystemBanners />

      {/* the whole body: NINE large title-only buttons, 3×3 at lg and up */}
      <main
        className="grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:min-h-0"
        aria-label="Sections de la salle de commandement"
      >
        {EXPERT_SECTIONS.map((section) => {
          const pulse = pulses[section.id];
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setOpenSection(section.id)}
              className={`relative flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border px-6 transition-colors ${
                pulse.urgent
                  ? "blaze-cta-pulse border-accent bg-accent-dim/15 hover:bg-accent-dim/25"
                  : "border-edge bg-surface hover:border-edge-strong hover:bg-overlay"
              }`}
            >
              {/* discreet liveness dot — only once the section holds data */}
              {pulse.active && (
                <span
                  aria-hidden
                  className={`absolute right-3.5 top-3.5 size-2 rounded-full ${
                    pulse.urgent ? "bg-accent" : "bg-ok"
                  }`}
                />
              )}

              {/* THE title — the only content a button carries */}
              <span
                className={`text-center text-[22px] font-semibold leading-tight ${
                  pulse.active ? "text-foreground" : "text-faint"
                }`}
              >
                {section.title}
              </span>

              {/* optional discreet counter (« 6 events ») */}
              {pulse.count && (
                <span
                  className={`font-mono text-[11px] ${
                    pulse.urgent ? "text-accent" : "text-faint"
                  }`}
                >
                  {pulse.count}
                </span>
              )}
            </button>
          );
        })}
      </main>

      {/* clicking a button mounts the matching existing panel, in large */}
      <ExpertSectionOverlay
        sectionId={openSection}
        onClose={() => setOpenSection(null)}
      />
    </div>
  );
}
