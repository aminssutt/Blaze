"use client";

/**
 * BLAZE control room — /expert (ticket #38, moved here by #110, live-wired by
 * #114, reduced to the tactical map by product/expert-map).
 *
 * WHY THERE IS ONLY A MAP HERE. This page used to be a 3×3 grid of nine big
 * buttons, each raising one of the shared panels in an overlay. Eight of those
 * nine sections (radio feed, structured events, situation synthesis, agent
 * trace, tactical plan, safety review, commander decision, dispatch) are
 * already reachable from /workflow by clicking the matching pipeline node —
 * the grid was a second door onto the same rooms. The tactical map was the one
 * thing /workflow never showed. So /expert IS the tactical map now, at full
 * screen, where a 3D city block and eight labels can actually be read.
 *
 * PURE CONSULTATION VIEW: no replay controls live here. The replay (or the
 * live SSE session) is driven from /workflow; both pages read the SAME shared
 * incident store, so whatever runs there is what this map draws.
 *
 * SHAPE — one screen, no scrolling:
 *   OpsNav        operator tabs
 *   HeaderBar     incident identity, phase, local-inference pills
 *   SystemBanners zero height until a fallback/error is reduced (#51)
 *   TacticalMap   ALL the remaining height
 */

import OpsNav from "@/components/ops/OpsNav";
import HeaderBar from "@/components/HeaderBar";
import SystemBanners from "@/components/banners/SystemBanners";
import TacticalMap from "@/components/map/TacticalMap";

export default function ExpertPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden p-2 xl:h-screen xl:flex-none xl:overflow-hidden">
      {/* operator tabs */}
      <OpsNav />

      {/* incident identity, state-machine phase, local inference stack */}
      <HeaderBar />

      {/* zero height until a fallback/error is reduced (#51) */}
      <SystemBanners />

      {/* the whole body: the map, nothing else, no click required */}
      <main
        className="flex min-h-[520px] flex-col xl:min-h-0 xl:flex-1"
        aria-label="Tactical map"
      >
        <TacticalMap className="min-h-0 flex-1" />
      </main>
    </div>
  );
}
