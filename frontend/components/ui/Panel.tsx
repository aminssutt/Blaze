// Ticket #38 — shared UI primitive: titled panel shell. Owner: @six-16.

import type { ReactNode } from "react";
import EmptyState from "./EmptyState";

export interface PanelProps {
  /** French panel title, rendered uppercase in the panel header. */
  title: string;
  /** Optional secondary line under the title (units, version, counts…). */
  subtitle?: ReactNode;
  /** Optional right-hand slot of the header (badges, counters, controls). */
  right?: ReactNode;
  /** Shows a pulsing accent dot next to the title while the panel is live. */
  live?: boolean;
  /** When true the body is replaced by the empty state. */
  empty?: boolean;
  /** Label of the empty state (defaults to "en attente…"). */
  emptyLabel?: string;
  /** Secondary line of the empty state. */
  emptyHint?: string;
  /** Emphasise the whole panel (used for the on-stage key moments). */
  tone?: "default" | "accent" | "alert" | "ok";
  /** Extra classes on the <section> (grid placement belongs to the caller). */
  className?: string;
  /** Extra classes on the scrolling body. */
  bodyClassName?: string;
  /** DOM id, used as an anchor by the demo script. */
  id?: string;
  children?: ReactNode;
}

const TONE_BORDER: Record<NonNullable<PanelProps["tone"]>, string> = {
  default: "border-edge",
  accent: "border-accent-dim",
  alert: "border-alert/60",
  ok: "border-ok/50",
};

/**
 * The panel shell every control-room region renders into: fixed header,
 * internally scrolling body (the page itself never scrolls), consistent
 * empty state. Purely presentational — no store access lives in components/ui.
 */
export default function Panel({
  title,
  subtitle,
  right,
  live = false,
  empty = false,
  emptyLabel,
  emptyHint,
  tone = "default",
  className = "",
  bodyClassName = "",
  id,
  children,
}: PanelProps) {
  return (
    <section
      id={id}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border bg-surface ${TONE_BORDER[tone]} ${className}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {live && (
            <span
              aria-hidden
              className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent"
            />
          )}
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-foreground">
              {title}
            </h2>
            {subtitle !== undefined && subtitle !== null && (
              <div className="truncate font-mono text-[10px] text-faint">
                {subtitle}
              </div>
            )}
          </div>
        </div>
        {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
      </header>

      <div
        className={`blaze-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 ${bodyClassName}`}
      >
        {empty ? <EmptyState label={emptyLabel} hint={emptyHint} /> : children}
      </div>
    </section>
  );
}
