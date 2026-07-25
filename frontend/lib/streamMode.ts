/**
 * BLAZE stream-mode selector (ticket #54).
 *
 * Decides which concrete `EventSource` the session singleton instantiates:
 *   - "mock" — `MockStreamSource`, timed replay of the frozen JSONL (#39).
 *   - "live" — `SseSource`, real backend SSE stream (#54).
 *
 * Resolution order:
 *   1. localStorage override (`blaze.stream-mode`) — set by the header toggle,
 *      so the mode can be flipped at runtime WITHOUT a rebuild;
 *   2. build-time default `NEXT_PUBLIC_STREAM_MODE` (mock | live);
 *   3. "mock" (demo-safe fallback).
 *
 * `setStreamMode` persists the override and reloads the page: the session is
 * a module-level singleton wired at first render, so a clean reload is the
 * only state-safe way to swap the source (and it guarantees the store rebuilds
 * from INITIAL state instead of mixing mock and live sequences).
 */

export type StreamMode = "mock" | "live";

const STORAGE_KEY = "blaze.stream-mode";

/** Build-time default (inlined by Next; must be read as a static property). */
const ENV_DEFAULT: StreamMode =
  process.env.NEXT_PUBLIC_STREAM_MODE === "live" ? "live" : "mock";

function isStreamMode(value: unknown): value is StreamMode {
  return value === "mock" || value === "live";
}

/** Current mode: localStorage override, else env default, else "mock". */
export function getStreamMode(): StreamMode {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isStreamMode(stored)) return stored;
    } catch {
      // Storage unavailable (private mode) — fall through to the env default.
    }
  }
  return ENV_DEFAULT;
}

export function isLiveMode(): boolean {
  return getStreamMode() === "live";
}

/**
 * Persists the runtime override and reloads so the session singleton is
 * rebuilt on the new source (see module doc for why a reload is required).
 */
export function setStreamMode(mode: StreamMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Persisting failed: still reload — the env default will apply.
  }
  window.location.reload();
}

/**
 * Base URL of the backend API.
 * Default "/api/backend" goes through the Next rewrite (next.config.ts) to
 * BACKEND_URL (http://localhost:8080 by default) — same-origin, no CORS.
 * Override with NEXT_PUBLIC_BACKEND_URL to hit the backend directly
 * (its CORS allowlist already includes localhost:3000).
 */
export function getBackendBase(): string {
  return process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/backend";
}
