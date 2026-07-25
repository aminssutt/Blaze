/**
 * BLAZE incident store (ticket #39, extended by ticket #38).
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
 *
 * TICKET #38 EXTENSION — every field added below is ADDITIVE: the fields and
 * behaviour of ticket #39 are untouched, so existing consumers keep working.
 * Each addition is annotated with the ticket that consumes it. All payload
 * field names are derived from the REAL `contracts/mocks/demo_event_stream.jsonl`,
 * never guessed.
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
  SourceType,
  ToolRequest,
  ToolResult,
  ToolResultStatus,
  TranscriptResult,
} from "./contracts";

/* -------------------------------------------------------------------------- */
/* State shape — ticket #38 additions                                         */
/* -------------------------------------------------------------------------- */

/** Which variant of the scenario audio is being played. */
export type AudioMode = "clean" | "radio";

/** Lifecycle of one radio audio message through the STT pipeline. */
export type AudioStatus = "pending" | "received" | "transcribing" | "transcribed";

/**
 * Merged per-audio progress record (ticket #42 radio timeline, #43 event
 * cards). Built by folding `audio.received` + `transcription.started` +
 * `transcript.ready` + `radio_event.extracted` onto one record per audio_id.
 */
export interface AudioProgress {
  /** Stable audio identifier (audio_01 … audio_05). */
  audio_id: string;
  /** `audio.received` envelope timestamp, null if the audio was never announced. */
  received_at: string | null;
  /** Furthest stage reached by this audio. */
  status: AudioStatus;
  /** Variant actually played, from `audio.received.audio_variant`. */
  audio_mode: AudioMode | null;
  /** Expected speaking unit, from `audio.received.speaker_hint`. */
  speaker_hint: string | null;
  /** Repo-relative WAV path, from `audio.received.audio_path`. */
  audio_path: string | null;
  /** Audio duration, from `audio.received.duration_seconds`. */
  duration_seconds: number | null;
  /** Offset from incident start, from `audio.received.scenario_timestamp`. */
  scenario_timestamp: number | null;
  /** STT model announced by `transcription.started.model_name`. */
  stt_model_name: string | null;
  /** The transcript once `transcript.ready` arrived. */
  transcript: TranscriptResult | null;
  /** ids of the RadioEvents extracted from this audio, in arrival order. */
  extracted_event_ids: string[];
}

/**
 * One agent activation (ticket #44 agent trace, plus the header phase).
 * Started by `context_agent.started` / `radio_agent.started` /
 * `planning.started` / `safety_review.started` / `dispatch.started`.
 */
export interface AgentRun {
  /** Agent identifier from the payload (situation_context, radio_intelligence…). */
  agent_id: string;
  /** Local model identifier from the payload (`model_id`), null if absent. */
  model_id: string | null;
  /** `started_at` from the payload, falling back to the envelope timestamp. */
  started_at: string;
  /** Envelope sequence of the starting event — the run's stable ordering key. */
  sequence: number;
  /** Event type that started the run (used to match its completion event). */
  started_by: EventType;
  /** True once the run's matching completion event has been reduced. */
  finished: boolean;
  /** Timestamp of the completion event, null while running. */
  finished_at: string | null;
  /** Sequence of the completion event, null while running. */
  finished_sequence: number | null;
}

/**
 * A tool call with its request and its result MERGED into a single record
 * (ticket #44 agent trace, ticket #45 snapshot provenance). Ordered by first
 * appearance. `latency_ms` is computed as retrieved_at - requested_at.
 */
export interface ToolCall {
  /** Correlation key between `tool.call.requested` and `tool.call.completed`. */
  tool_call_id: string;
  /* --- request side ----------------------------------------------------- */
  agent_id: string | null;
  tool_name: string;
  arguments: Record<string, unknown> | null;
  reason: string | null;
  requested_at: string | null;
  /** Sequence of the request event (ordering key), null if never requested. */
  requested_sequence: number | null;
  /* --- result side (null until `tool.call.completed`) -------------------- */
  completed: boolean;
  status: ToolResultStatus | null;
  data: ToolResult["data"] | null;
  source_type: SourceType | null;
  source_name: string | null;
  retrieved_at: string | null;
  data_timestamp: string | null;
  is_cached: boolean | null;
  staleness_seconds: number | null;
  error: string | null;
  /** Computed round-trip: retrieved_at - requested_at, null when unknown. */
  latency_ms: number | null;
}

/**
 * Payload of `plan.revision.requested` (ticket #46 plan panel, #47 safety
 * critic) — the audit link between a `revise` review and the next plan version.
 */
export interface PlanRevisionRequest {
  plan_id: string;
  review_id: string;
  requested_by: string;
  reason: string;
  requested_at: string;
  /** Envelope sequence, for interleaving with plans in the timeline. */
  sequence: number;
}

/** A system-level banner raised by `fallback.activated` or `error` (ticket #51). */
export interface SystemBanner {
  /** Envelope event_id — stable React key. */
  id: string;
  kind: "fallback" | "error";
  /** Raw event payload, rendered by the banner component. */
  payload: Record<string, unknown>;
  timestamp: string;
  sequence: number;
}

/** TTS generation state for one dispatch instruction (ticket #49). */
export interface TtsState {
  dispatch_id: string;
  unit_id: string | null;
  /** "generating" after `tts.started`, "ready" after `tts.ready`. */
  status: "generating" | "ready";
  engine: string | null;
  voice: string | null;
  started_at: string | null;
  completed_at: string | null;
  tts_audio_path: string | null;
  /** Measured TTS latency reported by `tts.ready.latency_ms`. */
  latency_ms: number | null;
}

/** Incident centre point, from `incident.started.location` (ticket #40 map). */
export interface IncidentLocation {
  lat: number;
  lon: number;
  label: string | null;
}

/** Incident extent, from `incident.started.bounding_box` (ticket #40 map). */
export interface BoundingBox {
  min_lat: number;
  min_lon: number;
  max_lat: number;
  max_lon: number;
}

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

  /* ---------------------------------------------------------------------- */
  /* Ticket #38 additions — each annotated with its consuming ticket         */
  /* ---------------------------------------------------------------------- */

  /** Full ordered event log. Consumed by #44 (agent/tool trace panel). */
  events: EventEnvelope[];

  /** Merged per-audio pipeline progress, in arrival order. #42, #43. */
  audios: AudioProgress[];

  /** Ordered agent activations. #44 (trace), #38 header phase. */
  agentRuns: AgentRun[];

  /** agent_id of the most recent unfinished run, null when idle. #44, #38. */
  activeAgentId: string | null;

  /** Requests and results merged by tool_call_id, in request order. #44, #45. */
  toolCalls: ToolCall[];

  /** EVERY plan version in arrival order (`plan` stays the latest). #46. */
  plans: DraftTacticalPlan[];

  /** Every `plan.revision.requested` payload, in order. #46, #47. */
  planRevisionRequests: PlanRevisionRequest[];

  /** EVERY safety review (`safetyReview` stays the latest). #47. */
  safetyReviews: SafetyReview[];

  /** Ordered fallback/error banners (counters above are kept too). #51. */
  banners: SystemBanner[];

  /** Scenario audio variant in force ("clean" | "radio"). #38 header, #51. */
  audioMode: string | null;

  /** TTS state per dispatch_id. #49 (dispatch panel). */
  ttsByDispatchId: Record<string, TtsState>;

  /**
   * PRODUCT INVARIANT #1 — dispatch stays INERT until an `approval.received`
   * event carrying decision === "approve" has been reduced. Nothing else in
   * this reducer may ever set this to true. #48 (approval gate), #49 (dispatch).
   */
  dispatchUnlocked: boolean;

  /** Incident centre point from `incident.started`. #40 (map). */
  incidentLocation: IncidentLocation | null;

  /** Incident bounding box from `incident.started`. #40 (map). */
  boundingBox: BoundingBox | null;
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
  /* ticket #38 additions */
  events: [],
  audios: [],
  agentRuns: [],
  activeAgentId: null,
  toolCalls: [],
  plans: [],
  planRevisionRequests: [],
  safetyReviews: [],
  banners: [],
  audioMode: null,
  ttsByDispatchId: {},
  dispatchUnlocked: false,
  incidentLocation: null,
  boundingBox: null,
};

/* -------------------------------------------------------------------------- */
/* Reducer helpers (pure)                                                     */
/* -------------------------------------------------------------------------- */

/** Narrow an envelope payload to a contract type (payloads are schema-valid). */
function payloadAs<T>(event: EventEnvelope): T {
  return event.payload as unknown as T;
}

/** Reads the payload as a loose record, for progress events with no contract type. */
function raw(event: EventEnvelope): Record<string, unknown> {
  return event.payload as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Empty progress record for an audio first seen through any pipeline event. */
function emptyAudio(audioId: string): AudioProgress {
  return {
    audio_id: audioId,
    received_at: null,
    status: "pending",
    audio_mode: null,
    speaker_hint: null,
    audio_path: null,
    duration_seconds: null,
    scenario_timestamp: null,
    stt_model_name: null,
    transcript: null,
    extracted_event_ids: [],
  };
}

/**
 * Immutably upserts the progress record of `audioId`, preserving arrival
 * order. An audio first seen through a later event is appended, so the
 * timeline never drops data because an `audio.received` was missed.
 */
function upsertAudio(
  audios: AudioProgress[],
  audioId: string,
  patch: (current: AudioProgress) => AudioProgress,
): AudioProgress[] {
  const index = audios.findIndex((a) => a.audio_id === audioId);
  if (index === -1) return [...audios, patch(emptyAudio(audioId))];
  const next = [...audios];
  next[index] = patch(next[index]);
  return next;
}

/** Audio stages are monotonic: a late `transcription.started` cannot rewind. */
const AUDIO_STAGE_ORDER: Record<AudioStatus, number> = {
  pending: 0,
  received: 1,
  transcribing: 2,
  transcribed: 3,
};

function advanceAudioStatus(
  current: AudioStatus,
  candidate: AudioStatus,
): AudioStatus {
  return AUDIO_STAGE_ORDER[candidate] > AUDIO_STAGE_ORDER[current]
    ? candidate
    : current;
}

/**
 * Which start event each completion event closes. An agent run is marked
 * finished by the most recent still-running run started by the mapped type,
 * which keeps concurrent runs (radio extraction while the context agent is
 * still collecting tools) correctly interleaved.
 */
const AGENT_COMPLETION: Partial<Record<EventType, EventType>> = {
  "situation.snapshot.ready": "context_agent.started",
  "radio_event.extracted": "radio_agent.started",
  "plan.draft.ready": "planning.started",
  "safety_review.ready": "safety_review.started",
  "dispatch.instruction.ready": "dispatch.started",
};

/** Marks the latest unfinished run started by `startedBy` as finished. */
function finishAgentRun(
  runs: AgentRun[],
  startedBy: EventType,
  event: EventEnvelope,
): AgentRun[] {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].started_by === startedBy && !runs[i].finished) {
      const next = [...runs];
      next[i] = {
        ...next[i],
        finished: true,
        finished_at: event.timestamp,
        finished_sequence: event.sequence,
      };
      return next;
    }
  }
  return runs;
}

/** agent_id of the most recently started run that is still running. */
function deriveActiveAgentId(runs: AgentRun[]): string | null {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (!runs[i].finished) return runs[i].agent_id;
  }
  return null;
}

/** Appends an agent run built from a `*.started` payload. */
function appendAgentRun(runs: AgentRun[], event: EventEnvelope): AgentRun[] {
  const p = raw(event);
  return [
    ...runs,
    {
      agent_id: asString(p.agent_id) ?? event.event_type,
      model_id: asString(p.model_id),
      started_at: asString(p.started_at) ?? event.timestamp,
      sequence: event.sequence,
      started_by: event.event_type,
      finished: false,
      finished_at: null,
      finished_sequence: null,
    },
  ];
}

/** Blank merged tool call, created by whichever half arrives first. */
function emptyToolCall(toolCallId: string, toolName: string): ToolCall {
  return {
    tool_call_id: toolCallId,
    agent_id: null,
    tool_name: toolName,
    arguments: null,
    reason: null,
    requested_at: null,
    requested_sequence: null,
    completed: false,
    status: null,
    data: null,
    source_type: null,
    source_name: null,
    retrieved_at: null,
    data_timestamp: null,
    is_cached: null,
    staleness_seconds: null,
    error: null,
    latency_ms: null,
  };
}

function upsertToolCall(
  calls: ToolCall[],
  toolCallId: string,
  toolName: string,
  patch: (current: ToolCall) => ToolCall,
): ToolCall[] {
  const index = calls.findIndex((c) => c.tool_call_id === toolCallId);
  if (index === -1) return [...calls, patch(emptyToolCall(toolCallId, toolName))];
  const next = [...calls];
  next[index] = patch(next[index]);
  return next;
}

/** Round-trip latency in ms, null when either timestamp is missing/invalid. */
function computeLatencyMs(
  requestedAt: string | null,
  retrievedAt: string | null,
): number | null {
  if (!requestedAt || !retrievedAt) return null;
  const start = Date.parse(requestedAt);
  const end = Date.parse(retrievedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return end - start;
}

/**
 * Placeholder note carried by mock `metric.updated` payloads.
 * PRODUCT INVARIANT #4 — the UI must flag these values as placeholders and
 * must never present them as measured. Ticket #38 header, ticket #50 panel.
 */
export function getMetricsNote(
  metrics: Record<string, unknown> | null,
): string | null {
  if (!metrics) return null;
  return typeof metrics.note === "string" ? metrics.note : null;
}

/** True when the current metric values are mock placeholders, not measured. */
export function areMetricsPlaceholder(
  metrics: Record<string, unknown> | null,
): boolean {
  const note = getMetricsNote(metrics);
  return note !== null && /mock|placeholder|not measured/i.test(note);
}

/* -------------------------------------------------------------------------- */
/* Reducer                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Pure reducer: one envelope in, next immutable state out.
 * Every event updates the bookkeeping; well-known types also update their
 * typed slice (the real views of tickets #40–#51 build on these).
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
    // Ticket #38: the full ordered log backing the trace panel (#44).
    events: [...state.events, event],
  };

  // Ticket #38: any payload that carries an explicit audio_mode updates the
  // scenario-wide mode (incident.started does; per-audio variants are tracked
  // on the AudioProgress record instead).
  const declaredAudioMode = asString(raw(event).audio_mode);
  if (declaredAudioMode !== null) next.audioMode = declaredAudioMode;

  // Ticket #38: close the matching agent run before opening any new one.
  const closes = AGENT_COMPLETION[event.event_type];
  if (closes) next.agentRuns = finishAgentRun(next.agentRuns, closes, event);

  switch (event.event_type) {
    case "incident.started": {
      const p = event.payload as {
        incident_id?: string;
        name?: string;
        network_mode?: string;
        location?: { lat?: unknown; lon?: unknown; label?: unknown };
        bounding_box?: Record<string, unknown>;
      };
      next.incidentStatus = "active";
      next.incidentId = p.incident_id ?? event.incident_id;
      next.incidentName = p.name ?? null;
      next.networkMode = p.network_mode ?? next.networkMode;

      // Ticket #38 → #40: geographic frame for the tactical map.
      const lat = asNumber(p.location?.lat);
      const lon = asNumber(p.location?.lon);
      next.incidentLocation =
        lat !== null && lon !== null
          ? { lat, lon, label: asString(p.location?.label) }
          : null;

      const bb = p.bounding_box ?? null;
      const minLat = asNumber(bb?.min_lat);
      const minLon = asNumber(bb?.min_lon);
      const maxLat = asNumber(bb?.max_lat);
      const maxLon = asNumber(bb?.max_lon);
      next.boundingBox =
        minLat !== null && minLon !== null && maxLat !== null && maxLon !== null
          ? { min_lat: minLat, min_lon: minLon, max_lat: maxLat, max_lon: maxLon }
          : null;
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
      // Ticket #38 → #51: ordered banner list alongside the counter.
      next.banners = [
        ...state.banners,
        {
          id: event.event_id,
          kind: "fallback",
          payload: raw(event),
          timestamp: event.timestamp,
          sequence: event.sequence,
        },
      ];
      break;
    case "error":
      next.errorCount = state.errorCount + 1;
      next.banners = [
        ...state.banners,
        {
          id: event.event_id,
          kind: "error",
          payload: raw(event),
          timestamp: event.timestamp,
          sequence: event.sequence,
        },
      ];
      break;

    /* ---------------------------------------------------------------- */
    /* Audio pipeline (ticket #38 → #42, #43)                           */
    /* ---------------------------------------------------------------- */

    case "audio.received": {
      const p = raw(event);
      const audioId = asString(p.audio_id);
      if (!audioId) break;
      const variant = asString(p.audio_variant);
      next.audios = upsertAudio(next.audios, audioId, (a) => ({
        ...a,
        received_at: event.timestamp,
        status: advanceAudioStatus(a.status, "received"),
        audio_mode:
          variant === "clean" || variant === "radio" ? variant : a.audio_mode,
        speaker_hint: asString(p.speaker_hint) ?? a.speaker_hint,
        audio_path: asString(p.audio_path) ?? a.audio_path,
        duration_seconds: asNumber(p.duration_seconds) ?? a.duration_seconds,
        scenario_timestamp:
          asNumber(p.scenario_timestamp) ?? a.scenario_timestamp,
      }));
      break;
    }

    case "transcription.started": {
      const p = raw(event);
      const audioId = asString(p.audio_id);
      if (!audioId) break;
      next.audios = upsertAudio(next.audios, audioId, (a) => ({
        ...a,
        status: advanceAudioStatus(a.status, "transcribing"),
        stt_model_name: asString(p.model_name) ?? a.stt_model_name,
      }));
      break;
    }

    case "transcript.ready": {
      const transcript = payloadAs<TranscriptResult>(event);
      next.transcripts = [...state.transcripts, transcript];
      next.audios = upsertAudio(next.audios, transcript.audio_id, (a) => ({
        ...a,
        status: advanceAudioStatus(a.status, "transcribed"),
        transcript,
        stt_model_name: transcript.model_name ?? a.stt_model_name,
      }));
      break;
    }

    case "radio_event.extracted": {
      const radioEvent = payloadAs<RadioEvent>(event);
      next.radioEvents = [...state.radioEvents, radioEvent];
      if (radioEvent.audio_id) {
        next.audios = upsertAudio(next.audios, radioEvent.audio_id, (a) =>
          a.extracted_event_ids.includes(radioEvent.event_id)
            ? a
            : {
                ...a,
                extracted_event_ids: [
                  ...a.extracted_event_ids,
                  radioEvent.event_id,
                ],
              },
        );
      }
      break;
    }

    /* ---------------------------------------------------------------- */
    /* Agent runs (ticket #38 → #44)                                    */
    /* ---------------------------------------------------------------- */

    case "radio_agent.started":
    case "context_agent.started":
    case "planning.started":
    case "safety_review.started":
    case "dispatch.started":
      next.agentRuns = appendAgentRun(next.agentRuns, event);
      break;

    /* ---------------------------------------------------------------- */
    /* Tool layer (ticket #38 → #44, #45)                               */
    /* ---------------------------------------------------------------- */

    case "tool.call.requested": {
      const request = payloadAs<ToolRequest>(event);
      next.toolRequests = [...state.toolRequests, request];
      next.toolCalls = upsertToolCall(
        next.toolCalls,
        request.tool_call_id,
        request.tool_name,
        (c) => ({
          ...c,
          agent_id: request.agent_id ?? c.agent_id,
          tool_name: request.tool_name ?? c.tool_name,
          arguments: request.arguments ?? c.arguments,
          reason: request.reason ?? c.reason,
          requested_at: request.requested_at ?? c.requested_at,
          requested_sequence: c.requested_sequence ?? event.sequence,
          latency_ms: computeLatencyMs(
            request.requested_at ?? c.requested_at,
            c.retrieved_at,
          ),
        }),
      );
      break;
    }
    case "tool.call.completed": {
      const result = payloadAs<ToolResult>(event);
      next.toolResults = [...state.toolResults, result];
      const p = raw(event);
      next.toolCalls = upsertToolCall(
        next.toolCalls,
        result.tool_call_id,
        result.tool_name,
        (c) => ({
          ...c,
          tool_name: result.tool_name ?? c.tool_name,
          completed: true,
          status: result.status ?? c.status,
          data: result.data ?? null,
          source_type: result.source_type ?? c.source_type,
          source_name: result.source_name ?? c.source_name,
          retrieved_at: result.retrieved_at ?? c.retrieved_at,
          data_timestamp: asString(p.data_timestamp) ?? c.data_timestamp,
          is_cached: asBoolean(p.is_cached) ?? c.is_cached,
          staleness_seconds:
            asNumber(p.staleness_seconds) ?? c.staleness_seconds,
          error: asString(p.error) ?? null,
          latency_ms: computeLatencyMs(
            c.requested_at,
            result.retrieved_at ?? c.retrieved_at,
          ),
        }),
      );
      break;
    }

    case "situation.snapshot.ready":
      next.snapshot = payloadAs<SituationSnapshot>(event);
      break;

    case "plan.draft.ready": {
      const plan = payloadAs<DraftTacticalPlan>(event);
      next.plan = plan;
      next.planVersions = Math.max(state.planVersions, plan.version ?? state.planVersions + 1);
      // Ticket #38 → #46: keep EVERY version, not just the latest.
      next.plans = [...state.plans, plan];
      break;
    }

    case "plan.revision.requested": {
      const p = raw(event);
      next.planRevisionRequests = [
        ...state.planRevisionRequests,
        {
          plan_id: asString(p.plan_id) ?? "",
          review_id: asString(p.review_id) ?? "",
          requested_by: asString(p.requested_by) ?? "",
          reason: asString(p.reason) ?? "",
          requested_at: asString(p.requested_at) ?? event.timestamp,
          sequence: event.sequence,
        },
      ];
      break;
    }

    case "safety_review.ready": {
      const review = payloadAs<SafetyReview>(event);
      next.safetyReview = review;
      // Ticket #38 → #47: the "revise" review must stay visible after the pass.
      next.safetyReviews = [...state.safetyReviews, review];
      break;
    }

    case "approval.requested":
      next.approvalRequested = true;
      break;
    case "approval.received": {
      const decision = payloadAs<ApprovalDecision>(event);
      next.approvalRequested = false;
      next.approval = decision;
      // PRODUCT INVARIANT #1 — the ONLY place dispatchUnlocked becomes true.
      if (decision.decision === "approve") next.dispatchUnlocked = true;
      break;
    }

    case "dispatch.instruction.ready":
      next.dispatches = [...state.dispatches, payloadAs<DispatchInstruction>(event)];
      break;
    case "tts.started": {
      const p = raw(event);
      const dispatchId = asString(p.dispatch_id);
      if (!dispatchId) break;
      const current = state.ttsByDispatchId[dispatchId];
      next.ttsByDispatchId = {
        ...state.ttsByDispatchId,
        [dispatchId]: {
          dispatch_id: dispatchId,
          unit_id: asString(p.unit_id) ?? current?.unit_id ?? null,
          status: "generating",
          engine: asString(p.engine) ?? current?.engine ?? null,
          voice: asString(p.voice) ?? current?.voice ?? null,
          started_at: asString(p.started_at) ?? event.timestamp,
          completed_at: current?.completed_at ?? null,
          tts_audio_path: current?.tts_audio_path ?? null,
          latency_ms: current?.latency_ms ?? null,
        },
      };
      break;
    }
    case "tts.ready": {
      const p = event.payload as { dispatch_id?: string; tts_audio_path?: string };
      next.dispatches = state.dispatches.map((d) =>
        d.dispatch_id === p.dispatch_id
          ? { ...d, tts_audio_path: p.tts_audio_path ?? d.tts_audio_path, dispatch_status: "ready" }
          : d,
      );
      // Ticket #38 → #49: per-dispatch TTS status, independent of the instruction.
      const dispatchId = asString(p.dispatch_id);
      if (dispatchId) {
        const all = raw(event);
        const current = state.ttsByDispatchId[dispatchId];
        next.ttsByDispatchId = {
          ...state.ttsByDispatchId,
          [dispatchId]: {
            dispatch_id: dispatchId,
            unit_id: asString(all.unit_id) ?? current?.unit_id ?? null,
            status: "ready",
            engine: asString(all.engine) ?? current?.engine ?? null,
            voice: current?.voice ?? null,
            started_at: current?.started_at ?? null,
            completed_at: asString(all.completed_at) ?? event.timestamp,
            tts_audio_path:
              asString(all.tts_audio_path) ?? current?.tts_audio_path ?? null,
            latency_ms: asNumber(all.latency_ms) ?? current?.latency_ms ?? null,
          },
        };
      }
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
      // Remaining progress events are covered by countsByType / lastByType.
      break;
  }

  // Ticket #38: derived after every event, never stored ad hoc.
  next.activeAgentId = deriveActiveAgentId(next.agentRuns);

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
