// Ticket #38 — shared UI primitive: status dot. Owner: @six-16.

export type StatusTone = "ok" | "warn" | "alert" | "idle" | "running";

export interface StatusDotProps {
  tone: StatusTone;
  /** Adds a pulse — use for "in progress", never for a settled state. */
  pulse?: boolean;
  /** Optional inline label rendered next to the dot. */
  label?: string;
  /** Native tooltip. */
  title?: string;
  className?: string;
}

const TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  alert: "bg-alert",
  idle: "bg-faint",
  running: "bg-info",
};

const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  alert: "text-alert",
  idle: "text-faint",
  running: "text-info",
};

/** Small coloured dot for a five-state operational status. */
export default function StatusDot({
  tone,
  pulse = false,
  label,
  title,
  className = "",
}: StatusDotProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 ${className}`}
    >
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]} ${pulse ? "animate-pulse" : ""}`}
      />
      {label && (
        <span className={`font-mono text-[10px] ${TONE_TEXT[tone]}`}>{label}</span>
      )}
    </span>
  );
}
