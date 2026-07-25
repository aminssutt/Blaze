// Ticket #51 — demo controls (scénario, coupure réseau, audio). Owner: @selyan-mhli.
//
// Not a <Panel>: this is the compact control strip of the demo row, rendered
// next to the ticket #39 PlayerBar (which page.tsx keeps mounted).
//
// MOCK-MODE SHIM — the network toggle injects a synthetic, contract-valid
// `network.mode.changed` envelope straight into the store. Its sequence is
// placed strictly BETWEEN the last reduced sequence and the next integer one
// (last + remaining/2), so the store's restart rule never fires and the next
// real event still increases the sequence. Ticket #54 replaces the injection
// with POST /incident/network-mode; everything else here is untouched.

"use client";

import { useState } from "react";
import {
  getSession,
  useIncidentState,
  usePlayerState,
  useSessionControls,
} from "@/lib/session";
import type { EventType } from "@/lib/contracts";
import { Chip } from "@/components/ui";

let syntheticCount = 0;

/** Inject a synthetic local event (mock-mode only — see header comment). */
function injectLocalEvent(
  eventType: EventType,
  payload: Record<string, unknown>,
): void {
  const { store } = getSession();
  const snapshot = store.getSnapshot();
  const last = snapshot.lastSequence;
  const sequence = last + (Math.floor(last) + 1 - last) / 2;
  syntheticCount += 1;
  store.ingest({
    event_id: `local-${syntheticCount}`,
    incident_id: snapshot.incidentId ?? "local",
    event_type: eventType,
    timestamp: new Date().toISOString(),
    sequence,
    payload,
  });
}

// Dev hook so fallback/error banners can be exercised without a backend
// (ticket #51 acceptance; integration #56 feeds the real ones).
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as unknown as Record<string, unknown>).__blazeInject = injectLocalEvent;
}

const BUTTON =
  "rounded-sm border px-2 py-1 font-mono text-[10px] disabled:cursor-not-allowed disabled:opacity-40";

export default function DemoControls() {
  const state = useIncidentState();
  const player = usePlayerState();
  const controls = useSessionControls();
  /** Variant requested for the NEXT run — the mock replay itself is radio. */
  const [nextAudio, setNextAudio] = useState<"clean" | "radio">("radio");

  const offline = state.networkMode === "offline";
  const toggleNetwork = () => {
    injectLocalEvent("network.mode.changed", {
      previous_mode: state.networkMode ?? "online",
      network_mode: offline ? "online" : "offline",
    });
  };

  const canStart = player.status === "ready" || player.status === "paused";

  return (
    <div
      id="demo-controls"
      className="flex shrink-0 flex-wrap items-center gap-1.5"
    >
      <span className="text-[9px] uppercase tracking-[0.16em] text-faint">
        démo
      </span>

      <button
        type="button"
        onClick={controls.toggle}
        disabled={!canStart}
        className={`${BUTTON} border-accent-dim font-semibold text-accent hover:border-accent`}
        title="Démarre (ou reprend) le déroulé de l'incident"
      >
        ▶ démarrer
      </button>
      <button
        type="button"
        onClick={controls.reset}
        disabled={player.status === "idle" || player.status === "loading"}
        className={`${BUTTON} border-edge text-muted hover:border-edge-strong`}
        title="Réinitialise l'incident : interface remise à l'état initial"
      >
        ⟲ reset
      </button>

      <button
        type="button"
        onClick={toggleNetwork}
        aria-pressed={offline}
        className={`${BUTTON} ${
          offline
            ? "border-alert/70 bg-alert-dim/40 text-alert"
            : "border-edge text-muted hover:border-edge-strong"
        }`}
        title="Coupure réseau simulée — bascule network.mode.changed (API réelle au ticket #54)"
      >
        {offline ? "⚡ réseau coupé" : "⚡ couper le réseau"}
      </button>

      <button
        type="button"
        onClick={() => setNextAudio(nextAudio === "radio" ? "clean" : "radio")}
        aria-pressed={nextAudio === "clean"}
        className={`${BUTTON} border-edge text-muted hover:border-edge-strong`}
        title="Variante audio demandée pour le prochain run réel (#54) — le replay mock reste en radio"
      >
        ♪ prochain run : {nextAudio}
      </button>

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
        title="audio_mode courant du flux"
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
