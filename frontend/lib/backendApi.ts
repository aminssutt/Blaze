/**
 * BLAZE backend REST client (ticket #54) — the thin fetch layer used in LIVE
 * mode only. Endpoints are Selyan's (#22 streaming, #34 approval):
 *
 *   POST /incident/start     — start the scenario run (demo replay for now)
 *   POST /incident/reset     — back to IDLE, sequences restart at 1
 *   POST /plans              — register a DraftTacticalPlan version
 *   POST /approval/decision  — record a human approve / modify / reject
 *
 * KNOWN BACKEND GAP the client compensates for: the dev replay publishes
 * `plan.draft.ready` envelopes straight onto the event bus WITHOUT registering
 * the plan in the PlanStore, so a decision on a replayed plan 404s. The
 * decision helper therefore retries once after submitting the plan the UI
 * already holds (the payload came from the stream, so it IS the plan).
 */

import type { DraftTacticalPlan, Decision } from "./contracts";
import { getBackendBase } from "./streamMode";

/** Error carrying the HTTP status so callers can branch (404 → register plan). */
export class BackendApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string,
  ) {
    super(`${path} → HTTP ${status}: ${detail}`);
    this.name = "BackendApiError";
  }
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${getBackendBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const parsed = (await response.json()) as { detail?: unknown };
      if (typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      // Non-JSON error body — keep the status text.
    }
    throw new BackendApiError(response.status, path, detail);
  }
  return response.json();
}

/* ------------------------------ demo control ------------------------------ */

/** Starts the scenario run. A 409 (already running) is swallowed: the goal —
 * events flowing — is already met. */
export async function startIncident(speedFactor: number): Promise<void> {
  try {
    await postJson("/incident/start", { speed_factor: speedFactor });
  } catch (err) {
    if (err instanceof BackendApiError && err.status === 409) return;
    throw err;
  }
}

/** Resets the backend run (bus history cleared, sequence restarts at 1). */
export async function resetIncident(): Promise<void> {
  await postJson("/incident/reset", undefined);
}

/* -------------------------------- approval -------------------------------- */

export interface DecisionResult {
  decision: Record<string, unknown>;
  new_plan: Record<string, unknown> | null;
}

/**
 * Records a commander decision on `plan` (POST /approval/decision).
 *
 * - `modify` requires modified actions server-side; the UI has no action
 *   editor yet, so the current actions are resubmitted unchanged and the
 *   operator note carries the requested change (backend mints version N+1
 *   and re-emits plan.draft.ready + plan.revision.requested on the bus).
 * - On 404 (replayed plan unknown to the PlanStore) the plan held by the UI
 *   is registered via POST /plans, then the decision is retried once.
 */
export async function postApprovalDecision(
  plan: DraftTacticalPlan,
  decision: Decision,
  operatorNote: string | null,
  operatorName = "commandant (UI)",
): Promise<DecisionResult> {
  const body = {
    plan_id: plan.plan_id,
    decision,
    operator_name: operatorName,
    operator_note: operatorNote,
    modified_actions: decision === "modify" ? plan.unit_actions : null,
  };
  try {
    return (await postJson("/approval/decision", body)) as DecisionResult;
  } catch (err) {
    if (!(err instanceof BackendApiError) || err.status !== 404) throw err;
    await submitPlan(plan);
    return (await postJson("/approval/decision", body)) as DecisionResult;
  }
}

/** Registers a plan version the backend does not know yet (409 = already there). */
async function submitPlan(plan: DraftTacticalPlan): Promise<void> {
  try {
    await postJson("/plans", plan);
  } catch (err) {
    if (err instanceof BackendApiError && err.status === 409) return;
    throw err;
  }
}
