"use client";

// Custom audio player on the control-room tokens (Selyan's UX audit): the
// native browser <audio> chrome is a white capsule that breaks the dark room.
// Same API everywhere a WAV is played: radio timeline, dispatch, demo view.

import { useEffect, useRef, useState } from "react";

export interface AudioPlayerProps {
  src: string;
  ariaLabel: string;
  /** Called once if the file cannot be loaded (caller swaps to a text badge). */
  onError?: () => void;
  className?: string;
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
      <rect x="3" y="2" width="4" height="12" rx="1" />
      <rect x="9" y="2" width="4" height="12" rx="1" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
      <path d="M4 2.5v11a.7.7 0 0 0 1.06.6l9-5.5a.7.7 0 0 0 0-1.2l-9-5.5A.7.7 0 0 0 4 2.5Z" />
    </svg>
  );
}

export default function AudioPlayer({ src, ariaLabel, onError, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Keep display state in sync with the hidden element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setTime(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play();
  };

  const seek = (clientX: number) => {
    const audio = audioRef.current;
    const track = trackRef.current;
    if (!audio || !track || !Number.isFinite(audio.duration)) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
  };

  const progress = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div
      className={`flex items-center gap-2 rounded-full border border-edge bg-overlay py-1 pl-1 pr-3 ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? `Pause — ${ariaLabel}` : `Play — ${ariaLabel}`}
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors"
        style={{
          borderColor: "var(--blaze-border-strong)",
          color: playing ? "var(--blaze-accent)" : "var(--blaze-text)",
          background: playing ? "var(--blaze-accent-dim)" : "transparent",
        }}
      >
        <PlayIcon playing={playing} />
      </button>

      <div
        ref={trackRef}
        role="slider"
        aria-label={`Seek — ${ariaLabel}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        tabIndex={0}
        onClick={(e) => seek(e.clientX)}
        onKeyDown={(e) => {
          const audio = audioRef.current;
          if (!audio) return;
          if (e.key === "ArrowRight") audio.currentTime = Math.min(audio.duration, audio.currentTime + 2);
          if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 2);
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
          }
        }}
        className="relative h-1 flex-1 cursor-pointer rounded-full"
        style={{ background: "var(--blaze-border)" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${progress}%`, background: "var(--blaze-accent)" }}
        />
      </div>

      <span
        className="shrink-0 font-mono text-[10px] tabular-nums"
        style={{ color: "var(--blaze-text-muted)" }}
      >
        {fmt(time)} / {fmt(duration)}
      </span>

      {/* The transcript text is always rendered next to the player by callers. */}
      <audio ref={audioRef} src={src} preload="metadata" onError={onError} hidden />
    </div>
  );
}
