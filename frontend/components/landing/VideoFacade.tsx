// Landing — the demo video, loaded as a FACADE and never before the visitor
// asks for it.
//
// A plain <iframe> would pull Google's player scripts and set cookies on every
// single page view. On a product whose entire claim is "everything runs on one
// machine; nothing leaves it", the landing page contradicting that in the
// network tab is not a detail — it is the pitch failing in public.
//
// So until the click there is exactly one thing on screen: the video's own
// poster frame, served from /public (downloaded once, never hotlinked from
// img.youtube.com). Zero external hosts are contacted. The click is the
// consent: only then do we mount the iframe, on the youtube-nocookie domain,
// with autoplay so the same gesture that loads the player also starts it.
//
// One layout note worth keeping: the focus ring is drawn INSET. The trigger is
// an `absolute inset-0` button filling a container with `overflow-hidden` (the
// rounded corners need it), and that clips any outline or outer box-shadow
// ring — so the ring has to live inside the box to be visible at all.

"use client";

import Image from "next/image";
import { useState } from "react";

const VIDEO_ID = "zlNaOR0Hea8";

/** youtube-nocookie + autoplay: the click that loads the player also plays it. */
const EMBED_SRC = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`;

/** Play triangle, drawn inline so the facade needs no icon dependency. */
function PlayGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-7 translate-x-[2px]"
      fill="currentColor"
    >
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.14-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

export default function VideoFacade() {
  const [playing, setPlaying] = useState(false);

  return (
    <figure className="m-0 w-full max-w-full">
      <div
        className="relative w-full overflow-hidden rounded-lg border"
        style={{
          aspectRatio: "16 / 9",
          borderColor: "var(--blaze-border)",
          background: "var(--blaze-bg-overlay)",
        }}
      >
        {playing ? (
          <iframe
            src={EMBED_SRC}
            title="BLAZE demo video"
            className="absolute inset-0 size-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label="Play the BLAZE demo video — loads the player from YouTube"
            className="group absolute inset-0 size-full cursor-pointer focus-visible:outline-none"
          >
            <Image
              src="/video-poster.jpg"
              alt=""
              fill
              sizes="(min-width: 1024px) 480px, 100vw"
              className="object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.03]"
            />

            {/* Scrim. The poster is a bright title card, so it needs a real
                dim, not a token one: it has to sit inside a dark control-room
                page, let the amber glyph read as the only lit thing, and carry
                legible caption text along its bottom edge. */}
            <span
              aria-hidden
              className="absolute inset-0 transition-opacity duration-300 group-hover:opacity-65 group-focus-visible:opacity-65 motion-reduce:transition-none"
              style={{
                background:
                  "linear-gradient(to top, rgba(10,12,16,0.97) 0%, rgba(10,12,16,0.86) 22%, rgba(10,12,16,0.7) 55%, rgba(10,12,16,0.64) 100%)",
              }}
            />

            <span
              aria-hidden
              className="absolute left-1/2 top-1/2 grid size-[68px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-110"
              style={{
                background: "var(--blaze-accent)",
                borderColor: "var(--blaze-accent-strong)",
                color: "#140d02",
                boxShadow: "0 12px 40px -8px rgba(249,115,22,0.55)",
              }}
            >
              <PlayGlyph />
            </span>

            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 pb-3 text-left"
            >
              <span
                className="font-mono text-[12px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: "var(--blaze-text)" }}
              >
                Watch the demo
              </span>
              <span
                className="font-mono text-[10px] uppercase tracking-[0.12em]"
                style={{ color: "var(--blaze-text-muted)" }}
              >
                YouTube loads only on play
              </span>
            </span>

            {/* Keyboard focus ring — its own top-most layer, on purpose. An
                inset box-shadow on the button itself paints underneath the
                poster and the scrim, and an outline or outer ring is clipped by
                the container's overflow-hidden. This is the only version that
                is actually visible when you tab to it. */}
            <span
              aria-hidden
              className="absolute inset-0 opacity-0 group-focus-visible:opacity-100"
              style={{ boxShadow: "inset 0 0 0 3px var(--blaze-accent)" }}
            />
          </button>
        )}
      </div>
    </figure>
  );
}
