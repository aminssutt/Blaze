// Ticket #38 — shared UI primitive: empty state. Owner: @six-16.

export interface EmptyStateProps {
  /** Main line. Defaults to the control-room standard "en attente…". */
  label?: string;
  /** Optional second line explaining what is being waited for. */
  hint?: string;
}

/**
 * The one placeholder used everywhere before events arrive. Honest by
 * construction: it never shows fabricated sample data.
 */
export default function EmptyState({
  label = "en attente…",
  hint,
}: EmptyStateProps) {
  return (
    <div className="flex h-full min-h-12 flex-col items-center justify-center gap-1 py-4 text-center">
      <span className="font-mono text-[11px] text-faint">{label}</span>
      {hint && <span className="font-mono text-[10px] text-faint/70">{hint}</span>}
    </div>
  );
}
