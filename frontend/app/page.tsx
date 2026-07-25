/**
 * BLAZE public landing v3 — light, sober, fast to read (~30 s scroll).
 *
 * Five sections: hero thesis → 01 why now (real 2026 wildfire facts,
 * sourced) → 02 animated pipeline diagram with the human-veto line →
 * 03 measured numbers in one thin row → final CTA + one-line footer.
 * Static page — no store, no event source; all motion is client-side and
 * honors prefers-reduced-motion.
 */

import type { Metadata } from "next";
import Hero from "@/components/landing/Hero";
import LandingNav from "@/components/landing/LandingNav";
import WhyNowSection from "@/components/landing/WhyNowSection";
import PipelineDiagram from "@/components/landing/PipelineDiagram";
import ProofSection from "@/components/landing/ProofSection";
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
        <ProofSection />
        <FinalCta />
      </main>

      <LandingFooter />
    </div>
  );
}
