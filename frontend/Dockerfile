# BLAZE frontend — Next.js production server. Build from the REPO ROOT:
#   docker build -f frontend/Dockerfile -t blaze-frontend .
#
# The context is the repo root, not frontend/, because the build reaches
# outside frontend/:
#   - prebuild -> sync-mocks reads contracts/mocks/demo_event_stream.jsonl
#   - prebuild -> sync-data  reads data/{scenario,geo,audio,audio/tts}
#   - app/globals.css imports ../design/tokens.css
#   - next.config.ts pins the Turbopack root to the repo root

# --- build ----------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app

# Dependencies first — only the lockfile invalidates this layer.
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

# Everything the build reads, repo-root-relative.
COPY design/ ./design/
COPY contracts/ ./contracts/
COPY data/ ./data/
COPY frontend/ ./frontend/

WORKDIR /app/frontend

# `next build` EVALUATES rewrites() and bakes the destination into
# .next/routes-manifest.json — BACKEND_URL is read at build time, never at
# runtime. It must therefore be a build arg; setting it only as a runtime
# env var silently leaves http://localhost:8080 baked in and every
# /api/backend/* call 500s with ECONNREFUSED.
ARG BACKEND_URL=http://backend:8080
ENV BACKEND_URL=${BACKEND_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# prebuild regenerates public/mocks + public/data (git-ignored, excluded from
# the context on purpose) before `next build`.
RUN npm run build

# --- runtime --------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Production dependencies only (next itself is a runtime dependency).
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --omit=dev

# next.config.ts joins __dirname/.. as the Turbopack root, so /app must exist
# as the parent of /app/frontend — it does.
COPY --from=builder /app/frontend/.next ./frontend/.next
COPY --from=builder /app/frontend/public ./frontend/public
COPY --from=builder /app/frontend/next.config.ts ./frontend/next.config.ts

WORKDIR /app/frontend
EXPOSE 3000

# BACKEND_URL (server-side) drives the /api/backend/* rewrite. Leave
# NEXT_PUBLIC_BACKEND_URL unset so the browser stays same-origin: no CORS, and
# the backend never needs to be publicly exposed.
CMD ["npm", "run", "start"]
