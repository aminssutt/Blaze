// Operator navigation — one bar, three views:
//   Workflow   /workflow — THE agent-control view: pipeline graph + per-node
//                          terminals, the default
//   Legacy     /expert   — the previous full control room, kept accessible
//   Settings   /settings — configuration and machine/AI health
//
// Pure navigation furniture on the control-room tokens; the pages own their
// content. The bar spans the page and centers its pill so it looks identical
// wherever it is mounted.

"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/workflow", label: "Workflow", title: "Agent control — pipeline graph and per-node terminals" },
  // "Legacy" read as "obsolete, don't click" — nobody opened the map, the plan
  // or the safety review, which all live behind this tab.
  { href: "/expert", label: "Tactical", title: "Map, tactical plan, safety review and agent traces" },
  { href: "/settings", label: "Settings", title: "Configuration and machine health" },
] as const;

export default function OpsNav() {
  const pathname = usePathname();

  return (
    <div className="flex shrink-0 justify-center">
      <nav
        aria-label="Operator views"
        className="flex h-10 items-center rounded-full border border-edge bg-surface pl-4 pr-1.5"
      >
        <Link
          href="/"
          className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.2em]"
          style={{ color: "var(--blaze-accent)" }}
          title="BLAZE home"
        >
          <Image
            src="/logo-blaze.png"
            alt="BLAZE logo"
            width={28}
            height={28}
            className="rounded-full"
            loading="eager"
          />
        </Link>

        <span
          aria-hidden
          className="mx-3 h-4 w-px"
          style={{ background: "var(--blaze-border-strong)" }}
        />

        <div className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                title={tab.title}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-3.5 py-1 text-[12px] font-medium transition-colors ${
                  active
                    ? "border-accent bg-accent-dim/20"
                    : "border-transparent hover:border-edge-strong"
                }`}
                style={{
                  color: active ? "var(--blaze-accent)" : "var(--blaze-text-muted)",
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
