// Landing v3 — one-line footer: core statement + product links.

"use client";

import Link from "next/link";

export default function LandingFooter() {
  return (
    <footer
      className="border-t py-8"
      style={{ borderColor: "var(--blaze-border)" }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 lg:px-10">
        <p
          className="text-[13px] leading-relaxed"
          style={{ color: "var(--blaze-text-muted)" }}
        >
          <span
            className="font-mono font-bold tracking-[0.2em]"
            style={{ color: "var(--blaze-text)" }}
          >
            BLAZE
          </span>{" "}
          — every firefighter is already a sensor. Everything runs on one
          machine; nothing leaves it.
        </p>
        <div className="flex items-center gap-5">
          <a
            href="https://github.com/aminssutt/Blaze"
            target="_blank"
            rel="noreferrer"
            className="text-[13px]"
            style={{ color: "var(--blaze-text-muted)" }}
          >
            GitHub ↗
          </a>
          <Link
            href="/workflow"
            className="text-[13px]"
            style={{ color: "var(--blaze-text-muted)" }}
          >
            Open demo
          </Link>
        </div>
      </div>
    </footer>
  );
}
