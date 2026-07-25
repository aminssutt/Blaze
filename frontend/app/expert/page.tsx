"use client";

/**
 * BLAZE control room — the expert view (ticket #38, moved here by #110,
 * decluttered by product/expert-declutter).
 *
 * ROUTES — / is the landing (#111), /demo is the guided cinematic demo
 * (#110, links here as « Expert view »), /expert is this full control room
 * (live-wired by #114).
 *
 * PURE CONSULTATION VIEW: this page carries NO demo controls (no start /
 * reset / network-cut / next-run, no player bar, no stream-mode toggle).
 * The replay or live session is driven from /workflow; both pages read the
 * same shared session store, so whatever runs there is displayed here. When
 * the store is empty, every panel shows its explanatory empty state.
 *
 * ONE screen, targeted at 1920x1080: at xl and up the page itself never
 * scrolls in either direction (`xl:h-screen` + `xl:overflow-hidden`); every
 * panel absorbs its own overflow through the shared `<Panel>` primitive.
 * Below xl the same panels stack in one column and the page scrolls
 * vertically — there is never a horizontal scroll.
 *
 * ROWS at xl and up (a flex column, not a grid: `SystemBanners` renders
 * NOTHING while no banner exists, and a flex column costs exactly zero height
 * for an absent child — an explicit grid template would leave a dead row and
 * shift every panel below it):
 *   HeaderBar        auto      — region 1, full width
 *   SystemBanners    0 or auto — fallback / error strip
 *   main             1fr       — 3 columns, 26fr / 44fr / 30fr
 *   evidence rail    15.5rem   — trace + synthèse + événements radio
 *
 * READABILITY (`.expert-readable` + the scoped stylesheet below): the panels
 * are shared with /workflow's node overlays, so their files cannot be touched
 * from this ticket. Instead this page scopes CSS overrides under its root:
 * the critical 9/10/11px utility sizes are raised to 11/12/13px and the
 * shared panel body gains breathing room — on this page only.
 *
 * LAYOUT CONTRACT for tickets #40–#51: this file owns the placement and the
 * vertical share of every panel (the `flex-*` classes below) and NOTHING else.
 * Every panel lives in its own file, owned by exactly one ticket; putting a
 * panel's logic here — or its placement in the panel file — would break the
 * isolation that makes eleven agents working in parallel safe.
 */

import { useIncidentState } from "@/lib/session";
import OpsNav from "@/components/ops/OpsNav";
import HeaderBar from "@/components/HeaderBar";
import SystemBanners from "@/components/banners/SystemBanners";
import TacticalMap from "@/components/map/TacticalMap";
import UnitsBoard from "@/components/units/UnitsBoard";
import RadioTimeline from "@/components/radio/RadioTimeline";
import RadioEventCards from "@/components/radio/RadioEventCards";
import AgentTracePanel from "@/components/trace/AgentTracePanel";
import SituationSnapshotPanel from "@/components/situation/SituationSnapshotPanel";
import TacticalPlanPanel from "@/components/plan/TacticalPlanPanel";
import SafetyCriticPanel from "@/components/safety/SafetyCriticPanel";
import ApprovalGate from "@/components/approval/ApprovalGate";
import DispatchPanel from "@/components/dispatch/DispatchPanel";

/** Stacked below xl, a column of the single-screen grid at xl and up. */
const COLUMN = "flex min-w-0 flex-col gap-2.5 xl:min-h-0";

/**
 * Page-scoped readability overrides — the expert view is a consultation
 * screen read from a distance, so the smallest utility sizes used inside the
 * shared panels are raised here without touching the shared files (they are
 * also mounted by /workflow, which keeps its denser sizing). Selector
 * specificity (0,2,0) beats the Tailwind utilities (0,1,0), and relative
 * `leading-*` utilities keep working since they scale with font-size.
 */
const READABILITY_CSS = `
.expert-readable .text-\\[9px\\]  { font-size: 11px; }
.expert-readable .text-\\[10px\\] { font-size: 12px; }
.expert-readable .text-\\[11px\\] { font-size: 13px; }
.expert-readable .blaze-scroll   { padding: 0.625rem 0.875rem; }
`;

/**
 * Ticket #121 — zone banner: a discreet one-line header naming the business
 * zone a column belongs to, so any operator reads the room in order:
 * SOURCES → SITUATION → DÉCISION. Pure layout furniture (no store access),
 * so it lives here with the placement it annotates.
 */
function ZoneBanner({ label, tagline }: { label: string; tagline: string }) {
  return (
    <div className="flex min-w-0 shrink-0 items-baseline gap-2 rounded-full border border-edge bg-surface px-3.5 py-1.5">
      <span className="whitespace-nowrap text-[13px] font-semibold text-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-[13px] text-faint">— {tagline}</span>
    </div>
  );
}

export default function Home() {
  // #121 — the DECISION column becomes the visual call to action while the
  // commander's decision is pending (approval.requested seen, none received).
  const { approvalRequested, approval } = useIncidentState();
  const decisionPending = approvalRequested && !approval;

  return (
    // `xl:flex-none` is load-bearing, do not drop it: this div is a flex item of
    // <body>, whose height is indefinite (`min-h-full`). With `flex-1` the basis
    // is `0%`, a percentage against an indefinite main size, which CSS resolves
    // to `content` — so `xl:h-screen` is ignored, the div grows to its content
    // and the whole page scrolls once real scenario data arrives. `flex-none`
    // restores `flex-basis: auto`, letting the 100vh height actually apply.
    <div className="expert-readable flex min-h-0 flex-1 flex-col gap-2.5 overflow-x-hidden p-2.5 xl:h-screen xl:flex-none xl:overflow-hidden">
      <style>{READABILITY_CSS}</style>

      {/* operator tabs (Essentiel / Intervention / Système) */}
      <OpsNav />

      {/* region 1 — BLAZE wordmark, incident identity, status chip */}
      <HeaderBar />

      {/* zero height until a fallback/error is reduced (#51) */}
      <SystemBanners />

      {/* main working area — takes every pixel the fixed rows leave */}
      <main
        className="flex flex-col gap-2.5 xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-[26fr_44fr_30fr]"
        aria-label="Régions de la salle de commandement"
      >
        {/* left — the chief's engines, then the radio truth feeding them */}
        <div className={COLUMN}>
          <ZoneBanner label="Engines" tagline="what each truck is doing" />
          <UnitsBoard className="xl:flex-[3]" />
          <RadioTimeline className="xl:flex-[2]" />
        </div>

        {/* centre — the dominant tactical picture and the plan it drives */}
        <div className={COLUMN}>
          <ZoneBanner label="Situation" tagline="what the system understands" />
          <TacticalMap className="xl:flex-[3]" />
          <TacticalPlanPanel className="xl:flex-[2]" />
        </div>

        {/* right — the three on-stage moments, top to bottom. #121: the whole
            commander zone carries a dim amber tint, escalating to a pulsing
            call-to-action glow while the commander's decision is pending. */}
        <div
          className={`${COLUMN} rounded-md border p-2 ${
            decisionPending
              ? "blaze-cta-pulse border-accent bg-accent-dim/15"
              : "border-accent-dim/60 bg-accent-dim/10"
          }`}
        >
          <ZoneBanner label="Decision" tagline="what the commander approves" />
          <SafetyCriticPanel className="xl:flex-[3]" />
          <ApprovalGate className="xl:flex-[2]" />
          <DispatchPanel className="xl:flex-[3]" />
        </div>
      </main>

      {/* evidence rail — fixed height at xl, stacked below it; taller than the
          historical 13.5rem because the demo-control row above is gone.
          NVIDIA metrics intentionally absent: machine health lives in /system. */}
      <div className="flex shrink-0 flex-col gap-2.5 xl:grid xl:h-[15.5rem] xl:grid-cols-[38fr_32fr_30fr]">
        <AgentTracePanel />
        <SituationSnapshotPanel />
        <RadioEventCards />
      </div>
    </div>
  );
}
