// Ticket #38 — shared UI primitive: horizontal meter. Owner: @six-16.

export type MeterTone = "accent" | "ok" | "warn" | "alert" | "info";

export interface MeterProps {
  /** Current value, in the same unit as `max`. */
  value: number;
  /** Full-scale value. 100 for percentages, 1 for a [0,1] confidence. */
  max?: number;
  /** Optional caption on the left of the value. */
  label?: string;
  /** Text shown on the right; defaults to the rounded percentage. */
  valueLabel?: string;
  tone?: MeterTone;
  /** Native tooltip, e.g. the exact unrounded value. */
  title?: string;
  className?: string;
}

const TONE_BAR: Record<MeterTone, string> = {
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  alert: "bg-alert",
  info: "bg-info",
};

const TONE_TEXT: Record<MeterTone, string> = {
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  alert: "text-alert",
  info: "text-info",
};

/**
 * Horizontal bar for a bounded quantity: unit water level, extraction or
 * planning confidence, cache ratio. Values outside [0, max] are clamped for
 * rendering, never for display.
 */
export default function Meter({
  value,
  max = 100,
  label,
  valueLabel,
  tone = "accent",
  title,
  className = "",
}: MeterProps) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const percent = Math.round(ratio * 100);

  return (
    <div className={`flex flex-col gap-0.5 ${className}`} title={title}>
      {(label || valueLabel) && (
        <div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
          {label && <span className="truncate text-faint">{label}</span>}
          <span className={TONE_TEXT[tone]}>{valueLabel ?? `${percent}%`}</span>
        </div>
      )}
      <div
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={label}
        className="h-1 w-full overflow-hidden rounded-full bg-overlay"
      >
        <div
          className={`h-full rounded-full ${TONE_BAR[tone]}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
