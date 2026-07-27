// Tickets #40/#41 — the tactical map's MapLibre style.
//
// OFFLINE BY CONSTRUCTION (product invariant #5). There is no tile server, no
// sprite URL and no glyph URL in this style: every pixel is rasterised from
// GeoJSON that ships in the repo. That is also why the map carries no symbol
// layers — symbol text would require a remote (or pre-baked) glyph endpoint —
// and why labels are DOM elements laid out by MapLabels instead.
//
// Colours are READ FROM design/tokens.css at runtime (WebGL cannot resolve CSS
// variables), so the map re-themes with the rest of the control room.

import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import type { Lng } from "./tacticalModel";

/* -------------------------------------------------------------------------- */
/* Palette                                                                    */
/* -------------------------------------------------------------------------- */

const TOKEN_FALLBACKS = {
  bg: "#0a0c10",
  border: "#232936",
  borderStrong: "#343d4f",
  textFaint: "#5c6577",
  accent: "#f59e0b",
  accentStrong: "#f97316",
  accentDim: "#7c4a03",
  alert: "#ef4444",
  ok: "#22c55e",
  warn: "#eab308",
  info: "#38bdf8",
} as const;

export type Palette = Record<keyof typeof TOKEN_FALLBACKS, string>;

const TOKEN_NAMES: Record<keyof typeof TOKEN_FALLBACKS, string> = {
  bg: "--blaze-bg",
  border: "--blaze-border",
  borderStrong: "--blaze-border-strong",
  textFaint: "--blaze-text-faint",
  accent: "--blaze-accent",
  accentStrong: "--blaze-accent-strong",
  accentDim: "--blaze-accent-dim",
  alert: "--blaze-alert",
  ok: "--blaze-ok",
  warn: "--blaze-warn",
  info: "--blaze-info",
};

/** Resolves the `--blaze-*` tokens to concrete hex values for the GL context. */
export function readPalette(): Palette {
  const palette = { ...TOKEN_FALLBACKS } as Palette;
  if (typeof window === "undefined") return palette;
  const computed = getComputedStyle(document.documentElement);
  for (const key of Object.keys(TOKEN_NAMES) as (keyof Palette)[]) {
    const value = computed.getPropertyValue(TOKEN_NAMES[key]).trim();
    if (value) palette[key] = value;
  }
  return palette;
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

export const SOURCES = {
  osm: "osm",
  cadastre: "cadastre",
  roads: "scenario-roads",
  trails: "unit-trails",
  starts: "unit-starts",
  fire: "fire",
  exclusion: "exclusion",
  wind: "wind",
  windHead: "wind-head",
} as const;

const EMPTY: { type: "FeatureCollection"; features: [] } = {
  type: "FeatureCollection",
  features: [],
};

/* -------------------------------------------------------------------------- */
/* Building extrusion                                                         */
/* -------------------------------------------------------------------------- */

/**
 * NOMINAL HEIGHTS. The Etalab cadastre carries no height attribute — only a
 * construction class ("01" durable, "02" light). The extrusion therefore uses
 * one nominal height per class and the panel says so; nothing here pretends to
 * be a measured elevation.
 */
export const NOMINAL_HEIGHT_M = { durable: 9, light: 4 } as const;

const HEIGHT_EXPRESSION: ExpressionSpecification = [
  "match",
  ["get", "t"],
  "02",
  NOMINAL_HEIGHT_M.light,
  NOMINAL_HEIGHT_M.durable,
];

/**
 * Thickness of the bright roof rim (metres, taken OFF the nominal height, not
 * added to it — the silhouette stays exactly as tall as the nominal class).
 *
 * A single flat-topped extrusion on a near-black backdrop reads as a dark plan
 * seen from an angle: the eye gets no edge to separate roof from wall. Splitting
 * each footprint into a body (0 → h−rim) and a lit cap (h−rim → h) draws that
 * edge, and the two solids never share a face, so nothing z-fights.
 */
const ROOF_RIM_M = 1.1;

const BODY_TOP_EXPRESSION: ExpressionSpecification = [
  "-",
  HEIGHT_EXPRESSION,
  ROOF_RIM_M,
];

const M_PER_DEG_LAT = 111_320;

/**
 * Great-circle-ish distance, in metres, from each building's cached centroid
 * (`cx`/`cy`, injected at load) to the reported hotspot. Expressed as a style
 * expression so a new hotspot costs one `setPaintProperty` instead of a 3 MB
 * re-upload of 10 193 footprints.
 */
function distanceToExpression([hx, hy]: Lng): ExpressionSpecification {
  const kx = M_PER_DEG_LAT * Math.cos((hy * Math.PI) / 180);
  return [
    "sqrt",
    [
      "+",
      ["^", ["*", ["-", ["get", "cx"], hx], kx], 2],
      ["^", ["*", ["-", ["get", "cy"], hy], M_PER_DEG_LAT], 2],
    ],
  ];
}

/**
 * The two faces of the same tint ramp: `body` is the wall mass, `roof` is the
 * lit cap that draws the top edge. Both ramps run from "at the hotspot" to
 * "far from it"; the roof one is simply ~30 % lighter so every block gets a
 * highlight the eye can read as a horizontal surface.
 *
 * Walls used to be #222a3a on a #070910 backdrop — a 4 % luminance step, which
 * is why the city read as a flat dark plan. These sit well clear of the sky.
 */
type BuildingFace = "body" | "roof";

const RAMP: Record<BuildingFace, {
  hot: string;
  warm: string;
  edge: string;
  outside: string;
  cool: string;
}> = {
  body: {
    hot: "#c04c2b",
    warm: "#8b4930",
    edge: "#5f4438",
    outside: "#333e57",
    cool: "#2f3950",
  },
  // At the opening camera a 9 m wall is barely a pixel: what actually draws
  // the built-up area is the ROOF value, so the roof ramp carries most of the
  // contrast budget against a #05070d ground. The cool end stays a cold slate —
  // bright enough to lift the city off the ground, dark enough that the hot end
  // still reads as "this is where the fire is" and not as glare.
  roof: {
    hot: "#ff8a4c",
    warm: "#c2734a",
    edge: "#8b6a57",
    outside: "#525f80",
    cool: "#4c5876",
  },
};

/**
 * Building tint = distance to the reported hotspot. When the hazmat exclusion
 * radius is known (safety rule sr-hazmat-perimeter) the ramp breaks sharply at
 * that radius, so "inside the perimeter" is readable at a glance.
 */
export function buildingColor(
  palette: Palette,
  fireCentre: Lng | null,
  exclusionRadiusM: number | null,
  face: BuildingFace = "body",
): ExpressionSpecification | string {
  const c = RAMP[face];
  if (!fireCentre) return c.cool;
  const d = distanceToExpression(fireCentre);
  const ring = exclusionRadiusM ?? null;
  if (ring === null) {
    return [
      "interpolate",
      ["linear"],
      d,
      0,
      c.hot,
      400,
      c.warm,
      1100,
      c.cool,
    ];
  }
  return [
    "interpolate",
    ["linear"],
    d,
    0,
    c.hot,
    ring * 0.85,
    c.warm,
    ring,
    c.edge,
    ring * 1.02,
    c.outside,
    ring * 4,
    c.cool,
  ];
}

/* -------------------------------------------------------------------------- */
/* Style                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The full style, sources included. Every source starts empty and is filled by
 * `setData` as the fetches resolve, so a layer whose data never arrives simply
 * draws nothing — the map degrades one layer at a time, never all at once.
 */
export function buildStyle(palette: Palette): StyleSpecification {
  const layers: LayerSpecification[] = [
    {
      // Deliberately the darkest thing on screen: everything the operator has
      // to read — buildings, fire, engines, wind — is lighter than the ground.
      id: "backdrop",
      type: "background",
      paint: { "background-color": "#05070d" },
    },

    /* ---- OSM ground cover -------------------------------------------- */
    {
      id: "osm-water",
      type: "fill",
      source: SOURCES.osm,
      filter: ["==", ["get", "natural"], "water"],
      paint: { "fill-color": "#0a2233", "fill-opacity": 0.9 },
    },
    {
      id: "osm-landuse",
      type: "fill",
      source: SOURCES.osm,
      filter: ["has", "landuse"],
      paint: { "fill-color": "#101521", "fill-opacity": 0.9 },
    },

    /* ---- the fire, on the ground, under the city --------------------- */
    {
      id: "fire-heat",
      type: "heatmap",
      source: SOURCES.fire,
      paint: {
        "heatmap-weight": [
          "interpolate",
          ["linear"],
          ["get", "frp_mw"],
          0,
          0.35,
          40,
          1,
        ],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 2.6],
        "heatmap-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          11,
          24,
          14,
          90,
          17,
          260,
        ],
        "heatmap-opacity": 0.8,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(0,0,0,0)",
          0.15,
          "rgba(124,74,3,0.35)",
          0.4,
          "rgba(245,158,11,0.5)",
          0.7,
          "rgba(249,115,22,0.72)",
          1,
          "rgba(255,238,196,0.92)",
        ],
      },
    },
    {
      id: "exclusion-fill",
      type: "fill",
      source: SOURCES.exclusion,
      paint: { "fill-color": palette.alert, "fill-opacity": 0.07 },
    },

    /* ---- OSM network -------------------------------------------------- */
    {
      id: "osm-road-casing",
      type: "line",
      source: SOURCES.osm,
      filter: ["==", ["get", "category"], "road"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#0a0d14",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          11,
          1.2,
          14,
          3,
          17,
          9,
        ],
      },
    },
    {
      id: "osm-road",
      type: "line",
      source: SOURCES.osm,
      filter: ["==", ["get", "category"], "road"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "match",
          ["get", "highway"],
          ["primary", "secondary"],
          "#4b5772",
          ["residential", "unclassified"],
          "#2f374a",
          "#272e3e",
        ],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          11,
          ["match", ["get", "highway"], ["primary", "secondary"], 0.9, 0.35],
          14,
          ["match", ["get", "highway"], ["primary", "secondary"], 2.4, 1.1],
          17,
          ["match", ["get", "highway"], ["primary", "secondary"], 7, 3.2],
        ],
      },
    },
    {
      id: "osm-track",
      type: "line",
      source: SOURCES.osm,
      filter: ["==", ["get", "category"], "track"],
      paint: {
        "line-color": "#2a3040",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 17, 1.6],
        "line-dasharray": [3, 2],
      },
    },

    /* ---- the city, in 3D ---------------------------------------------
       Two solids per footprint, stacked and never coincident:
         buildings-3d   0 → h−rim   the wall mass, vertically graded
         buildings-cap  h−rim → h   the lit roof rim that draws the top edge
       Both are fully opaque: a translucent extrusion lets the ground bleed
       through and is exactly what made this city look like a flat plan. */
    {
      id: "buildings-3d",
      type: "fill-extrusion",
      source: SOURCES.cadastre,
      paint: {
        "fill-extrusion-color": RAMP.body.cool,
        "fill-extrusion-height": BODY_TOP_EXPRESSION,
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      id: "buildings-cap",
      type: "fill-extrusion",
      source: SOURCES.cadastre,
      paint: {
        "fill-extrusion-color": RAMP.roof.cool,
        "fill-extrusion-height": HEIGHT_EXPRESSION,
        "fill-extrusion-base": BODY_TOP_EXPRESSION,
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": false,
      },
    },

    /* ---- operational overlays ---------------------------------------- */
    {
      id: "exclusion-line",
      type: "line",
      source: SOURCES.exclusion,
      paint: {
        "line-color": palette.alert,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 17, 4],
        "line-dasharray": [2.6, 2],
        "line-opacity": 1,
      },
    },
    /* ---- wind: a shaft and a head, so "which way" needs no legend ----
       The BEARING is the datum (cached open-meteo forecast). The 900 m length
       is drawing, not physics: nothing here claims a spread rate. */
    {
      id: "wind-axis-halo",
      type: "line",
      source: SOURCES.wind,
      layout: { "line-cap": "round" },
      paint: {
        "line-color": palette.info,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 17, 16],
        "line-opacity": 0.14,
        "line-blur": 5,
      },
    },
    {
      id: "wind-axis",
      type: "line",
      source: SOURCES.wind,
      layout: { "line-cap": "butt" },
      paint: {
        "line-color": palette.info,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.6, 17, 3.4],
        "line-dasharray": [3, 2.2],
        "line-opacity": 0.95,
      },
    },
    {
      id: "wind-head",
      type: "fill",
      source: SOURCES.windHead,
      paint: { "fill-color": palette.info, "fill-opacity": 0.9 },
    },

    {
      id: "plan-kept-halo",
      type: "line",
      source: SOURCES.roads,
      filter: ["match", ["get", "plan"], ["kept", "split"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": palette.ok,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 6, 17, 22],
        "line-opacity": 0.28,
        "line-blur": 4,
      },
    },
    {
      id: "road-open",
      type: "line",
      source: SOURCES.roads,
      filter: ["==", ["get", "state"], "open"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": palette.borderStrong,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 17, 6],
      },
    },
    {
      id: "road-restricted",
      type: "line",
      source: SOURCES.roads,
      filter: ["==", ["get", "state"], "restricted"],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": palette.warn,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 17, 6],
        "line-dasharray": [2.6, 1.6],
      },
    },
    {
      id: "road-blocked",
      type: "line",
      source: SOURCES.roads,
      filter: ["==", ["get", "state"], "blocked"],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": palette.alert,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.8, 17, 6.5],
        "line-dasharray": [2, 1.4],
      },
    },
    // Audio-4 correction: the CCF stays blocked (solid red core) while light
    // vehicles pass (amber dashes riding on top) — one road, two verdicts.
    {
      id: "road-corrected-core",
      type: "line",
      source: SOURCES.roads,
      filter: ["==", ["get", "state"], "corrected"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": palette.alert,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.4, 17, 8],
      },
    },
    {
      id: "road-corrected-pass",
      type: "line",
      source: SOURCES.roads,
      filter: ["==", ["get", "state"], "corrected"],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": palette.warn,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 17, 3.2],
        "line-dasharray": [2.2, 1.8],
      },
    },
    {
      id: "plan-discarded",
      type: "line",
      source: SOURCES.roads,
      filter: ["match", ["get", "plan"], ["discarded", "split"], true, false],
      paint: {
        "line-color": palette.alert,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 17, 2.4],
        "line-dasharray": [0.6, 2.4],
        "line-opacity": 0.9,
      },
    },

    /* ---- engines ------------------------------------------------------ */
    {
      id: "unit-trail",
      type: "line",
      source: SOURCES.trails,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "match",
          ["get", "tone"],
          "accent",
          palette.accent,
          "info",
          palette.info,
          palette.textFaint,
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 17, 3],
        "line-dasharray": [1.6, 1.6],
        "line-opacity": 0.75,
      },
    },
    {
      id: "unit-start",
      type: "circle",
      source: SOURCES.starts,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2, 17, 5],
        "circle-color": [
          "match",
          ["get", "tone"],
          "accent",
          palette.accent,
          "info",
          palette.info,
          palette.textFaint,
        ],
        "circle-opacity": 0.35,
      },
    },

    /* ---- fire core, above everything ---------------------------------- */
    {
      id: "fire-glow",
      type: "circle",
      source: SOURCES.fire,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 17, 140],
        "circle-color": palette.accentStrong,
        "circle-opacity": 0.32,
        "circle-blur": 1,
      },
    },
    {
      id: "fire-ring",
      type: "circle",
      source: SOURCES.fire,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 8, 17, 40],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#ffd28a",
        "circle-stroke-width": 1.2,
        "circle-stroke-opacity": 0.5,
      },
    },
    {
      id: "fire-core",
      type: "circle",
      source: SOURCES.fire,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 17, 18],
        "circle-color": "#fff4d6",
        "circle-stroke-color": palette.alert,
        "circle-stroke-width": 2,
        "circle-opacity": 1,
      },
    },
  ];

  return {
    version: 8,
    // No `glyphs`, no `sprite`, no remote source: nothing to fetch off-machine.
    sources: {
      [SOURCES.osm]: { type: "geojson", data: EMPTY },
      [SOURCES.cadastre]: { type: "geojson", data: EMPTY },
      [SOURCES.roads]: { type: "geojson", data: EMPTY },
      [SOURCES.trails]: { type: "geojson", data: EMPTY },
      [SOURCES.starts]: { type: "geojson", data: EMPTY },
      [SOURCES.fire]: { type: "geojson", data: EMPTY },
      [SOURCES.exclusion]: { type: "geojson", data: EMPTY },
      [SOURCES.wind]: { type: "geojson", data: EMPTY },
      [SOURCES.windHead]: { type: "geojson", data: EMPTY },
    },
    // Anchored to the MAP, not the viewport: the sun stays put when the
    // operator rotates the camera, so a wall that was lit stays lit and the
    // roof/wall contrast never inverts mid-gesture. Warm and hard enough that
    // a 9 m block casts a readable value step between its faces.
    light: {
      anchor: "map",
      color: "#ffe9cc",
      intensity: 0.62,
      position: [1.5, 235, 38],
    },
    // A pitched map with no horizon is just a black band at the top of the
    // frame. This is a colour ramp, not a data layer — nothing is fetched.
    sky: {
      "sky-color": "#05070d",
      "horizon-color": "#182238",
      "fog-color": "#0a0e16",
      "sky-horizon-blend": 0.7,
      "horizon-fog-blend": 0.55,
      "fog-ground-blend": 0.6,
      "atmosphere-blend": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        0.5,
        16,
        0.15,
      ],
    },
    layers,
  };
}
