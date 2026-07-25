"use client";

import { useEffect, useState } from "react";
import { countByEventType, loadMockStream } from "@/lib/mockStream";

/**
 * The 10 required control-room regions (docs/prompts roadmap — "Required
 * product experience"). Placeholders for now; each will become a real panel
 * in later product tickets.
 */
const REGIONS: { id: string; title: string; hint: string }[] = [
  { id: "tactical-map", title: "2 · Tactical Map", hint: "D17 / Hangar Zone / units / routes" },
  { id: "radio-timeline", title: "3 · Radio Timeline", hint: "audio, transcripts, processing status" },
  { id: "structured-events", title: "4 · Structured Events", hint: "extracted facts, corrections, confidence" },
  { id: "agent-tool-trace", title: "5 · Agent & Tool Trace", hint: "Gemma agents, tool calls, provenance" },
  { id: "tactical-roadmap", title: "6 · Tactical Roadmap", hint: "plan version, objectives, unit actions" },
  { id: "safety-critic", title: "7 · Safety Critic", hint: "pass / revise / block, objections, rule checks" },
  { id: "human-approval", title: "8 · Human Approval", hint: "approve / modify / reject" },
  { id: "dispatch-output", title: "9 · Dispatch Output", hint: "per-unit messages, TTS playback" },
  { id: "nvidia-metrics", title: "10 · NVIDIA Metrics", hint: "GPU, engine, latency, tokens/s" },
];

export default function Home() {
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMockStream()
      .then((events) => {
        if (cancelled) return;
        console.log(
          `[BLAZE] mock stream parsed: ${events.length} typed events`,
          countByEventType(events),
        );
        setEventCount(events.length);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error("[BLAZE] mock stream failed to parse:", message);
        setStreamError(message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      {/* Region 1 — Header / status */}
      <header
        id="header-status"
        className="flex items-center gap-4 border-b border-edge bg-surface px-6 py-3"
      >
        <h1 className="text-2xl font-bold tracking-[0.3em] text-accent">
          BLAZE
        </h1>
        <span className="text-sm text-muted">Wildfire Control Room</span>
        <div className="ml-auto flex items-center gap-3 font-mono text-xs text-faint">
          <span>1 · Header / Status — Gemma · vLLM · GPU · network · incident</span>
          <span
            className={
              streamError
                ? "text-alert"
                : eventCount !== null
                  ? "text-ok"
                  : "text-warn"
            }
          >
            {streamError
              ? "MOCK STREAM ERROR"
              : eventCount !== null
                ? `MOCK STREAM · ${eventCount} EVENTS`
                : "MOCK STREAM · LOADING"}
          </span>
        </div>
      </header>

      {/* Regions 2–10 — placeholder panels */}
      <main className="grid flex-1 auto-rows-[minmax(8rem,auto)] grid-cols-1 gap-3 p-3 md:grid-cols-3">
        {REGIONS.map((region) => (
          <section
            key={region.id}
            id={region.id}
            className={`flex flex-col rounded-lg border border-edge bg-surface p-4 ${
              region.id === "tactical-map" ? "md:col-span-2 md:row-span-2" : ""
            }`}
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              {region.title}
            </h2>
            <p className="mt-2 font-mono text-xs text-faint">{region.hint}</p>
            <div className="mt-auto pt-4 font-mono text-xs text-faint/60">
              awaiting data…
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
