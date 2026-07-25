// Ticket #45 — situation summary. Owner: @six-16.
//
// The compact synthesis the chief reads to know what the system UNDERSTANDS:
// weather and terrain, hotspots, road states, established facts against
// uncertain ones, contradictions, gaps, and where every datum came from.
//
// Three things this view refuses to do (product invariants #2/#4):
//   - it never renders a value the snapshot did not carry (no zeros standing
//     in for unknowns),
//   - contradictions and gaps are styled DIFFERENTLY from each other, because
//     "two sources disagree" and "nobody has told us yet" are different
//     problems for a commander,
//   - cached data always shows its age, so nothing stale passes as current.

"use client";

import { useIncidentState } from "@/lib/session";
import { Badge, Chip, Panel, SourceBadge } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";
import {
  buildProvenanceRows,
  environmentReadings,
  formatAge,
  hotspotSummary,
  roadStates,
  roadTone,
  type ProvenanceRow,
  type Reading,
} from "./snapshotModel";

/* -------------------------------------------------------------------------- */
/* Building blocks                                                            */
/* -------------------------------------------------------------------------- */

const READING_TONE: Record<Reading["tone"], string> = {
  neutral: "text-foreground",
  warn: "text-warn",
  alert: "text-alert",
};

/** Section heading with a count, consistent across the five blocks. */
function Heading({
  label,
  count,
  tone,
}: {
  label: string;
  count?: number;
  tone: string;
}) {
  return (
    <div className={`mb-1 font-mono text-[10px] uppercase tracking-wider ${tone}`}>
      {label}
      {count !== undefined ? ` (${count})` : ""}
    </div>
  );
}

/** Provenance line: field, source badge, and age when the datum is cached. */
function ProvenanceLine({ row }: { row: ProvenanceRow }) {
  // Prefer the staleness the tool layer measured; fall back to the age implied
  // by the snapshot itself. Never invent one.
  const seconds = row.reportedStalenessSeconds ?? row.ageSeconds;
  const age = formatAge(seconds);
  const stale = seconds !== null && seconds >= 600;

  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="font-mono text-[10px] text-muted">{row.field}</span>
      <SourceBadge
        source={row.sourceType}
        sourceName={row.sourceName}
        cached={row.isCached}
      />
      {age && (
        <span
          className={`font-mono text-[10px] ${stale ? "text-warn" : "text-faint"}`}
          title={
            row.retrievedAt
              ? `retrieved ${row.retrievedAt} — age at snapshot time`
              : "age at snapshot time"
          }
        >
          {age}
          {stale ? " old" : ""}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

export default function SituationSnapshotPanel({ className }: PanelComponentProps) {
  const { snapshot, toolCalls } = useIncidentState();

  if (!snapshot) {
    return (
      <Panel
        className={className}
        id="situation-snapshot"
        title="Situation summary"
        empty
        emptyLabel="no summary yet…"
        emptyHint="written by the system once the radio messages have been analysed"
      />
    );
  }

  const readings = environmentReadings(snapshot);
  const roads = roadStates(snapshot);
  const hotspots = hotspotSummary(snapshot);
  const provenance = buildProvenanceRows(snapshot, toolCalls);

  const conflicts = snapshot.conflicts;
  const missing = snapshot.missing_information;

  return (
    <Panel
      className={className}
      id="situation-snapshot"
      title="Situation summary"
      subtitle={`version ${snapshot.version} · ${snapshot.radio_events.length} radio events`}
      live={conflicts.length > 0}
      tone={conflicts.length > 0 ? "alert" : "default"}
      right={
        <>
          <Chip
            label="conflicts"
            value={conflicts.length}
            tone={conflicts.length > 0 ? "alert" : "ok"}
            title="Sources that contradict each other"
          />
          <Chip
            label="gaps"
            value={missing.length}
            tone={missing.length > 0 ? "warn" : "ok"}
            title="Information identified as missing"
          />
        </>
      }
    >
      <div className="flex flex-col gap-2.5 text-[11px] leading-snug">
        {/* Environment — what the terrain and the sky are doing */}
        {(readings.length > 0 || hotspots.count > 0) && (
          <section>
            <Heading label="environment" tone="text-info" />
            <div className="flex flex-wrap gap-1">
              {readings.map((reading) => (
                <span
                  key={reading.label}
                  title={reading.hint}
                  className="inline-flex items-baseline gap-1 whitespace-nowrap rounded-sm border border-edge bg-overlay px-1.5 py-px font-mono text-[10px] leading-4"
                >
                  <span className="text-faint">{reading.label}</span>
                  <span className={READING_TONE[reading.tone]}>{reading.value}</span>
                  {reading.hint && (
                    <span className="text-faint/70">{reading.hint}</span>
                  )}
                </span>
              ))}
              {hotspots.count > 0 && (
                <Chip
                  label="hotspots"
                  value={
                    hotspots.maxFrpMw !== null
                      ? `${hotspots.count} · ${hotspots.maxFrpMw} MW`
                      : hotspots.count
                  }
                  tone="alert"
                  title={
                    hotspots.confidences.length > 0
                      ? `confidence: ${hotspots.confidences.join(", ")}`
                      : undefined
                  }
                />
              )}
            </div>
          </section>
        )}

        {/* Roads — the constraint that decides every route */}
        {roads.length > 0 && (
          <section>
            <Heading label="roads" count={roads.length} tone="text-info" />
            <div className="flex flex-col gap-0.5">
              {roads.map((road) => {
                const tone = roadTone(road);
                return (
                  <div key={road.roadId} className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-foreground">
                      {road.roadId}
                    </span>
                    <Badge variant={tone} filled={tone === "alert"} title={road.note ?? undefined}>
                      {road.status}
                    </Badge>
                    {road.restrictedTo.length > 0 && (
                      <span className="font-mono text-[10px] text-warn">
                        no {road.restrictedTo.join(", ")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Established facts */}
        {snapshot.known_facts.length > 0 && (
          <section>
            <Heading label="established" count={snapshot.known_facts.length} tone="text-ok" />
            <ul className="list-inside list-disc text-foreground">
              {snapshot.known_facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Uncertain facts */}
        {snapshot.uncertain_facts.length > 0 && (
          <section>
            <Heading label="uncertain" count={snapshot.uncertain_facts.length} tone="text-warn" />
            <ul className="list-inside list-disc text-muted">
              {snapshot.uncertain_facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Conflicts — SOLID alert border: two sources disagree, decide now */}
        {conflicts.length > 0 && (
          <section className="rounded-sm border border-alert/60 bg-alert-dim/20 p-1.5">
            <Heading label="contradictions" count={conflicts.length} tone="text-alert" />
            <ul className="flex flex-col gap-0.5">
              {conflicts.map((conflict) => (
                <li key={conflict} className="flex gap-1.5 text-alert">
                  <span aria-hidden className="shrink-0">
                    ⚠
                  </span>
                  <span>{conflict}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Missing info — DASHED warn border: nobody has reported this yet.
            Deliberately a different shape from contradictions above. */}
        {missing.length > 0 && (
          <section className="rounded-sm border border-dashed border-warn/60 bg-warn/5 p-1.5">
            <Heading label="missing information" count={missing.length} tone="text-warn" />
            <ul className="flex flex-col gap-0.5">
              {missing.map((item) => (
                <li key={item} className="flex gap-1.5 text-warn">
                  <span aria-hidden className="shrink-0 font-mono">
                    ?
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Provenance + staleness, one line per snapshot field */}
        {provenance.length > 0 && (
          <section>
            <Heading label="provenance" tone="text-faint" />
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {provenance.map((row) => (
                <ProvenanceLine key={row.field} row={row} />
              ))}
            </div>
          </section>
        )}

        <div className="font-mono text-[10px] text-faint/70">
          generated {snapshot.generated_at}
        </div>
      </div>
    </Panel>
  );
}
