// Ticket #111 — 1-minute demo video slot. Renders the real video when
// public/landing/demo.mp4 exists (ticket #62 drops it there), a labeled
// placeholder until then.

"use client";

import { useState } from "react";

export default function VideoSlot() {
  const [missing, setMissing] = useState(false);

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--blaze-border)", background: "var(--blaze-bg-raised)" }}
    >
      {!missing ? (
        <video
          controls
          preload="metadata"
          src="/landing/demo.mp4"
          onError={() => setMissing(true)}
          className="size-full object-cover"
          aria-label="One-minute BLAZE demo video"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center">
          <span
            className="rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{ borderColor: "var(--blaze-border-strong)", color: "var(--blaze-text-faint)" }}
          >
            video slot
          </span>
          <p className="text-sm" style={{ color: "var(--blaze-text-muted)" }}>
            1-minute demo film lands here (ticket #62) — meanwhile, the live
            demo is one click away.
          </p>
        </div>
      )}
    </div>
  );
}
