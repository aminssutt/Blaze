"use client";

/**
 * BLAZE control room — the single desktop view (ticket #38).
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
import { useSessionControls } from "@/lib/session";
import HeaderBar from "@/components/HeaderBar";
import PlayerBar from "@/components/PlayerBar";
import SystemBanners from "@/components/banners/SystemBanners";
import DemoControls from "@/components/controls/DemoControls";
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

export default function Home() {
  const controls = useSessionControls();

  // Arm the player on mount: loads + validates the mock stream (paused at
  // event 0) so the jump index and totals are ready before the first Play.
  useEffect(() => {
    controls.start();
  }, [controls]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden p-2 xl:h-screen xl:overflow-hidden">
      {/* region 1 */}
      <HeaderBar />

      {/* zero height until a fallback/error is reduced (#51) */}
      <SystemBanners />

      {/* demo row: #51 controls + the ticket #39 player bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-edge bg-surface px-3 py-1.5">
        <DemoControls />
        <div className="ml-auto">
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
          <RadioTimeline className="xl:flex-1" />
          <RadioEventCards className="xl:flex-1" />
        </div>

        {/* centre — the dominant tactical picture and the plan it drives */}
        <div className={COLUMN}>
          <TacticalMap className="xl:flex-[3]" />
          <TacticalPlanPanel className="xl:flex-[2]" />
        </div>

        {/* right — the three on-stage moments, top to bottom */}
        <div className={COLUMN}>
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
