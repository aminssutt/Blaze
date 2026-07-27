"use client";

// Tickets #40/#41 — the tactical map canvas (MapLibre GL JS).
//
// This module is loaded through `next/dynamic({ ssr: false })` from
// TacticalMap.tsx: MapLibre needs a real DOM, and keeping ~800 kB of WebGL out
// of the initial bundle matters for a control room that boots on a laptop.
//
// It owns the imperative side only — map lifecycle, sources, markers, label
// placement. Every value it draws is decided upstream in tacticalModel.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./TacticalMapCanvas.module.css";
import {
  SOURCES,
  buildStyle,
  buildingColor,
  readPalette,
} from "./mapLayers";
import type { Lng, MarkerSpec, TacticalModel } from "./tacticalModel";
import type { CadastreCollection, OsmCollection } from "./useMapGeoData";

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `setData` on a GeoJSON source. Our collections are structurally GeoJSON but
 * typed locally (tacticalModel.ts owns lightweight shapes so nothing in the app
 * depends on MapLibre's types); this is the single place that bridges the two.
 */
function setGeoJson(map: maplibregl.Map, sourceId: string, data: unknown): void {
  const source = map.getSource(sourceId) as
    | { setData: (value: unknown) => void }
    | undefined;
  source?.setData(data);
}

/** WGS84 readout in the form a control room expects: 43.4552°N 3.7561°E. */
function formatCentre(lat: number, lon: number, zoom: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns}  ${Math.abs(lon).toFixed(4)}°${ew}   z${zoom.toFixed(1)}`;
}

/* -------------------------------------------------------------------------- */
/* Marker DOM                                                                 */
/* -------------------------------------------------------------------------- */

interface MarkerEntry {
  marker: maplibregl.Marker;
  root: HTMLElement;
  /** Hairline from the dot to a label the solver had to push out. */
  leader: HTMLElement;
  label: HTMLElement;
  title: HTMLElement;
  detail: HTMLElement;
  spec: MarkerSpec;
  /** Measured label box, refreshed only when the text changes. */
  size: { w: number; h: number };
}

function createMarkerElement(spec: MarkerSpec): {
  root: HTMLElement;
  leader: HTMLElement;
  label: HTMLElement;
  title: HTMLElement;
  detail: HTMLElement;
} {
  const root = document.createElement("div");
  root.className = styles.marker;

  const ring = document.createElement("span");
  ring.className = styles.ring;
  root.appendChild(ring);

  // Behind the dot on purpose: a leader must never cross the icon it serves.
  const leader = document.createElement("span");
  leader.className = styles.leader;
  root.appendChild(leader);

  const dot = document.createElement("span");
  dot.className = styles.dot;
  dot.textContent = spec.glyph;
  root.appendChild(dot);

  const label = document.createElement("span");
  label.className = styles.label;
  const title = document.createElement("span");
  title.className = styles.labelTitle;
  const detail = document.createElement("span");
  detail.className = styles.labelDetail;
  label.append(title, detail);
  root.appendChild(label);

  return { root, leader, label, title, detail };
}

/** Applies a spec to an existing element without replacing any animated node. */
function applySpec(entry: MarkerEntry, spec: MarkerSpec): boolean {
  const { root, title, detail } = entry;
  root.dataset.kind = spec.kind;
  root.dataset.tone = spec.tone;
  root.dataset.pulse = spec.pulse ? "1" : "0";
  let textChanged = false;
  if (title.textContent !== spec.title) {
    title.textContent = spec.title;
    textChanged = true;
  }
  const nextDetail = spec.detail ?? "";
  if (detail.textContent !== nextDetail) {
    detail.textContent = nextDetail;
    textChanged = true;
  }
  entry.spec = spec;
  return textChanged;
}

/* -------------------------------------------------------------------------- */
/* Label collision solver                                                     */
/* -------------------------------------------------------------------------- */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Breathing room enforced between any two placed boxes, in CSS px. */
const BOX_GUTTER = 4;

function overlaps(a: Box, b: Box): boolean {
  const g = BOX_GUTTER;
  return (
    a.x - g < b.x + b.w &&
    a.x + a.w + g > b.x &&
    a.y - g < b.y + b.h &&
    a.y + a.h + g > b.y
  );
}

/**
 * Space every label has to route around, per marker kind, in CSS px.
 * `note` is the downwind marker: it draws no dot of its own but sits on the
 * arrowhead, and a label parked on top of the one glyph that says which way
 * the wind blows defeats the point of drawing it.
 * `road` markers are bare line midpoints — nothing to avoid.
 */
const RESERVED_PX: Record<string, number> = {
  fire: 32,
  unit: 26,
  asset: 26,
  note: 36,
};

/**
 * Candidate directions, in screen space, ordered by how well a label reads
 * there: beside first (the eye scans horizontally), then the diagonals, then
 * above/below, then straight back across the map. Angles are degrees, 0 = due
 * right, growing clockwise because the screen's y axis points down.
 */
const ANGLES = [0, 180, -32, 32, -148, 148, -68, 68, -112, 112, -90, 90];

/**
 * Distance rings, in CSS pixels, between the icon and the NEAREST EDGE of its
 * label. Everything used to be tried at ~14 px, which is why five labels piled
 * up on the hangar: once the close slots were gone the solver simply gave up
 * and hid the rest. Now it walks outwards and draws a leader line, so a dense
 * corner spreads into a fan instead of collapsing.
 */
const RINGS = [14, 34, 60, 92, 130];

/** Beyond this gap a bare label is ambiguous and gets a leader line. */
const LEADER_FROM_PX = 26;

/**
 * Greedy label placement, highest priority first: the fire keeps its spot, then
 * the engines and the wind, then the assets, then the road names. A label that
 * fits nowhere is hidden rather than stacked — no more "Industrial hangar"
 * printed across "Forest Track 5".
 */
function layoutLabels(map: maplibregl.Map, entries: MarkerEntry[]): void {
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;

  const ordered = [...entries].sort((a, b) => b.spec.priority - a.spec.priority);
  // The map chrome is an obstacle like any other: a label must never end up
  // under the scale bar, the compass or the attribution line.
  const taken: Box[] = [
    { x: 0, y: 0, w: 178, h: 92 }, // north indicator + coordinate readout
    { x: width - 54, y: 0, w: 54, h: 122 }, // zoom + compass
    { x: 0, y: height - 32, w: 156, h: 32 }, // scale bar
    { x: width - 560, y: height - 30, w: 560, h: 30 }, // attribution
  ];

  // Reserve the icons first so no label ever sits on a unit, the fire or the
  // wind arrowhead.
  for (const entry of ordered) {
    const size = RESERVED_PX[entry.spec.kind];
    if (!size) continue;
    const p = map.project(entry.spec.position);
    taken.push({ x: p.x - size / 2, y: p.y - size / 2, w: size, h: size });
  }

  for (const entry of ordered) {
    const { label, leader, size } = entry;
    const p = map.project(entry.spec.position);
    const offscreen =
      p.x < -60 || p.y < -40 || p.x > width + 60 || p.y > height + 40;
    if (offscreen || size.w === 0) {
      label.dataset.hidden = "1";
      leader.dataset.hidden = "1";
      continue;
    }
    // Road names are bare line midpoints: they may sit right on their point.
    // Everything else keeps its reserved glyph clear.
    const reserved = RESERVED_PX[entry.spec.kind] ?? 0;
    const clearance = reserved > 0 ? reserved / 2 - 13 : -8;

    let placed = false;
    // Ring by ring, so the closest legible slot always wins over a far one.
    outer: for (const ring of RINGS) {
      for (const angle of ANGLES) {
        const rad = (angle * Math.PI) / 180;
        const gap = ring + clearance;
        // Push the box out until its near edge sits `gap` px from the icon.
        const cx = p.x + Math.cos(rad) * (gap + size.w / 2);
        const cy = p.y + Math.sin(rad) * (gap + size.h / 2);
        const dx = cx - size.w / 2 - p.x;
        const dy = cy - size.h / 2 - p.y;
        const box: Box = { x: p.x + dx, y: p.y + dy, w: size.w, h: size.h };
        if (box.x < 6 || box.y < 6 || box.x + box.w > width - 6) continue;
        if (box.y + box.h > height - 6) continue;
        if (taken.some((t) => overlaps(box, t))) continue;

        label.style.setProperty("--lx", `${dx}px`);
        label.style.setProperty("--ly", `${dy}px`);
        label.dataset.hidden = "0";

        // The leader stops at the box edge, not at its centre, so it reads as
        // a pointer rather than a line struck through the text.
        const reach = Math.hypot(cx - p.x, cy - p.y) - Math.hypot(size.w, size.h) / 2;
        if (ring >= LEADER_FROM_PX && reach > 8) {
          leader.style.setProperty("--ld", `${reach}px`);
          leader.style.setProperty("--la", `${angle}deg`);
          leader.dataset.hidden = "0";
        } else {
          leader.dataset.hidden = "1";
        }

        taken.push(box);
        placed = true;
        break outer;
      }
    }
    if (!placed) {
      label.dataset.hidden = "1";
      leader.dataset.hidden = "1";
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export interface TacticalMapCanvasProps {
  model: TacticalModel | null;
  cadastre: CadastreCollection | null;
  osm: OsmCollection | null;
}

/** Fixed fallback frame, used until the scenario geometry has loaded. */
const FALLBACK_CENTRE: [number, number] = [3.7561, 43.4552];

/** Opening camera. 60° is where walls read as walls without hiding each other. */
const PITCH = 60;
/**
 * North up. Not a style choice: the incident box is ~2.4 km east–west by
 * 1.8 km north–south on a canvas that is three times wider than it is tall, so
 * height is what limits the zoom. Rotating that box makes its screen height
 * `w·sin θ + h·cos θ` — at the old −18° that is 2.45 km instead of 1.80 km, a
 * third of the available zoom thrown away for a tilt nobody asked for. 0° also
 * means the compass needle points up, which is what a duty officer expects.
 */
const BEARING = 0;
/** Air kept around the framed box, in CSS px: room for the labels and chrome. */
const FRAME_PAD = { top: 58, bottom: 44, left: 56, right: 56 };
/** Never push past this: at some point the far engines leave the frame. */
const MAX_FRAME_ZOOM = 16.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Frame `bounds` as TIGHTLY as the canvas allows.
 *
 * `fitBounds` alone is not enough on a pitched camera: it has to guarantee the
 * box fits inside a trapezoidal ground frustum, so it settles a long way short
 * and the incident ends up as a smudge in the middle of an empty frame. This
 * fits once, then measures what the box ACTUALLY occupies on screen and zooms
 * by the leftover slack — repeated a few times because perspective makes each
 * step non-linear. Purely a camera routine: it reads no data and draws nothing.
 */
function frameBounds(map: maplibregl.Map, bounds: [Lng, Lng]): void {
  map.fitBounds(bounds, {
    padding: FRAME_PAD,
    pitch: PITCH,
    bearing: BEARING,
    duration: 0,
  });

  const corners: Lng[] = [
    [bounds[0][0], bounds[0][1]],
    [bounds[0][0], bounds[1][1]],
    [bounds[1][0], bounds[0][1]],
    [bounds[1][0], bounds[1][1]],
  ];
  const canvas = map.getCanvas();

  for (let pass = 0; pass < 5; pass++) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const pts = corners.map((c) => map.project(c));
    if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return;

    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));

    // Re-centre first: the screen centre of a pitched box is NOT its geographic
    // centre, so panning by the screen delta is the only honest correction.
    const availLeft = FRAME_PAD.left;
    const availTop = FRAME_PAD.top;
    const availW = width - FRAME_PAD.left - FRAME_PAD.right;
    const availH = height - FRAME_PAD.top - FRAME_PAD.bottom;
    if (availW <= 0 || availH <= 0) return;

    const dx = (minX + maxX) / 2 - (availLeft + availW / 2);
    const dy = (minY + maxY) / 2 - (availTop + availH / 2);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) map.panBy([dx, dy], { duration: 0 });

    const slack = Math.min(
      availW / Math.max(maxX - minX, 1),
      availH / Math.max(maxY - minY, 1),
    );
    if (slack < 1.01) return;
    const next = clamp(map.getZoom() + Math.log2(slack), 11, MAX_FRAME_ZOOM);
    if (next <= map.getZoom() + 0.01) return;
    map.setZoom(next);
  }
}

export default function TacticalMapCanvas({
  model,
  cadastre,
  osm,
}: TacticalMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const needleRef = useRef<HTMLSpanElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  /** null = never framed; false = framed before the fire was known. */
  const framedRef = useRef<null | boolean>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const palette = useMemo(() => readPalette(), []);

  /* ---- map lifecycle --------------------------------------------------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Same object for the whole mount: safe to capture for the cleanup.
    const markers = markersRef.current;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: buildStyle(palette),
        center: FALLBACK_CENTRE,
        zoom: 13.2,
        // 60° instead of 50°: the extra 10° roughly doubles how much of each
        // wall the camera sees, which is what turns the cadastre from a dark
        // plan into a city. Beyond ~64° the far blocks start hiding the near
        // ones and the labels pile into the top third of the frame.
        pitch: PITCH,
        bearing: BEARING,
        maxPitch: 72,
        // Extrusion edges are the whole point of this map: pay for MSAA.
        canvasContextAttributes: { antialias: true },
        maplibreLogo: false,
        // Everything drawn here is local data; the credit line names where the
        // files came from, which is the same promise as the SourceBadge.
        attributionControl: {
          compact: true,
          customAttribution:
            "Cadastre Etalab · OpenStreetMap contributors · NASA FIRMS — all served from this machine",
        },
      });
    } catch {
      // No WebGL (remote desktop, locked-down GPU): fall back to the notice.
      // Deferred so the effect never triggers a cascading render inline.
      queueMicrotask(() => setFailed(true));
      return;
    }
    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: true,
      }),
      "top-right",
    );
    map.addControl(
      new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }),
      "bottom-left",
    );

    // These three write straight to the DOM on every camera frame: routing
    // them through React state would re-render the panel ~60 times a second.
    const relayout = () => layoutLabels(map, [...markersRef.current.values()]);
    const spinNeedle = () => {
      const needle = needleRef.current;
      if (needle) needle.style.transform = `rotate(${-map.getBearing()}deg)`;
    };
    const updateReadout = () => {
      const el = readoutRef.current;
      if (!el) return;
      const centre = map.getCenter();
      el.textContent = formatCentre(centre.lat, centre.lng, map.getZoom());
    };

    map.on("load", () => {
      setReady(true);
      updateReadout();
    });
    map.on("move", relayout);
    map.on("move", updateReadout);
    map.on("resize", relayout);
    map.on("rotate", spinNeedle);
    map.on("error", (event) => {
      // A missing optional layer must never take the panel down.
      console.warn("[tactical-map]", event.error?.message ?? event);
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      markers.forEach((entry) => entry.marker.remove());
      markers.clear();
      framedRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [palette]);

  /* ---- cadastre: 10 193 footprints, extruded --------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !cadastre) return;
    setGeoJson(map, SOURCES.cadastre, cadastre);
  }, [ready, cadastre]);

  /* ---- OSM ground network ---------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !osm) return;
    setGeoJson(map, SOURCES.osm, osm);
  }, [ready, osm]);

  /* ---- everything derived from the live incident ----------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !model) return;

    setGeoJson(map, SOURCES.roads, model.roads);
    setGeoJson(map, SOURCES.trails, model.trails);
    setGeoJson(map, SOURCES.starts, model.starts);
    setGeoJson(map, SOURCES.fire, model.fire);
    setGeoJson(map, SOURCES.exclusion, model.exclusion);
    setGeoJson(map, SOURCES.wind, model.windAxis);
    setGeoJson(map, SOURCES.windHead, model.windHead);

    // Buildings are tinted by their distance to the reported hotspot; a new
    // hotspot is one paint update, never a geometry re-upload. Walls and roof
    // rims run the same ramp at two lightnesses.
    map.setPaintProperty(
      "buildings-3d",
      "fill-extrusion-color",
      buildingColor(palette, model.fireCentre, model.exclusionRadiusM, "body"),
    );
    map.setPaintProperty(
      "buildings-cap",
      "fill-extrusion-color",
      buildingColor(palette, model.fireCentre, model.exclusionRadiusM, "roof"),
    );

    /* markers: keyed reconcile, so pulses never restart on a radio event */
    const seen = new Set<string>();
    let measureNeeded = false;
    for (const spec of model.markers) {
      seen.add(spec.id);
      const existing = markersRef.current.get(spec.id);
      if (existing) {
        if (applySpec(existing, spec)) measureNeeded = true;
        existing.marker.setLngLat(spec.position);
        continue;
      }
      const dom = createMarkerElement(spec);
      const marker = new maplibregl.Marker({
        element: dom.root,
        anchor: "center",
      })
        .setLngLat(spec.position)
        .addTo(map);
      const entry: MarkerEntry = {
        marker,
        root: dom.root,
        leader: dom.leader,
        label: dom.label,
        title: dom.title,
        detail: dom.detail,
        spec,
        size: { w: 0, h: 0 },
      };
      applySpec(entry, spec);
      markersRef.current.set(spec.id, entry);
      measureNeeded = true;
    }
    for (const [id, entry] of markersRef.current) {
      if (seen.has(id)) continue;
      entry.marker.remove();
      markersRef.current.delete(id);
    }

    const entries = [...markersRef.current.values()];
    if (measureNeeded) {
      // One batched layout read per model change, never per frame.
      for (const entry of entries) {
        entry.size = {
          w: entry.label.offsetWidth,
          h: entry.label.offsetHeight,
        };
      }
    }
    layoutLabels(map, entries);

    /* Frame the incident when the scenario geometry lands, then ONCE more the
       moment the first hotspot arrives — the opening frame is computed before
       the fire is known, and a map that never re-centres on the fire is a map
       whose main subject can sit just off the edge. */
    const hasFire = model.fireCentre !== null;
    if (framedRef.current === null || (framedRef.current === false && hasFire)) {
      framedRef.current = hasFire;
      frameBounds(map, model.bounds);
      layoutLabels(map, entries);
    }
  }, [ready, model, palette]);

  return (
    <div ref={containerRef} className={styles.root}>
      {failed && (
        <p className={styles.fallback}>
          3D rendering is unavailable on this display (no WebGL context). The
          tactical picture is still available in the situation synthesis panel.
        </p>
      )}
      {!failed && (
        <>
          <div className={styles.north} aria-hidden>
            <span ref={needleRef} className={styles.northNeedle} />
            <span className={styles.northLabel}>N</span>
          </div>
          <div
            ref={readoutRef}
            className={styles.readout}
            aria-label="Map centre coordinates"
          />
        </>
      )}
    </div>
  );
}
