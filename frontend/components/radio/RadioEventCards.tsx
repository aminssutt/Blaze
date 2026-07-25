// Ticket #43 — événements structurés (cartes RadioEvent). Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #43 owns this file from now on.
// PRODUCT INVARIANT #3 — a corrected event stays visible with an audit link;
// this stub already renders corrections instead of replacing the originals.

"use client";

import { useIncidentState } from "@/lib/session";
import {
  Badge,
  Meter,
  Panel,
  SourceBadge,
  confirmationLabel,
  confirmationVariant,
  urgencyLabel,
  urgencyVariant,
} from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

export default function RadioEventCards({ className }: PanelComponentProps) {
  const { radioEvents } = useIncidentState();
  const corrections = radioEvents.filter((e) => e.is_correction).length;

  return (
    <Panel
      className={className}
      id="radio-event-cards"
      title="Événements structurés"
      subtitle={
        radioEvents.length > 0
          ? `${radioEvents.length} événements · ${corrections} correction(s)`
          : undefined
      }
      empty={radioEvents.length === 0}
      emptyLabel="aucun événement extrait…"
      emptyHint="alimenté par radio_event.extracted"
    >
      <ul className="flex flex-col gap-1.5">
        {radioEvents.map((event) => (
          <li
            key={event.event_id}
            className={`rounded-sm border bg-overlay p-2 ${
              event.is_correction ? "border-warn/60" : "border-edge"
            }`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] text-accent">
                {event.unit_id ?? "unité inconnue"}
              </span>
              <Badge variant="info" title={event.event_type}>
                {event.event_type}
              </Badge>
              <Badge variant={urgencyVariant(event.urgency)} filled>
                {urgencyLabel(event.urgency)}
              </Badge>
              <Badge variant={confirmationVariant(event.confirmation_status)}>
                {confirmationLabel(event.confirmation_status)}
              </Badge>
              <SourceBadge
                source={event.source_type}
                sourceName={event.audio_id}
                className="ml-auto"
              />
            </div>

            {event.is_correction && (
              <div className="mt-1 font-mono text-[10px] text-warn">
                corrige {event.corrects_event_id ?? "?"} — l&apos;événement
                d&apos;origine reste au journal
              </div>
            )}

            <ul className="mt-1 list-inside list-disc text-[11px] leading-snug text-foreground">
              {event.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>

            <Meter
              className="mt-1.5"
              label="confiance"
              value={event.confidence}
              max={1}
              tone={event.confidence >= 0.9 ? "ok" : "warn"}
              valueLabel={event.confidence.toFixed(2)}
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
