"use client";

/**
 * BLAZE control room — the expert view (ticket #38, moved here by #110).
 *
 * ROUTES — / is the landing (#111), /demo is the guided cinematic demo
 * (#110, links here as « Expert view »), /expert is this full control room
 * (live-wired by #114).
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
 *   demo row         auto      — DemoControls + the ticket #39 PlayerBar
 *   main             1fr       — 3 columns, 26fr / 44fr / 30fr
 *   evidence rail    13.5rem   — trace + synthèse + métriques
 *
 * LAYOUT CONTRACT for tickets #40–#51: this file owns the placement and the
 * vertical share of every panel (the `flex-*` classes below) and NOTHING else.
 * Every panel lives in its own file, owned by exactly one ticket; putting a
 * panel's logic here — or its placement in the panel file — would break the
 * isolation that makes eleven agents working in parallel safe.
 */

import { useEffect } from "react";
import { useIncidentState, useSessionControls } from "@/lib/session";
import HeaderBar from "@/components/HeaderBar";
import PlayerBar from "@/components/PlayerBar";
import SystemBanners from "@/components/banners/SystemBanners";
import DemoControls from "@/components/controls/DemoControls";
import StreamModeToggle from "@/components/controls/StreamModeToggle";
import TacticalMap from "@/components/map/TacticalMap";
import RadioTimeline from "@/components/radio/RadioTimeline";
import RadioEventCards from "@/components/radio/RadioEventCards";
import AgentTracePanel from "@/components/trace/AgentTracePanel";
import SituationSnapshotPanel from "@/components/situation/SituationSnapshotPanel";
import TacticalPlanPanel from "@/components/plan/TacticalPlanPanel";
import SafetyCriticPanel from "@/components/safety/SafetyCriticPanel";
import ApprovalGate from "@/components/approval/ApprovalGate";
import DispatchPanel from "@/components/dispatch/DispatchPanel";
import NvidiaMetricsPanel from "@/components/metrics/NvidiaMetricsPanel";

/** Stacked below xl, a column of the single-screen grid at xl and up. */
const COLUMN = "flex min-w-0 flex-col gap-2 xl:min-h-0";

/**
 * Ticket #121 — zone banner: a discreet one-line header naming the business
 * zone a column belongs to, so any operator reads the room in order:
 * SOURCES → SITUATION → DÉCISION. Pure layout furniture (no store access),
 * so it lives here with the placement it annotates.
 */
function ZoneBanner({ label, tagline }: { label: string; tagline: string }) {
  return (
    <div className="flex min-w-0 shrink-0 items-baseline gap-1.5 rounded-sm border border-edge bg-surface px-2 py-1">
      <span className="whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
        {label}
      </span>
      <span className="min-w-0 truncate font-mono text-[10px] text-faint">
        — {tagline}
      </span>
    </div>
  );
}

export default function Home() {
  const controls = useSessionControls();
  // #121 — the DECISION column becomes the visual call to action while the
  // commander's decision is pending (approval.requested seen, none received).
  const { approvalRequested, approval } = useIncidentState();
  const decisionPending = approvalRequested && !approval;

  // Arm the player on mount: loads + validates the mock stream (paused at
  // event 0) so the jump index and totals are ready before the first Play.
  useEffect(() => {
    controls.start();
  }, [controls]);

  return (
    // `xl:flex-none` is load-bearing, do not drop it: this div is a flex item of
    // <body>, whose height is indefinite (`min-h-full`). With `flex-1` the basis
    // is `0%`, a percentage against an indefinite main size, which CSS resolves
    // to `content` — so `xl:h-screen` is ignored, the div grows to its content
    // and the whole page scrolls once real scenario data arrives. `flex-none`
    // restores `flex-basis: auto`, letting the 100vh height actually apply.
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden p-2 xl:h-screen xl:flex-none xl:overflow-hidden">
      {/* region 1 */}
      <HeaderBar />

      {/* zero height until a fallback/error is reduced (#51) */}
      <SystemBanners />

      {/* demo row: #51 controls + the ticket #39 player bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-edge bg-surface px-3 py-1.5">
        <DemoControls />
        <div className="ml-auto flex items-center gap-3">
          {/* ticket #54 — mock ↔ live source selector */}
          <StreamModeToggle />
          <PlayerBar />
        </div>
      </div>

      {/* main working area — takes every pixel the fixed rows leave */}
      <main
        className="flex flex-col gap-2 xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-[26fr_44fr_30fr]"
        aria-label="Régions de la salle de commandement"
      >
        {/* left — the radio stream becoming structured facts */}
        <div className={COLUMN}>
          <ZoneBanner label="📡 Sources" tagline="ce que le terrain rapporte" />
          <RadioTimeline className="xl:flex-1" />
          <RadioEventCards className="xl:flex-1" />
        </div>

        {/* centre — the dominant tactical picture and the plan it drives */}
        <div className={COLUMN}>
          <ZoneBanner
            label="🗺️ Situation"
            tagline="ce que le système comprend"
          />
          <TacticalMap className="xl:flex-[3]" />
          <TacticalPlanPanel className="xl:flex-[2]" />
        </div>

        {/* right — the three on-stage moments, top to bottom. #121: the whole
            commander zone carries a dim amber tint, escalating to a pulsing
            call-to-action glow while the commander's decision is pending. */}
        <div
          className={`${COLUMN} rounded-md border p-1.5 ${
            decisionPending
              ? "blaze-cta-pulse border-accent bg-accent-dim/15"
              : "border-accent-dim/60 bg-accent-dim/10"
          }`}
        >
          <ZoneBanner
            label="🎯 Décision"
            tagline="ce que le commandant valide"
          />
          <SafetyCriticPanel className="xl:flex-[3]" />
          <ApprovalGate className="xl:flex-[2]" />
          <DispatchPanel className="xl:flex-[3]" />
        </div>
      </main>

      {/* evidence rail — fixed height at xl, stacked below it */}
      <div className="flex shrink-0 flex-col gap-2 xl:grid xl:h-[13.5rem] xl:grid-cols-[44fr_30fr_26fr]">
        <AgentTracePanel />
        <SituationSnapshotPanel />
        <NvidiaMetricsPanel />
      </div>
    </div>
  );
}
