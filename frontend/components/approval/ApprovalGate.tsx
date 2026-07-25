// Ticket #48 — validation commandant. Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #48 owns this file from now on.
// PRODUCT INVARIANT #1 — `dispatchUnlocked` is the single derived gate: it is
// true ONLY after an approval.received event carrying decision === "approve".
// The interactive approve/modify/reject flow belongs to ticket #48.

"use client";

import { useIncidentState } from "@/lib/session";
import { Badge, Panel, StatusDot } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

export default function ApprovalGate({ className }: PanelComponentProps) {
  const { approvalRequested, approval, dispatchUnlocked, plan } =
    useIncidentState();

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
        {approvalRequested && !approval && (
          <div className="flex items-center gap-2 rounded-sm border border-accent-dim bg-accent-dim/20 p-2">
            <StatusDot tone="warn" pulse />
            <span className="text-[11px] text-accent">
              décision du commandant attendue
            </span>
          </div>
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
          </div>
        )}
      </div>
    </Panel>
  );
}
