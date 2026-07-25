/**
 * BLAZE public landing v2 — Astyr-grade structure, 100% BLAZE content.
 *
 * Numbered narrative: hero thesis → 01 problem → 02 animated pipeline
 * diagram (the signature) → 03 five agents & their guardrails → 04 human
 * veto spotlight → 05 measured proof → 06 final CTA + demo film → footer.
 * Static page — no store, no event source; all motion is client-side and
 * honors prefers-reduced-motion.
 */

import type { Metadata } from "next";
import Hero from "@/components/landing/Hero";
import LandingNav from "@/components/landing/LandingNav";
import ProblemSection from "@/components/landing/ProblemSection";
import PipelineDiagram from "@/components/landing/PipelineDiagram";
import AgentsSection from "@/components/landing/AgentsSection";
import HumanVetoSection from "@/components/landing/HumanVetoSection";
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
        <ProblemSection />
        <PipelineDiagram />
        <AgentsSection />
        <HumanVetoSection />
        <ProofSection />
        <FinalCta />
      </main>

      <LandingFooter />
    </div>
  );
}
