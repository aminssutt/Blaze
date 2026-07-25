// Engines board — the intervention chief's first glance (asked by Selyan):
// one card per truck. Callsign, vehicle, water gauge, current mission from the
// latest plan, and the unit's last radio report. Everything shown is either
// seeded state or a human report — never a model guess.

"use client";

import { useIncidentState } from "@/lib/session";
import { useScenario } from "@/lib/useScenario";
import { Badge, Meter, Panel } from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";
import type { RadioEvent } from "@/lib/contracts";

const VEHICLE_LABEL: Record<string, string> = {
  CCF: "Engine · CCF",
  light_vehicle: "Light vehicle",
  command_post: "Command post",
};

function lastReport(events: RadioEvent[], unitId: string): RadioEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].unit_id === unitId) return events[i];
  }
  return null;
}

/** Latest water % spoken over the radio, if any ("eau 30%" style facts). */
function reportedWaterPct(events: RadioEvent[], unitId: string): number | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.unit_id !== unitId) continue;
    for (const fact of event.facts) {
      const match = fact.match(/(\d{1,3})\s*%/);
      if (match && /eau|water/i.test(fact)) return Number(match[1]);
    }
  }
  return null;
}

export default function UnitsBoard({ className }: PanelComponentProps) {
  const { radioEvents, plan, dispatches } = useIncidentState();
  const { units } = useScenario();

  const fieldUnits = (units?.units ?? []).filter((u) => u.vehicle_type !== "command_post");

  return (
    <Panel
      className={className}
      id="units-board"
      title="Engines"
      subtitle={units ? `${fieldUnits.length} units on this incident` : undefined}
      live={radioEvents.length > 0}
      empty={fieldUnits.length === 0}
      emptyLabel="loading units…"
      bodyClassName="flex flex-col gap-2"
    >
      {fieldUnits.map((unit) => {
        const report = lastReport(radioEvents, unit.unit_id);
        const water = reportedWaterPct(radioEvents, unit.unit_id) ?? unit.water_pct;
        const mission = plan?.unit_actions.find(
          (a) => (a as { unit_id?: string }).unit_id === unit.unit_id,
        ) as { instruction?: string; priority?: string } | undefined;
        const dispatch = dispatches.find((d) => d.unit_id === unit.unit_id);
        const waterTone = water != null && water <= 20 ? "alert" : water != null && water <= 35 ? "warn" : "ok";

        return (
          <article
            key={unit.unit_id}
            className="rounded-xl border border-edge bg-overlay px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-[14px] font-bold" style={{ color: "var(--blaze-accent)" }}>
                {unit.callsign}
              </h3>
              <span className="text-[11px]" style={{ color: "var(--blaze-text-muted)" }}>
                {VEHICLE_LABEL[unit.vehicle_type] ?? unit.vehicle_type} · crew {unit.crew_size}
              </span>
              {dispatch?.acknowledgement_required && (
                <Badge variant="warn" className="ml-auto">
                  awaiting ack
                </Badge>
              )}
            </div>

            {water != null && (
              <div className="mt-1.5 flex items-center gap-2">
                <span className="w-10 text-[11px]" style={{ color: "var(--blaze-text-muted)" }}>
                  water
                </span>
                <Meter value={water} tone={waterTone} className="flex-1" />
                <span
                  className="font-mono text-[11px] tabular-nums"
                  style={{
                    color:
                      waterTone === "alert"
                        ? "var(--blaze-alert)"
                        : waterTone === "warn"
                          ? "var(--blaze-warn)"
                          : "var(--blaze-text)",
                  }}
                >
                  {water}%
                </span>
              </div>
            )}

            {mission?.instruction && (
              <p className="mt-1.5 text-[12px] leading-snug" style={{ color: "var(--blaze-text)" }}>
                <span style={{ color: "var(--blaze-text-faint)" }}>mission — </span>
                {mission.instruction}
              </p>
            )}

            {report ? (
              <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--blaze-text-muted)" }}>
                <span style={{ color: "var(--blaze-text-faint)" }}>last radio report — </span>
                « {report.evidence_text} »
                {report.location_reference ? ` · near ${report.location_reference}` : ""}
              </p>
            ) : (
              <p className="mt-1 text-[11px]" style={{ color: "var(--blaze-text-faint)" }}>
                no radio report yet
              </p>
            )}
          </article>
        );
      })}
    </Panel>
  );
}
