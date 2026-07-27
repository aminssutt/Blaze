"use client";

// Tickets #40/#41 — static geo layers behind the tactical map.
//
// Three same-origin static assets, fetched once per page and cached in module
// scope (the map is mounted/unmounted every time the /expert overlay opens):
//
//   /data/geo/cadastre_batiments_clipped.geojson  10 193 building footprints
//   /data/geo/osm_features.geojson                the OSM road/water extract
//   /data/scenario/safety_rules.json              sr-hazmat-perimeter radius
//
// PRODUCT INVARIANT #5 — no request leaves the machine. Everything here is a
// relative URL served by our own Next.js server out of `public/`, copied there
// from the repo `data/` folder by `scripts/sync-data.mjs`.
//
// Every layer is OPTIONAL: a failed fetch resolves to an empty collection so
// the map still draws the tactical picture on a bare background.

import { useEffect, useState } from "react";
import { SCENARIO_DATA_URLS } from "@/lib/scenarioData";
import type { GeoCollection, Lng } from "./tacticalModel";

export const CADASTRE_URL = "/data/geo/cadastre_batiments_clipped.geojson";
export const OSM_URL = "/data/geo/osm_features.geojson";

/* -------------------------------------------------------------------------- */
/* Cadastre                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Building footprint kept for rendering. `cx`/`cy` are the footprint centroid:
 * they let the fill-extrusion colour be re-derived from the fire hotspot with a
 * paint-property update alone, instead of re-uploading 3 MB of geometry every
 * time the situation snapshot is rebuilt.
 */
export interface BuildingProps extends Record<string, unknown> {
  /** Cadastral class: "01" durable construction, "02" light structure. */
  t: string;
  cx: number;
  cy: number;
}

type Ring = number[][];
type PolygonCoords = Ring[];
type MultiPolygonCoords = PolygonCoords[];

export interface BuildingGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: PolygonCoords | MultiPolygonCoords;
}

export type CadastreCollection = GeoCollection<BuildingGeometry, BuildingProps>;

function outerRing(geometry: BuildingGeometry): Ring {
  return geometry.type === "Polygon"
    ? (geometry.coordinates as PolygonCoords)[0]
    : (geometry.coordinates as MultiPolygonCoords)[0][0];
}

/** Mean of the outer ring — accurate enough to rank a 12 m building by distance. */
function ringCentroid(ring: Ring): Lng {
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return [lon / ring.length, lat / ring.length];
}

interface RawCadastreFeature {
  geometry: BuildingGeometry;
  properties: { type?: string | null } | null;
}

/** Strips the cadastre down to what the 3D layer needs and adds the centroid. */
function prepareCadastre(raw: { features: RawCadastreFeature[] }): CadastreCollection {
  const features: CadastreCollection["features"] = [];
  for (const feature of raw.features) {
    if (!feature.geometry) continue;
    const [cx, cy] = ringCentroid(outerRing(feature.geometry));
    features.push({
      type: "Feature",
      geometry: feature.geometry,
      properties: { t: feature.properties?.type ?? "01", cx, cy },
    });
  }
  return { type: "FeatureCollection", features };
}

/* -------------------------------------------------------------------------- */
/* OSM extract                                                                */
/* -------------------------------------------------------------------------- */

export interface OsmProps extends Record<string, unknown> {
  category?: string;
  highway?: string;
  natural?: string;
  landuse?: string;
  name?: string;
}

export type OsmCollection = GeoCollection<
  { type: string; coordinates: unknown },
  OsmProps
>;

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface MapGeoData {
  /** null while loading; an empty collection when the fetch failed. */
  cadastre: CadastreCollection | null;
  osm: OsmCollection | null;
  /** `default_perimeter_radius_m` of rule sr-hazmat-perimeter. */
  hazmatRadiusM: number | null;
}

const EMPTY_CADASTRE: CadastreCollection = { type: "FeatureCollection", features: [] };
const EMPTY_OSM: OsmCollection = { type: "FeatureCollection", features: [] };

let cache: MapGeoData | null = null;
let inflight: Promise<MapGeoData> | null = null;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Reads the hazmat exclusion radius out of the seeded safety rules. */
function readHazmatRadius(file: unknown): number | null {
  const rules = (file as { rules?: unknown[] } | null)?.rules;
  if (!Array.isArray(rules)) return null;
  for (const rule of rules) {
    const r = rule as { rule_id?: string; parameters?: Record<string, unknown> };
    if (r.rule_id !== "sr-hazmat-perimeter") continue;
    const radius = r.parameters?.default_perimeter_radius_m;
    return typeof radius === "number" && Number.isFinite(radius) ? radius : null;
  }
  return null;
}

async function loadAll(): Promise<MapGeoData> {
  // Independent fetches — never awaited one after the other (no waterfall).
  const [cadastreRaw, osmRaw, rulesRaw] = await Promise.all([
    fetchJson<{ features: RawCadastreFeature[] }>(CADASTRE_URL),
    fetchJson<OsmCollection>(OSM_URL),
    fetchJson<unknown>(SCENARIO_DATA_URLS.safetyRules),
  ]);
  return {
    cadastre: cadastreRaw ? prepareCadastre(cadastreRaw) : EMPTY_CADASTRE,
    osm: osmRaw ?? EMPTY_OSM,
    hazmatRadiusM: readHazmatRadius(rulesRaw),
  };
}

export function useMapGeoData(): MapGeoData {
  const [data, setData] = useState<MapGeoData>(
    cache ?? { cadastre: null, osm: null, hazmatRadiusM: null },
  );

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    inflight ??= loadAll();
    void inflight.then((loaded) => {
      cache = loaded;
      if (!cancelled) setData(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
