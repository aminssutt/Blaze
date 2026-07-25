// Ticket #47 — critique sécurité. Owner: @six-16.
//
// The on-stage moment: the Safety Critic Agent challenging the planner.
// Reads `safetyReviews` (EVERY review is kept, so the v1 "revise" objection
// stays visible after the v2 "pass") + `agentRuns` for the in-progress state.
//
//   - HERO STATUS: one big colour pastille (pass green / revise yellow /
//     block red / analysing blue) that the audience can read from the back
//     of the room. It pulses while revising and flashes on every status
//     transition (WAAPI, no shared CSS touched).
//   - Latest review in full: critical objections, required changes,
//     required confirmations, and the explicit safety-rule checklist with
//     pass / warning / fail icons.
//   - Review history below, newest first — the v1 revise stays on screen.
//   - Each review is an evidence anchor (`data-evidence-id=<review_id>`) so
//     plan-v2's `sr-001` evidence link scrolls here.

"use client";

import { useEffect, useRef } from "react";
import { useIncidentState } from "@/lib/session";
import type { RuleCheck, SafetyReview } from "@/lib/contracts";
import { Badge, Panel, safetyLabel, safetyVariant } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";
import EvidenceLink from "@/components/plan/EvidenceLink";

/* -------------------------------------------------------------------------- */
/* Hero status pastille                                                       */
/* -------------------------------------------------------------------------- */

type HeroState = "waiting" | "reviewing" | "pass" | "revise" | "block";

const HERO: Record<
  HeroState,
  { dot: string; text: string; label: string; sub: string; pulse: boolean }
> = {
  waiting: {
    dot: "bg-faint/30 border-edge-strong",
    text: "text-faint",
    label: "en attente",
    sub: "aucune revue reçue",
    pulse: false,
  },
  reviewing: {
    dot: "bg-info/20 border-info",
    text: "text-info",
    label: "analyse…",
    sub: "le Safety Critic challenge le plan",
    pulse: true,
  },
  pass: {
    dot: "bg-ok-dim border-ok",
    text: "text-ok",
    label: "validé",
    sub: "aucune objection bloquante",
    pulse: false,
  },
  revise: {
    dot: "bg-warn/20 border-warn",
    text: "text-warn",
    label: "à réviser",
    sub: "plan renvoyé au planificateur",
    pulse: true,
  },
  block: {
    dot: "bg-alert-dim border-alert",
    text: "text-alert",
    label: "bloqué",
    sub: "plan rejeté par la sécurité",
    pulse: true,
  },
};

function HeroStatus({ state, planId }: { state: HeroState; planId: string | null }) {
  const hero = HERO[state];
  const ref = useRef<HTMLDivElement>(null);

  // Flash the whole hero on every state transition so the audience catches
  // the pass → revise → pass beats even without watching this panel.
  useEffect(() => {
    if (state === "waiting") return;
    ref.current?.animate(
      [
        { transform: "scale(1)", filter: "brightness(1)" },
        { transform: "scale(1.04)", filter: "brightness(1.6)", offset: 0.25 },
        { transform: "scale(1)", filter: "brightness(1)" },
      ],
      { duration: 700, easing: "ease-out" },
    );
  }, [state]);

  return (
    <div
      ref={ref}
      data-testid="safety-hero"
      data-state={state}
      className={`flex items-center gap-3 rounded-md border bg-overlay px-3 py-2 ${
        state === "revise"
          ? "border-warn/60"
          : state === "block"
            ? "border-alert/70"
            : state === "pass"
              ? "border-ok/50"
              : "border-edge"
      }`}
    >
      <span
        aria-hidden
        className={`size-9 shrink-0 rounded-full border-2 ${hero.dot} ${
          hero.pulse ? "animate-pulse" : ""
        }`}
      />
      <div className="min-w-0">
        <div
          className={`text-[16px] font-bold uppercase tracking-[0.12em] leading-tight ${hero.text}`}
        >
          {hero.label}
        </div>
        <div className="truncate font-mono text-[10px] text-muted">
          {hero.sub}
          {planId ? ` · ${planId}` : ""}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rule checklist                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Explicit checklist row. The contract only carries `passed`; a failed check
 * inside a "revise" review renders as a warning (fixable), inside a "block"
 * review as a hard fail.
 */
function RuleCheckRow({
  check,
  reviewStatus,
}: {
  check: RuleCheck;
  reviewStatus: SafetyReview["status"];
}) {
  const state = check.passed
    ? { icon: "✓", cls: "text-ok border-ok/40", label: "conforme" }
    : reviewStatus === "block"
      ? { icon: "✕", cls: "text-alert border-alert/50", label: "échec" }
      : { icon: "!", cls: "text-warn border-warn/50", label: "avertissement" };
  return (
    <li className="flex items-start gap-1.5">
      <span
        aria-hidden
        className={`mt-px inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] font-bold leading-none ${state.cls}`}
      >
        {state.icon}
      </span>
      <span className="min-w-0">
        <span className={`font-mono text-[10px] ${state.cls.split(" ")[0]}`}>
          {check.rule_id}
        </span>
        <span className="sr-only"> — {state.label}</span>
        {check.detail && (
          <span className="block text-[10px] leading-snug text-muted">
            {check.detail}
          </span>
        )}
      </span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* One review article                                                         */
/* -------------------------------------------------------------------------- */

function ReviewArticle({
  review,
  isLatest,
}: {
  review: SafetyReview;
  isLatest: boolean;
}) {
  return (
    <article
      data-evidence-id={review.review_id}
      className={`rounded-sm border bg-overlay p-2 ${
        isLatest
          ? review.status === "revise"
            ? "border-warn/50"
            : review.status === "block"
              ? "border-alert/60"
              : "border-ok/40"
          : "border-edge opacity-80"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={safetyVariant(review.status)} filled>
          {safetyLabel(review.status)}
        </Badge>
        <span className="font-mono text-[10px] text-faint">
          {review.review_id} · plan <EvidenceLink id={review.plan_id} />
        </span>
        {!isLatest && (
          <Badge variant="neutral" title="revue précédente conservée à l'écran">
            historique
          </Badge>
        )}
      </div>

      {review.critical_objections.length > 0 && (
        <div className="mt-1.5">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-alert">
            objections critiques
          </h3>
          <ul className="mt-0.5 flex flex-col gap-0.5 text-[11px] leading-snug text-alert">
            {review.critical_objections.map((objection) => (
              <li key={objection} className="flex gap-1.5">
                <span aria-hidden className="shrink-0">⨯</span>
                <span>{objection}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.required_changes.length > 0 && (
        <div className="mt-1.5">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-warn">
            changements requis
          </h3>
          <ul className="mt-0.5 flex flex-col gap-0.5 text-[11px] leading-snug text-warn">
            {review.required_changes.map((change) => (
              <li key={change} className="flex gap-1.5">
                <span aria-hidden className="shrink-0">→</span>
                <span>{change}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(review.required_confirmations?.length ?? 0) > 0 && (
        <div className="mt-1.5">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-info">
            confirmations terrain requises
          </h3>
          <ul className="mt-0.5 flex flex-col gap-0.5 text-[11px] leading-snug text-info">
            {review.required_confirmations!.map((confirmation) => (
              <li key={confirmation} className="flex gap-1.5">
                <span aria-hidden className="shrink-0">?</span>
                <span>{confirmation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-1.5">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-faint">
          règles de sécurité vérifiées
        </h3>
        <ul className="mt-0.5 flex flex-col gap-1">
          {review.rule_checks.map((check) => (
            <RuleCheckRow
              key={check.rule_id}
              check={check}
              reviewStatus={review.status}
            />
          ))}
        </ul>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

export default function SafetyCriticPanel({ className }: PanelComponentProps) {
  const { safetyReviews, safetyReview, agentRuns } = useIncidentState();

  const reviewing = agentRuns.some(
    (r) => r.started_by === "safety_review.started" && !r.finished,
  );
  const heroState: HeroState = reviewing
    ? "reviewing"
    : safetyReview
      ? safetyReview.status
      : "waiting";

  const newestFirst = [...safetyReviews].reverse();
  const failedCount = safetyReview
    ? safetyReview.rule_checks.filter((c) => !c.passed).length
    : 0;

  return (
    <Panel
      className={className}
      id="safety-critic"
      title="Safety critic"
      live={reviewing}
      subtitle={
        safetyReviews.length > 0
          ? `${safetyReviews.length} revue(s) · ${failedCount} règle(s) en échec sur la dernière`
          : reviewing
            ? "revue en cours…"
            : undefined
      }
      right={
        safetyReview ? (
          <Badge variant={safetyVariant(safetyReview.status)} filled>
            {safetyLabel(safetyReview.status)}
          </Badge>
        ) : null
      }
      tone={
        heroState === "revise" || heroState === "block"
          ? "alert"
          : heroState === "pass"
            ? "ok"
            : "default"
      }
      empty={safetyReviews.length === 0 && !reviewing}
      emptyLabel="no review yet…"
      emptyHint="safety check of the proposed plan — before approval is requested"
    >
      <div className="flex flex-col gap-2">
        <HeroStatus
          state={heroState}
          planId={reviewing ? null : (safetyReview?.plan_id ?? null)}
        />
        {newestFirst.map((review, index) => (
          <ReviewArticle
            key={review.review_id}
            review={review}
            isLatest={index === 0 && !reviewing}
          />
        ))}
      </div>
    </Panel>
  );
}
