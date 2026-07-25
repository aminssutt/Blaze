#!/usr/bin/env bash
# Ticket #8 — Fetch NASA FIRMS hotspots for the demo bbox and cache the response.
#
# Reads NASA_FIRMS_MAP_KEY from .env (never committed).
# Writes data/cached_external/firms_area_<source>.csv + .meta.json
#
# Usage: ./scripts/platform/fetch_firms.sh [west,south,east,north] [days]
# Default bbox: provisional demo area (Hérault) — finalize with ticket #7.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$REPO_ROOT/.env"

: "${NASA_FIRMS_MAP_KEY:?NASA_FIRMS_MAP_KEY missing from .env}"

BBOX="${1:-3.70,43.42,3.80,43.49}"
DAYS="${2:-3}"
SOURCE="VIIRS_SNPP_NRT"
OUT_DIR="$REPO_ROOT/data/cached_external"
OUT_CSV="$OUT_DIR/firms_area_${SOURCE}.csv"
OUT_META="$OUT_DIR/firms_area_${SOURCE}.meta.json"

url="https://firms.modaps.eosdis.nasa.gov/api/area/csv/$NASA_FIRMS_MAP_KEY/$SOURCE/$BBOX/$DAYS"
body="$(curl -sf "$url")"

# FIRMS returns errors as HTML/text, valid data as CSV starting with "latitude,"
if [[ "$body" != latitude,* ]]; then
  echo "FIRMS error response: $(echo "$body" | head -c 200)" >&2
  exit 1
fi

printf '%s\n' "$body" > "$OUT_CSV"
rows=$(( $(wc -l < "$OUT_CSV") - 1 ))
printf '{\n  "source": "%s",\n  "bbox_wsen": "%s",\n  "days": %s,\n  "fetched_at": "%s",\n  "rows": %s\n}\n' \
  "$SOURCE" "$BBOX" "$DAYS" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rows" > "$OUT_META"

echo "Cached $rows hotspot rows -> $OUT_CSV"
