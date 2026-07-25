/**
 * Copies the frozen contract mocks into frontend/public/mocks/ so the app can
 * fetch them at runtime. Runs automatically before `npm run dev` and
 * `npm run build` (predev / prebuild hooks), or manually via
 * `npm run sync-mocks`. The copy in public/ is generated and git-ignored —
 * `contracts/mocks/` stays the single source of truth.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(frontendRoot, "..");

const source = join(repoRoot, "contracts", "mocks", "demo_event_stream.jsonl");
const targetDir = join(frontendRoot, "public", "mocks");
const target = join(targetDir, "demo_event_stream.jsonl");

if (!existsSync(source)) {
  console.error(`[sync-mocks] Source not found: ${source}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`[sync-mocks] Copied contracts/mocks/demo_event_stream.jsonl -> public/mocks/`);
