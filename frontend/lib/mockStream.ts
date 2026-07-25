/**
 * BLAZE mock stream loader.
 *
 * Loads `contracts/mocks/demo_event_stream.jsonl` (copied into
 * `frontend/public/mocks/` by the `sync-mocks` npm script, which runs
 * automatically before `dev` and `build`) and parses it into typed
 * `EventEnvelope` values, validating each line against the envelope contract.
 */

import { EVENT_TYPES, type EventEnvelope, type EventType } from "./contracts";

/** Public URL where the sync-mocks script places the JSONL mock stream. */
export const MOCK_STREAM_URL = "/mocks/demo_event_stream.jsonl";

/** One line of the JSONL that failed envelope validation or JSON parsing. */
export interface StreamParseError {
  /** 1-based line number in the JSONL file. */
  line: number;
  /** Why the line was rejected. */
  reason: string;
  /** Raw line content (truncated for logging). */
  raw: string;
}

export interface ParsedStream {
  /** Valid envelope-wrapped events, in file (scenario) order. */
  events: EventEnvelope[];
  /** Lines that failed to parse or validate. */
  errors: StreamParseError[];
}

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);

/** Type guard: checks a parsed JSON value against the EventEnvelope contract. */
export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.event_id === "string" &&
    typeof v.incident_id === "string" &&
    typeof v.event_type === "string" &&
    EVENT_TYPE_SET.has(v.event_type) &&
    typeof v.timestamp === "string" &&
    !Number.isNaN(Date.parse(v.timestamp)) &&
    typeof v.sequence === "number" &&
    Number.isInteger(v.sequence) &&
    v.sequence >= 1 &&
    typeof v.payload === "object" &&
    v.payload !== null &&
    !Array.isArray(v.payload)
  );
}

/** Describes which envelope field is invalid, for actionable error messages. */
function envelopeProblem(v: Record<string, unknown>): string {
  if (typeof v.event_id !== "string") return "missing/invalid event_id";
  if (typeof v.incident_id !== "string") return "missing/invalid incident_id";
  if (typeof v.event_type !== "string") return "missing/invalid event_type";
  if (!EVENT_TYPE_SET.has(v.event_type)) {
    return `unknown event_type "${v.event_type}"`;
  }
  if (typeof v.timestamp !== "string" || Number.isNaN(Date.parse(v.timestamp))) {
    return "missing/invalid timestamp";
  }
  if (
    typeof v.sequence !== "number" ||
    !Number.isInteger(v.sequence) ||
    v.sequence < 1
  ) {
    return "missing/invalid sequence";
  }
  if (
    typeof v.payload !== "object" ||
    v.payload === null ||
    Array.isArray(v.payload)
  ) {
    return "missing/invalid payload";
  }
  return "invalid envelope";
}

/**
 * Parses raw JSONL text into typed, validated event envelopes.
 * Blank lines are skipped; every non-blank line must be a valid envelope.
 */
export function parseEventStream(jsonl: string): ParsedStream {
  const events: EventEnvelope[] = [];
  const errors: StreamParseError[] = [];

  const lines = jsonl.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      errors.push({
        line: i + 1,
        reason: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        raw: raw.slice(0, 120),
      });
      continue;
    }

    if (isEventEnvelope(parsed)) {
      events.push(parsed);
    } else {
      errors.push({
        line: i + 1,
        reason: envelopeProblem(parsed as Record<string, unknown>),
        raw: raw.slice(0, 120),
      });
    }
  }

  return { events, errors };
}

/**
 * Fetches and parses the mock event stream from `/mocks/`.
 * Throws if the file cannot be fetched or if any line fails validation, so a
 * contract drift is caught immediately instead of silently dropping events.
 */
export async function loadMockStream(
  url: string = MOCK_STREAM_URL,
): Promise<EventEnvelope[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch mock stream at ${url} (HTTP ${res.status}). ` +
        `Run "npm run sync-mocks" to copy contracts/mocks/ into public/mocks/.`,
    );
  }

  const { events, errors } = parseEventStream(await res.text());
  if (errors.length > 0) {
    const detail = errors
      .map((e) => `  line ${e.line}: ${e.reason}`)
      .join("\n");
    throw new Error(
      `Mock stream contains ${errors.length} invalid event(s):\n${detail}`,
    );
  }

  return events;
}

/** Counts events per event_type — handy for quick console diagnostics. */
export function countByEventType(
  events: EventEnvelope[],
): Partial<Record<EventType, number>> {
  const counts: Partial<Record<EventType, number>> = {};
  for (const e of events) {
    counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
  }
  return counts;
}
