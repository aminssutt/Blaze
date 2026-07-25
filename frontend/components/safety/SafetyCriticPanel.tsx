// Ticket #47 — critique sécurité. Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #47 owns this file from now on.
// Real slice: `safetyReviews` — EVERY review is kept, so the on-stage
// "revise" objection stays visible after the v2 "pass".

"use client";

import { useIncidentState } from "@/lib/session";
import {
  Badge,
  Panel,
  StatusDot,
  safetyLabel,
  safetyVariant,
} from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

export default function SafetyCriticPanel({ className }: PanelComponentProps) {
  const { safetyReviews, safetyReview } = useIncidentState();

  return (
    <Panel
      className={className}
      id="safety-critic"
      title="Critique sécurité"
      subtitle={
        safetyReviews.length > 0
          ? `${safetyReviews.length} revue(s) · dernière : ${safetyReview?.plan_id}`
          : undefined
      }
      right={
        safetyReview ? (
          <Badge variant={safetyVariant(safetyReview.status)} filled>
            {safetyLabel(safetyReview.status)}
          </Badge>
        ) : null
      }
      tone={safetyReview?.status === "revise" ? "alert" : "default"}
      empty={safetyReviews.length === 0}
      emptyLabel="aucune revue…"
      emptyHint="alimenté par safety_review.ready"
    >
      <div className="flex flex-col gap-2">
        {safetyReviews.map((review) => (
          <article
            key={review.review_id}
            className="rounded-sm border border-edge bg-overlay p-2"
          >
            <div className="flex items-center gap-1.5">
              <Badge variant={safetyVariant(review.status)} filled>
                {safetyLabel(review.status)}
              </Badge>
              <span className="font-mono text-[10px] text-faint">
                {review.review_id} · {review.plan_id}
              </span>
            </div>

            {review.critical_objections.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-[11px] leading-snug text-alert">
                {review.critical_objections.map((objection) => (
                  <li key={objection}>{objection}</li>
                ))}
              </ul>
            )}

            {review.required_changes.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-[11px] leading-snug text-warn">
                {review.required_changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            )}

            <div className="mt-1.5 flex flex-wrap gap-1">
              {review.rule_checks.map((check) => (
                <StatusDot
                  key={check.rule_id}
                  tone={check.passed ? "ok" : "alert"}
                  label={check.rule_id}
                  title={check.detail}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}
