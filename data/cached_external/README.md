# Cached external data

Snapshots of external API responses so the demo never depends on network or
third-party uptime (fallback level 1 in `docs/ROADMAP.md`).

## NASA FIRMS (active-fire hotspots)

- Fetch/refresh: `./scripts/platform/fetch_firms.sh [west,south,east,north] [days]`
  (reads `NASA_FIRMS_MAP_KEY` from `.env` — key is free, never committed:
  https://firms.modaps.eosdis.nasa.gov/api/map_key/)
- `firms_area_VIIRS_SNPP_NRT.csv` — canonical cache for the demo bbox
  (provisional Hérault bbox `3.70,43.42,3.80,43.49` until ticket #7 freezes it;
  re-run the script after #7).
- `firms_area_sample_occitanie.csv` — wider 48 h Occitanie sample containing
  real hotspots, useful to render believable fire markers offline.
- Each `.csv` has a `.meta.json` sibling: source, bbox, time range, fetch time, row count.

### Fallback behavior (FIRMS must never block the demo)

1. `NETWORK_MODE=online` and FIRMS reachable → live Area API call, response
   re-cached here on success.
2. FIRMS unreachable / times out / returns a non-CSV error body → serve the
   cached CSV, and tag the tool result `"source": "cached"` so provenance
   badges in the UI show the data is not live.
3. No cache present → empty hotspot list with `"source": "unavailable"` —
   the scenario's seeded fire geometry still drives the demo.

Known API quirks (observed): the free key allows 5000 transactions / 10 min;
large bbox + long time ranges can return an empty body instead of an error —
treat empty (headerless) responses as failures and fall back to cache.
