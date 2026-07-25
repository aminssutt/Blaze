// Ticket #45 — situation summary: pure derivation. Owner: @six-16.
//
// No JSX here on purpose: everything below is a pure function of the reduced
// store, so `npm run verify-store` can assert it against the frozen demo
// stream without a browser or a component renderer.
//
// HONESTY RULE (product invariant #2/#4): nothing is computed that the data
// does not support. A field the snapshot never reported is `null`, not zero
// and not a guess, and every rendered datum carries where it came from.

import type { SituationSnapshot, SourceType } from "@/lib/contracts";
import type { ToolCall } from "@/lib/incidentStore";

/* -------------------------------------------------------------------------- */
/* Safe readers — snapshot sub-objects are `Record<string, unknown>`           */
/* -------------------------------------------------------------------------- */

type Bag = Record<string, unknown> | null | undefined;

export function num(bag: Bag, key: string): number | null {
  const value = bag?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function str(bag: Bag, key: string): string | null {
  const value = bag?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

/**
 * Meteorological wind direction (degrees the wind comes FROM) to a compass
 * point. Firefighters read "NW", not "320°" — both are shown.
 */
export function degToCompass(deg: number | null): string | null {
  if (deg === null || !Number.isFinite(deg)) return null;
  const normalized = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 22.5) % 16];
}

/** Compact age: "12 s", "4 min", "1 h 05". Negative or unknown -> null. */
export function formatAge(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(Math.round(minutes % 60)).padStart(2, "0")}`;
}

/** Seconds between two ISO timestamps; null when either is unparsable. */
export function secondsBetween(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return (to - from) / 1000;
}

/* -------------------------------------------------------------------------- */
/* Provenance + staleness                                                     */
/* -------------------------------------------------------------------------- */

export interface ProvenanceRow {
  /** Snapshot field the provenance applies to (weather, terrain, …). */
  field: string;
  sourceType: SourceType;
  sourceName: string;
  /** When the tool layer retrieved it, null if the entry omitted it. */
  retrievedAt: string | null;
  /**
   * Age of the datum AT SNAPSHOT TIME (generated_at - retrieved_at). Derived
   * from the snapshot itself, so it never drifts with wall-clock time and is
   * deterministic under replay.
   */
  ageSeconds: number | null;
  /** True when the matching tool result was served from the local cache. */
  isCached: boolean | null;
  /** Staleness the tool layer itself reported, when it did. */
  reportedStalenessSeconds: number | null;
}

/**
 * One row per snapshot provenance entry, enriched with the cache/staleness
 * facts of the tool call that produced it (matched on source_name — the tool
 * layer and the snapshot agree on that label per the contracts).
 */
export function buildProvenanceRows(
  snapshot: SituationSnapshot,
  toolCalls: ToolCall[],
): ProvenanceRow[] {
  return snapshot.provenance.map((entry) => {
    const match = toolCalls.find(
      (call) => call.completed && call.source_name === entry.source_name,
    );
    return {
      field: entry.field,
      sourceType: entry.source_type,
      sourceName: entry.source_name,
      retrievedAt: entry.retrieved_at ?? null,
      ageSeconds: secondsBetween(entry.retrieved_at ?? null, snapshot.generated_at),
      isCached: match ? match.is_cached : null,
      reportedStalenessSeconds: match ? match.staleness_seconds : null,
    };
  });
}

/** Rows whose data was served from cache — the ones staleness matters for. */
export function cachedRows(rows: ProvenanceRow[]): ProvenanceRow[] {
  return rows.filter((row) => row.isCached === true || row.sourceType === "cached_public");
}

/* -------------------------------------------------------------------------- */
/* Environment readings                                                       */
/* -------------------------------------------------------------------------- */

export interface Reading {
  /** Short label shown to the chief. */
  label: string;
  /** Formatted value, already carrying its unit. */
  value: string;
  /** Extra context (gusts, compass point) — omitted when unknown. */
  hint?: string;
  /** Raises attention: dry air, strong wind, steep slope. */
  tone: "neutral" | "warn" | "alert";
}

/**
 * Weather and terrain reduced to the handful of readings that change tactical
 * decisions. A missing field produces NO reading rather than a zero.
 */
export function environmentReadings(snapshot: SituationSnapshot): Reading[] {
  const readings: Reading[] = [];
  const weather = snapshot.weather as Bag;
  const terrain = snapshot.terrain as Bag;

  const wind = num(weather, "wind_speed_kmh");
  if (wind !== null) {
    const gusts = num(weather, "wind_gusts_kmh");
    const compass = degToCompass(num(weather, "wind_direction_deg"));
    const deg = num(weather, "wind_direction_deg");
    readings.push({
      label: "wind",
      value: `${wind} km/h`,
      hint: [
        compass && deg !== null ? `from ${compass} (${deg}°)` : null,
        gusts !== null ? `gusts ${gusts}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
      // Gusts are what push a fire across a break.
      tone: (gusts ?? wind) >= 40 ? "alert" : wind >= 20 ? "warn" : "neutral",
    });
  }

  const humidity = num(weather, "relative_humidity_pct");
  if (humidity !== null) {
    readings.push({
      label: "humidity",
      value: `${humidity} %`,
      // Red-flag fire weather is conventionally RH <= 25% together with strong
      // wind; below 35% fuels already ignite readily.
      tone: humidity <= 25 ? "alert" : humidity < 35 ? "warn" : "neutral",
    });
  }

  const temperature = num(weather, "temperature_c");
  if (temperature !== null) {
    readings.push({
      label: "temp",
      value: `${temperature} °C`,
      tone: temperature >= 35 ? "alert" : temperature >= 30 ? "warn" : "neutral",
    });
  }

  const slope = num(terrain, "slope_estimate_pct");
  if (slope !== null) {
    readings.push({
      label: "slope",
      value: `${slope} %`,
      // Fire spreads markedly faster uphill.
      tone: slope >= 15 ? "alert" : slope >= 8 ? "warn" : "neutral",
    });
  }

  const elevation = num(terrain, "elevation_m");
  if (elevation !== null) {
    readings.push({ label: "elevation", value: `${elevation} m`, tone: "neutral" });
  }

  return readings;
}

/* -------------------------------------------------------------------------- */
/* Roads and hotspots                                                         */
/* -------------------------------------------------------------------------- */

export interface RoadState {
  roadId: string;
  status: string;
  /** Vehicle types explicitly restricted, empty when none were reported. */
  restrictedTo: string[];
  note: string | null;
}

export function roadStates(snapshot: SituationSnapshot): RoadState[] {
  return (snapshot.roads ?? []).flatMap((raw) => {
    const bag = raw as Bag;
    const roadId = str(bag, "road_id");
    if (!roadId) return [];
    const restricted = bag?.["restricted_to"];
    return [
      {
        roadId,
        status: str(bag, "status") ?? "unknown",
        restrictedTo: Array.isArray(restricted)
          ? restricted.filter((v): v is string => typeof v === "string")
          : [],
        note: str(bag, "note"),
      },
    ];
  });
}

/** A road that is not usable, or usable only by some vehicle types. */
export function roadTone(road: RoadState): "ok" | "warn" | "alert" {
  const status = road.status.toLowerCase();
  if (status === "blocked" || status === "closed") return "alert";
  if (road.restrictedTo.length > 0 || status === "restricted") return "warn";
  return "ok";
}

export interface HotspotSummary {
  count: number;
  /** Highest fire radiative power reported, null when none carried it. */
  maxFrpMw: number | null;
  /** Confidence labels present, de-duplicated. */
  confidences: string[];
}

export function hotspotSummary(snapshot: SituationSnapshot): HotspotSummary {
  const spots = snapshot.fire_hotspots ?? [];
  let maxFrpMw: number | null = null;
  const confidences: string[] = [];

  for (const raw of spots) {
    const bag = raw as Bag;
    const frp = num(bag, "frp_mw");
    if (frp !== null && (maxFrpMw === null || frp > maxFrpMw)) maxFrpMw = frp;
    const confidence = str(bag, "confidence");
    if (confidence && !confidences.includes(confidence)) confidences.push(confidence);
  }

  return { count: spots.length, maxFrpMw, confidences };
}
