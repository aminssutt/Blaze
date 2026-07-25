// Landing v2 — discreet sticky nav: wordmark, section anchors, demo CTA.
// Smooth-scrolls via scrollIntoView so we never touch the root layout.

"use client";

import Link from "next/link";

const ANCHORS = [
  { id: "why-now", label: "Why now" },
  { id: "how-it-works", label: "How it works" },
  { id: "proof", label: "Measured" },
];

function scrollToSection(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function LandingNav() {
  return (
    <nav
      aria-label="Landing sections"
      className="sticky top-0 z-50 border-b backdrop-blur-md"
      style={{
        borderColor: "var(--blaze-border)",
        background: "rgba(10, 12, 16, 0.78)",
      }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3 lg:px-10">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="font-mono text-sm font-bold tracking-[0.24em]"
          style={{ color: "var(--blaze-text)" }}
        >
          BLAZE
        </a>

        <div className="hidden items-center gap-5 md:flex">
          {ANCHORS.map((anchor) => (
            <a
              key={anchor.id}
              href={`#${anchor.id}`}
              onClick={(e) => {
                e.preventDefault();
                scrollToSection(anchor.id);
              }}
              className="text-[13px] transition-colors hover:opacity-100"
              style={{ color: "var(--blaze-text-muted)" }}
            >
              {anchor.label}
            </a>
          ))}
        </div>

        <Link
          href="/workflow"
          className="rounded-md border px-3.5 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em]"
          style={{
            borderColor: "var(--blaze-accent)",
            color: "var(--blaze-accent)",
          }}
        >
          Open demo
        </Link>
      </div>
    </nav>
  );
}
