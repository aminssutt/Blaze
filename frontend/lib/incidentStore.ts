/**
 * BLAZE incident store (ticket #39).
 *
 * Derived UI state built by reducing every `EventEnvelope` delivered by an
 * `EventSource` (mock replay today, SSE later — the store never knows which).
 * UI regions consume THIS store, never the player/source directly, so the
 * event-handling code path is identical for mock and real streams.
 *
 * The store is a tiny external store (subscribe/getSnapshot) bound to React
 * with `useSyncExternalStore` — see lib/session.ts for the rationale.
 *
 * Restart rule (EventSource contract): an incoming event whose sequence is
 * not strictly greater than the last seen sequence means the stream was
 * replayed from the beginning (player jump/reset, SSE reconnect replay);
 * the store rebuilds from the initial state.
 */

import type {
  ApprovalDecision,
  DispatchInstruction,
  DraftTacticalPlan,
  EventEnvelope,
  EventType,
  RadioEvent,
  SafetyReview,
  SituationSnapshot,
  ToolRequest,
  ToolResult,
  TranscriptResult,
} from "./contracts";

/* -------------------------------------------------------------------------- */
/* State shape                                                                */
/* -------------------------------------------------------------------------- */

export type IncidentStatus = "waiting" | "active" | "completed";

export interface IncidentState {
  /* Header / status (region 1) */
  incidentStatus: IncidentStatus;
  incidentId: string | null;
  incidentName: string | null;
  networkMode: string | null;
  fallbackCount: number;
  errorCount: number;

  /* Stream bookkeeping */
  eventsReceived: number;
  lastSequence: number;
  countsByType: Partial<Record<EventType, number>>;
  lastByType: Partial<Record<EventType, EventEnvelope>>;

  /* Radio timeline (region 3) */
  transcripts: TranscriptResult[];

  /* Structured events (region 4) */
  radioEvents: RadioEvent[];

  /* Agent & tool trace (region 5) */
  toolRequests: ToolRequest[];
  toolResults: ToolResult[];

  /* Tactical map (region 2) — fed by the situation snapshot */
  snapshot: SituationSnapshot | null;

  /* Tactical roadmap (region 6) */
  plan: DraftTacticalPlan | null;
  planVersions: number;

  /* Safety critic (region 7) */
  safetyReview: SafetyReview | null;

  /* Human approval (region 8) */
  approvalRequested: boolean;
  approval: ApprovalDecision | null;

  /* Dispatch output (region 9) */
  dispatches: DispatchInstruction[];
  dispatchesSent: number;

  /* NVIDIA metrics (region 10) */
  metrics: Record<string, unknown> | null;
}

export const INITIAL_INCIDENT_STATE: IncidentState = {
  incidentStatus: "waiting",
  incidentId: null,
  incidentName: null,
  networkMode: null,
  fallbackCount: 0,
  errorCount: 0,
  eventsReceived: 0,
  lastSequence: 0,
  countsByType: {},
  lastByType: {},
  transcripts: [],
  radioEvents: [],
  toolRequests: [],
  toolResults: [],
  snapshot: null,
  plan: null,
  planVersions: 0,
  safetyReview: null,
  approvalRequested: false,
  approval: null,
  dispatches: [],
  dispatchesSent: 0,
  metrics: null,
};

/* -------------------------------------------------------------------------- */
/* Reducer                                                                    */
/* -------------------------------------------------------------------------- */

/** Narrow an envelope payload to a contract type (payloads are schema-valid). */
function payloadAs<T>(event: EventEnvelope): T {
  return event.payload as unknown as T;
}

/**
 * Pure reducer: one envelope in, next immutable state out.
 * Every event updates the bookkeeping; well-known types also update their
 * typed slice (the future real views of tickets #40–#51 build on these).
 */
export function reduceEvent(
  state: IncidentState,
  event: EventEnvelope,
): IncidentState {
  const next: IncidentState = {
    ...state,
    eventsReceived: state.eventsReceived + 1,
    lastSequence: event.sequence,
    countsByType: {
      ...state.countsByType,
      [event.event_type]: (state.countsByType[event.event_type] ?? 0) + 1,
    },
    lastByType: { ...state.lastByType, [event.event_type]: event },
  };

  switch (event.event_type) {
    case "incident.started": {
      const p = event.payload as { incident_id?: string; name?: string; network_mode?: string };
      next.incidentStatus = "active";
      next.incidentId = p.incident_id ?? event.incident_id;
      next.incidentName = p.name ?? null;
      next.networkMode = p.network_mode ?? next.networkMode;
      break;
    }
    case "incident.completed":
      next.incidentStatus = "completed";
      break;
    case "network.mode.changed": {
      const p = event.payload as { network_mode?: string; mode?: string };
      next.networkMode = p.network_mode ?? p.mode ?? next.networkMode;
      break;
    }
    case "fallback.activated":
      next.fallbackCount = state.fallbackCount + 1;
      break;
    case "error":
      next.errorCount = state.errorCount + 1;
      break;

    case "transcript.ready":
      next.transcripts = [...state.transcripts, payloadAs<TranscriptResult>(event)];
      break;

    case "radio_event.extracted":
      next.radioEvents = [...state.radioEvents, payloadAs<RadioEvent>(event)];
      break;

    case "tool.call.requested":
      next.toolRequests = [...state.toolRequests, payloadAs<ToolRequest>(event)];
      break;
    case "tool.call.completed":
      next.toolResults = [...state.toolResults, payloadAs<ToolResult>(event)];
      break;

    case "situation.snapshot.ready":
      next.snapshot = payloadAs<SituationSnapshot>(event);
      break;

    case "plan.draft.ready": {
      const plan = payloadAs<DraftTacticalPlan>(event);
      next.plan = plan;
      next.planVersions = Math.max(state.planVersions, plan.version ?? state.planVersions + 1);
      break;
    }

    case "safety_review.ready":
      next.safetyReview = payloadAs<SafetyReview>(event);
      break;

    case "approval.requested":
      next.approvalRequested = true;
      break;
    case "approval.received":
      next.approvalRequested = false;
      next.approval = payloadAs<ApprovalDecision>(event);
      break;

    case "dispatch.instruction.ready":
      next.dispatches = [...state.dispatches, payloadAs<DispatchInstruction>(event)];
      break;
    case "tts.ready": {
      const p = event.payload as { dispatch_id?: string; tts_audio_path?: string };
      next.dispatches = state.dispatches.map((d) =>
        d.dispatch_id === p.dispatch_id
          ? { ...d, tts_audio_path: p.tts_audio_path ?? d.tts_audio_path, dispatch_status: "ready" }
          : d,
      );
      break;
    }
    case "dispatch.sent": {
      const p = event.payload as { dispatch_id?: string };
      next.dispatchesSent = state.dispatchesSent + 1;
      next.dispatches = state.dispatches.map((d) =>
        d.dispatch_id === p.dispatch_id ? { ...d, dispatch_status: "sent" } : d,
      );
      break;
    }

    case "metric.updated":
      next.metrics = { ...(state.metrics ?? {}), ...event.payload };
      break;

    default:
      // Progress/start events (transcription.started, planning.started, ...)
      // are covered by countsByType / lastByType — no dedicated slice yet.
      break;
  }

  return next;
}

/* -------------------------------------------------------------------------- */
/* External store                                                             */
/* -------------------------------------------------------------------------- */

/** Tiny external store consumed by React via useSyncExternalStore. */
export class IncidentStore {
  private state: IncidentState = INITIAL_INCIDENT_STATE;
  private subs = new Set<() => void>();

  /** EventSource callback — pass to `source.subscribe(store.ingest)`. */
  ingest = (event: EventEnvelope): void => {
    // Restart rule: non-increasing sequence => stream replayed from scratch.
    const base =
      event.sequence <= this.state.lastSequence
        ? INITIAL_INCIDENT_STATE
        : this.state;
    this.state = reduceEvent(base, event);
    this.notify();
  };

  /** Explicit rebuild (player reset with no events re-emitted). */
  reset = (): void => {
    this.state = INITIAL_INCIDENT_STATE;
    this.notify();
  };

  getSnapshot = (): IncidentState => this.state;

  subscribe = (cb: () => void): (() => void) => {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  };

  private notify(): void {
    for (const cb of this.subs) cb();
  }
}
