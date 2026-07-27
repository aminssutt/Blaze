// Tickets #40/#41 — tactical map: PURE derivation layer.
//
// Everything the map draws is derived here, from data that already exists in
// the repo or arrived over the stream. Nothing on this map is invented:
//   - buildings        -> data/geo/cadastre_batiments_clipped.geojson (cadastre)
//   - road network     -> data/geo/osm_features.geojson (OSM extract)
//   - tactical roads   -> data/scenario/roads.json + live snapshot.roads
//   - fire hotspot     -> snapshot.fire_hotspots (NASA FIRMS, cached_public)
//   - wind vector      -> snapshot.weather.wind_direction_deg / wind_speed_kmh
//   - exclusion radius -> data/scenario/safety_rules.json (sr-hazmat-perimeter)
//   - unit positions   -> seeded start + every RadioEvent.location_reference
//                         resolved against known road/resource geometry
//
// The provenance rule of the SVG version is preserved verbatim: an engine only
// moves where the field reported it, and the dashed trail is that report chain.

import type { LatLon, ScenarioRoad } from "@/lib/scenarioData";
import type {
  DraftTacticalPlan,
  RadioEvent,
  SituationSnapshot,
} from "@/lib/contracts";

/* -------------------------------------------------------------------------- */
/* Geodesy — small-angle helpers, enough for a 4 km × 3 km incident box       */
/* -------------------------------------------------------------------------- */

const M_PER_DEG_LAT = 111_320;

export type Lng = [number, number];

/** Point `meters` away from `[lon, lat]` along a compass bearing (deg, 0 = N). */
export function destination(origin: Lng, bearingDeg: number, meters: number): Lng {
  const rad = (bearingDeg * Math.PI) / 180;
  const [lon, lat] = origin;
  const dLat = (meters * Math.cos(rad)) / M_PER_DEG_LAT;
  const dLon =
    (meters * Math.sin(rad)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [lon + dLon, lat + dLat];
}

/** Planar great-circle-ish distance in metres between two lon/lat pairs. */
export function distanceMeters(a: Lng, b: Lng): number {
  const midLatRad = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const dx = (b[0] - a[0]) * M_PER_DEG_LAT * Math.cos(midLatRad);
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Closed ring approximating a circle of `radiusM` around `center`. */
export function circleRing(center: Lng, radiusM: number, steps = 72): Lng[] {
  const ring: Lng[] = [];
  for (let i = 0; i <= steps; i++) {
    ring.push(destination(center, (i / steps) * 360, radiusM));
  }
  return ring;
}

const toLng = (p: LatLon): Lng => [p.lon, p.lat];

/* -------------------------------------------------------------------------- */
/* Wind staff geometry                                                        */
/* -------------------------------------------------------------------------- */

/** Length of the downwind staff, in metres. Drawing length, not a forecast. */
export const WIND_STAFF_M = 1000;
/** Length of its arrowhead, in metres. */
export const WIND_HEAD_M = 150;

/**
 * Closed triangle whose apex sits at `tip` and which points along `bearingDeg`.
 * Drawn as a polygon rather than a sprite because the style has no sprite
 * sheet — product invariant #5, nothing is fetched off-machine.
 */
export function arrowHead(tip: Lng, bearingDeg: number): Lng[] {
  const back = (bearingDeg + 180) % 360;
  const base = destination(tip, back, WIND_HEAD_M);
  const left = destination(base, (bearingDeg + 270) % 360, WIND_HEAD_M * 0.42);
  const right = destination(base, (bearingDeg + 90) % 360, WIND_HEAD_M * 0.42);
  return [tip, left, right, tip];
}

/* -------------------------------------------------------------------------- */
/* Minimal GeoJSON shapes (we never import a geojson runtime)                  */
/* -------------------------------------------------------------------------- */

export interface GeoFeature<G, P = Record<string, unknown>> {
  type: "Feature";
  geometry: G;
  properties: P;
}
export interface GeoCollection<G, P = Record<string, unknown>> {
  type: "FeatureCollection";
  features: GeoFeature<G, P>[];
}
export type PointGeom = { type: "Point"; coordinates: Lng };
export type LineGeom = { type: "LineString"; coordinates: Lng[] };
export type PolyGeom = { type: "Polygon"; coordinates: Lng[][] };

export const EMPTY_COLLECTION: GeoCollection<never> = {
  type: "FeatureCollection",
  features: [],
};

function collection<G, P>(features: GeoFeature<G, P>[]): GeoCollection<G, P> {
  return { type: "FeatureCollection", features };
}

/* -------------------------------------------------------------------------- */
/* Radio-reported positions (unchanged semantics from the SVG version)        */
/* -------------------------------------------------------------------------- */

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function roadMidpoint(road: ScenarioRoad): LatLon | null {
  const g = road.geometry;
  return g.length > 0 ? g[Math.floor(g.length / 2)] : null;
}

interface NamedPoint {
  key: string;
  position: LatLon;
}

/** Resolve a spoken location ("D17", "hangar", "point d'eau 2") to coords. */
function resolveLocation(
  reference: string,
  roads: ScenarioRoad[],
  namedPoints: NamedPoint[],
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

export interface TrackUnit {
  unit_id: string;
  callsign: string;
  vehicle_type: string;
  position: LatLon | null;
}

export interface UnitTrack {
  unitId: string;
  callsign: string;
  vehicleType: string;
  /** Seeded start, then every radio-reported hop, in report order. */
  path: LatLon[];
}

export function buildTracks(
  units: TrackUnit[],
  radioEvents: RadioEvent[],
  roads: ScenarioRoad[],
  namedPoints: NamedPoint[],
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
    if (last.lat !== position.lat || last.lon !== position.lon) {
      track.path.push(position);
    }
  }
  return [...tracks.values()];
}

/* -------------------------------------------------------------------------- */
/* Road intel from the radio (#41) — per-vehicle styling                      */
/* -------------------------------------------------------------------------- */

export interface RoadIntel {
  /** road_status said blocked (audio 1). */
  blocked: boolean;
  /** correction said: light vehicles pass, CCF stays blocked (audio 4). */
  corrected: boolean;
}

export function buildRoadIntel(
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
export function buildPlanRoutes(
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
  // even if another unit still uses it: D17 is kept for Charlie 1 (light
  // vehicle) and discarded for the CCF retreat at the same time.
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
/* Fire & weather, read out of the situation snapshot                         */
/* -------------------------------------------------------------------------- */

export interface FireHotspot {
  position: Lng;
  /** Fire Radiative Power in MW, as reported by FIRMS. */
  frpMw: number | null;
  confidence: string | null;
}

export interface WindVector {
  /** Meteorological convention: the direction the wind blows FROM. */
  fromDeg: number;
  speedKmh: number | null;
  gustsKmh: number | null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function readHotspots(snapshot: SituationSnapshot | null): FireHotspot[] {
  const spots: FireHotspot[] = [];
  for (const raw of snapshot?.fire_hotspots ?? []) {
    const lat = num(raw.lat);
    const lon = num(raw.lon);
    if (lat === null || lon === null) continue;
    spots.push({
      position: [lon, lat],
      frpMw: num(raw.frp_mw),
      confidence: str(raw.confidence),
    });
  }
  return spots;
}

export function readWind(snapshot: SituationSnapshot | null): WindVector | null {
  const w = snapshot?.weather;
  if (!w) return null;
  const fromDeg = num(w.wind_direction_deg);
  if (fromDeg === null) return null;
  return {
    fromDeg,
    speedKmh: num(w.wind_speed_kmh),
    gustsKmh: num(w.wind_gusts_kmh),
  };
}

/* -------------------------------------------------------------------------- */
/* Marker specs — one uniform system for units, assets, roads and the fire    */
/* -------------------------------------------------------------------------- */

export type MarkerKind = "fire" | "unit" | "asset" | "road" | "note";
export type MarkerTone =
  | "accent"
  | "info"
  | "alert"
  | "warn"
  | "ok"
  | "muted";

export interface MarkerSpec {
  id: string;
  position: Lng;
  kind: MarkerKind;
  tone: MarkerTone;
  /** Short symbol drawn inside the dot ("" = label-only marker). */
  glyph: string;
  title: string;
  detail: string | null;
  /** Higher wins the spot when two labels collide. */
  priority: number;
  pulse: boolean;
}

/* -------------------------------------------------------------------------- */
/* The assembled model the canvas renders                                     */
/* -------------------------------------------------------------------------- */

export interface TacticalModel {
  /** Camera frame: [[west, south], [east, north]]. */
  bounds: [Lng, Lng];
  /** Tactical roads, carrying their radio/plan state as feature properties. */
  roads: GeoCollection<LineGeom>;
  /** One dashed LineString per engine that actually moved. */
  trails: GeoCollection<LineGeom>;
  /** Seeded starting points of the engines that moved. */
  starts: GeoCollection<PointGeom>;
  /** FIRMS hotspots (empty until the snapshot arrives). */
  fire: GeoCollection<PointGeom>;
  /** The hotspot the building tint is measured from, null when unknown. */
  fireCentre: Lng | null;
  /** Hazmat exclusion ring, null until the radio confirms the hazard. */
  exclusion: GeoCollection<PolyGeom>;
  exclusionRadiusM: number | null;
  /** Downwind axis of the cached forecast, null when no wind is known. */
  windAxis: GeoCollection<LineGeom>;
  /** Filled arrowhead at the downwind tip of that axis. */
  windHead: GeoCollection<PolyGeom>;
  wind: WindVector | null;
  markers: MarkerSpec[];
  /** Number of radio-reported position changes, for the panel header. */
  reportedHops: number;
}

export interface BuildModelInput {
  units: TrackUnit[];
  roads: ScenarioRoad[];
  resources: {
    resource_id: string;
    name: string;
    type: string;
    status: string;
    position: LatLon | null;
  }[];
  radioEvents: RadioEvent[];
  snapshot: SituationSnapshot | null;
  plan: DraftTacticalPlan | null;
  /** `default_perimeter_radius_m` of rule sr-hazmat-perimeter, when loaded. */
  hazmatRadiusM: number | null;
}

const UNIT_TONE: Record<string, MarkerTone> = {
  CCF: "accent",
  light_vehicle: "info",
  command_post: "muted",
};

const UNIT_GLYPH: Record<string, string> = {
  CCF: "C",
  light_vehicle: "V",
  command_post: "P",
};

/** Human label of a road's drivability, in English, for the map label. */
function roadStateLabel(
  intel: RoadIntel | undefined,
  status: string,
  road: ScenarioRoad,
): { state: string; label: string | null } {
  if (intel?.corrected) {
    return { state: "corrected", label: "blocked for CCF · light vehicles pass" };
  }
  if (intel?.blocked) return { state: "blocked", label: "blocked (radio)" };
  if (status === "blocked") return { state: "blocked", label: "blocked" };
  if (road.allowed_vehicle_types.length === 1) {
    return { state: "restricted", label: "light vehicles only" };
  }
  if (status && status !== "open") return { state: "restricted", label: status };
  return { state: "open", label: null };
}

export function buildTacticalModel(input: BuildModelInput): TacticalModel {
  const { units, roads, resources, radioEvents, snapshot, plan } = input;

  const namedPoints: NamedPoint[] = resources
    .filter((r) => r.position)
    .flatMap((r) => [
      { key: normalize(r.resource_id), position: r.position as LatLon },
      { key: normalize(r.name), position: r.position as LatLon },
    ]);

  /* ---- live road status, radio intel, plan routes ---------------------- */
  const liveStatus = new Map<string, string>();
  for (const road of snapshot?.roads ?? []) {
    const id = str(road.road_id);
    const status = str(road.status);
    if (id && status) liveStatus.set(id, status);
  }
  const roadIntel = buildRoadIntel(radioEvents, roads);
  const planRoutes = buildPlanRoutes(plan, roads);

  const roadFeatures = roads.map((road) => {
    const status = liveStatus.get(road.road_id) ?? road.initial_status;
    const intel = roadIntel.get(road.road_id);
    const { state, label } = roadStateLabel(intel, status, road);
    const selected = planRoutes.selected.has(road.road_id);
    const rejected = planRoutes.rejected.has(road.road_id);
    return {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: road.geometry.map(toLng),
      },
      properties: {
        road_id: road.road_id,
        name: road.name,
        state,
        state_label: label,
        plan: selected && rejected ? "split" : selected ? "kept" : rejected ? "discarded" : "none",
      },
    };
  });

  /* ---- engines: seeded start -> radio-reported hops -------------------- */
  const tracks = buildTracks(units, radioEvents, roads, namedPoints);
  const unitLive = new Map<string, { water: number | null; mission: string | null }>();
  for (const u of snapshot?.units ?? []) {
    const id = str(u.unit_id);
    if (!id) continue;
    unitLive.set(id, { water: num(u.water_pct), mission: str(u.mission) });
  }

  const trails = tracks
    .filter((t) => t.path.length > 1)
    .map((t) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: t.path.map(toLng),
      },
      properties: { unit_id: t.unitId, tone: UNIT_TONE[t.vehicleType] ?? "muted" },
    }));

  const starts = tracks
    .filter((t) => t.path.length > 1)
    .map((t) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: toLng(t.path[0]) },
      properties: { unit_id: t.unitId, tone: UNIT_TONE[t.vehicleType] ?? "muted" },
    }));

  /* ---- fire (FIRMS hotspots, cached_public) ---------------------------- */
  const hotspots = readHotspots(snapshot);
  const fire = collection(
    hotspots.map((h, i) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: h.position },
      properties: {
        idx: i,
        // Weight the heat layer by the reported radiative power; 1 when FIRMS
        // gave none, so a hotspot without FRP is still drawn.
        frp_mw: h.frpMw ?? 1,
        confidence: h.confidence ?? "unknown",
      },
    })),
  );
  const fireCentre = hotspots.length > 0 ? hotspots[0].position : null;

  /* ---- hazmat exclusion perimeter (#41) -------------------------------- */
  // Rung by the audio-5 `confirmation` at the hangar; radius comes from the
  // sr-hazmat-perimeter safety rule, never from a guess.
  const hangar = resources.find((r) => r.type === "industrial_building");
  const hazardConfirmed =
    hangar?.position !== undefined &&
    hangar?.position !== null &&
    radioEvents.some((e) => {
      if (e.event_type !== "confirmation" || !e.location_reference) return false;
      const ref = normalize(e.location_reference);
      const name = normalize(hangar.name);
      return ref.includes(name) || name.includes(ref);
    });
  const exclusionCentre =
    hazardConfirmed && hangar?.position ? toLng(hangar.position) : null;
  const exclusionRadiusM =
    exclusionCentre && input.hazmatRadiusM ? input.hazmatRadiusM : null;
  const exclusion =
    exclusionCentre && exclusionRadiusM
      ? collection([
          {
            type: "Feature" as const,
            geometry: {
              type: "Polygon" as const,
              coordinates: [circleRing(exclusionCentre, exclusionRadiusM)],
            },
            properties: { radius_m: exclusionRadiusM },
          },
        ])
      : collection<PolyGeom, Record<string, unknown>>([]);

  /* ---- wind axis (cached forecast, direction only) --------------------- */
  const wind = readWind(snapshot);
  const windOrigin = fireCentre ?? exclusionCentre;
  // A fixed staff: the BEARING is the datum, the length is only there to be
  // visible. No spread rate is claimed anywhere — the arrow says "downwind is
  // that way", never "the fire will be there in n minutes".
  const downwindDeg = wind ? (wind.fromDeg + 180) % 360 : 0;
  const windTip =
    wind && windOrigin ? destination(windOrigin, downwindDeg, WIND_STAFF_M) : null;
  const windAxis =
    wind && windOrigin && windTip
      ? collection([
          {
            type: "Feature" as const,
            geometry: {
              type: "LineString" as const,
              coordinates: [
                destination(windOrigin, wind.fromDeg, 260),
                // Stop the dashes where the head starts, so the shaft never
                // shows through the arrowhead.
                destination(windOrigin, downwindDeg, WIND_STAFF_M - WIND_HEAD_M),
              ],
            },
            properties: { from_deg: wind.fromDeg },
          },
        ])
      : collection<LineGeom, Record<string, unknown>>([]);
  const windHead =
    wind && windOrigin && windTip
      ? collection([
          {
            type: "Feature" as const,
            geometry: {
              type: "Polygon" as const,
              coordinates: [arrowHead(windTip, downwindDeg)],
            },
            properties: { from_deg: wind.fromDeg },
          },
        ])
      : collection<PolyGeom, Record<string, unknown>>([]);

  /* ---- markers --------------------------------------------------------- */
  const markers: MarkerSpec[] = [];

  hotspots.forEach((h, i) => {
    markers.push({
      id: `fire-${i}`,
      position: h.position,
      kind: "fire",
      tone: "alert",
      glyph: "▲",
      title: "Fire hotspot",
      detail: [
        h.frpMw !== null ? `${h.frpMw} MW` : null,
        h.confidence ? `${h.confidence} confidence` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      priority: 100,
      pulse: true,
    });
  });

  if (wind && windTip) {
    markers.push({
      id: "wind",
      position: windTip,
      kind: "note",
      tone: "info",
      glyph: "",
      title: "Downwind",
      detail: [
        wind.speedKmh !== null ? `${wind.speedKmh} km/h` : null,
        `from ${Math.round(wind.fromDeg)}°`,
        wind.gustsKmh !== null ? `gusts ${wind.gustsKmh}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      // Just under the engines: "which way does it blow" is one of the three
      // things this map has to answer before anything else, so its label is
      // never the one the collision solver drops.
      priority: 85,
      pulse: false,
    });
  }

  for (const track of tracks) {
    const live = unitLive.get(track.unitId);
    const detail = [
      live?.water !== null && live?.water !== undefined ? `water ${live.water}%` : null,
      live?.mission ?? null,
      track.path.length > 1 ? `${track.path.length - 1} radio move${track.path.length > 2 ? "s" : ""}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    markers.push({
      id: `unit-${track.unitId}`,
      position: toLng(track.path[track.path.length - 1]),
      kind: "unit",
      tone: UNIT_TONE[track.vehicleType] ?? "muted",
      glyph: UNIT_GLYPH[track.vehicleType] ?? "•",
      title: track.callsign,
      detail: detail || null,
      priority: 90,
      pulse: track.path.length > 1,
    });
  }

  for (const res of resources) {
    if (!res.position) continue;
    const isWater = res.type === "water_point";
    const isHazard =
      res.status === "hazard_suspected" || res.type === "industrial_building";
    const isVulnerable = res.type === "vulnerable_area";
    if (!isWater && !isHazard && !isVulnerable) continue;
    markers.push({
      id: `asset-${res.resource_id}`,
      position: toLng(res.position),
      kind: "asset",
      tone: isWater ? "info" : isHazard ? "alert" : "warn",
      glyph: isWater ? "≈" : isHazard ? "!" : "⌂",
      title: res.name,
      detail: isWater
        ? "water point"
        : isHazard
          ? "industrial hazard"
          : "vulnerable area",
      priority: isVulnerable ? 80 : 70,
      pulse: false,
    });
  }

  for (const feature of roadFeatures) {
    const mid = feature.geometry.coordinates[
      Math.floor(feature.geometry.coordinates.length / 2)
    ];
    // Kept short on purpose: the map label says WHICH verdict, the plan panel
    // says why. A three-clause sentence here just fights the other labels.
    const planLabel =
      feature.properties.plan === "split"
        ? "plan: kept (light) / discarded (CCF)"
        : feature.properties.plan === "kept"
          ? "plan: kept"
          : feature.properties.plan === "discarded"
            ? "plan: discarded"
            : null;
    markers.push({
      id: `road-${feature.properties.road_id}`,
      position: mid,
      kind: "road",
      tone:
        feature.properties.state === "blocked" || feature.properties.state === "corrected"
          ? "alert"
          : feature.properties.plan === "kept"
            ? "ok"
            : "muted",
      glyph: "",
      title: feature.properties.name,
      detail: [feature.properties.state_label, planLabel].filter(Boolean).join(" · ") || null,
      priority: 50,
      pulse: false,
    });
  }

  /* ---- camera frame ----------------------------------------------------
     Framed on the ACTION, not on the data extent. The seeded road network runs
     several kilometres past the incident; fitting all of it put the whole city
     in ~700 px of a 1500 px canvas — a textured smudge with no readable volume,
     which is exactly the "flat dark plan" complaint. So the frame is the union
     of everything that carries a label (fire, engines, assets, road midpoints)
     plus the engines' reported trails and the downwind tip: what a first-time
     visitor must see without panning, and nothing else. */
  const framePoints: Lng[] = [
    ...markers.map((m) => m.position),
    ...tracks.flatMap((t) => t.path.map(toLng)),
    ...(windTip ? [windTip] : []),
  ];
  const lons = framePoints.map((p) => p[0]);
  const lats = framePoints.map((p) => p[1]);
  // ~150 m of air so no marker sits on the frame edge and its label still has
  // somewhere to go.
  const padLat = 0.0014;
  const padLon = 0.0019;
  const bounds: [Lng, Lng] = [
    [Math.min(...lons) - padLon, Math.min(...lats) - padLat],
    [Math.max(...lons) + padLon, Math.max(...lats) + padLat],
  ];

  return {
    bounds,
    roads: collection(roadFeatures),
    trails: collection(trails),
    starts: collection(starts),
    fire,
    fireCentre,
    exclusion,
    exclusionRadiusM,
    windAxis,
    windHead,
    wind,
    markers,
    reportedHops: tracks.reduce((n, t) => n + t.path.length - 1, 0),
  };
}
