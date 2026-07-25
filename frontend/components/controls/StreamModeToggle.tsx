// Ticket #54 — stream source selector (mock replay ↔ live backend SSE).
//
// Discreet toggle of the demo row: shows the mode the CURRENT session was
// built on, one click persists the other mode (localStorage override of
// NEXT_PUBLIC_STREAM_MODE) and reloads — no rebuild needed. The effective
// mode lives in localStorage, which the server cannot know: the server
// snapshot renders a neutral placeholder and `useSyncExternalStore` swaps in
// the client value after hydration without a mismatch. The subscribe is a
// no-op because a mode change always goes through a full page reload.

"use client";

import { useSyncExternalStore } from "react";
import { getStreamMode, setStreamMode, type StreamMode } from "@/lib/streamMode";

const subscribeNever = () => () => {};

export default function StreamModeToggle() {
  const mode: StreamMode | null = useSyncExternalStore(
    subscribeNever,
    getStreamMode,
    () => null,
  );

  const next: StreamMode = mode === "live" ? "mock" : "live";

  return (
    <button
      type="button"
      data-testid="stream-mode-toggle"
      disabled={mode === null}
      onClick={() => setStreamMode(next)}
      aria-pressed={mode === "live"}
      title={
        mode === null
          ? "résolution du mode de flux…"
          : `Source des événements : ${mode === "live" ? "SSE backend temps réel" : "replay mock local"} — cliquer pour basculer en ${next} (recharge la page)`
      }
      className={`rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-wider disabled:opacity-40 ${
        mode === "live"
          ? "border-ok/70 bg-ok-dim/40 text-ok hover:border-ok"
          : "border-edge text-muted hover:border-edge-strong"
      }`}
    >
      flux : {mode ?? "…"}
    </button>
  );
}
