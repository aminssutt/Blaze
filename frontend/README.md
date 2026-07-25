# BLAZE frontend

Next.js (App Router) + TypeScript + Tailwind CSS v4 control-room UI for the
BLAZE wildfire incident-command demo.

## Getting started

```bash
npm install
npm run dev     # syncs mocks, then serves http://localhost:3000
npm run build   # syncs mocks, then production build
```

The home page renders the empty control-room shell (header + the 10 required
regions as placeholders) and logs the number of parsed mock events to the
browser console.

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
- `npm run sync-mocks` — copies `contracts/mocks/demo_event_stream.jsonl` into
  `public/mocks/` (git-ignored, regenerated automatically via the `predev` /
  `prebuild` hooks). `contracts/mocks/` remains the single source of truth.
