// Ticket #38 — shared UI primitive: header status pill. Owner: @six-16.

import StatusDot, { type StatusTone } from "./StatusDot";

export type PillLevel = "unknown" | "ok" | "active" | "warn" | "alert";

export interface StatusPillProps {
  /** Short label rendered faint (e.g. "GPU NVIDIA"). */
  label: string;
  /** Primary value (e.g. "gemma-4-local"). */
  value: string;
  level: PillLevel;
  /** Secondary line — surfaced as the tooltip and to screen readers. */
  detail: string;
  /**
   * When false the value is inferred or self-declared unmeasured: the pill
   * prefixes it with `~` and says so in the tooltip, so a viewer can never
   * mistake it for a measured reading (product invariant #4).
   */
  measured?: boolean;
  /** Test hook suffix — rendered as `data-testid="status-<testId>"`. */
  testId?: string;
  className?: string;
}

const LEVEL_TONE: Record<PillLevel, StatusTone> = {
  unknown: "idle",
  ok: "ok",
  active: "running",
  warn: "warn",
  alert: "alert",
};

const LEVEL_VALUE_TEXT: Record<PillLevel, string> = {
  unknown: "text-faint",
  ok: "text-foreground",
  active: "text-info",
  warn: "text-warn",
  alert: "text-alert",
};

/**
 * One system status in the control-room header: dot, label, value. Purely
 * presentational — the caller derives the status (see lib/systemStatus.ts).
 */
export default function StatusPill({
  label,
  value,
  level,
  detail,
  measured = true,
  testId,
  className = "",
}: StatusPillProps) {
  // `unknown` already reads as "en attente": prefixing it with `~` would
  // suggest an approximate reading where there is simply no reading yet.
  const approximate = !measured && level !== "unknown";
  const suffix = measured ? "" : " (valeur non mesurée)";
  const title = `${label} : ${value} — ${detail}${suffix}`;

  return (
    <div
      data-testid={testId ? `status-${testId}` : undefined}
      data-level={level}
      data-measured={measured}
      title={title}
      className={`flex min-w-0 items-center gap-1.5 rounded-sm border border-edge bg-overlay px-2 py-1 ${className}`}
    >
      <StatusDot
        tone={LEVEL_TONE[level]}
        pulse={level === "active" || level === "alert"}
      />
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint">
        {label}
      </span>
      <span
        className={`max-w-[16ch] truncate font-mono text-[11px] ${LEVEL_VALUE_TEXT[level]}`}
      >
        {approximate ? "~" : ""}
        {value}
      </span>
      <span className="sr-only">
        {detail}
        {suffix}
      </span>
    </div>
  );
}
