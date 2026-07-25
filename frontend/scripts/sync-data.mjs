/**
 * Copies the scenario / geo / audio fixtures the control-room panels need into
 * frontend/public/data/ so the browser can fetch them at runtime. Runs
 * automatically before `npm run dev` and `npm run build` (predev / prebuild
 * hooks), or manually via `npm run sync-data`. Same pattern as sync-mocks.mjs:
 * the copy in public/ is generated and git-ignored — the repo files under
 * `data/` stay the single source of truth and are never modified here.
 *
 * Copied (ticket #38):
 *   data/scenario/*.json          -> public/data/scenario/
 *   data/geo/*.geojson            -> public/data/geo/
 *   data/audio/manifest.json      -> public/data/audio/
 *   data/audio/*.wav              -> public/data/audio/
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(frontendRoot, "..");
const publicData = join(frontendRoot, "public", "data");

/** One copy rule: every file of `from` matching `test` lands in `to`. */
const RULES = [
  {
    from: join(repoRoot, "data", "scenario"),
    to: join(publicData, "scenario"),
    test: (name) => name.endsWith(".json"),
    label: "data/scenario/*.json",
  },
  {
    from: join(repoRoot, "data", "geo"),
    to: join(publicData, "geo"),
    test: (name) => name.endsWith(".geojson"),
    label: "data/geo/*.geojson",
  },
  {
    from: join(repoRoot, "data", "audio"),
    to: join(publicData, "audio"),
    test: (name) => name === "manifest.json" || name.endsWith(".wav"),
    label: "data/audio/manifest.json + *.wav",
  },
  {
    // Ticket #49 — per-unit dispatch TTS WAVs referenced by tts.ready events.
    from: join(repoRoot, "data", "audio", "tts"),
    to: join(publicData, "audio", "tts"),
    test: (name) => name.endsWith(".wav"),
    label: "data/audio/tts/*.wav",
  },
];

let copied = 0;

for (const rule of RULES) {
  if (!existsSync(rule.from)) {
    console.error(`[sync-data] Source directory not found: ${rule.from}`);
    process.exit(1);
  }

  const names = readdirSync(rule.from, { withFileTypes: true })
    .filter((entry) => entry.isFile() && rule.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (names.length === 0) {
    console.error(`[sync-data] No file matched ${rule.label} in ${rule.from}`);
    process.exit(1);
  }

  mkdirSync(rule.to, { recursive: true });
  for (const name of names) {
    copyFileSync(join(rule.from, name), join(rule.to, name));
    copied += 1;
  }
  console.log(`[sync-data] ${rule.label} -> public/data/ (${names.length} files)`);
}

console.log(`[sync-data] Copied ${copied} files into frontend/public/data/`);
