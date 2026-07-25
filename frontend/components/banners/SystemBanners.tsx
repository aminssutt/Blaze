// Ticket #51 — system banners (fallback / erreur). Owner: @selyan-mhli.
//
// Not a <Panel>: this region is a full-width strip that must occupy ZERO
// height while no fallback/error has been reduced. Banners inform, they never
// block: the rest of the UI keeps working underneath, and each banner can be
// dismissed (the store keeps the full list + counters for the header chips).

"use client";

import { useState } from "react";
import { useIncidentState } from "@/lib/session";
import { Badge } from "@/components/ui";

function bannerText(payload: Record<string, unknown>): string {
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.reason === "string") return payload.reason;
  if (typeof payload.fallback === "string") return `repli actif : ${payload.fallback}`;
  return JSON.stringify(payload);
}

export default function SystemBanners() {
  const { banners } = useIncidentState();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const visible = banners.filter((b) => !dismissed.has(b.id));

  // Zero height until something is actually wrong.
  if (visible.length === 0) return null;

  return (
    <div
      id="system-banners"
      className="flex shrink-0 flex-wrap items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {visible.map((banner) => (
        <div
          key={banner.id}
          className={`flex min-w-0 items-center gap-2 rounded-md border px-3 py-1 ${
            banner.kind === "error"
              ? "border-alert/70 bg-alert-dim/40"
              : "border-warn/60 bg-warn/10"
          }`}
        >
          <Badge variant={banner.kind === "error" ? "alert" : "warn"} filled>
            {banner.kind === "error" ? "erreur" : "repli"}
          </Badge>
          <span className="truncate font-mono text-[11px] text-foreground">
            {bannerText(banner.payload)}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-faint">
            seq {banner.sequence}
          </span>
          <button
            type="button"
            onClick={() => setDismissed(new Set([...dismissed, banner.id]))}
            className="shrink-0 rounded-sm px-1 font-mono text-[11px] text-faint hover:text-foreground"
            aria-label="Masquer cette bannière"
            title="Masquer (le compteur repli/err de la barre démo reste à jour)"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
