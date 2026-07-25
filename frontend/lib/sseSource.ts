/**
 * BLAZE real SSE source (ticket #54).
 *
 * `SseSource` implements the `EventSource` adapter contract
 * (lib/eventSource.ts) against the real backend stream of ticket #22:
 * `GET /events/stream` — one SSE message per `EventEnvelope`, `id:` carrying
 * the sequence, `event:` carrying the event_type, `data:` the JSON envelope.
 *
 * Contract compliance:
 * - Events are forwarded in arrival order; the backend bus guarantees strictly
 *   increasing sequences within one run and replays history on (re)connect via
 *   `?after=` / `Last-Event-ID`, so no client-side dedupe is needed.
 * - RESTART SEMANTICS: after a backend reset the sequence restarts at 1; the
 *   consumer (IncidentStore.ingest) detects the non-increasing sequence and
 *   rebuilds — this source just forwards envelopes, exactly as documented.
 * - Reconnection: the browser primitive (`window.EventSource`) retries
 *   transient drops on its own (sending `Last-Event-ID`); when it gives up
 *   (readyState CLOSED — backend down), this class reconnects with
 *   exponential backoff (1s → 30s, ±20% jitter) using `?after=<lastSeq>`.
 * - SILENCE WATCHDOG: the backend SSE generator can die silently while the
 *   Next proxy keeps the client socket open (observed: the #22 heartbeat's
 *   `asyncio.wait_for` around `__anext__` kills the bus generator after 15s
 *   without events → StopAsyncIteration server-side, dead air client-side —
 *   invisible to EventSource because SSE comments never reach the API). Any
 *   connection silent for WATCHDOG_MS is therefore torn down and reopened
 *   with `?after=<lastSeq>`, which the bus answers loss-free from history;
 *   `play()` additionally reconnects up front when the stream has been quiet,
 *   so "démarrer" is never sent into a dead pipe.
 *
 * The class also mirrors the control surface of `MockStreamSource`
 * (getState/subscribeState + play/pause/toggle/setSpeed/jumpTo/reset) so the
 * session singleton, PlayerBar and DemoControls work unchanged in live mode:
 * - toggle/play  → ensure connected, then POST /incident/start (409 ignored)
 * - pause        → close the connection (resume replays the gap via ?after=)
 * - setSpeed     → sets the speed_factor of the NEXT /incident/start
 * - jumpTo       → no-op (a live stream has no timeline to scrub)
 * - reset        → POST /incident/reset + reconnect from sequence 0
 */

import { EVENT_TYPES, type EventEnvelope } from "./contracts";
import type {
  EventCallback,
  EventSource as EventSourceContract,
} from "./eventSource";
import {
  INITIAL_PLAYER_STATE,
  type PlayerSpeed,
  type PlayerState,
} from "./streamPlayer";
import { getBackendBase } from "./streamMode";
import { startIncident, resetIncident } from "./backendApi";

/** Backend replay speed_factor for player speed x1 (10 = demo pacing of #22). */
const BASE_SPEED_FACTOR = 10;

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** Reopen any connection silent for this long (see SILENCE WATCHDOG above).
 * Above the backend's 15s heartbeat interval so a healthy-but-idle stream is
 * only cycled once its heartbeat window has demonstrably passed. */
const WATCHDOG_MS = 20_000;
/** play() pre-emptively reconnects when the stream was quiet this long. */
const QUIET_BEFORE_PLAY_MS = 10_000;

export class SseSource implements EventSourceContract {
  private eventSubs = new Set<EventCallback>();
  private stateSubs = new Set<() => void>();
  private state: PlayerState = INITIAL_PLAYER_STATE;

  private es: globalThis.EventSource | null = null;
  private lastSequence = 0;
  private received = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  /** True between start() and stop(): governs whether errors trigger backoff. */
  private wantConnected = false;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  /** Wall-clock time of the last received event on the current connection. */
  private lastMessageAt = 0;

  /* ------------------------- EventSource interface ------------------------ */

  subscribe(callback: EventCallback): () => void {
    this.eventSubs.add(callback);
    return () => {
      this.eventSubs.delete(callback);
    };
  }

  /** Opens the SSE connection (idempotent). Does NOT start the scenario. */
  start(): void {
    if (typeof window === "undefined") return;
    if (this.es || this.reconnectTimer) return;
    this.wantConnected = true;
    this.connect();
  }

  /** Closes the connection and cancels any pending reconnection. */
  stop(): void {
    this.wantConnected = false;
    this.clearReconnectTimer();
    this.clearWatchdog();
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    if (this.state.status === "playing" || this.state.status === "ready") {
      this.setState({ status: "paused" });
    }
  }

  /* --------------------- MockStreamSource control mirror ------------------- */

  play(): void {
    // A quiet connection may be silently dead (see SILENCE WATCHDOG):
    // reopen before asking the backend to run, so the events have a pipe.
    if (this.es && Date.now() - this.lastMessageAt > QUIET_BEFORE_PLAY_MS) {
      this.reconnectNow();
    }
    this.start();
    // Ask the backend to run the scenario; "already running" is success.
    void startIncident(BASE_SPEED_FACTOR * this.state.speed).catch(
      (err: unknown) => {
        this.setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
  }

  pause(): void {
    this.stop();
  }

  toggle(): void {
    if (this.state.status === "playing") this.pause();
    else this.play(); // ready / paused / idle / error: (re)connect + arm the run
  }

  /** Live speed maps to the speed_factor of the NEXT /incident/start. */
  setSpeed(speed: PlayerSpeed): void {
    if (speed !== this.state.speed) this.setState({ speed });
  }

  /** A live stream has no scrub bar — jump points stay empty. */
  jumpTo(_pointId: string): void {
    void _pointId;
  }

  /** Full restart: backend back to IDLE, reconnect from sequence 0. */
  reset(): void {
    void (async () => {
      let resetError: string | null = null;
      try {
        await resetIncident();
      } catch (err: unknown) {
        resetError = err instanceof Error ? err.message : String(err);
      }
      // Reconnect from scratch either way — a fresh stream is the goal.
      this.clearReconnectTimer();
      if (this.es) {
        this.es.close();
        this.es = null;
      }
      this.lastSequence = 0;
      this.received = 0;
      this.reconnectAttempts = 0;
      this.wantConnected = true;
      this.setState({ position: 0, total: 0, error: resetError });
      this.connect();
    })();
  }

  /* ------------------------- React binding (state) ------------------------ */

  getState = (): PlayerState => this.state;

  subscribeState = (cb: () => void): (() => void) => {
    this.stateSubs.add(cb);
    return () => {
      this.stateSubs.delete(cb);
    };
  };

  /* ------------------------------- Internals ------------------------------ */

  private streamUrl(): string {
    const base = getBackendBase();
    const after = this.lastSequence > 0 ? `?after=${this.lastSequence}` : "";
    return `${base}/events/stream${after}`;
  }

  /** Immediate loss-free reconnection (`?after=` resumes from history). */
  private reconnectNow(): void {
    this.clearReconnectTimer();
    this.clearWatchdog();
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.wantConnected = true;
    this.connect();
  }

  private connect(): void {
    this.setState({ status: "loading", error: null });
    const es = new window.EventSource(this.streamUrl());
    this.es = es;
    this.lastMessageAt = Date.now();
    this.armWatchdog();

    es.onopen = () => {
      if (this.es !== es) return;
      this.reconnectAttempts = 0;
      // "ready" until the first event: DemoControls' start button needs it.
      this.setState({
        status: this.received > 0 ? "playing" : "ready",
        error: null,
      });
    };

    // The backend names every message (`event: <event_type>`), so the default
    // onmessage never fires — one listener per contract event type instead.
    const onEnvelope = (message: MessageEvent<string>) => {
      if (this.es !== es) return;
      this.handleMessage(message.data);
    };
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, onEnvelope);
    }

    es.onerror = () => {
      if (this.es !== es) return;
      if (es.readyState === window.EventSource.CLOSED) {
        // Browser gave up (backend down / non-200): our backoff takes over.
        es.close();
        this.es = null;
        this.scheduleReconnect();
      } else {
        // Transient drop: the browser is already retrying with Last-Event-ID.
        this.setState({ status: "loading" });
      }
    };
  }

  private handleMessage(data: string): void {
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(data) as EventEnvelope;
    } catch {
      this.setState({ error: "unparseable SSE payload (ignored)" });
      return;
    }
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      typeof envelope.sequence !== "number" ||
      typeof envelope.event_type !== "string"
    ) {
      this.setState({ error: "non-envelope SSE payload (ignored)" });
      return;
    }
    // Restart pass-through: a non-increasing sequence (backend reset) is
    // forwarded as-is — consumers rebuild per the adapter contract.
    if (envelope.sequence <= this.lastSequence) this.received = 0;
    this.lastSequence = envelope.sequence;
    this.received += 1;
    this.lastMessageAt = Date.now();
    this.armWatchdog();
    for (const cb of this.eventSubs) cb(envelope);
    this.setState({
      status: "playing",
      position: this.received,
      total: this.received,
      error: null,
    });
  }

  private scheduleReconnect(): void {
    if (!this.wantConnected || this.reconnectTimer) return;
    const exp = Math.min(
      BACKOFF_MAX_MS,
      BACKOFF_INITIAL_MS * 2 ** this.reconnectAttempts,
    );
    const jitter = exp * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.round(exp + jitter);
    this.reconnectAttempts += 1;
    this.setState({
      status: "loading",
      error: `SSE disconnected — retry ${this.reconnectAttempts} in ${Math.round(delay / 100) / 10}s`,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantConnected) this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      if (this.wantConnected && this.es) this.reconnectNow();
    }, WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private setState(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of this.stateSubs) cb();
  }
}
