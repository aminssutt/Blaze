// Ticket #45 — synthèse de situation. Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #45 owns this file from now on.
// Real slice: `snapshot` (situation.snapshot.ready), with its per-field
// provenance — product invariant #2.

"use client";

import { useIncidentState } from "@/lib/session";
import { Chip, Panel, SourceBadge } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

export default function SituationSnapshotPanel({ className }: PanelComponentProps) {
  const { snapshot } = useIncidentState();

  return (
    <Panel
      className={className}
      id="situation-snapshot"
      title="Situation summary"
      subtitle={snapshot ? `version ${snapshot.version}` : undefined}
      right={
        snapshot ? (
          <Chip
            label="conflits"
            value={snapshot.conflicts.length}
            tone={snapshot.conflicts.length > 0 ? "alert" : "ok"}
          />
        ) : null
      }
      empty={!snapshot}
      emptyLabel="aucune synthèse…"
      emptyHint="résumé de situation rédigé par le système — après analyse des messages"
    >
      {snapshot && (
        <div className="flex flex-col gap-2 text-[11px] leading-snug">
          <section>
            <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-ok">
              faits établis ({snapshot.known_facts.length})
            </div>
            <ul className="list-inside list-disc text-foreground">
              {snapshot.known_facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>

          <section>
            <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-warn">
              incertitudes ({snapshot.uncertain_facts.length})
            </div>
            <ul className="list-inside list-disc text-muted">
              {snapshot.uncertain_facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>

          {snapshot.conflicts.length > 0 && (
            <section>
              <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-alert">
                conflits ({snapshot.conflicts.length})
              </div>
              <ul className="list-inside list-disc text-alert">
                {snapshot.conflicts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-[10px] text-faint">provenance</span>
            {snapshot.provenance.map((p) => (
              <SourceBadge
                key={p.field}
                source={p.source_type}
                sourceName={`${p.field} · ${p.source_name}`}
              />
            ))}
          </section>
        </div>
      )}
    </Panel>
  );
}
