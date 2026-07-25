// Ticket #51 — demo controls (scénario, coupure réseau, audio). Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #51 owns this file from now on.
// Not a <Panel>: this is the compact control strip of the demo row, rendered
// next to the ticket #39 PlayerBar (which page.tsx keeps mounted).

"use client";

import { useIncidentState } from "@/lib/session";
import { Chip } from "@/components/ui";

export default function DemoControls() {
  const state = useIncidentState();

  return (
    <div
      id="demo-controls"
      className="flex shrink-0 flex-wrap items-center gap-1.5"
    >
      <span className="text-[9px] uppercase tracking-[0.16em] text-faint">
        démo
      </span>
      <Chip
        label="événements"
        value={`${state.eventsReceived}`}
        tone={state.eventsReceived > 0 ? "accent" : "neutral"}
        title="Nombre d'événements réduits par le store"
      />
      <Chip
        label="réseau"
        value={state.networkMode ?? "—"}
        tone={state.networkMode === "online" ? "ok" : state.networkMode ? "alert" : "neutral"}
        title="network_mode courant"
      />
      <Chip
        label="audio"
        value={state.audioMode ?? "—"}
        title="audio_mode courant"
      />
      <Chip
        label="repli/err"
        value={`${state.fallbackCount}/${state.errorCount}`}
        tone={state.errorCount > 0 ? "alert" : state.fallbackCount > 0 ? "warn" : "neutral"}
        title="fallback.activated / error"
      />
    </div>
  );
}
