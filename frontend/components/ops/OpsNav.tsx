// Operator navigation — one bar, three audiences (asked by Selyan):
//   Essentiel    /simple  — any firefighter: what the agents just did, plainly
//   Intervention /expert  — the commander's full control room (map, panels)
//   Système      /system  — is the machine healthy: vLLM, GPU, STT/TTS
//
// Pure navigation furniture on the control-room tokens; the pages own their
// content. /demo (guided cinematic) keeps living outside these tabs.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/simple", label: "Essentiel", title: "L'essentiel, pour tous" },
  { href: "/expert", label: "Intervention", title: "Salle de commandement" },
  { href: "/system", label: "Système", title: "État du matériel et de l'IA" },
] as const;

export default function OpsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Vues opérateur"
      className="flex shrink-0 items-center gap-1 rounded-md border border-edge bg-surface px-2 py-1"
    >
      <Link
        href="/"
        className="mr-2 flex items-center gap-1.5 px-1 font-mono text-[12px] font-bold tracking-[0.2em]"
        style={{ color: "var(--blaze-accent)" }}
        title="Accueil BLAZE"
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
              className={`rounded-sm border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
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
        className="ml-auto px-1 font-mono text-[10px] uppercase tracking-[0.16em] hover:underline"
        style={{ color: "var(--blaze-text-faint)" }}
      >
        démo guidée →
      </Link>
    </nav>
  );
}
