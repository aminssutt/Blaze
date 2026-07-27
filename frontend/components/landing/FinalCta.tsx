// Landing — final CTA. The closing argument on the left, the demo video on
// the right. Carries the `see-it-run` anchor so the nav can address all four
// sections.
//
// The video sits here rather than in its own band on purpose: a full-width
// video section would have cost ~600px of page height, and this page was just
// pulled back from exactly that kind of bloat. Beside the CTA it costs almost
// nothing — the card was already this tall — and it lands where the visitor is
// deciding whether to click through, which is precisely when a walkthrough is
// worth watching.

"use client";

import Link from "next/link";
import { Reveal } from "./primitives";
import VideoFacade from "./VideoFacade";

export default function FinalCta() {
  return (
    <section
      id="see-it-run"
      aria-labelledby="cta-title"
      className="scroll-mt-20 py-8 lg:py-9"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal>
          <div
            className="relative overflow-hidden rounded-xl border px-7 py-8 lg:px-12"
            style={{
              background: "var(--blaze-bg-raised)",
              borderColor: "var(--blaze-border)",
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-24 h-48"
              style={{
                background:
                  "radial-gradient(ellipse at center, rgba(245,158,11,0.14) 0%, transparent 70%)",
              }}
            />

            <div className="relative grid items-center gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12">
              <div>
                <h2
                  id="cta-title"
                  className="text-3xl font-semibold leading-tight tracking-tight lg:text-4xl"
                  style={{ color: "var(--blaze-text)" }}
                >
                  From radio chatter to a validated voice order.{" "}
                  <span style={{ color: "var(--blaze-accent-strong)" }}>
                    See it run.
                  </span>
                </h2>

                <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <Link
                    href="/workflow"
                    className="inline-block rounded-md border px-7 py-3 font-mono text-base font-semibold uppercase tracking-[0.12em]"
                    style={{
                      background: "var(--blaze-accent)",
                      borderColor: "var(--blaze-accent)",
                      color: "#140d02",
                    }}
                  >
                    Open demo →
                  </Link>
                  <span
                    className="font-mono text-[11px] uppercase tracking-[0.18em]"
                    style={{ color: "var(--blaze-text-faint)" }}
                  >
                    Runs offline · no account
                  </span>
                </div>
              </div>

              <VideoFacade />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
