# BLAZE — Data Sources

## Demo location & bounding box (frozen — ticket #7)

- **Commune**: Frontignan / massif de la Gardiole, Hérault, France — garrigue
  terrain genuinely exposed to wildfires (INSEE 34108 for cadastre downloads).
- **Bounding box (WSEN)**: `3.73, 43.44, 3.77, 43.47`
  (min_lon, min_lat, max_lon, max_lat) — matches the `bounding_box` of the
  frozen `incident.started` mock payload.
- **Incident center**: `43.455, 3.756` (Hangar Zone, sector B12).
- Every seeded coordinate (units, Command Post, resources, D17 / North Access /
  Forest Track 5 geometry) lies inside this bbox — verified by
  `scripts/platform/check_geometry.py`, which also regenerates the map preview
  `data/geo/scenario_preview.geojson` (drop it on geojson.io to inspect).
- External adapters use the same bbox: FIRMS area `3.70,43.42,3.80,43.49`
  (small margin), Open-Meteo point `43.45, 3.75`.

BLAZE combines live public APIs, downloaded public geographic data, and clearly labeled seeded demo data. Every datum shown in the UI or used by an agent carries a **provenance label** (see bottom of this page), and every external dependency has a **cached fallback** so the demo works fully offline.

## Source overview

| Source | Purpose | API key | Cache / fallback mode |
|---|---|---|---|
| **Open-Meteo Weather API** | Current weather for the incident area: temperature, relative humidity, wind speed, wind direction, wind gusts, precipitation (when available), retrieval timestamp | **None** (non-commercial hackathon usage) | Scenario response cached locally; offline mode serves the cached response labeled `cached_public` |
| **Open-Meteo Elevation API** | Terrain elevation (90 m model); a simple local slope estimate is derived from several nearby elevation points | **None** (non-commercial hackathon usage) | All values used in the demo cached locally; offline mode serves `cached_public` |
| **NASA FIRMS Area API** | Active-fire hotspots for one predefined bounding box and short time range | **`NASA_FIRMS_MAP_KEY` required** (free, requested before the hackathon) | A valid response is cached; FIRMS unavailability **never blocks the demo** — falls back to `cached_public` or degrades gracefully |
| **Cadastre Etalab** (cadastre.data.gouv.fr) | Buildings (`batiments`) and optionally parcels (`parcelles`) GeoJSON for one chosen commune / prepared area | **None** (public download) | Downloaded, clipped and simplified before the event; served as local files (`cached_public`). No owner/property data included — not part of the open plan data and not needed |
| **OpenStreetMap / Overpass** | Roads, forest tracks, campings, water points, industrial buildings, hospitals/fire stations, electrical infrastructure, route restrictions | **None** (standard public Overpass usage) | Selected features cached as local GeoJSON; **no live Overpass dependency during the pitch** (`cached_public`) |
| **Local routing graph** (deterministic, seeded) | Vehicle-aware routing over a small graph: D17, North Access, Forest Track 5, Water Point 2, Hangar Zone, Command Post, unit positions. Accepts vehicle type, blocked/restricted edges, danger polygons, origin, destination; returns selected route, rejected routes, travel time estimate, reason, vehicle compatibility | **None** (local code + seeded data) | Fully local and deterministic — no external dependency (`seeded_demo`) |
| **Units & resources** (seeded) | Firefighter unit and resource state: Alpha 3 (CCF, suppression, 65% water), Bravo 2 (light recon vehicle), Charlie 1 (light unit), Command Post; Water Point 2, additional CCF, hangar, vulnerable camping, vehicle-restricted road. Files: `/data/scenario/units.json`, `resources.json`, `roads.json`, `incidents.json`, `safety_rules.json` | **None** | Fully local seeded files, **always labeled `seeded_demo`** — no public real-time API exposes live French firefighter staffing/vehicle state, so this data is simulated by design |

## Why seeded operational data?

There is no generic public real-time API that exposes the active staffing, live location, remaining water, mission and vehicle state of French firefighter units. BLAZE therefore uses clearly labeled seeded operational data for units and resources, and never presents it as real.

## Provenance labels

Every UI element and every agent-visible datum indicates one of the following source types:

| Label | Meaning |
|---|---|
| `live_public` | Fetched live from a public API during the session (with source name and retrieval timestamp) |
| `cached_public` | Real public data, downloaded/cached before or during the event, served locally (with original data timestamp and staleness) |
| `seeded_demo` | Simulated operational data created for the demo scenario (units, resources, routing graph) |
| `human_report` | Information extracted from firefighter radio messages (field observations) |
| `model_inference` | Information inferred by a Gemma 4 agent — a suggestion, not ground truth |

Additionally, simulated radio endpoints are labeled `simulated_dispatch`.

## Fallback behavior

- Every external API call goes through the Tool Execution Layer, which validates arguments, times out safely, and **falls back to cached data** automatically.
- Each `ToolResult` records `source_type`, `source_name`, `retrieved_at`, `data_timestamp`, `is_cached`, and `staleness_seconds`.
- In **network blackout** mode, all territorial context is served from local caches, and the full pipeline (STT → agents → TTS) keeps running because every model is local.

## Environment variables

```text
NASA_FIRMS_MAP_KEY=   # only key required by any data source
USE_CACHED_EXTERNAL_DATA=true
NETWORK_MODE=online   # or offline
```

See `.env.example` at the repository root for the complete list.
