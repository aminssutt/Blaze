// Ticket #46 — plan tactique. Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #46 owns this file from now on.
// Real slices: `plans` (EVERY version), `plan` (latest) and
// `planRevisionRequests` (the audit link from a "revise" review to v2).

"use client";

import { useIncidentState } from "@/lib/session";
import {
  Badge,
  Meter,
  Panel,
  urgencyLabel,
  urgencyVariant,
} from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

export default function TacticalPlanPanel({ className }: PanelComponentProps) {
  const { plan, plans, planRevisionRequests } = useIncidentState();

  return (
    <Panel
      className={className}
      id="tactical-plan"
      title="Plan tactique"
      subtitle={plan ? plan.summary : undefined}
      right={
        <>
          {planRevisionRequests.length > 0 && (
            <Badge variant="warn" title="plan.revision.requested">
              {planRevisionRequests.length} révision(s)
            </Badge>
          )}
          {plans.map((p) => (
            <Badge
              key={p.plan_id}
              variant="accent"
              filled={p.plan_id === plan?.plan_id}
              title={p.plan_id}
            >
              v{p.version}
            </Badge>
          ))}
        </>
      }
      empty={!plan}
      emptyLabel="aucun plan…"
      emptyHint="alimenté par plan.draft.ready"
    >
      {plan && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-wrap gap-1">
            {plan.objectives.map((objective) => (
              <li
                key={objective}
                className="rounded-sm border border-edge bg-overlay px-1.5 py-px font-mono text-[10px] text-muted"
              >
                {objective}
              </li>
            ))}
          </ul>

          <ul className="flex flex-col gap-1.5">
            {plan.unit_actions.map((action) => (
              <li
                key={action.action_id}
                className="rounded-sm border border-edge bg-overlay p-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] text-accent">
                    {action.unit_id}
                  </span>
                  <Badge variant="info">{action.action_type}</Badge>
                  <Badge variant={urgencyVariant(action.priority)} filled>
                    {urgencyLabel(action.priority)}
                  </Badge>
                  {action.human_approval_required && (
                    <Badge variant="warn" title="human_approval_required">
                      validation requise
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-foreground">
                  {action.instruction}
                </p>
                <Meter
                  className="mt-1.5"
                  label="confiance"
                  value={action.confidence}
                  max={1}
                  tone={action.confidence >= 0.9 ? "ok" : "warn"}
                  valueLabel={action.confidence.toFixed(2)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
