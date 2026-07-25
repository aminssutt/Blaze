// Operator navigation — one bar, four audiences:
//   Essentials /simple   — any firefighter: what the agents just did, plainly
//   Monitor    /monitor  — THE agent-control view (asked by Lakhdar): pipeline
//                          graph + per-node terminals, the new default
//   Legacy     /expert   — the previous full control room, kept accessible
//   System     /system   — is the machine healthy: vLLM, GPU, STT/TTS
//
// Pure navigation furniture on the control-room tokens; the pages own their
// content. /demo (guided cinematic) keeps living outside these tabs.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/simple", label: "Essentials", title: "The essentials, for everyone" },
  { href: "/monitor", label: "Monitor", title: "Agent control — pipeline graph and per-node terminals" },
  { href: "/expert", label: "Legacy", title: "The previous control room (detailed view)" },
  { href: "/system", label: "System", title: "Machine and AI health" },
] as const;

export default function OpsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Operator views"
      className="flex shrink-0 items-center gap-1 rounded-full border border-edge bg-surface px-3 py-1.5"
    >
      <Link
        href="/"
        className="mr-2 flex items-center gap-1.5 px-1 font-mono text-[12px] font-bold tracking-[0.2em]"
        style={{ color: "var(--blaze-accent)" }}
        title="BLAZE home"
      >
        BLAZE<span aria-hidden>▲</span>
      </Link>

      <div className="flex items-center gap-1" role="tablist">
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

      <Link
        href="/demo"
        className="ml-auto px-1 text-[11px] hover:underline"
        style={{ color: "var(--blaze-text-faint)" }}
      >
        guided demo →
      </Link>
    </nav>
  );
}
