/**
 * BLAZE frontend contract types.
 *
 * Hand-written from the FROZEN JSON Schemas in `contracts/schemas/*.schema.json`
 * (draft-07). The schemas are the single source of truth — if a schema changes
 * (via a dedicated contract-change PR), this file must be updated to match.
 * NEVER edit the schemas from the frontend workstream.
 */

/* -------------------------------------------------------------------------- */
/* Shared enums                                                               */
/* -------------------------------------------------------------------------- */

/** Priority / urgency scale shared by RadioEvent, UnitAction, DispatchInstruction. */
export type Priority = "low" | "medium" | "high" | "critical";

/** Provenance categories (tool_result.schema.json / situation_snapshot.schema.json). */
export type SourceType =
  | "live_public"
  | "cached_public"
  | "seeded_demo"
  | "human_report"
  | "model_inference";

/* -------------------------------------------------------------------------- */
/* event_envelope.schema.json                                                 */
/* -------------------------------------------------------------------------- */

/** The 27 event types of the envelope enum, in schema order. */
export const EVENT_TYPES = [
  "incident.started",
  "audio.received",
  "transcription.started",
  "transcript.ready",
  "radio_agent.started",
  "radio_event.extracted",
  "context_agent.started",
  "tool.call.requested",
  "tool.call.completed",
  "situation.snapshot.ready",
  "planning.started",
  "plan.draft.ready",
  "safety_review.started",
  "safety_review.ready",
  "approval.requested",
  "approval.received",
  "plan.revision.requested",
  "dispatch.started",
  "dispatch.instruction.ready",
  "tts.started",
  "tts.ready",
  "dispatch.sent",
  "metric.updated",
  "network.mode.changed",
  "fallback.activated",
  "error",
  "incident.completed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Envelope wrapping every event streamed from the backend to the frontend.
 * `payload` is event-type-specific; well-known payloads can be narrowed with
 * the matching contract type (RadioEvent, DraftTacticalPlan, ...).
 */
export interface EventEnvelope<P = Record<string, unknown>> {
  /** Unique identifier of this event. */
  event_id: string;
  /** Identifier of the incident this event belongs to. */
  incident_id: string;
  /** Type of the wrapped event. */
  event_type: EventType;
  /** Emission time (ISO 8601). */
  timestamp: string;
  /** Monotonically increasing sequence number within the incident (>= 1). */
  sequence: number;
  /** Event-type-specific payload (see the matching contract schema). */
  payload: P;
}

/* -------------------------------------------------------------------------- */
/* audio_manifest_item.schema.json                                            */
/* -------------------------------------------------------------------------- */

/** One prerecorded radio audio message of the demo scenario. */
export interface AudioManifestItem {
  /** Stable identifier of the audio message (e.g. audio_01). */
  audio_id: string;
  /** Offset in seconds from incident start at which this message is released (>= 0). */
  scenario_timestamp: number;
  /** Expected speaking unit (e.g. Alpha 3). */
  speaker_hint: string;
  /** Relative path to the clean WAV version. */
  clean_path: string;
  /** Relative path to the radio-degraded WAV version. */
  radio_path: string;
  /** Exact French reference transcript of the message. */
  reference_transcript: string;
  /** RadioEvent event_type values expected to be extracted from this message. */
  expected_event_types: string[];
}

/* -------------------------------------------------------------------------- */
/* transcript_result.schema.json                                              */
/* -------------------------------------------------------------------------- */

/** Time-aligned transcript segment. */
export interface TranscriptSegment {
  /** Segment start time in seconds. */
  start: number;
  /** Segment end time in seconds. */
  end: number;
  /** Segment text. */
  text: string;
  /** Segment confidence in [0, 1] when available. */
  confidence?: number | null;
}

/** Output of the local speech-to-text service for one audio message. */
export interface TranscriptResult {
  /** Identifier of the transcribed audio message. */
  audio_id: string;
  /** Full transcript text. */
  text: string;
  /** Detected or hinted language code (e.g. fr). */
  language: string;
  /** Time-aligned transcript segments. */
  segments?: TranscriptSegment[];
  /** Transcription start time (ISO 8601). */
  started_at: string;
  /** Transcription completion time (ISO 8601). */
  completed_at: string;
  /** Measured transcription latency in milliseconds (>= 0). */
  latency_ms: number;
  /** Local STT model identifier (e.g. faster-whisper-small). */
  model_name: string;
  /** True if a fallback (clean audio or reference transcript) was used. */
  fallback_used: boolean;
}

/* -------------------------------------------------------------------------- */
/* radio_event.schema.json                                                    */
/* -------------------------------------------------------------------------- */

/** Category of the extracted operational event. */
export type RadioEventType =
  | "hazard_report"
  | "resource_update"
  | "road_status"
  | "wind_update"
  | "correction"
  | "confirmation"
  | "position_update"
  | "other";

/** Whether a fact is reported, inferred, or field-confirmed. */
export type ConfirmationStatus = "reported" | "inferred" | "confirmed";

/**
 * Structured operational event extracted from one radio transcript by the
 * Radio Intelligence Agent.
 */
export interface RadioEvent {
  /** Unique identifier of this radio event. */
  event_id: string;
  /** Identifier of the source audio message. */
  audio_id: string;
  /** Identified speaking unit (e.g. alpha-3), null if unknown. */
  unit_id?: string | null;
  /** Category of the extracted operational event. */
  event_type: RadioEventType;
  /** Location mentioned in the message (e.g. hangar, D17), null if none. */
  location_reference?: string | null;
  /** Atomic facts extracted from the message. */
  facts: string[];
  /** Assessed urgency of the event. */
  urgency: Priority;
  /** Extraction confidence in [0, 1]. */
  confidence: number;
  /** Whether the fact is reported, inferred, or field-confirmed. */
  confirmation_status: ConfirmationStatus;
  /** True if this event corrects a previous event. */
  is_correction: boolean;
  /** Identifier of the corrected event, null if not a correction. */
  corrects_event_id?: string | null;
  /** Open uncertainties attached to this event. */
  uncertainties?: string[];
  /** Exact transcript span supporting this event. */
  evidence_text: string;
  /** Time the observation was made (ISO 8601). */
  observed_at: string;
  /** Always human_report for radio events. */
  source_type: "human_report";
}

/* -------------------------------------------------------------------------- */
/* tool_request.schema.json                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A tool call requested by a Gemma agent, validated and executed by the
 * deterministic tool layer.
 */
export interface ToolRequest {
  /** Unique identifier of this tool call. */
  tool_call_id: string;
  /** Identifier of the requesting agent (e.g. situation_context). */
  agent_id: string;
  /** Allowlisted tool name (e.g. weather, elevation, firms, cadastre, osm, routing, resources). */
  tool_name: string;
  /** Tool arguments as validated key/value pairs. */
  arguments: Record<string, unknown>;
  /** Concise agent rationale for requesting this tool. */
  reason?: string;
  /** Request time (ISO 8601). */
  requested_at: string;
}

/* -------------------------------------------------------------------------- */
/* tool_result.schema.json                                                    */
/* -------------------------------------------------------------------------- */

/** Tool execution outcome. */
export type ToolResultStatus = "success" | "error" | "timeout" | "fallback";

/** Result of an executed tool call, with full provenance and cache/staleness information. */
export interface ToolResult {
  /** Identifier of the originating tool call. */
  tool_call_id: string;
  /** Executed tool name. */
  tool_name: string;
  /** Execution outcome. */
  status: ToolResultStatus;
  /** Structured tool output, null on error. */
  data?: Record<string, unknown> | unknown[] | null;
  /** Provenance category of the returned data. */
  source_type: SourceType;
  /** Human-readable source (e.g. open-meteo, nasa-firms, cadastre-etalab). */
  source_name: string;
  /** Time the data was retrieved by the tool layer (ISO 8601). */
  retrieved_at: string;
  /** Timestamp of the underlying data itself, null if unknown. */
  data_timestamp?: string | null;
  /** True if served from local cache. */
  is_cached: boolean;
  /** Age of the data in seconds (>= 0), null if unknown. */
  staleness_seconds?: number | null;
  /** Error message when status is not success, null otherwise. */
  error?: string | null;
}

/* -------------------------------------------------------------------------- */
/* situation_snapshot.schema.json                                             */
/* -------------------------------------------------------------------------- */

/** Per-field data provenance entry of a situation snapshot. */
export interface ProvenanceEntry {
  /** Snapshot field the provenance applies to. */
  field: string;
  /** Provenance category. */
  source_type: SourceType;
  /** Human-readable source. */
  source_name: string;
  /** Retrieval time. */
  retrieved_at?: string;
}

/**
 * Normalized picture of the incident produced by the Situation Context Agent,
 * with explicit provenance.
 */
export interface SituationSnapshot {
  /** Identifier of the incident. */
  incident_id: string;
  /** Snapshot version, incremented on each rebuild (>= 1). */
  version: number;
  /** Identifiers of the RadioEvents incorporated in this snapshot. */
  radio_events: string[];
  /** Normalized weather state (temperature, humidity, wind speed/direction/gusts). */
  weather?: Record<string, unknown> | null;
  /** Normalized terrain state (elevation, slope estimate). */
  terrain?: Record<string, unknown> | null;
  /** Detected or cached fire hotspots. */
  fire_hotspots?: Record<string, unknown>[];
  /** Road segments with current status and vehicle restrictions. */
  roads?: Record<string, unknown>[];
  /** Relevant cadastral buildings and parcels. */
  buildings_and_parcels?: Record<string, unknown>[];
  /** Vulnerable or critical assets (camping, water points, infrastructure). */
  critical_assets?: Record<string, unknown>[];
  /** Current unit states. */
  units?: Record<string, unknown>[];
  /** Current resource states. */
  resources?: Record<string, unknown>[];
  /** Facts considered established. */
  known_facts: string[];
  /** Facts that remain uncertain. */
  uncertain_facts: string[];
  /** Unresolved contradictions between sources. */
  conflicts: string[];
  /** Information identified as missing. */
  missing_information: string[];
  /** Per-field data provenance. */
  provenance: ProvenanceEntry[];
  /** Snapshot generation time (ISO 8601). */
  generated_at: string;
}

/* -------------------------------------------------------------------------- */
/* unit_action.schema.json                                                    */
/* -------------------------------------------------------------------------- */

/** One proposed action for a specific unit inside a draft tactical plan. */
export interface UnitAction {
  /** Unique identifier of this action. */
  action_id: string;
  /** Target unit (e.g. alpha-3). */
  unit_id: string;
  /** Action category (e.g. retreat, reconnaissance, confirm_access, hold_position). */
  action_type: string;
  /** Concise human-readable instruction. */
  instruction: string;
  /** Route identifier to use (e.g. north-access), null if not applicable. */
  route?: string | null;
  /** Destination identifier (e.g. water-point-2), null if not applicable. */
  destination?: string | null;
  /** Why this action is proposed. */
  reason: string;
  /** Action priority. */
  priority: Priority;
  /** RadioEvent or tool-call identifiers supporting this action. */
  evidence_ids: string[];
  /** Planning confidence in [0, 1]. */
  confidence: number;
  /** True if the action must be approved by the incident commander. */
  human_approval_required: boolean;
  /** True if the unit must acknowledge the instruction. */
  acknowledgement_required: boolean;
}

/* -------------------------------------------------------------------------- */
/* draft_tactical_plan.schema.json                                            */
/* -------------------------------------------------------------------------- */

/** Alternative considered and rejected by the planning agent. */
export interface RejectedOption {
  /** Rejected alternative. */
  option: string;
  /** Why it was rejected. */
  reason: string;
}

/**
 * Versioned operational plan proposed by the Tactical Fusion and Planning
 * Agent. Never dispatched without human approval.
 */
export interface DraftTacticalPlan {
  /** Unique identifier of this plan version. */
  plan_id: string;
  /** Identifier of the incident. */
  incident_id: string;
  /** Plan version, incremented on each revision (>= 1). */
  version: number;
  /** Concise summary of the plan. */
  summary: string;
  /** Operational objectives. */
  objectives: string[];
  /** Proposed per-unit actions. */
  unit_actions: UnitAction[];
  /** Alternatives considered and rejected. */
  rejected_options?: RejectedOption[];
  /** Assumptions the plan relies on. */
  assumptions?: string[];
  /** Unresolved uncertainties. */
  uncertainties?: string[];
  /** Identifiers of supporting evidence. */
  evidence_ids?: string[];
  /** Plan creation time (ISO 8601). */
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/* safety_review.schema.json                                                  */
/* -------------------------------------------------------------------------- */

/** Safety review outcome. */
export type SafetyReviewStatus = "pass" | "revise" | "block";

/** Explicit safety-rule check result. */
export interface RuleCheck {
  /** Identifier of the safety rule checked. */
  rule_id: string;
  /** Whether the rule check passed. */
  passed: boolean;
  /** Short check result explanation. */
  detail?: string;
}

/**
 * Adversarial safety review of a draft tactical plan produced by the Safety
 * Critic Agent.
 */
export interface SafetyReview {
  /** Unique identifier of this review. */
  review_id: string;
  /** Identifier of the reviewed plan version. */
  plan_id: string;
  /** Review outcome. */
  status: SafetyReviewStatus;
  /** Material risks found in the plan. */
  critical_objections: string[];
  /** Changes required before the plan can pass. */
  required_changes: string[];
  /** Field confirmations required before or after approval. */
  required_confirmations?: string[];
  /** Explicit safety-rule check results. */
  rule_checks: RuleCheck[];
  /** Review time (ISO 8601). */
  reviewed_at: string;
}

/* -------------------------------------------------------------------------- */
/* approval_decision.schema.json                                              */
/* -------------------------------------------------------------------------- */

/** Commander decision on a tactical plan. */
export type Decision = "approve" | "modify" | "reject";

/**
 * Explicit decision of the human incident commander on a tactical plan.
 * Dispatch is impossible without it.
 */
export interface ApprovalDecision {
  /** Unique identifier of this decision. */
  decision_id: string;
  /** Identifier of the plan version being decided. */
  plan_id: string;
  /** Commander decision. */
  decision: Decision;
  /** Name or role of the deciding operator. */
  operator_name: string;
  /** Optional operator note, null if none. */
  operator_note?: string | null;
  /** Operator-modified actions when decision is modify. */
  modified_actions?: UnitAction[];
  /** Decision time (ISO 8601). */
  decided_at: string;
}

/* -------------------------------------------------------------------------- */
/* dispatch_instruction.schema.json                                           */
/* -------------------------------------------------------------------------- */

/** Current status in the simulated dispatch pipeline. */
export type DispatchStatus =
  | "pending"
  | "tts_generating"
  | "ready"
  | "sent"
  | "acknowledged"
  | "failed";

/**
 * One approved, unit-specific dispatch message generated by the Dispatch Agent
 * after human approval.
 */
export interface DispatchInstruction {
  /** Unique identifier of this dispatch instruction. */
  dispatch_id: string;
  /** Identifier of the approved plan version. */
  plan_id: string;
  /** Recipient unit (e.g. alpha-3). */
  unit_id: string;
  /** Message priority. */
  priority: Priority;
  /** Exact TTS-ready French message text. */
  message_text: string;
  /** True if the unit must acknowledge reception. */
  acknowledgement_required: boolean;
  /** Path to the generated TTS WAV, null until generated. */
  tts_audio_path?: string | null;
  /** Generation time (ISO 8601). */
  generated_at: string;
  /** Current status in the simulated dispatch pipeline. */
  dispatch_status: DispatchStatus;
}
