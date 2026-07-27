// Landing hero — the interactive handheld radio.
//
// The hero's visual anchor AND a real player: pressing the radio plays one of
// the scenario radio calls that drive the whole demo, the LCD tickers the
// French transcript as it plays and the status LED pulses. Press again to
// stop; when a message ends the radio arms the next one, so five presses walk
// the visitor through the whole scenario.
//
// Everything comes from the real fixture manifest (`/data/audio/manifest.json`
// — the same file the backend scenario uses): file paths, speaker and
// transcript are READ, never hardcoded, so renaming a fixture can't desync the
// landing page. If the manifest or the artwork is missing the component still
// renders — the radio degrades to a drawn shell and the button reports "no
// signal" instead of breaking the hero.
//
// The LCD and LED overlays are positioned as fractions of the artwork box,
// measured on the PNG itself, so they stay glued to the hardware at any size.
//
// prefers-reduced-motion: no LED pulse, no VU meter, no ticker scroll — the
// transcript still updates because it is content the visitor asked for.

"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/** Shape of one entry in `/data/audio/manifest.json`. */
type ManifestEntry = {
  audio_id: string;
  speaker_hint: string;
  radio_path: string;
  clean_path: string;
  reference_transcript: string;
};

type Call = {
  id: string;
  speaker: string;
  src: string;
  words: string[];
};

const MANIFEST_URL = "/data/audio/manifest.json";

/** Artwork intrinsic box — the overlay coordinates below are fractions of it. */
const ART = { src: "/walkie-talkie.png", width: 456, height: 790 };

/** LCD glass, measured on the artwork (px → % of the 456×790 box). */
const LCD = { left: "22.8%", top: "56.7%", width: "52.6%", height: "10.1%" };

/** Status LED, measured on the artwork (center point, size in % of width). */
const LED = { left: "24.8%", top: "51.3%", size: "3.1%" };

function isEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.audio_id === "string" &&
    typeof e.reference_transcript === "string" &&
    (typeof e.radio_path === "string" || typeof e.clean_path === "string")
  );
}

/** `data/audio/x.wav` (manifest-relative) → `/data/audio/x.wav` (public URL). */
function toPublicUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export default function WalkieTalkie() {
  const reduced = useReducedMotion();
  const audioRef = useRef<HTMLAudioElement>(null);

  const [calls, setCalls] = useState<Call[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [artBroken, setArtBroken] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // Read the real fixture manifest — never guess a filename.
  useEffect(() => {
    const controller = new AbortController();
    fetch(MANIFEST_URL, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: unknown) => {
        const entries = Array.isArray(data) ? data.filter(isEntry) : [];
        if (entries.length === 0) throw new Error("empty manifest");
        setCalls(
          entries.map((e) => ({
            id: e.audio_id,
            speaker: e.speaker_hint ?? "UNIT",
            src: toPublicUrl(e.radio_path || e.clean_path),
            words: e.reference_transcript.split(/\s+/).filter(Boolean),
          })),
        );
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const call = calls?.[index];
  const total = calls?.length ?? 0;
  const shownWords = call
    ? call.words.slice(0, Math.ceil(progress * call.words.length))
    : [];

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !call) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    el.currentTime = 0;
    setProgress(0);
    void el.play().then(
      () => setPlaying(true),
      () => setFailed(true),
    );
  }, [call, playing]);

  // Stop playback if the visitor scrolls the hero away — a radio that keeps
  // talking off-screen is a bug, not a feature.
  useEffect(() => {
    if (!playing) return;
    const onVisibility = () => {
      if (document.hidden) {
        audioRef.current?.pause();
        setPlaying(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [playing]);

  const ready = Boolean(call) && !failed;
  const label = !ready
    ? "Scenario radio call unavailable"
    : playing
      ? `Stop the scenario radio call from ${call?.speaker}`
      : `Play scenario radio call ${index + 1} of ${total} from ${call?.speaker}`;

  return (
    <div className="relative mx-auto w-full max-w-[430px] lg:mx-0 lg:ml-auto lg:max-w-none">
      {/* Warm floor glow so the handset sits in the scene instead of floating. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[86%] w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-full lg:left-[64%]"
        style={{
          background:
            "radial-gradient(circle, rgba(245,158,11,0.13) 0%, rgba(245,158,11,0.04) 42%, transparent 70%)",
        }}
      />

      <div className="flex items-center justify-center gap-0 lg:justify-end">
        {/* The transcript used to be mirrored in a HUD panel beside the
            handset. It duplicated the LCD for no gain, so the panel is gone —
            but the LCD is aria-hidden decoration, so the spoken text has to
            stay reachable. This is that channel: invisible, announced. */}
        <p lang="fr" aria-live="polite" className="sr-only">
          {shownWords.length > 0
            ? shownWords.join(" ")
            : ready
              ? `Radio call ${index + 1} of ${total} from ${call?.speaker}, not yet played.`
              : "No radio call available."}
        </p>

        {/* ---------------------------------------------------------------- */}
        {/* The handset itself — one big accessible button.                  */}
        {/* ---------------------------------------------------------------- */}
        <button
          type="button"
          onClick={toggle}
          disabled={!ready}
          aria-label={label}
          aria-pressed={playing}
          className="group relative block w-[210px] shrink-0 outline-none transition-transform duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 enabled:hover:-translate-y-1 disabled:cursor-not-allowed sm:w-[248px] lg:w-[286px]"
          style={{
            aspectRatio: `${ART.width} / ${ART.height}`,
            // makes `cqw` inside the LCD resolve against the handset, so the
            // readout scales with the hardware instead of the viewport
            containerType: "inline-size",
            outlineColor: "var(--blaze-accent)",
          }}
        >
          {artBroken ? (
            // Artwork missing — drawn fallback keeps the exact same box so the
            // hero layout is identical with or without the PNG.
            <span
              aria-hidden
              className="absolute inset-x-[6%] inset-y-[2%] rounded-[20px] border"
              style={{
                background:
                  "linear-gradient(160deg, #1b1e25 0%, #0f1116 55%, #16191f 100%)",
                borderColor: "var(--blaze-border-strong)",
              }}
            />
          ) : (
            <Image
              src={ART.src}
              alt=""
              width={ART.width}
              height={ART.height}
              priority
              sizes="(max-width: 640px) 210px, (max-width: 1024px) 248px, 286px"
              onError={() => setArtBroken(true)}
              className="pointer-events-none size-full select-none object-contain drop-shadow-[0_40px_60px_rgba(0,0,0,0.7)]"
            />
          )}

          {/* status LED, glued to the hardware's own indicator */}
          <motion.span
            aria-hidden
            className="absolute rounded-full"
            style={{
              left: LED.left,
              top: LED.top,
              width: LED.size,
              aspectRatio: "1",
              // `translate` (not `transform`) so motion's transform styles and
              // this centering offset can never fight each other
              translate: "-50% -50%",
              background: ready ? "var(--blaze-accent)" : "var(--blaze-alert)",
            }}
            animate={
              playing && !reduced
                ? {
                    opacity: [1, 0.35, 1],
                    boxShadow: [
                      "0 0 10px 3px rgba(245,158,11,0.85)",
                      "0 0 4px 1px rgba(245,158,11,0.30)",
                      "0 0 10px 3px rgba(245,158,11,0.85)",
                    ],
                  }
                : {
                    opacity: ready ? 0.72 : 0.9,
                    boxShadow: "0 0 6px 1px rgba(245,158,11,0.35)",
                  }
            }
            transition={
              playing && !reduced
                ? { duration: 1.05, repeat: Infinity, ease: "easeInOut" }
                : { duration: 0.25 }
            }
          />

          {/* LCD — status row + the transcript tickering through the glass */}
          <span
            aria-hidden
            className="absolute flex flex-col overflow-hidden rounded-[3px] px-[3.5%] py-[1.5%] text-left"
            style={{
              left: LCD.left,
              top: LCD.top,
              width: LCD.width,
              height: LCD.height,
              background: playing
                ? "linear-gradient(180deg, rgba(245,158,11,0.16), rgba(245,158,11,0.05))"
                : "rgba(8,10,13,0.55)",
              boxShadow: playing
                ? "inset 0 0 14px rgba(245,158,11,0.28)"
                : "inset 0 0 10px rgba(0,0,0,0.6)",
            }}
          >
            <span
              className="flex shrink-0 items-center justify-between font-mono uppercase leading-none"
              style={{
                fontSize: "clamp(5px, 2.6cqw, 8px)",
                letterSpacing: "0.08em",
                color: ready ? "var(--blaze-accent)" : "var(--blaze-text-faint)",
                opacity: 0.9,
              }}
            >
              <span>{ready ? `CH12 ${call?.speaker}` : "--"}</span>
              <span>{total > 0 ? `${index + 1}/${total}` : "--"}</span>
            </span>

            {/* justify-end keeps the newest words visible as the text grows */}
            <span
              lang="fr"
              className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden font-mono leading-[1.25]"
              style={{
                fontSize: "clamp(5px, 2.5cqw, 8px)",
                color: "var(--blaze-accent)",
                opacity: playing ? 0.95 : 0.45,
              }}
            >
              {shownWords.length > 0
                ? shownWords.join(" ")
                : ready
                  ? "STANDBY · PRESS TO RECEIVE"
                  : "NO SIGNAL"}
            </span>
          </span>

          {/* press affordance — appears on hover/focus, never on touch idle */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-1 flex justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <span
              className="rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{
                background: "var(--blaze-bg-overlay)",
                borderColor: "var(--blaze-accent-dim)",
                color: "var(--blaze-accent)",
              }}
            >
              {playing ? "Stop" : "Press to receive"}
            </span>
          </span>
        </button>
      </div>

      {/* Mobile transcript — the HUD is hidden below sm, the words are not. */}
      <p
        lang="fr"
        aria-live="polite"
        className="mt-4 min-h-[3.5em] text-center font-mono text-[12px] leading-relaxed sm:hidden"
        style={{ color: "var(--blaze-text-muted)" }}
      >
        {shownWords.length > 0
          ? shownWords.join(" ")
          : "Press the radio to hear a real fireground call."}
      </p>

      {call && (
        <audio
          ref={audioRef}
          src={call.src}
          preload="none"
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration > 0) setProgress(el.currentTime / el.duration);
          }}
          onEnded={() => {
            setPlaying(false);
            setProgress(1);
            // arm the next call so a second press continues the scenario
            window.setTimeout(() => {
              setIndex((i) => (i + 1) % (calls?.length ?? 1));
              setProgress(0);
            }, 1400);
          }}
          onError={() => {
            setFailed(true);
            setPlaying(false);
          }}
        />
      )}
    </div>
  );
}
