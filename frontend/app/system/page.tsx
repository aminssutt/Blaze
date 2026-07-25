"use client";

/**
 * System view (/system) — is the machine demo-ready?
 *
 * Centerpiece (asked by Selyan): the pipeline as SIX numbered buttons.
 * Click a stage → the live metrics of what that stage is doing right now,
 * derived from the reduced event stream. Nothing hardcoded, nothing invented:
 * a value that was not measured renders as "—".
 *
 * Around it: a live GET /health probe (10 s poll, independent of the stream),
 * the NVIDIA cockpit, and a dated installation record clearly labeled as a
 * setup reading.
 */

import { useEffect, useMemo, useState } from "react";
import { useIncidentState, useSessionControls } from "@/lib/session";
import type { IncidentState } from "@/lib/incidentStore";
import { getBackendBase } from "@/lib/streamMode";
import OpsNav from "@/components/ops/OpsNav";
import PlayerBar from "@/components/PlayerBar";
import StreamModeToggle from "@/components/controls/StreamModeToggle";
import NvidiaMetricsPanel from "@/components/metrics/NvidiaMetricsPanel";
import { Panel, StatusDot } from "@/components/ui";

/* ------------------------------------------------------------------------- */
/* Pipeline stages — six buttons, live metrics per stage                     */
/* ------------------------------------------------------------------------- */

interface StageMetric {
  label: string;
  value: string;
}

interface Stage {
  id: string;
  title: string;
  plain: string;
  agentId: string | null;
  tone: (s: IncidentState) => "idle" | "active" | "done" | "blocked";
  metrics: (s: IncidentState) => StageMetric[];
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function ms(value: number | null): string {
  if (value == null) return "—";
  return value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function runDurations(s: IncidentState, agentId: string): number[] {
  return s.agentRuns
    .filter((r) => r.agent_id === agentId && r.finished && r.finished_at)
    .map((r) => new Date(r.finished_at as string).getTime() - new Date(r.started_at).getTime())
    .filter((d) => Number.isFinite(d) && d >= 0);
}

function agentTone(s: IncidentState, agentId: string, hasOutput: boolean) {
  if (s.activeAgentId === agentId) return "active" as const;
  if (hasOutput) return "done" as const;
  return "idle" as const;
}

const STAGES: Stage[] = [
  {
    id: "stt",
    title: "Listening & transcription",
    plain: "Radio audio becomes text, locally (faster-whisper).",
    agentId: null,
    tone: (s) => (s.transcripts.length > 0 ? "done" : s.audios.length > 0 ? "active" : "idle"),
    metrics: (s) => [
      { label: "audios received", value: String(s.audios.length) },
      { label: "transcripts", value: String(s.transcripts.length) },
      { label: "avg STT latency", value: ms(mean(s.transcripts.map((t) => t.latency_ms))) },
      {
        label: "language",
        value: s.transcripts[0]?.language ?? "—",
      },
    ],
  },
  {
    id: "radio",
    title: "Radio agent",
    plain: "Extracts structured facts from each message.",
    agentId: "radio_intelligence",
    tone: (s) => agentTone(s, "radio_intelligence", s.radioEvents.length > 0),
    metrics: (s) => [
      { label: "events extracted", value: String(s.radioEvents.length) },
      { label: "corrections caught", value: String(s.radioEvents.filter((e) => e.is_correction).length) },
      { label: "runs", value: String(s.agentRuns.filter((r) => r.agent_id === "radio_intelligence").length) },
      { label: "avg run time", value: ms(mean(runDurations(s, "radio_intelligence"))) },
    ],
  },
  {
    id: "context",
    title: "Field context",
    plain: "Checks weather, roads, buildings and water points.",
    agentId: "situation_context",
    tone: (s) => agentTone(s, "situation_context", s.snapshot !== null),
    metrics: (s) => [
      { label: "tool calls", value: String(s.toolCalls.length) },
      { label: "snapshot version", value: s.snapshot ? `v${s.snapshot.version}` : "—" },
      { label: "runs", value: String(s.agentRuns.filter((r) => r.agent_id === "situation_context").length) },
      { label: "avg run time", value: ms(mean(runDurations(s, "situation_context"))) },
    ],
  },
  {
    id: "planning",
    title: "Planning agent",
    plain: "Turns facts and context into a tactical plan.",
    agentId: "tactical_planning",
    tone: (s) => agentTone(s, "tactical_planning", s.plan !== null),
    metrics: (s) => [
      { label: "plan versions", value: String(s.planVersions) },
      { label: "unit actions", value: s.plan ? String(s.plan.unit_actions.length) : "—" },
      { label: "revision requests", value: String(s.planRevisionRequests.length) },
      { label: "avg run time", value: ms(mean(runDurations(s, "tactical_planning"))) },
    ],
  },
  {
    id: "safety",
    title: "Safety critic",
    plain: "Attacks the plan before any human sees it.",
    agentId: "safety_critic",
    tone: (s) =>
      s.safetyReview?.status === "block"
        ? "blocked"
        : agentTone(s, "safety_critic", s.safetyReview !== null),
    metrics: (s) => [
      { label: "reviews", value: String(s.safetyReviews.length) },
      { label: "last verdict", value: s.safetyReview?.status ?? "—" },
      { label: "runs", value: String(s.agentRuns.filter((r) => r.agent_id === "safety_critic").length) },
      { label: "avg run time", value: ms(mean(runDurations(s, "safety_critic"))) },
    ],
  },
  {
    id: "dispatch",
    title: "Dispatch & voice",
    plain: "One approved voice order per unit (Piper TTS).",
    agentId: "dispatch",
    tone: (s) => (s.dispatchesSent > 0 ? "done" : s.dispatchUnlocked ? "active" : "idle"),
    metrics: (s) => [
      { label: "orders sent", value: String(s.dispatchesSent) },
      { label: "ack required", value: String(s.dispatches.filter((d) => d.acknowledgement_required).length) },
      {
        label: "voice files ready",
        value: String(Object.values(s.ttsByDispatchId).filter((t) => t.status === "ready").length),
      },
      { label: "unlocked by human", value: s.dispatchUnlocked ? "yes" : "not yet" },
    ],
  },
];

const TONE_DOT: Record<"idle" | "active" | "done" | "blocked", string> = {
  idle: "var(--blaze-text-faint)",
  active: "var(--blaze-accent)",
  done: "var(--blaze-ok)",
  blocked: "var(--blaze-alert)",
};

const TONE_LABEL: Record<"idle" | "active" | "done" | "blocked", string> = {
  idle: "waiting",
  active: "running",
  done: "done",
  blocked: "blocked",
};

function PipelineStages() {
  const state = useIncidentState();
  const [selectedId, setSelectedId] = useState<string>(STAGES[0].id);
  const selected = STAGES.find((stage) => stage.id === selectedId) ?? STAGES[0];
  const selectedTone = selected.tone(state);
  const metrics = useMemo(() => selected.metrics(state), [selected, state]);

  return (
    <Panel
      title="Pipeline"
      subtitle="click a stage to see what it is doing"
      live={state.eventsReceived > 0}
      bodyClassName="flex flex-col gap-3"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="tablist" aria-label="Pipeline stages">
        {STAGES.map((stage, index) => {
          const tone = stage.tone(state);
          const active = stage.id === selectedId;
          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedId(stage.id)}
              className={`flex cursor-pointer flex-col items-start gap-1 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                active ? "border-accent bg-accent-dim/15" : "border-edge bg-overlay hover:border-edge-strong"
              }`}
            >
              <span className="flex w-full items-center gap-1.5">
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{
                    background: active ? "var(--blaze-accent)" : "var(--blaze-bg)",
                    color: active ? "var(--blaze-bg)" : "var(--blaze-text-muted)",
                  }}
                >
                  {index + 1}
                </span>
                <span
                  className="ml-auto inline-block size-1.5 rounded-full"
                  style={{ background: TONE_DOT[tone] }}
                  aria-hidden
                />
              </span>
              <span className="text-[12px] font-semibold leading-tight text-foreground">
                {stage.title}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-edge bg-overlay px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[14px] font-semibold text-foreground">{selected.title}</h3>
          <span className="text-[11px]" style={{ color: TONE_DOT[selectedTone] }}>
            {TONE_LABEL[selectedTone]}
          </span>
        </div>
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--blaze-text-muted)" }}>
          {selected.plain}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <dt className="text-[10px]" style={{ color: "var(--blaze-text-faint)" }}>
                {metric.label}
              </dt>
              <dd className="font-mono text-[15px] tabular-nums text-foreground">{metric.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

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
      title="Backend probe"
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

export default function SystemView() {
  const controls = useSessionControls();

  useEffect(() => {
    controls.start();
  }, [controls]);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-3 p-3">
      <OpsNav />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-full border border-edge bg-surface px-4 py-1.5">
        <div className="ml-auto flex items-center gap-3">
          <StreamModeToggle />
          <PlayerBar />
        </div>
      </div>

      <PipelineStages />

      <main className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <NvidiaMetricsPanel className="min-h-[20rem]" />
        <div className="flex flex-col gap-3">
          <HealthCard />
          <InstallCard />
        </div>
      </main>
    </div>
  );
}
