# Deploying BLAZE on Dokploy — replay demo

The deployed site runs the **frozen replay demo**: no LLM, no GPU, no API key.
`DemoController` (`backend/api/demo.py`) re-emits the 70 events of
`contracts/mocks/demo_event_stream.jsonl` through the SSE bus, which is what
`/workflow`, `/expert` and the landing preview consume.

The live Gemma pipeline (`backend/orchestrator/incident_pipeline.py`) is **not**
part of this deployment — it was only ever run from
`scripts/ai/run_e2e_one_audio.py`, never wired into the API.

## What ships

| File | Role |
|---|---|
| `backend/Dockerfile` | FastAPI + SSE. Context = repo root (`REPO_ROOT` must be `/app`). |
| `frontend/Dockerfile` | Next.js production build. Context = repo root (the prebuild reads `contracts/` and `data/`). |
| `docker-compose.dokploy.yml` | Both services, no vLLM, no GPU. |
| `.dockerignore` | Keeps `video/`, `docs/`, screenshots and weights out of the context. |

`docker-compose.yml` (dev, with the vLLM/GPU service) is **left untouched** —
docker is Selyan's lane, and nothing here changes it.

## Architecture

```
browser ──► frontend :3000 ──/api/backend/*──► backend :8080
            (public)          (Next rewrite)   (internal only)
```

### Two stream modes — the demo does not need the backend

`frontend/lib/streamMode.ts` resolves the source in this order: `localStorage`
override (header toggle) → `NEXT_PUBLIC_STREAM_MODE` → **`"mock"`**.

- **`mock` (the default, and what the demo uses)** — a client-side timed replay
  of `public/mocks/demo_event_stream.jsonl`, driven by the ▶ button in the
  workflow header. **No backend call at all.** The demo survives the backend
  being down.
- **`live`** — a real SSE connection to the backend, opt-in via the header
  toggle or a `NEXT_PUBLIC_STREAM_MODE=live` build.

The backend is therefore only on the critical path in `live` mode. It is still
deployed because the approval/dispatch/audio endpoints and `/health` come from
it.

The browser never talks to the backend directly: `getBackendBase()` returns the
same-origin path `/api/backend`, which `next.config.ts` rewrites to
`BACKEND_URL`. Consequences:

- the backend needs **no public domain** and no CORS,
- SSE works because `next.config.ts` sets `compress: false` (Next's gzip
  otherwise buffers the stream and `EventSource` receives nothing).

⚠️ **Do not set `NEXT_PUBLIC_BACKEND_URL`.** It makes the browser bypass the
proxy and hit the backend directly, which would require exposing the backend
publicly and re-opening CORS.

### ⚠️ `BACKEND_URL` is a BUILD argument, not a runtime variable

`next build` **evaluates `rewrites()`** and bakes the destination into
`.next/routes-manifest.json`. Setting `BACKEND_URL` only as a runtime env var
leaves `http://localhost:8080` baked in, and every `/api/backend/*` call fails
with `ECONNREFUSED 127.0.0.1:8080`.

It is therefore passed as a Docker build arg (`frontend/Dockerfile`, defaulting
to `http://backend:8080`, set in `docker-compose.dokploy.yml` under
`build.args`). **Changing it requires a rebuild, not a restart.**

## Dokploy setup

1. **Create the application** — type **Docker Compose**, pointed at this repo,
   branch `main`.
2. **Compose file path**: `docker-compose.dokploy.yml`.
3. **Domain**: attach it to service `frontend`, port `3000`. Let Dokploy/Traefik
   handle TLS. Once the domain is routing, the `ports:` mapping on `frontend`
   in the compose file can be removed.
4. **Environment** (all optional — the defaults in the compose file work):

   | Variable | Default | Note |
   |---|---|---|
   | `SCENARIO_ID` | `wildfire-demo-01` | |
   | `NETWORK_MODE` | `online` | the "cut the network" toggle overrides it at runtime |
   | `FRONTEND_PORT` | `3000` | host port, irrelevant once Traefik routes |

   No secret is required. There is no `.env` in the images — `pydantic-settings`
   skips a missing env file and falls back to the defaults in
   `backend/api/config.py`.
5. **Deploy.** First build is slow (`npm ci` + `next build`); later ones hit the
   layer cache as long as the lockfiles don't change.

### Traefik and SSE

If you enable a **compression middleware** on the Dokploy/Traefik route, the SSE
stream will be buffered and the live view will stay empty — the same failure
`compress: false` fixes at the Next level (ticket #54). Leave compression off
for this app.

## Local verification

```bash
docker compose -f docker-compose.dokploy.yml up -d --build
curl localhost:3000/api/backend/health          # through the proxy
open http://localhost:3000/workflow             # then press ▶
```

`FRONTEND_PORT=3001 docker compose -f … up -d` if 3000 is taken by `next dev`.

Teardown: `docker compose -f docker-compose.dokploy.yml down`. State is
in-memory — down means reset.

Verified on 2026-07-26 (images: backend 514 MB, frontend 382 MB):

- both containers reach `healthy`,
- `/api/backend/health` answers through the proxy,
- the SSE stream delivers **53 events in 12 s** with `Accept-Encoding: gzip`
  (the exact ticket-#54 failure mode) — not buffered,
- `/workflow` runs the replay to completion in the browser: incident name,
  sequence counter, per-agent `working`/`done`, the 7 allowlisted tools green,
  0 console errors.

## Known gaps

- **TTS is not synthesized at runtime.** `PIPER_VOICE_PATH` is empty and no
  Piper voice ships in the image; `TTSService` degrades to its text-only
  fallback (it never raises). The dispatch WAVs the demo plays are the
  pre-generated ones under `data/audio/tts/`, served from the frontend.
- **`/settings` still shows the hackathon hardware**: the `INSTALL_ROWS` block
  (`frontend/app/settings/page.tsx:30`), the NVIDIA panel and the Gemma
  consumption table. They are fed by the replay stream, so they render, but they
  describe the L40S/vLLM setup that no longer exists. Cleaning this up (and
  moving the content to a "what the hackathon was" page) is separate work.
- The landing still claims "100% local · 0 cloud LLM calls"
  (`frontend/components/landing/Hero.tsx:87`). True of this deployment — there
  is no LLM at all — but it is describing the old architecture.
