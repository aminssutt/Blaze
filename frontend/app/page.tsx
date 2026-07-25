/**
 * BLAZE public landing (ticket #111) — the jury's front door.
 *
 * One 1080p screen tells the whole story: hero thesis, the animated agentic
 * pipeline (the page's signature), the demo film slot and the Open demo CTA.
 * The live control room moved to /demo. Static — no store, no event source.
 */

import type { Metadata } from "next";
import Link from "next/link";
import Hero from "@/components/landing/Hero";
import PipelineExplainer from "@/components/landing/PipelineExplainer";
import VideoSlot from "@/components/landing/VideoSlot";

export const metadata: Metadata = {
  title: "BLAZE — radio chatter to command decisions, 100% local",
  description:
    "Five local Gemma agents turn firefighter radio traffic into structured facts, a stress-tested tactical plan and human-approved dispatch orders. Zero cloud LLM calls.",
};

export default function Landing() {
  return (
    <div className="min-h-screen" style={{ background: "var(--blaze-bg)" }}>
      <Hero />

      <main className="mx-auto max-w-6xl px-6 pb-14 lg:px-10">
        <section aria-labelledby="pipeline-title" className="mt-2">
          <h2
            id="pipeline-title"
            className="font-mono text-[11px] uppercase tracking-[0.2em]"
            style={{ color: "var(--blaze-text-faint)" }}
          >
            {"// one radio message, end to end"}
          </h2>
          <div className="mt-4">
            <PipelineExplainer />
          </div>
        </section>

        <section className="mt-10 grid items-center gap-6 lg:grid-cols-[3fr_2fr]">
          <VideoSlot />
          <div>
            <h2
              className="text-2xl font-semibold leading-snug"
              style={{ color: "var(--blaze-text)" }}
            >
              Watch it, then drive it yourself.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--blaze-text-muted)" }}>
              The demo replays a real 5-message wildfire scenario near
              Frontignan: corrections, a wind shift, a safety-critic veto and a
              human approval gate — every datum labeled with its provenance.
            </p>
            <Link
              href="/demo"
              className="mt-5 inline-block rounded-md border px-5 py-2.5 font-mono text-sm font-semibold uppercase tracking-[0.12em]"
              style={{
                borderColor: "var(--blaze-accent)",
                color: "var(--blaze-accent)",
              }}
            >
              Open demo →
            </Link>
          </div>
        </section>
      </main>

      <footer
        className="border-t px-6 py-4 lg:px-10"
        style={{ borderColor: "var(--blaze-border)" }}
      >
        <p className="mx-auto max-w-6xl font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--blaze-text-faint)" }}>
          gemma 4 · vllm on nvidia l40s · faster-whisper · piper — everything
          runs on one machine, nothing leaves it
        </p>
      </footer>
    </div>
  );
}
