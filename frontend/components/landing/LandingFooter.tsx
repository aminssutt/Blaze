// Landing v2 — multi-column footer: site anchors, product links, the core
// statement, and the honesty tags.

"use client";

import Link from "next/link";
import { scrollToSection } from "./LandingNav";

const SITE_LINKS = [
  { id: "problem", label: "Problem" },
  { id: "how-it-works", label: "How it works" },
  { id: "agents", label: "Agents" },
  { id: "proof", label: "Proof" },
];

const PRODUCT_LINKS = [
  { href: "/demo", label: "Open demo", external: false },
  { href: "/expert", label: "Expert view", external: false },
  { href: "https://github.com/aminssutt/Blaze", label: "GitHub repo", external: true },
];

const TAGS = ["Grounded", "guardrail-checked", "commander-verified"];

export default function LandingFooter() {
  return (
    <footer
      className="border-t py-14"
      style={{ borderColor: "var(--blaze-border)" }}
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-6 md:grid-cols-[2fr_1fr_1fr] lg:px-10">
        <div>
          <p
            className="font-mono text-sm font-bold tracking-[0.24em]"
            style={{ color: "var(--blaze-text)" }}
          >
            BLAZE
          </p>
          <p
            className="mt-4 max-w-sm text-[13.5px] leading-relaxed"
            style={{ color: "var(--blaze-text-muted)" }}
          >
            We are not adding another sensor to the fireground. We are
            unlocking the sensor that was already there: every firefighter.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {TAGS.map((tag) => (
              <span
                key={tag}
                className="rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]"
                style={{
                  borderColor: "var(--blaze-border-strong)",
                  color: "var(--blaze-text-faint)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
            style={{ color: "var(--blaze-text-faint)" }}
          >
            Site
          </p>
          <ul className="mt-4 space-y-2.5">
            {SITE_LINKS.map((link) => (
              <li key={link.id}>
                <a
                  href={`#${link.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(link.id);
                  }}
                  className="text-[13.5px]"
                  style={{ color: "var(--blaze-text-muted)" }}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
            style={{ color: "var(--blaze-text-faint)" }}
          >
            Product
          </p>
          <ul className="mt-4 space-y-2.5">
            {PRODUCT_LINKS.map((link) =>
              link.external ? (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[13.5px]"
                    style={{ color: "var(--blaze-text-muted)" }}
                  >
                    {link.label} ↗
                  </a>
                </li>
              ) : (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-[13.5px]"
                    style={{ color: "var(--blaze-text-muted)" }}
                  >
                    {link.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </div>
      </div>

      <p
        className="mx-auto mt-12 max-w-6xl px-6 font-mono text-[10px] uppercase tracking-[0.16em] lg:px-10"
        style={{ color: "var(--blaze-text-faint)" }}
      >
        gemma 4 · vllm on nvidia l40s · faster-whisper · piper — everything
        runs on one machine, nothing leaves it
      </p>
    </footer>
  );
}
