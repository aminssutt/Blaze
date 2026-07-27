// Tickets #40/#41 — tactical map.
//
// A real MapLibre GL map of the incident, rendered entirely from files that
// ship with the repo: the Etalab cadastre extruded in 3D, the OSM road network
// underneath, the FIRMS hotspot as a heat plume, the seeded scenario roads with
// what the radio said about them, and the engines wherever the field last
// reported them.
//
// PRODUCT INVARIANT #5 — nothing leaves the machine. There is no tile server,
// no sprite and no glyph endpoint in the style (see mapLayers.ts): every pixel
// comes from a same-origin static asset under `public/data/`.
//
// PROVENANCE — an engine only ever moves to a location the field reported over
// the radio (RadioEvent.location_reference resolved against known road/resource
// geometry) and drags a dashed trail behind it. The exclusion perimeter is rung
// by the audio-5 confirmation and sized by the sr-hazmat-perimeter safety rule.
// The fire, the wind and the buildings are cached public data, badged as such.

"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useIncidentState } from "@/lib/session";
import { useScenario } from "@/lib/useScenario";
import { Chip, Panel, SourceBadge } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";
import MapLegend from "./MapLegend";
import { buildTacticalModel } from "./tacticalModel";
import { useMapGeoData } from "./useMapGeoData";

// MapLibre needs a DOM and weighs ~800 kB: it is never part of the server
// render nor of the first client chunk.
const TacticalMapCanvas = dynamic(() => import("./TacticalMapCanvas"), {
  ssr: false,
  loading: () => (
    <div
      className="grid h-full w-full place-items-center rounded-xl border border-edge font-mono text-[11px] text-faint"
      style={{ background: "var(--blaze-bg)" }}
    >
      loading map engine…
    </div>
  ),
});

/** First conflict the snapshot raised about the wind, if any. */
function windConflictOf(conflicts: string[] | undefined): string | null {
  const hit = (conflicts ?? []).find((c) => /wind|vent/i.test(c));
  return hit ? hit.charAt(0).toLowerCase() + hit.slice(1) : null;
}

export default function TacticalMap({ className }: PanelComponentProps) {
  const { snapshot, radioEvents, incidentLocation, plan } = useIncidentState();
  const { units, roads, resources } = useScenario();
  const { cadastre, osm, hazmatRadiusM } = useMapGeoData();

  const model = useMemo(() => {
    if (!roads || !units || !resources) return null;
    return buildTacticalModel({
      units: units.units,
      roads: roads.roads,
      resources: resources.resources,
      radioEvents,
      snapshot,
      plan,
      hazmatRadiusM,
    });
  }, [roads, units, resources, radioEvents, snapshot, plan, hazmatRadiusM]);

  const hotspot = model?.fire.features[0]?.properties;
  const roadStates = model?.roads.features.map((f) => f.properties) ?? [];

  return (
    <Panel
      className={className}
      id="tactical-map"
      title="Tactical map"
      subtitle={
        incidentLocation
          ? `${incidentLocation.label ?? "zone"} · positions as reported over the radio`
          : "positions as reported over the radio"
      }
      right={
        <>
          {model && model.reportedHops > 0 && (
            <Chip label="radio moves" value={model.reportedHops} tone="accent" />
          )}
          {hotspot && (
            <Chip
              label="hotspot"
              value={`${hotspot.frp_mw} MW`}
              tone="alert"
              title="Fire Radiative Power reported by NASA FIRMS (cached_public)"
            />
          )}
          {model?.wind && (
            <Chip
              label="wind"
              value={`${model.wind.speedKmh ?? "?"} km/h · ${Math.round(model.wind.fromDeg)}°`}
              tone="info"
              title="Cached open-meteo forecast: speed and the direction the wind blows from"
            />
          )}
          {cadastre && cadastre.features.length > 0 && (
            <Chip
              label="buildings"
              value={cadastre.features.length.toLocaleString("en-GB")}
              title="Etalab cadastre clipped to the incident box (cached_public), every footprint extruded"
            />
          )}
          <SourceBadge source="seeded_demo" sourceName="scenario geometry" />
        </>
      }
      live={model !== null && radioEvents.length > 0}
      empty={model === null}
      emptyLabel="loading map…"
      emptyHint="seeded scenario geometry + cadastre + engine positions"
      bodyClassName="flex min-h-0 flex-col gap-2"
    >
      {model && (
        <>
          {/* min-h-0, NOT a pixel floor: with a floor the map refused to
              shrink, the legend was pushed past the bottom of the panel body
              and its provenance caption got clipped mid-sentence. The map is
              the elastic part; the legend always keeps its two lines. */}
          <div className="min-h-0 flex-1">
            <TacticalMapCanvas model={model} cadastre={cadastre} osm={osm} />
          </div>
          <MapLegend
            buildingCount={cadastre?.features.length ?? 0}
            hasFire={model.fire.features.length > 0}
            exclusionRadiusM={model.exclusionRadiusM}
            hasKeptRoute={roadStates.some(
              (p) => p.plan === "kept" || p.plan === "split",
            )}
            hasDiscardedRoute={roadStates.some(
              (p) => p.plan === "discarded" || p.plan === "split",
            )}
            hasCorrectedRoad={roadStates.some((p) => p.state === "corrected")}
            hasTrail={model.trails.features.length > 0}
            hasWind={model.windAxis.features.length > 0}
            windConflict={windConflictOf(snapshot?.conflicts)}
          />
        </>
      )}
    </Panel>
  );
}
