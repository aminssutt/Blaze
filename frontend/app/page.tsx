/**
 * BLAZE public landing v4 — sober, dense, fast to read (~30 s scroll).
 *
 * Hero: the thesis beside a working handheld radio — press it and a real
 * scenario call plays, transcribed live. Then 01 why now (real 2026 wildfire
 * figures, each previewing the article it came from) → 02 the pipeline on one
 * left-to-right rail, where the data packet visibly stops at the human veto →
 * 03 inside the demo → final CTA + one-line footer.
 *
 * Static page — no store, no event source. The only network call is the hero
 * reading the local audio manifest; all motion is client-side and honors
 * prefers-reduced-motion.
 */

import type { Metadata } from "next";
import Hero from "@/components/landing/Hero";
import LandingNav from "@/components/landing/LandingNav";
import WhyNowSection from "@/components/landing/WhyNowSection";
import PipelineDiagram from "@/components/landing/PipelineDiagram";
import DemoSection from "@/components/landing/DemoSection";
import FinalCta from "@/components/landing/FinalCta";
import LandingFooter from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "BLAZE — radio chatter to command decisions, 100% local",
  description:
    "Five local Gemma agents turn firefighter radio traffic into structured facts, a stress-tested tactical plan and human-approved dispatch orders. Zero cloud LLM calls.",
};

export default function Landing() {
  return (
    <div id="top" className="min-h-screen" style={{ background: "var(--blaze-bg)" }}>
      <LandingNav />
      <Hero />

      <main>
        <WhyNowSection />
        <PipelineDiagram />
        <DemoSection />
        <FinalCta />
      </main>

      <LandingFooter />
    </div>
  );
}
