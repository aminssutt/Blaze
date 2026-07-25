"use client";

/**
 * BLAZE client session: wires the event source to the incident store and
 * binds both to React (ticket #39).
 *
 * STATE-MANAGEMENT CHOICE — tiny external store + `useSyncExternalStore`
 * (zustand-style, zero dependency) instead of Context or zustand itself:
 * - The replay engine lives OUTSIDE React (timers must not depend on render
 *   cycles); an external store is the natural boundary, and
 *   `useSyncExternalStore` is React's first-class, tear-free binding for it.
 * - React Context would re-render the whole tree on every event (~events
 *   arrive multiple times per second at x5); external subscriptions keep
 *   updates scoped to the components that read the state.
 * - zustand would model this equally well but adds a dependency for what is
 *   ~30 lines here; if later tickets need selectors/middleware, the store
 *   can be swapped for zustand without touching the EventSource adapter.
 *
 * This module is the ONLY place that knows the concrete source. Ticket #54:
 * the source is chosen at session creation from the stream mode
 * (lib/streamMode.ts) — `MockStreamSource` (mock) or `SseSource` (live) —
 * and every consumer (store, hooks, UI regions) is untouched, both classes
 * exposing the same `StreamSource` control surface.
 */

import { useSyncExternalStore } from "react";
import type { EventSource as EventSourceContract } from "./eventSource";
import type { IncidentState } from "./incidentStore";
import { INITIAL_INCIDENT_STATE, IncidentStore } from "./incidentStore";
import type { PlayerSpeed, PlayerState } from "./streamPlayer";
import { INITIAL_PLAYER_STATE, MockStreamSource } from "./streamPlayer";
import { SseSource } from "./sseSource";
import { getStreamMode, type StreamMode } from "./streamMode";

/** Controls exposed to the UI (the player bar) — not the raw source. */
export interface SessionControls {
  toggle(): void;
  setSpeed(speed: PlayerSpeed): void;
  jumpTo(pointId: string): void;
  reset(): void;
  start(): void;
}

/**
 * Common surface of both concrete sources: the adapter contract plus the
 * player-shaped controls/state PlayerBar & DemoControls bind to (in live mode
 * the SseSource maps them to connection + backend-run control — see its doc).
 */
interface StreamSource extends EventSourceContract {
  toggle(): void;
  setSpeed(speed: PlayerSpeed): void;
  jumpTo(pointId: string): void;
  reset(): void;
  getState(): PlayerState;
  subscribeState(cb: () => void): () => void;
}

interface Session {
  mode: StreamMode;
  store: IncidentStore;
  player: StreamSource;
  controls: SessionControls;
}

let session: Session | null = null;

/** Lazily creates the singleton session (client-side only). */
export function getSession(): Session {
  if (!session) {
    const mode = getStreamMode();
    const store = new IncidentStore();
    const player: StreamSource =
      mode === "live" ? new SseSource() : new MockStreamSource();
    // The adapter seam: the store consumes the EventSource interface only.
    player.subscribe(store.ingest);
    session = {
      mode,
      store,
      player,
      controls: {
        toggle: () => player.toggle(),
        setSpeed: (s) => player.setSpeed(s),
        jumpTo: (id) => player.jumpTo(id),
        // Player reset re-emits nothing, so clear the derived state too.
        reset: () => {
          player.reset();
          store.reset();
        },
        start: () => void player.start(),
      },
    };
  }
  return session;
}

/** Reactive incident state (derived from events) for UI regions. */
export function useIncidentState(): IncidentState {
  const { store } = getSession();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => INITIAL_INCIDENT_STATE,
  );
}

/** Reactive player state (position, speed, status) for the control bar. */
export function usePlayerState(): PlayerState {
  const { player } = getSession();
  return useSyncExternalStore(
    player.subscribeState,
    player.getState,
    () => INITIAL_PLAYER_STATE,
  );
}

/** Player controls for the control bar. */
export function useSessionControls(): SessionControls {
  return getSession().controls;
}
