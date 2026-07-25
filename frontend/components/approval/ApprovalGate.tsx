// Ticket #48 — validation commandant. Owner: @selyan-mhli.
//
// PRODUCT INVARIANT #1 — `dispatchUnlocked` is the single derived gate: it is
// true ONLY after an approval.received event carrying decision === "approve".
// This component never sets state itself — it drives the mock replay (phase
// jumps) and lets the reduced events flow back through the store. Ticket #54:
// in LIVE mode the same handler POSTs the real /approval/decision instead
// (the resulting approval.received / plan.draft.ready events flow back through
// the SSE stream); the rendering below is already API-shaped
// (ApprovalDecision contract). Mock behaviour is byte-for-byte untouched.
//
// THE DEMO MOMENT (product/pro-polish-gate): the decision buttons are NOT a
// permanent fixture. Before approval.requested the panel shows its waiting
// state without any button; the instant the event lands, the whole decision
// block SURGES in (scale+fade spring) while the surrounding aside pulses
// amber — the jury must SEE the AI hand over to the human. After the decision
// the buttons leave and the existing recap takes their place.

"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useIncidentState,
  usePlayerState,
  useSessionControls,
} from "@/lib/session";
import { isLiveMode } from "@/lib/streamMode";
import { postApprovalDecision } from "@/lib/backendApi";
import type { Decision } from "@/lib/contracts";
import { Badge, Panel, StatusDot } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

/** Unit-action ids whose content changed between two plan versions (#48: "modify marks edited actions"). */
function changedActionIds(
  previous: { unit_actions?: { action_id?: string }[] } | undefined,
  current: { unit_actions?: { action_id?: string }[] } | undefined,
): string[] {
  if (!previous?.unit_actions || !current?.unit_actions) return [];
  const before = new Map(
    previous.unit_actions.map((a) => [a.action_id, JSON.stringify(a)]),
  );
  return current.unit_actions
    .filter((a) => before.get(a.action_id) !== JSON.stringify(a))
    .map((a) => a.action_id ?? "?");
}

export default function ApprovalGate({ className }: PanelComponentProps) {
  const { approvalRequested, approval, dispatchUnlocked, plan, plans } =
    useIncidentState();
  const player = usePlayerState();
  const controls = useSessionControls();
  const reduce = useReducedMotion();
  const [note, setNote] = useState("");
  /** Note typed in THIS session, frozen at decision time for the audit trail. */
  const [sessionNote, setSessionNote] = useState<string | null>(null);
  /** Ticket #54 — live-mode API call state (in flight / last failure). */
  const [posting, setPosting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const live = isLiveMode();
  const decisionPending = approvalRequested && !approval;
  const hasJump = (id: string) => player.jumpPoints.some((p) => p.id === id);

  /**
   * The ONE decision handler (#54). Mock: unchanged phase jump. Live: POST
   * /approval/decision — no local state is set; the approval.received (and,
   * on modify, plan.draft.ready v+1) events come back through the SSE stream.
   */
  const decide = (target: string, decision: Decision) => {
    setSessionNote(note.trim() || null);
    if (!live) {
      controls.jumpTo(target);
      return;
    }
    if (!plan || posting) return;
    setPosting(true);
    setApiError(null);
    postApprovalDecision(plan, decision, note.trim() || null)
      .catch((err: unknown) => {
        setApiError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setPosting(false));
  };

  /** Mock replay has no branch for `id` → disabled; live only needs a plan. */
  const cannotDecide = (mockJumpId: string) =>
    live ? !plan || posting : !hasJump(mockJumpId);

  const edited = changedActionIds(plans[plans.length - 2], plans[plans.length - 1]);

  return (
    <Panel
      className={className}
      id="approval-gate"
      title="Commander approval"
      subtitle={plan ? `plan ${plan.plan_id} · v${plan.version}` : undefined}
      right={
        <Badge
          variant={dispatchUnlocked ? "ok" : "alert"}
          filled
          title="Invariant produit #1 — la diffusion reste inerte sans validation humaine"
        >
          {dispatchUnlocked ? "diffusion déverrouillée" : "dispatch locked"}
        </Badge>
      }
      live={approvalRequested}
      tone={approvalRequested ? "accent" : dispatchUnlocked ? "ok" : "default"}
      empty={!approvalRequested && !approval}
      emptyLabel="no approval requested yet…"
      emptyHint="the decision buttons appear the moment the AI hands over"
    >
      <div className="flex flex-col gap-2">
        {/* The decision block only EXISTS while the decision is pending: it
            surges in when approval.requested lands (the hand-over moment) and
            leaves once the decision is taken, replaced by the recap below. */}
        <AnimatePresence initial={false}>
          {decisionPending && (
            <motion.div
              key="decision-block"
              data-testid="approval-decision-block"
              className="flex flex-col gap-2"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.82, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -4 }}
              transition={{ type: "spring", stiffness: 420, damping: 26, mass: 0.9 }}
            >
              <div className="flex items-center gap-2 rounded-sm border border-accent-dim bg-accent-dim/20 p-2">
                <StatusDot tone="warn" pulse />
                <span className="text-[11px] text-accent">
                  décision du commandant attendue
                </span>
              </div>

              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="note opérateur (jointe à la décision)…"
                aria-label="Note opérateur"
                className="w-full resize-none rounded-sm border border-edge bg-overlay p-2 text-[11px] leading-snug text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
              />

              {/* Approve + Modify are the primary acts; Reject stays discreet. */}
              <div className="flex items-stretch gap-1.5" role="group" aria-label="Décision">
                <button
                  type="button"
                  onClick={() => decide("dispatch", "approve")}
                  disabled={cannotDecide("dispatch")}
                  className="flex-[3] rounded-sm border border-ok bg-ok/15 px-2 py-2 font-mono text-[12px] font-bold text-ok hover:bg-ok/25 disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    live
                      ? "Valide le plan via POST /approval/decision (backend réel)"
                      : "Valide le plan et déclenche la phase de diffusion du replay"
                  }
                >
                  ✓ Approuver
                </button>
                <button
                  type="button"
                  onClick={() => decide("plan-v2", "modify")}
                  disabled={cannotDecide("plan-v2")}
                  className="flex-[3] rounded-sm border border-warn bg-warn/15 px-2 py-2 font-mono text-[12px] font-bold text-warn hover:bg-warn/25 disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    live
                      ? "Demande une révision via POST /approval/decision — le backend émet la version suivante du plan"
                      : "Demande une révision : rejoue le scénario jusqu'à la version suivante du plan"
                  }
                >
                  ✎ Modifier
                </button>
                <button
                  type="button"
                  onClick={() => decide("", "reject")}
                  disabled={!live || !plan || posting}
                  className={
                    live
                      ? "flex-1 rounded-sm border border-edge px-2 py-2 font-mono text-[11px] text-muted hover:border-alert/60 hover:text-alert disabled:cursor-not-allowed disabled:opacity-40"
                      : "flex-1 cursor-not-allowed rounded-sm border border-edge px-2 py-2 font-mono text-[11px] text-muted opacity-40"
                  }
                  title={
                    live
                      ? "Rejette le plan via POST /approval/decision (backend réel)"
                      : "Pas de branche « rejet » dans le replay mock — activé en mode live (ticket #54)"
                  }
                >
                  ✕ Rejeter
                </button>
              </div>

              {live && (posting || apiError) && (
                <p
                  data-testid="approval-api-status"
                  className={`font-mono text-[10px] ${apiError ? "text-alert" : "text-faint"}`}
                >
                  {apiError
                    ? `échec de la décision : ${apiError}`
                    : "envoi de la décision au backend…"}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {approval && (
          <div className="rounded-sm border border-edge bg-overlay p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant={approval.decision === "approve" ? "ok" : "alert"}
                filled
              >
                {approval.decision}
              </Badge>
              <span className="font-mono text-[11px] text-foreground">
                {approval.operator_name}
              </span>
              <span className="font-mono text-[10px] text-faint">
                {approval.decided_at}
              </span>
            </div>
            {approval.operator_note && (
              <p className="mt-1 text-[11px] leading-snug text-muted">
                « {approval.operator_note} »
              </p>
            )}
            {sessionNote && (
              <p className="mt-1 text-[11px] leading-snug text-accent">
                note opérateur (session) : « {sessionNote} »
              </p>
            )}
          </div>
        )}

        {plans.length >= 2 && edited.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-sm border border-edge bg-overlay p-2">
            <span className="text-[10px] uppercase tracking-wide text-faint">
              v{plans[plans.length - 1].version} — actions modifiées
            </span>
            {edited.map((id) => (
              <Badge key={id} variant="warn" title="Action modifiée par la révision">
                {id}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
