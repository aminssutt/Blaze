// Ticket #51 — system banners (fallback / erreur). Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #51 owns this file from now on.
// Not a <Panel>: this region is a full-width strip that must occupy ZERO
// height while no fallback/error has been reduced.

"use client";

import { useIncidentState } from "@/lib/session";
import { Badge } from "@/components/ui";

export default function SystemBanners() {
  const { banners } = useIncidentState();

  // Zero height until something is actually wrong.
  if (banners.length === 0) return null;

  return (
    <div
      id="system-banners"
      className="flex shrink-0 flex-wrap items-center gap-2"
    >
      {banners.map((banner) => (
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
            {typeof banner.payload.message === "string"
              ? banner.payload.message
              : typeof banner.payload.reason === "string"
                ? banner.payload.reason
                : JSON.stringify(banner.payload)}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">
            seq {banner.sequence}
          </span>
        </div>
      ))}
    </div>
  );
}
