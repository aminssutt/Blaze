# BLAZE frontend

Next.js (App Router) + TypeScript + Tailwind CSS v4 control-room UI for the
BLAZE wildfire incident-command demo.

## Getting started

```bash
npm install
npm run dev            # syncs fixtures, then serves http://localhost:3000
npm run build          # syncs fixtures, then production build
npm run verify-store   # replays the mock stream through the real store (tests)
npm run lint
```

## Control-room layout (ticket #38)

`app/page.tsx` owns **grid placement and nothing else**. It targets a single
1920x1080 screen: at `xl` and up the page never scrolls in either direction
(`xl:h-screen` + `xl:overflow-hidden`) and every panel absorbs its own overflow
through the shared `<Panel>` primitive. Below `xl` the same panels stack into
one column and the page scrolls vertically — there is never a horizontal
scroll.

Each region lives in its own file owned by exactly one ticket, so the panel
tickets (#40–#51) never touch the grid or each other:

| Region | Component | Ticket |
| --- | --- | --- |
| 1 · header / status | `components/HeaderBar.tsx` | #38 |
| 2 · tactical map | `components/map/TacticalMap.tsx` | #40, #41 |
| 3 · radio timeline | `components/radio/RadioTimeline.tsx` | #42 |
| 4 · structured events | `components/radio/RadioEventCards.tsx` | #43 |
| 5 · agent & tool trace | `components/trace/AgentTracePanel.tsx` | #44 |
| 6 · situation snapshot | `components/situation/SituationSnapshotPanel.tsx` | #45 |
| 7 · tactical plan | `components/plan/TacticalPlanPanel.tsx` | #46 |
| 8 · safety critic | `components/safety/SafetyCriticPanel.tsx` | #47 |
| 9 · approval gate | `components/approval/ApprovalGate.tsx` | #48 |
| 10 · dispatch | `components/dispatch/DispatchPanel.tsx` | #49 |
| — · NVIDIA metrics | `components/metrics/NvidiaMetricsPanel.tsx` | #50 |
| — · banners / controls | `components/banners/`, `components/controls/` | #51 |

`components/ui/` holds the shared presentational primitives (`Panel`, `Badge`,
`SourceBadge`, `StatusDot`, `StatusPill`, `Chip`, `Meter`, `EmptyState`).
**Nothing in `components/ui/` reads the incident store** — panels pass props in.

### Honest statuses

The header pills are derived by `lib/systemStatus.ts` from reduced events only.
Nothing is invented: a value that has not been reported yet renders "en
attente" in grey, and a value that is inferred (or whose payload declares
itself a placeholder, like the mock `metric.updated`) is prefixed with `~` and
flagged in its tooltip. A demo that fakes GPU telemetry is worse than one that
admits it is still waiting for it.

## Design tokens — single source of truth

All design tokens (colors, spacing, typography, radii) live in **one place**:
[`design/tokens.css`](../design/tokens.css) at the repo root.

Chosen approach: `app/globals.css` imports `../../design/tokens.css` directly
and maps the `--blaze-*` variables into Tailwind's `@theme inline` block, so
Tailwind utilities (`bg-surface`, `text-accent`, `text-alert`, `font-mono`, …)
resolve to the tokens. Rationale: tokens stay usable by non-frontend consumers
(design docs, future exports) while the frontend gets Tailwind ergonomics
without duplicating any value. Never redefine token values inside `frontend/`.

Theme: dark control-room — very dark background, fire amber/orange accents,
alert red, status green, monospace for technical data.

## Contracts and mock stream

- `lib/contracts.ts` — TypeScript types hand-written from the frozen JSON
  Schemas in `contracts/schemas/*.schema.json` (event envelope, the 27
  `event_type` values, RadioEvent, DraftTacticalPlan, SafetyReview,
  DispatchInstruction, ToolResult, SituationSnapshot, …). The schemas are the
  source of truth; never edit them from this workstream.
- `lib/mockStream.ts` — fetches `/mocks/demo_event_stream.jsonl`, parses each
  JSONL line into a typed `EventEnvelope`, and throws if any line fails
  envelope validation (all 70 demo events must parse).
- `lib/scenarioData.ts` — typed loaders for the seeded scenario fixtures
  (`data/scenario/*.json`, `data/geo/*.geojson`, `data/audio/manifest.json`)
  that the map, snapshot and radio panels read. Same-origin fetches only.
- `npm run sync-mocks` — copies `contracts/mocks/demo_event_stream.jsonl` into
  `public/mocks/` (git-ignored, regenerated automatically via the `predev` /
  `prebuild` hooks). `contracts/mocks/` remains the single source of truth.
- `npm run sync-data` — same pattern for `data/` → `public/data/`. Both run
  together as `npm run sync-fixtures` from the `predev` / `prebuild` hooks.

## Tests

`npm run verify-store` replays the frozen 70-event demo stream through the
**real** `lib/incidentStore.ts` and `lib/systemStatus.ts` (Node strips the
types — no test framework, no duplicated logic) and asserts:

- every event reduces, and the bookkeeping matches the stream,
- **product invariant #1** — `dispatchUnlocked` stays `false` at every prefix
  before `approval.received` carries an `approve` decision,
- the restart rule: a non-increasing sequence rebuilds state from scratch, and
  an approval never leaks across a replay,
- the reducer is pure (folding twice yields the same state),
- the header pills stay honest — the GPU is never claimed before a
  `metric.updated` carries it, and placeholder metrics are never presented as
  measured.
