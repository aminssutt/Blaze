// Landing v3 — Section 03 · MEASURED. One thin row of real numbers from our
// demo VM. No invented benchmarks, ever.

"use client";

import { Eyebrow, Reveal } from "./primitives";

const STATS = [
  { value: "183 s", caption: "end-to-end, audio to voice order" },
  { value: "63 tok/s", caption: "on NVIDIA L40S" },
  { value: "0", caption: "cloud LLM calls" },
  { value: "5", caption: "Gemma agents" },
];

export default function ProofSection() {
  return (
    <section
      id="proof"
      aria-labelledby="proof-title"
      className="scroll-mt-20 py-20 lg:py-24"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Reveal>
          <Eyebrow index="03" label="Measured" />
          <h2 id="proof-title" className="sr-only">
            Measured numbers
          </h2>
          <div
            className="mt-6 grid grid-cols-2 gap-y-8 border-y py-8 sm:grid-cols-4"
            style={{ borderColor: "var(--blaze-border)" }}
          >
            {STATS.map((stat) => (
              <div key={stat.caption}>
                <p
                  className="font-mono text-2xl font-semibold tracking-tight lg:text-3xl"
                  style={{ color: "var(--blaze-text)" }}
                >
                  {stat.value}
                </p>
                <p
                  className="mt-1 text-[13px] leading-snug"
                  style={{ color: "var(--blaze-text-muted)" }}
                >
                  {stat.caption}
                </p>
              </div>
            ))}
          </div>
          <p
            className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em]"
            style={{ color: "var(--blaze-text-faint)" }}
          >
            measured on NVIDIA L40S · no invented benchmarks
          </p>
        </Reveal>
      </div>
    </section>
  );
}
