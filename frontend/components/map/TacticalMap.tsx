// Tickets #40/#41 — tactical map, real implementation (was a stub).
//
// A dependency-free SVG projection of the seeded scenario geometry: roads,
// water point, hazard zone, vulnerable assets — and the engines. Each unit
// starts at its seeded position and MOVES to the last location it reported
// over the radio (RadioEvent.location_reference resolved against the known
// road/resource geometry), leaving a dashed trail. What the chief sees is
// exactly what the field reported — human_report provenance, nothing invented.

"use client";

import { useMemo } from "react";
import { useIncidentState } from "@/lib/session";
import { useScenario } from "@/lib/useScenario";
import type { LatLon, ScenarioRoad } from "@/lib/scenarioData";
import type { RadioEvent } from "@/lib/contracts";
import { Chip, Panel, SourceBadge } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* Projection                                                                 */
/* -------------------------------------------------------------------------- */

const VIEW_W = 100;
const VIEW_H = 64;

interface Projector {
  x: (p: LatLon) => number;
  y: (p: LatLon) => number;
}

function buildProjector(points: LatLon[]): Projector | null {
  if (points.length < 2) return null;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const padLat = (maxLat - minLat) * 0.12 || 0.01;
  const padLon = (maxLon - minLon) * 0.12 || 0.01;
  const lat0 = minLat - padLat;
  const lat1 = maxLat + padLat;
  const lon0 = minLon - padLon;
  const lon1 = maxLon + padLon;
  return {
    x: (p) => ((p.lon - lon0) / (lon1 - lon0)) * VIEW_W,
    // Lat grows north, SVG y grows down.
    y: (p) => VIEW_H - ((p.lat - lat0) / (lat1 - lat0)) * VIEW_H,
  };
}

/* -------------------------------------------------------------------------- */
/* Radio-reported positions                                                   */
/* -------------------------------------------------------------------------- */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function roadMidpoint(road: ScenarioRoad): LatLon | null {
  const g = road.geometry;
  return g.length > 0 ? g[Math.floor(g.length / 2)] : null;
}

/** Resolve a spoken location ("D17", "hangar", "point d'eau 2") to coords. */
function resolveLocation(
  reference: string,
  roads: ScenarioRoad[],
  namedPoints: { key: string; position: LatLon }[],
): LatLon | null {
  const ref = normalize(reference);
  if (!ref) return null;
  for (const point of namedPoints) {
    if (point.key && (ref.includes(point.key) || point.key.includes(ref))) {
      return point.position;
    }
  }
  for (const road of roads) {
    const keys = [normalize(road.road_id), normalize(road.name)];
    if (keys.some((k) => k && (ref.includes(k) || k.includes(ref)))) {
      return roadMidpoint(road);
    }
  }
  return null;
}

interface TrackUnit {
  unit_id: string;
  callsign: string;
  vehicle_type: string;
  position: LatLon | null;
}

interface UnitTrack {
  unitId: string;
  callsign: string;
  vehicleType: string;
  /** Seeded start, then every radio-reported hop, in report order. */
  path: LatLon[];
}

function buildTracks(
  units: TrackUnit[],
  radioEvents: RadioEvent[],
  roads: ScenarioRoad[],
  namedPoints: { key: string; position: LatLon }[],
): UnitTrack[] {
  const tracks = new Map<string, UnitTrack>();
  for (const unit of units) {
    if (!unit.position) continue;
    tracks.set(unit.unit_id, {
      unitId: unit.unit_id,
      callsign: unit.callsign,
      vehicleType: unit.vehicle_type,
      path: [unit.position],
    });
  }
  for (const event of radioEvents) {
    if (!event.unit_id || !event.location_reference) continue;
    const track = tracks.get(event.unit_id);
    if (!track) continue;
    const position = resolveLocation(event.location_reference, roads, namedPoints);
    if (!position) continue;
    const last = track.path[track.path.length - 1];
    if (last.lat !== position.lat || last.lon !== position.lon) track.path.push(position);
  }
  return [...tracks.values()];
}

/* -------------------------------------------------------------------------- */
/* Colors                                                                     */
/* -------------------------------------------------------------------------- */

const UNIT_COLOR: Record<string, string> = {
  CCF: "var(--blaze-accent)",
  light_vehicle: "var(--blaze-info)",
  command_post: "var(--blaze-text-muted)",
};

function roadStroke(status: string | undefined): { stroke: string; dash?: string } {
  if (status === "blocked") return { stroke: "var(--blaze-alert)", dash: "1.6 1.2" };
  if (status && status !== "open") return { stroke: "var(--blaze-warn)", dash: "2.4 1.2" };
  return { stroke: "var(--blaze-border-strong)" };
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function TacticalMap({ className }: PanelComponentProps) {
  const { snapshot, radioEvents, incidentLocation } = useIncidentState();
  const { units, roads, resources } = useScenario();

  const model = useMemo(() => {
    if (!roads || !units || !resources) return null;

    const namedPoints = resources.resources
      .filter((r) => r.position)
      .flatMap((r) => [
        { key: normalize(r.resource_id), position: r.position as LatLon },
        { key: normalize(r.name), position: r.position as LatLon },
      ]);

    const allPoints: LatLon[] = [
      ...roads.roads.flatMap((r) => r.geometry),
      ...resources.resources.flatMap((r) => (r.position ? [r.position] : [])),
      ...units.units.flatMap((u) => (u.position ? [u.position] : [])),
    ];
    const projector = buildProjector(allPoints);
    if (!projector) return null;

    // Live road status from the snapshot (falls back to the seeded status).
    const liveStatus = new Map<string, string>();
    for (const road of snapshot?.roads ?? []) {
      const id = typeof road.road_id === "string" ? road.road_id : null;
      const status = typeof road.status === "string" ? road.status : null;
      if (id && status) liveStatus.set(id, status);
    }

    const tracks = buildTracks(units.units, radioEvents, roads.roads, namedPoints);
    return { projector, liveStatus, tracks };
  }, [roads, units, resources, snapshot, radioEvents]);

  const reportedHops = model
    ? model.tracks.reduce((n, t) => n + t.path.length - 1, 0)
    : 0;

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
          {reportedHops > 0 && (
            <Chip label="radio moves" value={reportedHops} tone="accent" />
          )}
          <SourceBadge source="seeded_demo" sourceName="scenario geometry" />
        </>
      }
      live={model !== null && radioEvents.length > 0}
      empty={model === null}
      emptyLabel="loading map…"
      emptyHint="seeded scenario geometry + engine positions"
      bodyClassName="flex flex-col gap-2"
    >
      {model && roads && resources && (
        <>
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            role="img"
            aria-label="Tactical map: roads, assets and engine positions reported over the radio"
            className="w-full rounded-xl"
            style={{ background: "var(--blaze-bg)" }}
          >
            {/* Roads */}
            {roads.roads.map((road) => {
              const style = roadStroke(model.liveStatus.get(road.road_id) ?? road.initial_status);
              const d = road.geometry
                .map(
                  (p, i) =>
                    `${i === 0 ? "M" : "L"}${model.projector.x(p).toFixed(2)},${model.projector.y(p).toFixed(2)}`,
                )
                .join(" ");
              const mid = roadMidpoint(road);
              return (
                <g key={road.road_id}>
                  <path
                    d={d}
                    fill="none"
                    stroke={style.stroke}
                    strokeWidth="0.7"
                    strokeDasharray={style.dash}
                    strokeLinecap="round"
                  />
                  {mid && (
                    <text
                      x={model.projector.x(mid) + 1}
                      y={model.projector.y(mid) - 1}
                      fontSize="2.4"
                      fill="var(--blaze-text-faint)"
                      fontFamily="monospace"
                    >
                      {road.name}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Named assets: water point, hazard zone, vulnerable areas */}
            {resources.resources.map((res) => {
              if (!res.position) return null;
              const x = model.projector.x(res.position);
              const y = model.projector.y(res.position);
              const isWater = res.type === "water_point";
              const isHazard =
                res.status === "hazard_suspected" || res.type === "industrial_building";
              const isVulnerable = res.type === "vulnerable_area";
              if (!isWater && !isHazard && !isVulnerable) return null;
              const color = isWater
                ? "var(--blaze-info)"
                : isHazard
                  ? "var(--blaze-alert)"
                  : "var(--blaze-warn)";
              return (
                <g key={res.resource_id}>
                  {isHazard ? (
                    <rect
                      x={x - 1.6}
                      y={y - 1.6}
                      width="3.2"
                      height="3.2"
                      rx="0.8"
                      fill="none"
                      stroke={color}
                      strokeWidth="0.5"
                    />
                  ) : (
                    <circle cx={x} cy={y} r="1.4" fill="none" stroke={color} strokeWidth="0.5" />
                  )}
                  <text x={x + 2.2} y={y + 0.8} fontSize="2.2" fill={color} fontFamily="monospace">
                    {res.name}
                  </text>
                </g>
              );
            })}

            {/* Engines: seeded start → radio-reported hops (dashed trail) */}
            {model.tracks.map((track) => {
              const current = track.path[track.path.length - 1];
              const cx = model.projector.x(current);
              const cy = model.projector.y(current);
              const color = UNIT_COLOR[track.vehicleType] ?? "var(--blaze-text)";
              const trail = track.path
                .map(
                  (p, i) =>
                    `${i === 0 ? "M" : "L"}${model.projector.x(p).toFixed(2)},${model.projector.y(p).toFixed(2)}`,
                )
                .join(" ");
              const moved = track.path.length > 1;
              return (
                <g key={track.unitId}>
                  {moved && (
                    <path
                      d={trail}
                      fill="none"
                      stroke={color}
                      strokeWidth="0.4"
                      strokeDasharray="1 1"
                      opacity="0.6"
                    />
                  )}
                  {moved && (
                    <circle
                      cx={model.projector.x(track.path[0])}
                      cy={model.projector.y(track.path[0])}
                      r="0.7"
                      fill={color}
                      opacity="0.35"
                    />
                  )}
                  <circle cx={cx} cy={cy} r="1.8" fill={color} opacity="0.18">
                    {moved && (
                      <animate attributeName="r" values="1.8;2.6;1.8" dur="2.4s" repeatCount="indefinite" />
                    )}
                  </circle>
                  <circle cx={cx} cy={cy} r="1.1" fill={color} />
                  <text
                    x={cx + 2}
                    y={cy - 1.4}
                    fontSize="2.6"
                    fontWeight="bold"
                    fill={color}
                    fontFamily="monospace"
                  >
                    {track.callsign}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Legend — plain words, no decoding required */}
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px]"
            style={{ color: "var(--blaze-text-muted)" }}
          >
            <span className="flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: "var(--blaze-accent)" }}
              />
              engine (CCF)
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: "var(--blaze-info)" }}
              />
              light vehicle / water
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-sm border"
                style={{ borderColor: "var(--blaze-alert)" }}
              />
              hazard zone
            </span>
            <span>dashed trail = moves reported over the radio</span>
          </div>
        </>
      )}
    </Panel>
  );
}
