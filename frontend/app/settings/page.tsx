"use client";

/**
 * Settings view (/settings) — what this deployment actually is.
 *
 * It used to describe "the machine and the model": a hardcoded installation
 * record (NVIDIA L40S, gemma-4-E4B-it, vLLM 0.25.1, KV-cache sizing) plus an
 * NVIDIA telemetry cockpit. None of that is running here. This deployment
 * re-emits a frozen event stream recorded for the hackathon demo — no GPU, no
 * inference engine, no model, no API key. The hardware record was removed
 * rather than reworded, and the GPU cockpit with it: its values came from
 * `metric.updated` payloads that declare themselves
 * ("note": "mock placeholder values, not measured") and carry literal
 * placeholders, so relabelling them "recorded" would have been a second lie.
 *
 * What is left is what the replay genuinely provides: agent activity and the
 * counters the store builds as it reduces the stream.
 *
 * Everything workflow-shaped (pipeline stages, stream status, replay controls)
 * lives in /workflow — not here.
 */

import { useEffect } from "react";
import { useSessionControls } from "@/lib/session";
import OpsNav from "@/components/ops/OpsNav";
import ReplayActivityPanels from "@/components/metrics/ReplayActivityPanels";
import { Panel } from "@/components/ui";

/* ------------------------------------------------------------------------- */
/* What this build runs — the disclosure that replaces the hardware record    */
/* ------------------------------------------------------------------------- */

const DEPLOYMENT_ROWS: readonly (readonly [string, string])[] = [
  ["Source", "Recorded event stream, re-emitted envelope by envelope"],
  ["Inference", "None — no model is loaded and no request leaves this build"],
  ["Metrics", "Counted from the replayed events only (see the panels below)"],
] as const;

function DeploymentCard() {
  return (
    <Panel
      title="What this build runs"
      subtitle="replay of a recorded scenario — no live inference"
    >
      <dl className="flex flex-col gap-1.5">
        {DEPLOYMENT_ROWS.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-3">
            <dt
              className="w-20 shrink-0 text-[11px]"
              style={{ color: "var(--blaze-text-faint)" }}
            >
              {label}
            </dt>
            <dd className="font-mono text-[12px] text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <p
        className="mt-3 text-[11px] leading-relaxed"
        style={{ color: "var(--blaze-text-muted)" }}
      >
        The GPU, model and inference-engine readouts this page used to show
        described the hackathon machine. That machine is gone, and the recorded
        payloads that fed those readouts were placeholders rather than
        measurements, so they were removed instead of being relabelled.
      </p>
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
          What this build runs, and what the replayed stream contains.
        </p>
      </header>

      <main className="flex flex-col gap-4">
        <DeploymentCard />
        {/* Agent activity + replay counters — 100% event-derived. */}
        <ReplayActivityPanels />
      </main>
    </div>
  );
}
