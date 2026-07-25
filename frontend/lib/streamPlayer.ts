/**
 * BLAZE mock stream player (ticket #39).
 *
 * `MockStreamSource` implements the `EventSource` adapter interface
 * (lib/eventSource.ts) by replaying the 70 events of
 * `contracts/mocks/demo_event_stream.jsonl` (loaded via lib/mockStream.ts)
 * in `sequence` order, respecting the real timestamp gaps between events,
 * scaled by the selected speed (x1 / x2 / x5).
 *
 * Controls: play / pause / setSpeed / jumpTo(phase) / reset.
 * Jump and reset replay the stream from sequence 1 up to the target point
 * synchronously — consumers detect the restart via the non-increasing
 * sequence rule of the EventSource contract and rebuild their state.
 *
 * The player exposes its own immutable `PlayerState` snapshot +
 * `subscribeState` so React components can bind it with
 * `useSyncExternalStore` (see lib/session.ts). UI regions do NOT consume
 * the player directly — they consume the derived `IncidentStore`.
 */

import type { EventEnvelope } from "./contracts";
import type { EventCallback, EventSource } from "./eventSource";
import { loadMockStream } from "./mockStream";

/* -------------------------------------------------------------------------- */
/* Player state                                                               */
/* -------------------------------------------------------------------------- */

export const PLAYER_SPEEDS = [1, 2, 5] as const;
export type PlayerSpeed = (typeof PLAYER_SPEEDS)[number];

export type PlayerStatus =
  | "idle" // not started yet
  | "loading" // fetching the mock JSONL
  | "ready" // loaded, positioned before the first event
  | "playing"
  | "paused"
  | "ended"
  | "error";

/** A named key point of the demo scenario the player can jump to. */
export interface JumpPoint {
  /** Stable identifier (e.g. "plan-v1"). */
  id: string;
  /** Human-readable label for the control bar. */
  label: string;
  /** 0-based index into the ordered event list (inclusive target). */
  index: number;
  /** Sequence number of the target event. */
  sequence: number;
}

/** Immutable snapshot of the player, safe for useSyncExternalStore. */
export interface PlayerState {
  status: PlayerStatus;
  speed: PlayerSpeed;
  /** Number of events emitted so far in the current pass (0..total). */
  position: number;
  /** Total number of events in the stream (0 until loaded). */
  total: number;
  /** Key points of the scenario, computed from the loaded events. */
  jumpPoints: JumpPoint[];
  /** Error message when status is "error". */
  error: string | null;
}

export const INITIAL_PLAYER_STATE: PlayerState = {
  status: "idle",
  speed: 1,
  position: 0,
  total: 0,
  jumpPoints: [],
  error: null,
};

/* -------------------------------------------------------------------------- */
/* Jump points (phase index)                                                  */
/* -------------------------------------------------------------------------- */

interface PhaseDef {
  id: string;
  label: string;
  /** Predicate matching the target event; `nth` selects the nth match (1-based). */
  match: (e: EventEnvelope) => boolean;
  nth?: number;
}

/**
 * Key phases of the demo scenario, in chronological order. Indexes are
 * resolved against the actual loaded events (not hardcoded) so the index
 * survives scenario edits as long as the phase structure holds.
 */
const PHASE_DEFS: PhaseDef[] = [
  { id: "start", label: "Start", match: (e) => e.event_type === "incident.started" },
  { id: "first-transcripts", label: "First transcripts", match: (e) => e.event_type === "transcript.ready" },
  { id: "snapshot", label: "Snapshot", match: (e) => e.event_type === "situation.snapshot.ready" },
  { id: "plan-v1", label: "Plan v1", match: (e) => e.event_type === "plan.draft.ready", nth: 1 },
  {
    id: "safety-revise",
    label: "Safety revise",
    match: (e) =>
      e.event_type === "safety_review.ready" &&
      (e.payload as { status?: unknown }).status === "revise",
  },
  { id: "plan-v2", label: "Plan v2", match: (e) => e.event_type === "plan.draft.ready", nth: 2 },
  { id: "approval", label: "Approval", match: (e) => e.event_type === "approval.received" },
  { id: "dispatch", label: "Dispatch", match: (e) => e.event_type === "dispatch.started" },
  { id: "completed", label: "Completed", match: (e) => e.event_type === "incident.completed" },
];

/** Resolves the phase definitions against a loaded event list. */
export function computeJumpPoints(events: EventEnvelope[]): JumpPoint[] {
  const points: JumpPoint[] = [];
  for (const def of PHASE_DEFS) {
    const wanted = def.nth ?? 1;
    let seen = 0;
    for (let i = 0; i < events.length; i++) {
      if (def.match(events[i])) {
        seen += 1;
        if (seen === wanted) {
          points.push({
            id: def.id,
            label: def.label,
            index: i,
            sequence: events[i].sequence,
          });
          break;
        }
      }
    }
  }
  return points;
}

/* -------------------------------------------------------------------------- */
/* MockStreamSource                                                           */
/* -------------------------------------------------------------------------- */

export class MockStreamSource implements EventSource {
  private events: EventEnvelope[] = [];
  private eventSubs = new Set<EventCallback>();
  private stateSubs = new Set<() => void>();
  private state: PlayerState = INITIAL_PLAYER_STATE;
  /** Index of the next event to emit (== state.position). */
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Wall-clock time at which the previous event was emitted (for reschedule). */
  private lastEmitAt = 0;
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly loader: () => Promise<EventEnvelope[]> = loadMockStream,
  ) {}

  /* ------------------------- EventSource interface ------------------------ */

  subscribe(callback: EventCallback): () => void {
    this.eventSubs.add(callback);
    return () => {
      this.eventSubs.delete(callback);
    };
  }

  /** Loads the mock stream and arms the player (paused before event 1). */
  start(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.setState({ status: "loading", error: null });
    this.loadPromise = this.loader()
      .then((events) => {
        // Defensive: replay strictly in sequence order even if file order drifts.
        this.events = [...events].sort((a, b) => a.sequence - b.sequence);
        this.setState({
          status: "ready",
          total: this.events.length,
          position: 0,
          jumpPoints: computeJumpPoints(this.events),
        });
      })
      .catch((err: unknown) => {
        this.loadPromise = null;
        this.setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return this.loadPromise;
  }

  /** Stops playback and timers (does not clear subscribers). */
  stop(): void {
    this.clearTimer();
    if (this.state.status === "playing") {
      this.setState({ status: "paused" });
    }
  }

  /* ----------------------------- Player controls -------------------------- */

  play(): void {
    const { status } = this.state;
    if (status === "playing" || status === "loading" || status === "error") return;
    if (status === "idle") {
      // First interaction: load, then auto-play.
      void this.start().then(() => {
        if (this.state.status === "ready") this.play();
      });
      return;
    }
    if (status === "ended") {
      // Play after the end restarts from scratch.
      this.restartTo(-1);
    }
    this.lastEmitAt = Date.now();
    this.setState({ status: "playing" });
    this.scheduleNext();
  }

  pause(): void {
    if (this.state.status !== "playing") return;
    this.clearTimer();
    this.setState({ status: "paused" });
  }

  toggle(): void {
    if (this.state.status === "playing") this.pause();
    else this.play();
  }

  setSpeed(speed: PlayerSpeed): void {
    if (speed === this.state.speed) return;
    this.setState({ speed });
    if (this.state.status === "playing") {
      // Reschedule the pending event with the new scale.
      this.clearTimer();
      this.scheduleNext();
    }
  }

  /**
   * Jumps to a key point: replays events 1..(index+1) synchronously so the
   * derived state is exactly what it would be at that point of the scenario,
   * then resumes (or stays paused) from there.
   */
  jumpTo(pointId: string): void {
    const point = this.state.jumpPoints.find((p) => p.id === pointId);
    if (!point || this.events.length === 0) return;
    const wasPlaying = this.state.status === "playing";
    this.restartTo(point.index);
    if (wasPlaying) {
      this.lastEmitAt = Date.now();
      this.setState({ status: "playing" });
      this.scheduleNext();
    } else {
      this.setState({ status: this.cursor >= this.events.length ? "ended" : "paused" });
    }
  }

  /** Back to the pristine pre-scenario state (position 0, paused). */
  reset(): void {
    if (this.events.length === 0) return;
    this.restartTo(-1);
    this.setState({ status: "ready" });
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

  /**
   * Rewinds to the beginning and synchronously re-emits events 0..lastIndex
   * (inclusive; -1 emits nothing). Consumers see sequence 1 again and reset
   * their derived state per the EventSource restart contract.
   */
  private restartTo(lastIndex: number): void {
    this.clearTimer();
    this.cursor = 0;
    // Emitting from index 0 makes the first delivered sequence non-increasing
    // for consumers, which triggers their rebuild.
    for (let i = 0; i <= lastIndex && i < this.events.length; i++) {
      this.emit(this.events[i]);
    }
    this.cursor = Math.min(Math.max(lastIndex + 1, 0), this.events.length);
    this.setState({
      position: this.cursor,
      status: this.cursor >= this.events.length ? "ended" : this.state.status,
    });
  }

  private scheduleNext(): void {
    this.clearTimer();
    if (this.cursor >= this.events.length) {
      this.setState({ status: "ended" });
      return;
    }
    const next = this.events[this.cursor];
    const prev = this.cursor > 0 ? this.events[this.cursor - 1] : null;
    const gapMs = prev
      ? Math.max(0, Date.parse(next.timestamp) - Date.parse(prev.timestamp))
      : 0;
    const scaled = gapMs / this.state.speed;
    // Account for time already waited (pause/speed-change reschedules).
    const elapsed = Date.now() - this.lastEmitAt;
    const delay = Math.max(0, scaled - elapsed);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lastEmitAt = Date.now();
      this.emit(next);
      this.cursor += 1;
      this.setState({ position: this.cursor });
      this.scheduleNext();
    }, delay);
  }

  private emit(event: EventEnvelope): void {
    for (const cb of this.eventSubs) cb(event);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setState(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of this.stateSubs) cb();
  }
}
