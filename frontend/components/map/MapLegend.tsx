// Tickets #40/#41 — tactical map legend.
//
// ONE language: English, like the rest of the control room. Entries appear only
// when the thing they explain is actually on the map, so the legend never
// promises a layer the incident has not produced yet.

export interface MapLegendProps {
  buildingCount: number;
  hasFire: boolean;
  exclusionRadiusM: number | null;
  hasKeptRoute: boolean;
  hasDiscardedRoute: boolean;
  hasCorrectedRoad: boolean;
  hasTrail: boolean;
  hasWind: boolean;
  /** Conflicts carried by the situation snapshot, surfaced as a caveat. */
  windConflict: string | null;
}

function Swatch({ children }: { children: React.ReactNode }) {
  return <span className="flex shrink-0 items-center gap-1.5">{children}</span>;
}

export default function MapLegend({
  buildingCount,
  hasFire,
  exclusionRadiusM,
  hasKeptRoute,
  hasDiscardedRoute,
  hasCorrectedRoad,
  hasTrail,
  hasWind,
  windConflict,
}: MapLegendProps) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-0.5 font-mono text-[10.5px] leading-4 text-muted">
        {hasFire && (
          <Swatch>
            <span
              className="inline-block size-2.5 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, #ffe9b8 0%, var(--blaze-accent-strong) 55%, transparent 100%)",
              }}
            />
            fire hotspot
          </Swatch>
        )}
        {exclusionRadiusM !== null && (
          <Swatch>
            <span
              className="inline-block size-2.5 rounded-full border border-dashed"
              style={{ borderColor: "var(--blaze-alert)" }}
            />
            hazmat exclusion {exclusionRadiusM} m
          </Swatch>
        )}
        {hasWind && (
          <Swatch>
            <span
              className="inline-block h-px w-4"
              style={{
                background:
                  "repeating-linear-gradient(90deg, var(--blaze-info) 0 2px, transparent 2px 5px)",
              }}
            />
            <span aria-hidden style={{ color: "var(--blaze-info)" }}>
              ▶
            </span>
            arrow points downwind
          </Swatch>
        )}
        <Swatch>
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ background: "var(--blaze-accent)" }}
          />
          engine (CCF)
        </Swatch>
        <Swatch>
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ background: "var(--blaze-info)" }}
          />
          light vehicle
        </Swatch>
        <Swatch>
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ background: "var(--blaze-warn)" }}
          />
          vulnerable area
        </Swatch>
        <Swatch>
          <span
            className="inline-block size-2.5 rounded-sm border"
            style={{ borderColor: "var(--blaze-alert)" }}
          />
          industrial hazard
        </Swatch>
        {hasCorrectedRoad && (
          <Swatch>
            <span
              className="inline-block h-1 w-5 rounded-full"
              style={{
                background:
                  "repeating-linear-gradient(90deg, var(--blaze-alert) 0 3px, var(--blaze-warn) 3px 6px)",
              }}
            />
            blocked for CCF, light vehicles pass
          </Swatch>
        )}
        {hasKeptRoute && (
          <Swatch>
            <span
              className="inline-block h-1 w-5 rounded-full"
              style={{ background: "var(--blaze-ok)", opacity: 0.6 }}
            />
            route kept by the plan
          </Swatch>
        )}
        {hasDiscardedRoute && (
          <Swatch>
            <span
              className="inline-block h-px w-5"
              style={{
                background:
                  "repeating-linear-gradient(90deg, var(--blaze-alert) 0 1px, transparent 1px 4px)",
              }}
            />
            discarded by the plan
          </Swatch>
        )}
        {hasTrail && (
          <Swatch>
            <span
              className="inline-block h-px w-5"
              style={{
                background:
                  "repeating-linear-gradient(90deg, var(--blaze-text-muted) 0 3px, transparent 3px 6px)",
              }}
            />
            trail = moves reported over the radio
          </Swatch>
        )}
      </div>

      {/* The provenance caption. `break-words` + no truncation on purpose:
          this line is the honesty of the whole map (nominal heights, cached
          forecast) and must never be cut off mid-sentence. */}
      <p className="px-0.5 font-mono text-[10px] leading-[1.45] text-faint [overflow-wrap:anywhere]">
        {buildingCount > 0
          ? `${buildingCount.toLocaleString("en-GB")} cadastral footprints extruded at nominal heights — the Etalab cadastre carries a construction class, not a measured height. `
          : ""}
        Building tint is distance to the reported hotspot.
        {windConflict
          ? ` Wind shown is the cached forecast — ${windConflict}.`
          : ""}
      </p>
    </div>
  );
}
