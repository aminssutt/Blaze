"use client";

/**
 * Vue Système (/system) — is the machine ready for the demo? Three sources of
 * truth, clearly separated so nothing mock can pass for measured:
 *
 *   1. Live backend probe — GET /health polled every 10 s (vLLM, STT, TTS,
 *      network mode), independent of the event stream.
 *   2. Stream-derived pills — deriveSystemStatuses on the reduced state
 *      (same logic as the /expert header).
 *   3. The NVIDIA cockpit — metric.updated events only, "—" until measured.
 *
 * Plus one clearly-dated installation record (GPU / model / engine), labeled
 * as a setup reading — never presented as live telemetry.
 */

import { useEffect, useState } from "react";
import { useIncidentState, useSessionControls } from "@/lib/session";
import { deriveSystemStatuses } from "@/lib/systemStatus";
import { getBackendBase } from "@/lib/streamMode";
import OpsNav from "@/components/ops/OpsNav";
import PlayerBar from "@/components/PlayerBar";
import StreamModeToggle from "@/components/controls/StreamModeToggle";
import NvidiaMetricsPanel from "@/components/metrics/NvidiaMetricsPanel";
import { StatusDot, StatusPill } from "@/components/ui";

/* ------------------------------------------------------------------------- */
/* Live /health probe                                                        */
/* ------------------------------------------------------------------------- */

interface HealthComponent {
  status: string;
  detail: string;
}

interface Health {
  status: string;
  components: Record<string, HealthComponent>;
  network_mode: string;
}

type Probe =
  | { state: "loading" }
  | { state: "ok"; health: Health; at: Date }
  | { state: "unreachable"; at: Date };

const POLL_MS = 10_000;

function useHealthProbe(): Probe {
  const [probe, setProbe] = useState<Probe>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const resp = await fetch(`${getBackendBase()}/health`);
        if (!resp.ok) throw new Error(String(resp.status));
        const health = (await resp.json()) as Health;
        if (!cancelled) setProbe({ state: "ok", health, at: new Date() });
      } catch {
        if (!cancelled) setProbe({ state: "unreachable", at: new Date() });
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return probe;
}

const COMPONENT_LABELS: Record<string, string> = {
  vllm: "vLLM (Gemma 4)",
  stt: "Reconnaissance vocale",
  tts: "Synthèse vocale",
};

function HealthCard() {
  const probe = useHealthProbe();

  return (
    <section className="rounded-md border border-edge bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2
          className="font-mono text-[11px] uppercase tracking-[0.2em]"
          style={{ color: "var(--blaze-text-faint)" }}
        >
          {"// sonde backend en direct"}
        </h2>
        <span className="font-mono text-[10px]" style={{ color: "var(--blaze-text-faint)" }}>
          {probe.state === "loading"
            ? "première mesure…"
            : `sondé à ${probe.at.toLocaleTimeString("fr-FR")} · toutes les 10 s`}
        </span>
      </div>

      {probe.state === "unreachable" && (
        <p
          className="mt-2 rounded-sm border px-3 py-2 font-mono text-[12px]"
          style={{
            borderColor: "var(--blaze-alert)",
            background: "var(--blaze-alert-dim)",
            color: "var(--blaze-alert)",
          }}
        >
          Backend injoignable — vérifier que la stack tourne (tunnel ou machine locale).
        </p>
      )}

      {probe.state === "ok" && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {Object.entries(probe.health.components).map(([key, comp]) => {
            const ok = comp.status === "ok";
            return (
              <li key={key} className="flex items-center gap-2">
                <StatusDot tone={ok ? "ok" : "alert"} />
                <span className="text-sm" style={{ color: "var(--blaze-text)" }}>
                  {COMPONENT_LABELS[key] ?? key}
                </span>
                <span
                  className="ml-auto truncate font-mono text-[11px]"
                  style={{ color: ok ? "var(--blaze-text-muted)" : "var(--blaze-alert)" }}
                  title={comp.detail}
                >
                  {ok ? comp.detail : `${comp.status} — ${comp.detail}`}
                </span>
              </li>
            );
          })}
          <li className="mt-1 flex items-center gap-2 border-t border-edge pt-2">
            <StatusDot tone={probe.health.network_mode === "offline" ? "warn" : "ok"} />
            <span className="text-sm" style={{ color: "var(--blaze-text)" }}>
              Réseau
            </span>
            <span
              className="ml-auto font-mono text-[11px]"
              style={{ color: "var(--blaze-text-muted)" }}
            >
              {probe.health.network_mode === "offline"
                ? "hors ligne — caches locaux"
                : "en ligne"}
            </span>
          </li>
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Installation record — dated, never presented as live                      */
/* ------------------------------------------------------------------------- */

const INSTALL_ROWS = [
  ["GPU", "NVIDIA L40S — 46 068 MiB · driver 580.126.09 · CUDA 13.0"],
  ["Modèle", "google/gemma-4-E4B-it · bf16 · contexte 8192"],
  ["Moteur", "vLLM 0.25.1 · guided decoding · tool-call parser gemma4"],
  ["Cache KV", "25,16 GiB → 920 621 tokens → concurrence ×112 à 8k"],
  ["Machine", "12 CPU · 72 GiB RAM · 625 GiB disque"],
] as const;

function InstallCard() {
  return (
    <section className="rounded-md border border-edge bg-surface p-3">
      <h2
        className="font-mono text-[11px] uppercase tracking-[0.2em]"
        style={{ color: "var(--blaze-text-faint)" }}
      >
        {"// relevé d'installation — 25 juil. 2026, pas une télémétrie live"}
      </h2>
      <dl className="mt-2 flex flex-col gap-1">
        {INSTALL_ROWS.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-3">
            <dt
              className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[0.1em]"
              style={{ color: "var(--blaze-text-faint)" }}
            >
              {label}
            </dt>
            <dd className="font-mono text-[12px]" style={{ color: "var(--blaze-text)" }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Page                                                                      */
/* ------------------------------------------------------------------------- */

export default function SystemView() {
  const state = useIncidentState();
  const controls = useSessionControls();

  useEffect(() => {
    controls.start();
  }, [controls]);

  const pills = deriveSystemStatuses(state);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-3 p-3">
      <OpsNav />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-edge bg-surface px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {pills.map((pill) => (
            <StatusPill
              key={pill.id}
              label={pill.label}
              value={pill.value}
              level={pill.level}
              detail={pill.detail}
              measured={pill.measured}
              testId={pill.id}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <StreamModeToggle />
          <PlayerBar />
        </div>
      </div>

      <main className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <NvidiaMetricsPanel className="min-h-[24rem]" />
        <div className="flex flex-col gap-3">
          <HealthCard />
          <InstallCard />
        </div>
      </main>
    </div>
  );
}
