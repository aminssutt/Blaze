// Ticket #38 — shared UI primitive: key/value chip. Owner: @six-16.

import type { ReactNode } from "react";

export type ChipTone = "neutral" | "accent" | "ok" | "warn" | "alert" | "info";

export interface ChipProps {
  /** Key part, rendered faint (e.g. "vent"). */
  label: string;
  /** Value part, rendered in the tone colour (e.g. "28 km/h"). */
  value: ReactNode;
  tone?: ChipTone;
  /** Native tooltip — use it to carry the raw contract value or the unit. */
  title?: string;
  className?: string;
}

const TONE_VALUE: Record<ChipTone, string> = {
  neutral: "text-foreground",
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  alert: "text-alert",
  info: "text-info",
};

/** Compact `key: value` chip for dense operational data. */
export default function Chip({
  label,
  value,
  tone = "neutral",
  title,
  className = "",
}: ChipProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-baseline gap-1 whitespace-nowrap rounded-sm border border-edge bg-overlay px-1.5 py-px font-mono text-[10px] leading-4 ${className}`}
    >
      <span className="text-faint">{label}</span>
      <span className={TONE_VALUE[tone]}>{value}</span>
    </span>
  );
}
