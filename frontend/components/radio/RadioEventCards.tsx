// Ticket #43 — événements structurés (cartes RadioEvent). Owner: @six-16.
//
// One card per `radio_event.extracted` payload: facts, urgency, confirmation
// status (reported / inferred / confirmed rendered distinctly), confidence
// meter, evidence_text as a verbatim citation, human_report source badge.
//
// PRODUCT INVARIANT #3 — a corrected event is NEVER removed: the correcting
// card carries a "correction" badge plus an in-panel anchor link to the
// original, and the original gains a "corrigé par …" marker (mock: re-005
// corrects re-002). Both stay in the log.

"use client";

import type { RadioEvent } from "@/lib/contracts";
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

/** DOM anchor of one card, used by the correction cross-links. */
function cardAnchor(eventId: string): string {
  return `re-card-${eventId}`;
}

/** French label of the RadioEvent category. */
const EVENT_TYPE_LABEL: Record<RadioEvent["event_type"], string> = {
  hazard_report: "danger",
  resource_update: "ressources",
  road_status: "état route",
  wind_update: "vent",
  correction: "correction",
  confirmation: "confirmation",
  position_update: "position",
  other: "autre",
};

export default function RadioEventCards({ className }: PanelComponentProps) {
  const { radioEvents } = useIncidentState();
  const corrections = radioEvents.filter((e) => e.is_correction).length;

  // event_id -> the event that corrects it (audit link on the ORIGINAL card).
  const correctedBy = new Map<string, RadioEvent>();
  for (const e of radioEvents) {
    if (e.is_correction && e.corrects_event_id) {
      correctedBy.set(e.corrects_event_id, e);
    }
  }
  // event_id -> event, to summarise the corrected event on the CORRECTING card.
  const byId = new Map(radioEvents.map((e) => [e.event_id, e]));

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
      emptyHint="faits structurés tirés de chaque message radio — après transcription"
    >
      <ul className="flex flex-col gap-1.5">
        {radioEvents.map((event) => {
          const corrector = correctedBy.get(event.event_id);
          const corrected = event.corrects_event_id
            ? byId.get(event.corrects_event_id)
            : undefined;
          const border = event.is_correction
            ? "border-warn/60"
            : event.confirmation_status === "confirmed"
              ? "border-ok/50"
              : "border-edge";
          return (
            <li
              key={event.event_id}
              id={cardAnchor(event.event_id)}
              className={`scroll-mt-2 rounded-sm border bg-overlay p-2 target:ring-1 target:ring-warn ${border}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-accent">
                  {event.unit_id ?? "unité inconnue"}
                </span>
                <Badge
                  variant={event.is_correction ? "warn" : "info"}
                  filled={event.is_correction}
                  title={event.event_type}
                >
                  {EVENT_TYPE_LABEL[event.event_type] ?? event.event_type}
                </Badge>
                {event.location_reference && (
                  <Badge variant="neutral" title="location_reference">
                    {event.location_reference}
                  </Badge>
                )}
                <Badge variant={urgencyVariant(event.urgency)} filled>
                  {urgencyLabel(event.urgency)}
                </Badge>
                <Badge
                  variant={confirmationVariant(event.confirmation_status)}
                  filled={event.confirmation_status === "confirmed"}
                  title={`confirmation_status : ${event.confirmation_status}`}
                >
                  {confirmationLabel(event.confirmation_status)}
                </Badge>
                <SourceBadge
                  source={event.source_type}
                  sourceName={event.audio_id}
                  className="ml-auto"
                />
              </div>

              {/* correcting card → audit link to the ORIGINAL (kept in the log) */}
              {event.is_correction && event.corrects_event_id && (
                <a
                  href={`#${cardAnchor(event.corrects_event_id)}`}
                  className="mt-1 block rounded-sm border border-warn/40 bg-warn/10 px-1.5 py-1 text-[10px] leading-snug text-warn hover:border-warn/70"
                  title="l'événement d'origine reste au journal — cliquer pour le voir"
                >
                  <span className="font-mono">
                    ↩ corrige {event.corrects_event_id}
                  </span>
                  {corrected && (
                    <span className="text-warn/80">
                      {" — "}
                      {EVENT_TYPE_LABEL[corrected.event_type] ??
                        corrected.event_type}
                      {" : "}
                      {corrected.facts[0] ?? corrected.evidence_text}
                    </span>
                  )}
                </a>
              )}

              {/* corrected card → marker pointing to its correction */}
              {corrector && (
                <a
                  href={`#${cardAnchor(corrector.event_id)}`}
                  className="mt-1 block font-mono text-[10px] text-warn hover:underline"
                  title="événement conservé au journal — corrigé par un message ultérieur"
                >
                  ⚠ corrigé par {corrector.event_id} (voir la correction)
                </a>
              )}

              <ul
                className={`mt-1 list-inside list-disc text-[11px] leading-snug ${
                  corrector ? "text-muted" : "text-foreground"
                }`}
              >
                {event.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>

              {/* verbatim transcript span backing the extraction */}
              <blockquote className="mt-1 border-l-2 border-src-human/60 pl-2 text-[10px] italic leading-snug text-muted">
                « {event.evidence_text} »
              </blockquote>

              {event.uncertainties && event.uncertainties.length > 0 && (
                <div className="mt-1 text-[10px] leading-snug text-faint">
                  incertitudes : {event.uncertainties.join(" · ")}
                </div>
              )}

              <Meter
                className="mt-1.5"
                label="confiance"
                value={event.confidence}
                max={1}
                tone={event.confidence >= 0.9 ? "ok" : "warn"}
                valueLabel={event.confidence.toFixed(2)}
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
