/**
 * BLAZE event-source adapter interface.
 *
 * ADAPTER PATTERN (ticket #39, reused by #54): every producer of incident
 * events — today `MockStreamSource` (timed replay of the mock JSONL), later
 * `SseSource` (real backend SSE) — implements this interface. Consumers
 * (the incident store, and through it every UI region) only ever see
 * `EventSource`, so swapping mock replay for real SSE requires zero changes
 * on the consumer side.
 *
 * Delivery contract:
 * - `subscribe(callback)` registers a listener and returns an unsubscribe
 *   function. Events are delivered in strictly increasing `sequence` order
 *   within one pass of the stream.
 * - `start()` begins delivering events (idempotent). `stop()` halts delivery
 *   and releases timers/connections.
 * - RESTART SEMANTICS: a source may replay the stream from the beginning
 *   (mock player jump/reset, SSE reconnection with full replay). Consumers
 *   MUST treat an incoming event whose `sequence` is <= the last seen
 *   sequence as a stream restart and rebuild their derived state from
 *   scratch. `IncidentStore.ingest` implements exactly this rule.
 *
 * Note: this local `EventSource` interface intentionally shadows the DOM
 * `EventSource` type inside modules that import it. The future `SseSource`
 * implementation (#54) should refer to the browser primitive explicitly as
 * `window.EventSource`.
 */

import type { EventEnvelope } from "./contracts";

/** Listener invoked for every event delivered by a source. */
export type EventCallback = (event: EventEnvelope) => void;

/** Abstract stream of incident events (mock replay today, SSE later). */
export interface EventSource {
  /** Register a listener; returns an unsubscribe function. */
  subscribe(callback: EventCallback): () => void;
  /** Begin delivering events. Idempotent. May load resources asynchronously. */
  start(): void | Promise<void>;
  /** Halt delivery and release timers/connections. */
  stop(): void;
}
