// Ticket #46 — plan tactique. Owner: @six-16.
//
// Full tactical roadmap view over the `plans` / `plan` /
// `planRevisionRequests` slices of the incident store:
//   - version selector (v1 / v2…), auto-following the latest version unless
//     the operator pins an older one — with a "nouvelle version" badge when
//     a revision lands (the v1 → v2 demo moment);
//   - per-unit action cards: instruction, route, destination, reason,
//     colour-coded priority, clickable evidence links, confidence meter,
//     approval / acknowledgement flags;
//   - simple v(n-1) → v(n) diff: actions whose substance changed are marked
//     "modifié" with the previous instruction shown struck through;
//   - rejected options with reasons, assumptions, uncertainties;
//   - the `plan.revision.requested` audit link rendered as a banner.

"use client";

import { useState } from "react";
import { useIncidentState } from "@/lib/session";
import type { PlanRevisionRequest } from "@/lib/incidentStore";
import type { DraftTacticalPlan, UnitAction } from "@/lib/contracts";
import {
  Badge,
  Chip,
  Meter,
  Panel,
  urgencyLabel,
  urgencyVariant,
} from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";
import EvidenceLink from "./EvidenceLink";

/* -------------------------------------------------------------------------- */
/* v(n-1) → v(n) diff helpers (pure)                                          */
/* -------------------------------------------------------------------------- */

type ActionDiff =
  | { kind: "unchanged" }
  | { kind: "new-unit" }
  | { kind: "changed"; previous: UnitAction; changedFields: string[] };

/** Substance fields compared between two versions of a unit's action. */
const DIFF_FIELDS = [
  "action_type",
  "instruction",
  "route",
  "destination",
  "priority",
] as const;

/** Diffs one action of the displayed plan against the previous version. */
function diffAction(
  action: UnitAction,
  previousPlan: DraftTacticalPlan | null,
): ActionDiff {
  if (!previousPlan) return { kind: "unchanged" };
  const previous = previousPlan.unit_actions.find(
    (a) => a.unit_id === action.unit_id,
  );
  if (!previous) return { kind: "new-unit" };
  const changedFields = DIFF_FIELDS.filter(
    (f) => (action[f] ?? null) !== (previous[f] ?? null),
  );
  return changedFields.length > 0
    ? { kind: "changed", previous, changedFields }
    : { kind: "unchanged" };
}

/* -------------------------------------------------------------------------- */
/* Sub-blocks                                                                 */
/* -------------------------------------------------------------------------- */

function EvidenceRow({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="font-mono text-[10px] text-faint">preuves :</span>
      {ids.map((id) => (
        <EvidenceLink key={id} id={id} />
      ))}
    </div>
  );
}

function ActionCard({
  action,
  diff,
  previousVersion,
}: {
  action: UnitAction;
  diff: ActionDiff;
  previousVersion: number | null;
}) {
  return (
    <li
      data-evidence-id={action.action_id}
      className={`rounded-sm border bg-overlay p-2 ${
        diff.kind === "changed" ? "border-accent-dim" : "border-edge"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] font-semibold text-accent">
          {action.unit_id}
        </span>
        <Badge variant="info">{action.action_type}</Badge>
        <Badge variant={urgencyVariant(action.priority)} filled>
          {urgencyLabel(action.priority)}
        </Badge>
        {diff.kind === "changed" && (
          <Badge
            variant="accent"
            filled
            title={`champs modifiés vs v${previousVersion} : ${diff.changedFields.join(", ")}`}
          >
            modifié
          </Badge>
        )}
        {diff.kind === "new-unit" && (
          <Badge variant="accent" title="unité absente de la version précédente">
            nouveau
          </Badge>
        )}
        {action.human_approval_required && (
          <Badge variant="warn" title="human_approval_required">
            validation requise
          </Badge>
        )}
        {action.acknowledgement_required && (
          <Badge variant="neutral" title="acknowledgement_required">
            accusé requis
          </Badge>
        )}
      </div>

      {/* the diff moment: previous instruction struck through, new below */}
      {diff.kind === "changed" && (
        <p
          className="mt-1 text-[10px] leading-snug text-faint line-through"
          title={`instruction v${previousVersion}`}
        >
          v{previousVersion} · {diff.previous.instruction}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-snug text-foreground">
        {action.instruction}
      </p>
      <p className="mt-0.5 text-[10px] italic leading-snug text-muted">
        {action.reason}
      </p>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {action.route && <Chip label="itinéraire" value={action.route} tone="info" />}
        {action.destination && (
          <Chip label="destination" value={action.destination} tone="accent" />
        )}
      </div>

      <EvidenceRow ids={action.evidence_ids} />

      <Meter
        className="mt-1.5"
        label="confiance"
        value={action.confidence}
        max={1}
        tone={action.confidence >= 0.9 ? "ok" : action.confidence >= 0.8 ? "accent" : "warn"}
        valueLabel={action.confidence.toFixed(2)}
        title={`confiance planification : ${action.confidence}`}
      />
    </li>
  );
}

function ListSection({
  title,
  items,
  tone,
  marker,
}: {
  title: string;
  items: string[];
  tone: "muted" | "warn";
  marker: string;
}) {
  if (items.length === 0) return null;
  const text = tone === "warn" ? "text-warn" : "text-muted";
  return (
    <div>
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-faint">
        {title}
      </h3>
      <ul className={`mt-0.5 flex flex-col gap-0.5 text-[11px] leading-snug ${text}`}>
        {items.map((item) => (
          <li key={item} className="flex gap-1.5">
            <span aria-hidden className="shrink-0">
              {marker}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

export default function TacticalPlanPanel({ className }: PanelComponentProps) {
  const { plan, plans, planRevisionRequests, agentRuns } = useIncidentState();

  // null = follow the latest version (the demo default); a plan_id pins one.
  const [pinnedPlanId, setPinnedPlanId] = useState<string | null>(null);
  const displayed =
    (pinnedPlanId ? plans.find((p) => p.plan_id === pinnedPlanId) : null) ?? plan;
  const latest = plan;
  const displayedIsLatest = displayed?.plan_id === latest?.plan_id;

  const previousPlan = displayed
    ? [...plans]
        .reverse()
        .find((p) => p.version < displayed.version) ?? null
    : null;

  // Revision requested OF the displayed plan (v1 in the mock) — the audit
  // link between the safety "revise" and the next version.
  const revisionOfDisplayed: PlanRevisionRequest | undefined = displayed
    ? planRevisionRequests.find((r) => r.plan_id === displayed.plan_id)
    : undefined;
  // The displayed plan is itself the OUTCOME of a revision of the previous one.
  const revisionBehindDisplayed: PlanRevisionRequest | undefined = previousPlan
    ? planRevisionRequests.find((r) => r.plan_id === previousPlan.plan_id)
    : undefined;

  const planning = agentRuns.some(
    (r) => r.started_by === "planning.started" && !r.finished,
  );

  return (
    <Panel
      className={className}
      id="tactical-plan"
      title="Plan tactique"
      live={planning}
      subtitle={
        planning
          ? "planification en cours…"
          : displayed
            ? `${displayed.plan_id} · ${new Date(displayed.created_at).toLocaleTimeString("fr-FR")}`
            : undefined
      }
      tone={displayedIsLatest && plans.length > 1 ? "accent" : "default"}
      right={
        <>
          {plans.length > 1 && displayedIsLatest && (
            <Badge variant="accent" filled className="animate-pulse" title="plan révisé après la revue sécurité">
              nouvelle version
            </Badge>
          )}
          {plans.map((p) => {
            const active = p.plan_id === displayed?.plan_id;
            return (
              <button
                key={p.plan_id}
                type="button"
                title={`${p.plan_id} — afficher la version ${p.version}`}
                aria-pressed={active}
                onClick={() =>
                  setPinnedPlanId(p.plan_id === latest?.plan_id ? null : p.plan_id)
                }
                className={`cursor-pointer rounded-sm border px-1.5 py-px font-mono text-[10px] uppercase leading-4 tracking-wider transition-colors ${
                  active
                    ? "border-accent bg-accent-dim/50 text-accent"
                    : "border-edge-strong text-muted hover:border-accent-dim hover:text-accent"
                }`}
              >
                v{p.version}
              </button>
            );
          })}
        </>
      }
      empty={!displayed}
      emptyLabel="aucun plan…"
      emptyHint="plan d'action proposé par le système — après la synthèse de situation"
    >
      {displayed && (
        <div
          className="flex flex-col gap-2.5"
          data-evidence-id={displayed.plan_id}
        >
          {/* revision audit links (plan.revision.requested) */}
          {revisionOfDisplayed && (
            <div className="rounded-sm border border-warn/50 bg-warn/10 p-2 text-[11px] leading-snug text-warn">
              <span className="font-mono text-[10px] uppercase tracking-wider">
                révision demandée par {revisionOfDisplayed.requested_by}
              </span>
              <p className="mt-0.5">{revisionOfDisplayed.reason}</p>
              <div className="mt-1">
                <EvidenceLink id={revisionOfDisplayed.review_id} />
              </div>
            </div>
          )}
          {revisionBehindDisplayed && (
            <div className="rounded-sm border border-ok/40 bg-ok-dim/30 p-2 text-[11px] leading-snug text-ok">
              version issue de la révision demandée sur{" "}
              <span className="font-mono">{revisionBehindDisplayed.plan_id}</span>{" "}
              (revue <EvidenceLink id={revisionBehindDisplayed.review_id} />) —
              actions modifiées marquées ci-dessous.
            </div>
          )}

          {/* summary + objectives */}
          <p className="text-[12px] leading-snug text-foreground">
            {displayed.summary}
          </p>
          <ul className="flex flex-wrap gap-1">
            {displayed.objectives.map((objective) => (
              <li
                key={objective}
                className="rounded-sm border border-edge bg-overlay px-1.5 py-px font-mono text-[10px] text-muted"
              >
                {objective}
              </li>
            ))}
          </ul>

          {/* one card per unit action */}
          <ul className="flex flex-col gap-1.5">
            {displayed.unit_actions.map((action) => (
              <ActionCard
                key={action.action_id}
                action={action}
                diff={diffAction(action, previousPlan)}
                previousVersion={previousPlan?.version ?? null}
              />
            ))}
          </ul>

          {/* rejected alternatives, with reasons */}
          {(displayed.rejected_options?.length ?? 0) > 0 && (
            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-faint">
                options rejetées
              </h3>
              <ul className="mt-0.5 flex flex-col gap-1">
                {displayed.rejected_options!.map((option) => (
                  <li
                    key={option.option}
                    className="rounded-sm border border-edge bg-overlay p-1.5 text-[11px] leading-snug"
                  >
                    <span className="text-muted line-through">{option.option}</span>
                    <p className="mt-0.5 text-alert">↳ {option.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ListSection
            title="hypothèses"
            items={displayed.assumptions ?? []}
            tone="muted"
            marker="≈"
          />
          <ListSection
            title="incertitudes"
            items={displayed.uncertainties ?? []}
            tone="warn"
            marker="?"
          />

          <EvidenceRow ids={displayed.evidence_ids ?? []} />
        </div>
      )}
    </Panel>
  );
}
