// Tickets #40/#41 — tactical map, real implementation (was a stub).
//
// A dependency-free SVG projection of the seeded scenario geometry: roads,
// water point, hazard zone, vulnerable assets — and the engines. Each unit
// starts at its seeded position and MOVES to the last location it reported
// over the radio (RadioEvent.location_reference resolved against the known
// road/resource geometry), leaving a dashed trail. What the chief sees is
// exactly what the field reported — human_report provenance, nothing invented.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useIncidentState } from "@/lib/session";
import { useScenario } from "@/lib/useScenario";
import type { LatLon, ScenarioRoad } from "@/lib/scenarioData";
import type { DraftTacticalPlan, RadioEvent } from "@/lib/contracts";
import { Chip, Panel, SourceBadge } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* Cadastral buildings (ticket #40) — cached_public GeoJSON, centroids only   */
/* -------------------------------------------------------------------------- */

const CADASTRE_URL = "/data/geo/cadastre_batiments_clipped.geojson";
/** Density texture, not architecture: cap the layer for SVG performance. */
const MAX_BUILDINGS = 4000;

function firstRing(geometry: {
  type: string;
  coordinates: number[][][] | number[][][][];
}): number[][] {
  return geometry.type === "Polygon"
    ? (geometry.coordinates as number[][][])[0]
    : (geometry.coordinates as number[][][][])[0][0];
}

/** Fetch the clipped cadastre once and reduce each building to its centroid. */
function useBuildingCentroids(): LatLon[] | null {
  const [centroids, setCentroids] = useState<LatLon[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(CADASTRE_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((collection: { features: { geometry: never }[] }) => {
        if (cancelled) return;
        const step = Math.max(1, Math.ceil(collection.features.length / MAX_BUILDINGS));
        const points: LatLon[] = [];
        for (let i = 0; i < collection.features.length; i += step) {
          const ring = firstRing(collection.features[i].geometry);
          let lat = 0;
          let lon = 0;
          for (const [x, y] of ring) {
            lon += x;
            lat += y;
          }
          points.push({ lat: lat / ring.length, lon: lon / ring.length });
        }
        setCentroids(points);
      })
      .catch(() => {
        if (!cancelled) setCentroids([]); // layer optional: map works without it
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return centroids;
}

/* -------------------------------------------------------------------------- */
/* Road intel from the radio (ticket #41) — per-vehicle styling               */
/* -------------------------------------------------------------------------- */

interface RoadIntel {
  /** road_status said blocked (audio 1). */
  blocked: boolean;
  /** correction said: light vehicles pass, CCF stays blocked (audio 4). */
  corrected: boolean;
}

/** What the field reported about each road, in radio order — nothing invented. */
function buildRoadIntel(
  radioEvents: RadioEvent[],
  roads: ScenarioRoad[],
): Map<string, RoadIntel> {
  const intel = new Map<string, RoadIntel>();
  for (const event of radioEvents) {
    if (!event.location_reference) continue;
    const ref = normalize(event.location_reference);
    for (const road of roads) {
      const keys = [normalize(road.road_id), normalize(road.name)];
      if (!keys.some((k) => k && (ref.includes(k) || k.includes(ref)))) continue;
      const entry = intel.get(road.road_id) ?? { blocked: false, corrected: false };
      if (event.event_type === "road_status") entry.blocked = true;
      if (event.event_type === "correction") entry.corrected = true;
      intel.set(road.road_id, entry);
    }
  }
  return intel;
}

/** Roads the approved/draft plan uses vs the ones it explicitly walks away from. */
function buildPlanRoutes(
  plan: DraftTacticalPlan | null,
  roads: ScenarioRoad[],
): { selected: Set<string>; rejected: Set<string> } {
  const selected = new Set<string>();
  const rejected = new Set<string>();
  if (!plan) return { selected, rejected };
  const mentioned = (text: string, road: ScenarioRoad) => {
    const t = normalize(text);
    return t.includes(normalize(road.road_id)) || t.includes(normalize(road.name));
  };
  for (const action of plan.unit_actions) {
    if (action.route) selected.add(action.route);
  }
  // A road is "rejected" when the plan text forbids it (for a vehicle type),
  // even if another unit still uses it: D17 is retenue for Charlie 1 (VL)
  // and ecartee for the CCF retreat at the same time.
  const FORBID = /(forbidden|interdit|interdite|ecarte|rejected|avoid)/;
  const texts = [
    ...plan.unit_actions.map((a) => a.instruction ?? ""),
    ...(plan.rejected_options ?? []).map((o) =>
      typeof o === "string" ? o : `${o.option ?? ""} ${o.reason ?? ""}`,
    ),
  ];
  // Evaluate clause by clause: "Retreat via North Access. D17 forbidden for
  // CCF" forbids D17, not North Access.
  const clauses = texts.flatMap((t) => (t ? t.split(/[.;:]/) : []));
  for (const road of roads) {
    for (const clause of clauses) {
      if (!mentioned(clause, road)) continue;
      if (FORBID.test(clause.toLowerCase())) rejected.add(road.road_id);
      else if (!selected.has(road.road_id)) rejected.add(road.road_id);
    }
  }
  return { selected, rejected };
}

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
  const { snapshot, radioEvents, incidentLocation, plan } = useIncidentState();
  const { units, roads, resources } = useScenario();
  const buildings = useBuildingCentroids();

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
    const unitState = new Map<string, { water: number | null; mission: string | null }>();
    for (const u of snapshot?.units ?? []) {
      const id = typeof u.unit_id === "string" ? u.unit_id : null;
      if (!id) continue;
      unitState.set(id, {
        water: typeof u.water_pct === "number" ? u.water_pct : null,
        mission: typeof u.mission === "string" ? u.mission : null,
      });
    }
    const roadIntel = buildRoadIntel(radioEvents, roads.roads);
    const planRoutes = buildPlanRoutes(plan, roads.roads);

    // Exclusion perimeter (#41): a radio `confirmation` at the hangar
    // (explosions / gas cylinders, audio 5) rings the industrial zone.
    const hangar = resources.resources.find((r) => r.type === "industrial_building");
    const exclusionCenter =
      hangar?.position &&
      radioEvents.some((e) => {
        if (e.event_type !== "confirmation" || !e.location_reference) return false;
        const ref = normalize(e.location_reference);
        const name = normalize(hangar.name);
        return ref.includes(name) || name.includes(ref);
      })
        ? hangar.position
        : null;

    return { projector, liveStatus, tracks, unitState, roadIntel, planRoutes, exclusionCenter };
  }, [roads, units, resources, snapshot, radioEvents, plan]);

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
          {buildings && buildings.length > 0 && (
            <Chip
              label="bâtiments"
              value={buildings.length}
              title="Cadastre Etalab clippé (cached_public), échantillonné pour le rendu"
            />
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
            {/* Cadastral buildings (#40) — cached_public density layer */}
            {buildings && buildings.length > 0 && (
              <path
                aria-hidden
                d={buildings
                  .map(
                    (b) =>
                      `M${(model.projector.x(b) - 0.22).toFixed(2)},${(model.projector.y(b) - 0.22).toFixed(2)}h0.44v0.44h-0.44z`,
                  )
                  .join("")}
                fill="var(--blaze-border)"
                opacity="0.55"
              />
            )}

            {/* Exclusion perimeter (#41) — rung by the audio 5 confirmation */}
            {model.exclusionCenter && (
              <g aria-label="Périmètre d'exclusion autour du hangar">
                <circle
                  cx={model.projector.x(model.exclusionCenter)}
                  cy={model.projector.y(model.exclusionCenter)}
                  r="7"
                  fill="var(--blaze-alert)"
                  opacity="0.06"
                />
                <circle
                  cx={model.projector.x(model.exclusionCenter)}
                  cy={model.projector.y(model.exclusionCenter)}
                  r="7"
                  fill="none"
                  stroke="var(--blaze-alert)"
                  strokeWidth="0.4"
                  strokeDasharray="1.4 1"
                >
                  <animate attributeName="opacity" values="0.9;0.4;0.9" dur="2.4s" repeatCount="indefinite" />
                </circle>
                <text
                  x={model.projector.x(model.exclusionCenter)}
                  y={model.projector.y(model.exclusionCenter) - 7.8}
                  fontSize="2"
                  fill="var(--blaze-alert)"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  périmètre d&apos;exclusion
                </text>
              </g>
            )}

            {/* Roads — status by vehicle type + plan selection (#41) */}
            {roads.roads.map((road) => {
              const status = model.liveStatus.get(road.road_id) ?? road.initial_status;
              const intel = model.roadIntel.get(road.road_id);
              const selected = model.planRoutes.selected.has(road.road_id);
              const rejected = model.planRoutes.rejected.has(road.road_id);
              const style = roadStroke(status);
              const d = road.geometry
                .map(
                  (p, i) =>
                    `${i === 0 ? "M" : "L"}${model.projector.x(p).toFixed(2)},${model.projector.y(p).toFixed(2)}`,
                )
                .join(" ");
              const mid = roadMidpoint(road);
              return (
                <g key={road.road_id}>
                  {selected && (
                    <path
                      d={d}
                      fill="none"
                      stroke="var(--blaze-ok)"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      opacity="0.35"
                    />
                  )}
                  {intel?.corrected ? (
                    // Audio 4 correction: CCF still blocked (red core),
                    // light vehicles pass (amber dashes on top).
                    <>
                      <path
                        d={d}
                        fill="none"
                        stroke="var(--blaze-alert)"
                        strokeWidth="0.9"
                        strokeLinecap="round"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke="var(--blaze-warn)"
                        strokeWidth="0.45"
                        strokeDasharray="1.6 1.2"
                        strokeLinecap="round"
                      />
                    </>
                  ) : intel?.blocked ? (
                    <path
                      d={d}
                      fill="none"
                      stroke="var(--blaze-alert)"
                      strokeWidth="0.8"
                      strokeDasharray="1.6 1.2"
                      strokeLinecap="round"
                    />
                  ) : (
                    <path
                      d={d}
                      fill="none"
                      stroke={style.stroke}
                      strokeWidth="0.7"
                      strokeDasharray={style.dash}
                      strokeLinecap="round"
                    />
                  )}
                  {mid && (selected || rejected) && (
                    <text
                      x={model.projector.x(mid) + 1}
                      y={model.projector.y(mid) + 2.6}
                      fontSize="2"
                      fill={selected ? "var(--blaze-ok)" : "var(--blaze-alert)"}
                      fontFamily="monospace"
                    >
                      {selected && rejected
                        ? "✓ retenu VL · ✕ écarté CCF"
                        : selected
                          ? "✓ itinéraire retenu"
                          : "✕ écartée par le plan"}
                    </text>
                  )}
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
                  {(() => {
                    const live = model.unitState.get(track.unitId);
                    if (!live || (live.water === null && !live.mission)) return null;
                    const parts = [
                      live.water !== null ? `eau ${live.water}%` : null,
                      live.mission,
                    ].filter(Boolean);
                    return (
                      <text
                        x={cx + 2}
                        y={cy + 1.2}
                        fontSize="1.8"
                        fill={live.water !== null && live.water <= 30 ? "var(--blaze-warn)" : "var(--blaze-text-muted)"}
                        fontFamily="monospace"
                      >
                        {parts.join(" · ")}
                      </text>
                    );
                  })()}
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
              hazard / exclusion
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-0.5 w-3"
                style={{
                  background:
                    "repeating-linear-gradient(90deg, var(--blaze-alert) 0 3px, var(--blaze-warn) 3px 6px)",
                }}
              />
              D17 : rouge CCF · ambre VL (correction radio)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-3" style={{ background: "var(--blaze-ok)" }} />
              itinéraire retenu · ✕ écarté par le plan
            </span>
            <span>dashed trail = moves reported over the radio</span>
          </div>
        </>
      )}
    </Panel>
  );
}
