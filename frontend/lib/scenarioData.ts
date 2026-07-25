/**
 * BLAZE scenario fixture loaders (ticket #38).
 *
 * The tactical map (#40, #41), the situation snapshot (#45) and the radio
 * timeline (#42) need the seeded scenario data that lives OUTSIDE `frontend/`
 * (repo `data/`). `scripts/sync-data.mjs` copies it into `public/data/` before
 * dev/build; this module is the single typed way to read it back.
 *
 * All types below are hand-written from the REAL files — `data/scenario/*.json`,
 * `data/geo/scenario_preview.geojson`, `data/audio/manifest.json` — not guessed.
 * The repo files stay the source of truth: if they change, update this file.
 *
 * Everything is a same-origin fetch of a static asset: no external network
 * request ever leaves the machine (product invariant #5).
 */

import type { AudioManifestItem, SourceType } from "./contracts";

/* -------------------------------------------------------------------------- */
/* Public URLs (mirror of sync-data.mjs targets)                              */
/* -------------------------------------------------------------------------- */

export const SCENARIO_DATA_URLS = {
  units: "/data/scenario/units.json",
  roads: "/data/scenario/roads.json",
  resources: "/data/scenario/resources.json",
  safetyRules: "/data/scenario/safety_rules.json",
  geoPreview: "/data/geo/scenario_preview.geojson",
  audioManifest: "/data/audio/manifest.json",
} as const;

/** Public URL of a repo-relative audio path (e.g. `data/audio/x.wav`). */
export function publicAudioUrl(repoRelativePath: string): string {
  return `/${repoRelativePath.replace(/^\/+/, "")}`;
}

/* -------------------------------------------------------------------------- */
/* Shared envelope of the data/scenario/*.json files                          */
/* -------------------------------------------------------------------------- */

/** Every scenario fixture declares its own provenance — invariant #2. */
export interface ScenarioFileMeta {
  source_type: SourceType;
  source_name: string;
  scenario_id: string;
}

/** WGS84 point as written in the scenario files (`{ lat, lon }`). */
export interface LatLon {
  lat: number;
  lon: number;
}

/* -------------------------------------------------------------------------- */
/* data/scenario/units.json                                                   */
/* -------------------------------------------------------------------------- */

export interface ScenarioUnit {
  /** e.g. alpha-3. */
  unit_id: string;
  /** Radio callsign, e.g. "Alpha 3". */
  callsign: string;
  /** CCF | light_vehicle | command_post. */
  vehicle_type: string;
  crew_size: number;
  /** suppression | reconnaissance | route_confirmation | command. */
  mission: string;
  assigned_sector: string | null;
  assigned_route: string | null;
  /** Water level in percent; null for units without a tank. */
  water_pct: number | null;
  /** en_route | available | active. */
  status: string;
  position: LatLon | null;
  /** Present only on the command post ("human_approval_authority"). */
  role?: string;
}

export interface ScenarioUnitsFile extends ScenarioFileMeta {
  units: ScenarioUnit[];
}

/* -------------------------------------------------------------------------- */
/* data/scenario/roads.json                                                   */
/* -------------------------------------------------------------------------- */

export interface RoadRestriction {
  vehicle_type: string;
  reason: string;
}

export interface ScenarioRoad {
  /** e.g. d17, north-access, forest-track-5. */
  road_id: string;
  name: string;
  /** departmental_road | access_road | forest_track. */
  type: string;
  initial_status: string;
  allowed_vehicle_types: string[];
  restrictions: RoadRestriction[];
  note: string;
  /** Polyline vertices in scenario order. */
  geometry: LatLon[];
}

export interface ScenarioRoadsFile extends ScenarioFileMeta {
  roads: ScenarioRoad[];
}

/* -------------------------------------------------------------------------- */
/* data/scenario/resources.json                                               */
/* -------------------------------------------------------------------------- */

export interface ScenarioResource {
  /** e.g. water-point-2, hangar-zone, camping-les-pins. */
  resource_id: string;
  name: string;
  /** water_point | vehicle | capability | industrial_building | vulnerable_area. */
  type: string;
  /** available | unavailable | hazard_suspected | occupied. */
  status: string;
  position: LatLon | null;
  capacity_liters?: number;
  access_routes?: string[];
  vehicle_type?: string;
  provided_by?: string;
  estimated_occupants?: number;
  note?: string;
}

export interface ScenarioResourcesFile extends ScenarioFileMeta {
  resources: ScenarioResource[];
}

/* -------------------------------------------------------------------------- */
/* data/scenario/safety_rules.json                                            */
/* -------------------------------------------------------------------------- */

export interface ScenarioSafetyRule {
  /** Matches SafetyReview.rule_checks[].rule_id (e.g. sr-min-water). */
  rule_id: string;
  name: string;
  description: string;
  /** critical | high. */
  severity: string;
  /** Rule-specific thresholds, present on parameterised rules only. */
  parameters?: Record<string, number>;
}

export interface ScenarioSafetyRulesFile extends ScenarioFileMeta {
  rules: ScenarioSafetyRule[];
}

/* -------------------------------------------------------------------------- */
/* data/geo/scenario_preview.geojson                                          */
/* -------------------------------------------------------------------------- */

/** GeoJSON geometries actually present in the preview file. */
export type ScenarioGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] };

/**
 * Properties written by the scenario preview generator. `label` is prefixed
 * by kind (`unit:alpha-3`, `resource:water-point-2`, `road:d17`, `demo_bbox`).
 */
export interface ScenarioFeatureProperties {
  label: string;
  /** unit | resource | road | bbox. */
  kind: string;
  vehicle_type?: string;
  type?: string;
  status?: string | null;
}

export interface ScenarioFeature {
  type: "Feature";
  geometry: ScenarioGeometry;
  properties: ScenarioFeatureProperties;
}

export interface ScenarioFeatureCollection {
  type: "FeatureCollection";
  features: ScenarioFeature[];
}

/* -------------------------------------------------------------------------- */
/* Fetch helpers                                                              */
/* -------------------------------------------------------------------------- */

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${url} (HTTP ${res.status}). ` +
        `Run "npm run sync-data" to copy data/ into public/data/.`,
    );
  }
  return (await res.json()) as T;
}

/** Loads the seeded units (Alpha 3, Bravo 2, Charlie 1, command post). */
export async function loadScenarioUnits(): Promise<ScenarioUnitsFile> {
  return fetchJson<ScenarioUnitsFile>(SCENARIO_DATA_URLS.units);
}

/** Loads the road network with vehicle-type restrictions. */
export async function loadScenarioRoads(): Promise<ScenarioRoadsFile> {
  return fetchJson<ScenarioRoadsFile>(SCENARIO_DATA_URLS.roads);
}

/** Loads water points, the hangar and the vulnerable camping area. */
export async function loadScenarioResources(): Promise<ScenarioResourcesFile> {
  return fetchJson<ScenarioResourcesFile>(SCENARIO_DATA_URLS.resources);
}

/** Loads the safety rules the Safety Critic checks against. */
export async function loadScenarioSafetyRules(): Promise<ScenarioSafetyRulesFile> {
  return fetchJson<ScenarioSafetyRulesFile>(SCENARIO_DATA_URLS.safetyRules);
}

/** Loads the map preview FeatureCollection (units, resources, roads, bbox). */
export async function loadScenarioGeoPreview(): Promise<ScenarioFeatureCollection> {
  return fetchJson<ScenarioFeatureCollection>(SCENARIO_DATA_URLS.geoPreview);
}

/** Loads the five prerecorded radio messages with their clean/radio WAV paths. */
export async function loadAudioManifest(): Promise<AudioManifestItem[]> {
  return fetchJson<AudioManifestItem[]>(SCENARIO_DATA_URLS.audioManifest);
}

/** Everything at once, for panels that need the full seeded picture. */
export interface ScenarioBundle {
  units: ScenarioUnitsFile;
  roads: ScenarioRoadsFile;
  resources: ScenarioResourcesFile;
  safetyRules: ScenarioSafetyRulesFile;
  geoPreview: ScenarioFeatureCollection;
  audioManifest: AudioManifestItem[];
}

/** Loads every scenario fixture in parallel. */
export async function loadScenarioBundle(): Promise<ScenarioBundle> {
  const [units, roads, resources, safetyRules, geoPreview, audioManifest] =
    await Promise.all([
      loadScenarioUnits(),
      loadScenarioRoads(),
      loadScenarioResources(),
      loadScenarioSafetyRules(),
      loadScenarioGeoPreview(),
      loadAudioManifest(),
    ]);
  return { units, roads, resources, safetyRules, geoPreview, audioManifest };
}
