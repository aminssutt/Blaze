// Landing v3 — final CTA. One heading, one button.

"use client";

import Link from "next/link";
import { Reveal } from "./primitives";

export default function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal className="text-center">
          <h2
            id="cta-title"
            className="mx-auto max-w-3xl text-3xl font-semibold leading-tight tracking-tight lg:text-4xl"
            style={{ color: "var(--blaze-text)" }}
          >
            From radio chatter to a validated voice order.{" "}
            <span style={{ color: "var(--blaze-accent-strong)" }}>
              See it run.
            </span>
          </h2>
          <Link
            href="/workflow"
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
      </div>
    </section>
  );
}
