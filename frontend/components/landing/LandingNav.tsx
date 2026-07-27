// Landing v2 — discreet sticky nav: wordmark, section anchors, demo CTA.
// Smooth-scrolls via scrollIntoView so we never touch the root layout.

"use client";

import Image from "next/image";
import Link from "next/link";
import GithubMark, { REPO_URL } from "./GithubMark";

const ANCHORS = [
  { id: "why-now", label: "Why now" },
  { id: "how-it-works", label: "How it works" },
  { id: "the-demo", label: "Inside the demo" },
  { id: "see-it-run", label: "See it run" },
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
          className="flex items-center gap-2.5 font-mono text-[13px] font-bold tracking-[0.24em]"
          style={{ color: "var(--blaze-text)" }}
        >
          <Image
            src="/logo-blaze.png"
            alt="BLAZE logo"
            width={30}
            height={30}
            className="rounded-full"
            loading="eager"
          />
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

        <div className="flex items-center gap-2.5">
          {/* The repo is the proof the pitch is real — it gets a real button,
              once, here. The footer keeps its quiet text link; nowhere else. */}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="BLAZE source code on GitHub (opens in a new tab)"
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors hover:border-[var(--blaze-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blaze-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--blaze-bg)]"
            style={{
              borderColor: "var(--blaze-border)",
              color: "var(--blaze-text)",
            }}
          >
            <GithubMark className="size-4 shrink-0" />
            <span className="hidden sm:inline">GitHub</span>
          </a>

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
      </div>
    </nav>
  );
}
