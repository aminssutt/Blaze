"use client";

/**
 * Settings view (/settings) — the machine and the model.
 *
 * Four stacked sections, nothing else:
 *   1. Installation record — dated setup reading (GPU / model / engine),
 *      clearly labeled as NOT live telemetry.
 *   2. NVIDIA telemetry — the cockpit, driven 100% by `metric.updated`
 *      events; a value that was not measured renders as "—".
 *   3. Gemma consumption — per-agent table + scenario budget card, 100%
 *      derived from reduced stream events (see GemmaConsumptionTable).
 *   4. Machine health — live GET /health probe (10 s poll, independent of
 *      the event stream): vLLM / STT / TTS up, network mode.
 *
 * Everything workflow-shaped (pipeline stages, stream status pills, replay
 * controls) lives in /workflow — not here.
 */

import { useEffect, useState } from "react";
import { useSessionControls } from "@/lib/session";
import { getBackendBase } from "@/lib/streamMode";
import OpsNav from "@/components/ops/OpsNav";
import GemmaConsumptionTable from "@/components/metrics/GemmaConsumptionTable";
import NvidiaMetricsPanel from "@/components/metrics/NvidiaMetricsPanel";
import { Panel, StatusDot } from "@/components/ui";

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
  stt: "Speech-to-text",
  tts: "Text-to-speech",
};

function HealthCard() {
  const probe = useHealthProbe();

  return (
    <Panel
      title="Machine health"
      subtitle={
        probe.state === "loading"
          ? "first check…"
          : `checked at ${probe.at.toLocaleTimeString("en-GB")} · every 10 s`
      }
      live={probe.state === "ok"}
    >
      {probe.state === "unreachable" && (
        <p
          className="rounded-xl border px-3 py-2 text-[12px]"
          style={{
            borderColor: "var(--blaze-alert)",
            background: "var(--blaze-alert-dim)",
            color: "var(--blaze-alert)",
          }}
        >
          Backend unreachable — check that the stack is running (tunnel or local machine).
        </p>
      )}

      {probe.state === "ok" && (
        <ul className="flex flex-col gap-1.5">
          {Object.entries(probe.health.components).map(([key, comp]) => {
            const ok = comp.status === "ok";
            return (
              <li key={key} className="flex items-center gap-2">
                <StatusDot tone={ok ? "ok" : "alert"} />
                <span className="text-sm text-foreground">{COMPONENT_LABELS[key] ?? key}</span>
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
            <span className="text-sm text-foreground">Network</span>
            <span className="ml-auto font-mono text-[11px]" style={{ color: "var(--blaze-text-muted)" }}>
              {probe.health.network_mode === "offline" ? "offline — local caches" : "online"}
            </span>
          </li>
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------------- */
/* Installation record — dated, never presented as live                      */
/* ------------------------------------------------------------------------- */

const INSTALL_ROWS = [
  ["GPU", "NVIDIA L40S — 46,068 MiB · driver 580.126.09 · CUDA 13.0"],
  ["Model", "google/gemma-4-E4B-it · bf16 · 8192 context"],
  ["Engine", "vLLM 0.25.1 · guided decoding · gemma4 tool-call parser"],
  ["KV cache", "25.16 GiB → 920,621 tokens → ×112 concurrency at 8k"],
  ["Machine", "12 CPU · 72 GiB RAM · 625 GiB disk"],
] as const;

function InstallCard() {
  return (
    <Panel title="Installation record" subtitle="setup reading, Jul 25 2026 — not live telemetry">
      <dl className="flex flex-col gap-1.5">
        {INSTALL_ROWS.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-3">
            <dt className="w-16 shrink-0 text-[11px]" style={{ color: "var(--blaze-text-faint)" }}>
              {label}
            </dt>
            <dd className="font-mono text-[12px] text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/* ------------------------------------------------------------------------- */
/* Page                                                                      */
/* ------------------------------------------------------------------------- */

export default function SettingsView() {
  const controls = useSessionControls();

  useEffect(() => {
    controls.start();
  }, [controls]);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-3">
      <OpsNav />

      <header className="px-1">
        <h1 className="text-[18px] font-semibold text-foreground">Settings</h1>
        <p className="text-[12px]" style={{ color: "var(--blaze-text-muted)" }}>
          Machine, model &amp; telemetry — installation record, NVIDIA metrics, Gemma
          consumption, live health.
        </p>
      </header>

      <main className="flex flex-col gap-4">
        <InstallCard />
        <NvidiaMetricsPanel className="min-h-[20rem]" />
        {/* Gemma consumption per agent + scenario budget — 100% event-derived. */}
        <GemmaConsumptionTable />
        <HealthCard />
      </main>
    </div>
  );
}
