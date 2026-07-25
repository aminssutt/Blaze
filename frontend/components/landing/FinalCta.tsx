// Landing v2 — Section 06 · FINAL CTA. Big close + the demo film slot.

"use client";

import Link from "next/link";
import { Reveal } from "./primitives";
import VideoSlot from "./VideoSlot";

export default function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal className="text-center">
          <h2
            id="cta-title"
            className="mx-auto max-w-3xl text-3xl font-semibold leading-tight tracking-tight lg:text-5xl"
            style={{ color: "var(--blaze-text)" }}
          >
            From radio chatter to a validated voice order.{" "}
            <span style={{ color: "var(--blaze-accent-strong)" }}>
              See it run.
            </span>
          </h2>
          <Link
            href="/demo"
            className="mt-8 inline-block rounded-md border px-8 py-3.5 font-mono text-base font-semibold uppercase tracking-[0.12em]"
            style={{
              background: "var(--blaze-accent)",
              borderColor: "var(--blaze-accent)",
              color: "#140d02",
            }}
          >
            Open demo →
          </Link>
        </Reveal>

        <Reveal delay={0.15} className="mx-auto mt-14 max-w-3xl">
          <VideoSlot />
        </Reveal>
      </div>
    </section>
  );
}
