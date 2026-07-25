"use client";

/**
 * Mock stream player control bar (ticket #39) — lives in the header region.
 * Play/pause, speed x1/x2/x5, jump to key scenario points, reset, and the
 * "event N/70" position indicator.
 */

import { PLAYER_SPEEDS, type PlayerSpeed } from "@/lib/streamPlayer";
import { usePlayerState, useSessionControls } from "@/lib/session";

export default function PlayerBar() {
  const player = usePlayerState();
  const controls = useSessionControls();

  const playing = player.status === "playing";
  const loaded = player.total > 0;
  const playLabel = playing ? "Pause" : player.status === "ended" ? "Replay" : "Play";

  return (
    <div
      id="player-bar"
      className="flex flex-wrap items-center gap-2 font-mono text-xs"
    >
      <button
        type="button"
        onClick={controls.toggle}
        disabled={player.status === "loading" || player.status === "error"}
        className="rounded-sm border border-accent-dim bg-overlay px-3 py-1 font-semibold text-accent hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={playLabel}
      >
        {playing ? "❚❚" : "▶"} {playLabel}
      </button>

      <div className="flex items-center gap-1" role="group" aria-label="Replay speed">
        {PLAYER_SPEEDS.map((speed: PlayerSpeed) => (
          <button
            key={speed}
            type="button"
            onClick={() => controls.setSpeed(speed)}
            className={`rounded-sm border px-2 py-1 ${
              player.speed === speed
                ? "border-accent bg-accent-dim/40 text-accent"
                : "border-edge text-muted hover:border-edge-strong"
            }`}
            aria-pressed={player.speed === speed}
          >
            x{speed}
          </button>
        ))}
      </div>

      <select
        aria-label="Jump to scenario phase"
        className="rounded-sm border border-edge bg-overlay px-2 py-1 text-muted disabled:opacity-40"
        disabled={!loaded}
        value=""
        onChange={(e) => {
          if (e.target.value) controls.jumpTo(e.target.value);
        }}
      >
        <option value="" disabled>
          Jump to…
        </option>
        {player.jumpPoints.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} (#{p.sequence})
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={controls.reset}
        disabled={!loaded}
        className="rounded-sm border border-edge px-2 py-1 text-muted hover:border-edge-strong disabled:opacity-40"
      >
        Reset
      </button>

      <span
        data-testid="player-position"
        className={
          player.status === "error"
            ? "text-alert"
            : playing
              ? "text-ok"
              : "text-faint"
        }
      >
        {player.status === "error"
          ? "STREAM ERROR"
          : player.status === "loading"
            ? "loading…"
            : loaded
              ? `event ${player.position}/${player.total} · ${player.status}`
              : "mock stream idle"}
      </span>
    </div>
  );
}
