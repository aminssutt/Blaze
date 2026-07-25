// Ticket #49 — diffusion aux unités. Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #49 owns this file from now on.
// PRODUCT INVARIANT #1 — this panel stays INERT until `dispatchUnlocked`.
// Real slices: `dispatches` and `ttsByDispatchId` (per-dispatch TTS state).

"use client";

import { useIncidentState } from "@/lib/session";
import {
  Badge,
  Panel,
  dispatchStatusLabel,
  dispatchStatusVariant,
} from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

export default function DispatchPanel({ className }: PanelComponentProps) {
  const { dispatches, dispatchesSent, dispatchUnlocked, ttsByDispatchId } =
    useIncidentState();

  // Invariant #1: nothing operational is shown before human approval.
  if (!dispatchUnlocked) {
    return (
      <Panel
        className={className}
        id="dispatch-panel"
        title="Diffusion aux unités"
        right={
          <Badge variant="alert" filled title="Invariant produit #1">
            verrouillé
          </Badge>
        }
        empty
        emptyLabel="diffusion verrouillée"
        emptyHint="en attente de la validation du commandant"
      />
    );
  }

  return (
    <Panel
      className={className}
      id="dispatch-panel"
      title="Diffusion aux unités"
      subtitle={`${dispatchesSent}/${dispatches.length} transmis`}
      right={
        <Badge variant="ok" filled>
          déverrouillé
        </Badge>
      }
      empty={dispatches.length === 0}
      emptyLabel="aucun message généré…"
      emptyHint="alimenté par dispatch.instruction.ready"
    >
      <ul className="flex flex-col gap-1.5">
        {dispatches.map((dispatch) => {
          const tts = ttsByDispatchId[dispatch.dispatch_id];
          return (
            <li
              key={dispatch.dispatch_id}
              className="rounded-sm border border-edge bg-overlay p-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-accent">
                  {dispatch.unit_id}
                </span>
                <Badge variant={dispatchStatusVariant(dispatch.dispatch_status)}>
                  {dispatchStatusLabel(dispatch.dispatch_status)}
                </Badge>
                {tts && (
                  <Badge
                    variant={tts.status === "ready" ? "ok" : "warn"}
                    title={tts.engine ?? undefined}
                  >
                    tts {tts.status === "ready" ? "prêt" : "en cours"}
                    {tts.latency_ms !== null ? ` · ${tts.latency_ms} ms` : ""}
                  </Badge>
                )}
                {dispatch.acknowledgement_required && (
                  <Badge variant="info">accusé requis</Badge>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-foreground">
                « {dispatch.message_text} »
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
