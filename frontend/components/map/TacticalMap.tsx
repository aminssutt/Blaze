// Ticket #40 — carte tactique. Owner: @six-16.
//
// STUB laid down by ticket #38. Tickets #40 (map) and #41 (overlays) own this
// file from now on. It already reads its real slices: the incident geographic
// frame from `incident.started` and the entities of the situation snapshot.

"use client";

import { useIncidentState } from "@/lib/session";
import { Chip, Panel, SourceBadge } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

export default function TacticalMap({ className }: PanelComponentProps) {
  const state = useIncidentState();
  const { incidentLocation, boundingBox, snapshot } = state;

  const ready = incidentLocation !== null || snapshot !== null;

  return (
    <Panel
      className={className}
      id="tactical-map"
      title="Carte tactique"
      subtitle={
        incidentLocation
          ? `${incidentLocation.label ?? "zone"} · ${incidentLocation.lat.toFixed(4)}, ${incidentLocation.lon.toFixed(4)}`
          : undefined
      }
      right={
        snapshot ? (
          <Chip label="snapshot" value={`v${snapshot.version}`} tone="info" />
        ) : null
      }
      live={ready}
      empty={!ready}
      emptyLabel="carte en attente…"
      emptyHint="cadrage fourni par incident.started"
    >
      <div className="flex flex-col gap-2">
        {boundingBox && (
          <div className="rounded-sm border border-edge bg-overlay p-2 font-mono text-[10px] text-muted">
            <div className="mb-1 uppercase tracking-wider text-faint">
              emprise
            </div>
            <div>
              lat {boundingBox.min_lat} → {boundingBox.max_lat}
            </div>
            <div>
              lon {boundingBox.min_lon} → {boundingBox.max_lon}
            </div>
          </div>
        )}

        {snapshot && (
          <div className="flex flex-wrap gap-1.5">
            <Chip label="unités" value={snapshot.units?.length ?? 0} />
            <Chip label="routes" value={snapshot.roads?.length ?? 0} />
            <Chip
              label="foyers"
              value={snapshot.fire_hotspots?.length ?? 0}
              tone={(snapshot.fire_hotspots?.length ?? 0) > 0 ? "alert" : "neutral"}
            />
            <Chip label="bâtiments" value={snapshot.buildings_and_parcels?.length ?? 0} />
            <Chip
              label="enjeux"
              value={snapshot.critical_assets?.length ?? 0}
              tone="warn"
            />
          </div>
        )}

        {snapshot && snapshot.provenance.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-[10px] text-faint">provenance</span>
            {snapshot.provenance.map((p) => (
              <SourceBadge
                key={p.field}
                source={p.source_type}
                sourceName={`${p.field} · ${p.source_name}`}
              />
            ))}
          </div>
        )}

        <p className="font-mono text-[10px] text-faint/70">
          rendu cartographique — ticket #40 / calques — ticket #41
        </p>
      </div>
    </Panel>
  );
}
