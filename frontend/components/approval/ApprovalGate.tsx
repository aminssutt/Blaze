// Ticket #48 — validation commandant. Owner: @selyan-mhli.
//
// PRODUCT INVARIANT #1 — `dispatchUnlocked` is the single derived gate: it is
// true ONLY after an approval.received event carrying decision === "approve".
// This component never sets state itself — it drives the mock replay (phase
// jumps) and lets the reduced events flow back through the store. Ticket #54
// swaps the button handlers for POST /approval/decision calls; the rendering
// below is already API-shaped (ApprovalDecision contract).

"use client";

import { useState } from "react";
import {
  useIncidentState,
  usePlayerState,
  useSessionControls,
} from "@/lib/session";
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
  const [note, setNote] = useState("");
  /** Note typed in THIS session, frozen at decision time for the audit trail. */
  const [sessionNote, setSessionNote] = useState<string | null>(null);

  const decisionPending = approvalRequested && !approval;
  const hasJump = (id: string) => player.jumpPoints.some((p) => p.id === id);
  const decide = (target: string) => {
    setSessionNote(note.trim() || null);
    controls.jumpTo(target);
  };

  const edited = changedActionIds(plans[plans.length - 2], plans[plans.length - 1]);

  return (
    <Panel
      className={className}
      id="approval-gate"
      title="Validation commandant"
      subtitle={plan ? `plan ${plan.plan_id} · v${plan.version}` : undefined}
      right={
        <Badge
          variant={dispatchUnlocked ? "ok" : "alert"}
          filled
          title="Invariant produit #1 — la diffusion reste inerte sans validation humaine"
        >
          {dispatchUnlocked ? "diffusion déverrouillée" : "diffusion verrouillée"}
        </Badge>
      }
      live={approvalRequested}
      tone={approvalRequested ? "accent" : dispatchUnlocked ? "ok" : "default"}
      empty={!approvalRequested && !approval}
      emptyLabel="aucune validation demandée…"
      emptyHint="alimenté par approval.requested / approval.received"
    >
      <div className="flex flex-col gap-2">
        {decisionPending && (
          <>
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

            <div className="flex gap-1.5" role="group" aria-label="Décision">
              <button
                type="button"
                onClick={() => decide("dispatch")}
                disabled={!hasJump("dispatch")}
                className="flex-1 rounded-sm border border-ok/60 bg-ok/10 px-2 py-1.5 font-mono text-[11px] font-semibold text-ok hover:border-ok disabled:cursor-not-allowed disabled:opacity-40"
                title="Valide le plan et déclenche la phase de diffusion du replay"
              >
                ✓ Approuver
              </button>
              <button
                type="button"
                onClick={() => decide("plan-v2")}
                disabled={!hasJump("plan-v2")}
                className="flex-1 rounded-sm border border-warn/60 bg-warn/10 px-2 py-1.5 font-mono text-[11px] font-semibold text-warn hover:border-warn disabled:cursor-not-allowed disabled:opacity-40"
                title="Demande une révision : rejoue le scénario jusqu'à la version suivante du plan"
              >
                ✎ Modifier
              </button>
              <button
                type="button"
                disabled
                className="flex-1 cursor-not-allowed rounded-sm border border-edge px-2 py-1.5 font-mono text-[11px] font-semibold text-muted opacity-40"
                title="Pas de branche « rejet » dans le replay mock — activé avec l'API réelle (ticket #54)"
              >
                ✕ Rejeter
              </button>
            </div>
          </>
        )}

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
