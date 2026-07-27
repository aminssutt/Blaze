// Landing — Section 03 · INSIDE THE DEMO.
//
// Split out of the pipeline section, which had grown into three unrelated
// blocks stacked on one heading. Giving the demo teaser its own numbered
// section buys the nav a fourth real anchor and lets the copy sit beside the
// animation instead of stacked above it, which is where most of the page's
// dead vertical space was coming from.

"use client";

import { Eyebrow, Reveal } from "./primitives";
import WorkflowPreview from "./WorkflowPreview";

const POINTS = [
  {
    title: "Every agent is inspectable",
    body: "Open any stage to see its terminal — what it received, what it decided, and the evidence it quoted.",
  },
  {
    title: "Nothing is taken on trust",
    body: "Facts carry provenance labels; plan lines carry evidence IDs that code verifies before a human ever sees them.",
  },
  {
    title: "The commander holds the switch",
    body: "The dispatch stage stays locked until approval — in the demo exactly as in the architecture.",
  },
];

export default function DemoSection() {
  return (
    <section
      id="the-demo"
      aria-labelledby="demo-title"
      className="scroll-mt-20 py-12 lg:py-14"
    >
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-14">
          <Reveal>
            <Eyebrow index="03" label="Inside the demo" />
            <h2
              id="demo-title"
              className="mt-3 text-3xl font-semibold leading-tight tracking-tight lg:text-4xl"
              style={{ color: "var(--blaze-text)" }}
            >
              Click an agent. Watch it think.
            </h2>

            <ul className="mt-6 space-y-4">
              {POINTS.map((point) => (
                <li
                  key={point.title}
                  className="border-l-2 pl-4"
                  style={{ borderColor: "var(--blaze-accent-dim)" }}
                >
                  <p
                    className="text-[14px] font-semibold"
                    style={{ color: "var(--blaze-text)" }}
                  >
                    {point.title}
                  </p>
                  <p
                    className="mt-1 text-[13.5px] leading-snug"
                    style={{ color: "var(--blaze-text-muted)" }}
                  >
                    {point.body}
                  </p>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.1}>
            <WorkflowPreview />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
