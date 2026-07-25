"use client";

/**
 * Settings view (/settings) — the machine and the model.
 *
 * Three stacked sections, nothing else:
 *   1. Installation record — dated setup reading (GPU / model / engine),
 *      clearly labeled as NOT live telemetry.
 *   2. NVIDIA telemetry — the cockpit, driven 100% by `metric.updated`
 *      events; a value that was not measured renders as "—".
 *   3. Gemma consumption — per-agent table + scenario budget card, 100%
 *      derived from reduced stream events (see GemmaConsumptionTable).
 *
 * Everything workflow-shaped (pipeline stages, stream status pills, replay
 * controls) lives in /workflow — not here.
 */

import { useEffect } from "react";
import { useSessionControls } from "@/lib/session";
import OpsNav from "@/components/ops/OpsNav";
import GemmaConsumptionTable from "@/components/metrics/GemmaConsumptionTable";
import NvidiaMetricsPanel from "@/components/metrics/NvidiaMetricsPanel";
import { Panel } from "@/components/ui";

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
          consumption.
        </p>
      </header>

      <main className="flex flex-col gap-4">
        <InstallCard />
        <NvidiaMetricsPanel className="min-h-[20rem]" />
        {/* Gemma consumption per agent + scenario budget — 100% event-derived. */}
        <GemmaConsumptionTable />
      </main>
    </div>
  );
}
