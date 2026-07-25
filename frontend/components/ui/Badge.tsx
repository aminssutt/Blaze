// Ticket #38 — shared UI primitive: badge. Owner: @six-16.

import type { ReactNode } from "react";
import type {
  ConfirmationStatus,
  DispatchStatus,
  Priority,
  SafetyReviewStatus,
  ToolResultStatus,
} from "@/lib/contracts";

export type BadgeVariant =
  | "neutral"
  | "ok"
  | "warn"
  | "alert"
  | "info"
  | "accent";

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  /** Outline only (default) or filled — filled draws more attention. */
  filled?: boolean;
  /** Native tooltip, e.g. the untranslated contract value. */
  title?: string;
  className?: string;
}

const VARIANT: Record<BadgeVariant, { outline: string; filled: string }> = {
  neutral: {
    outline: "border-edge-strong text-muted",
    filled: "border-edge-strong bg-overlay text-foreground",
  },
  ok: { outline: "border-ok/50 text-ok", filled: "border-ok/60 bg-ok-dim text-ok" },
  warn: {
    outline: "border-warn/50 text-warn",
    filled: "border-warn/60 bg-warn/20 text-warn",
  },
  alert: {
    outline: "border-alert/60 text-alert",
    filled: "border-alert/70 bg-alert-dim text-alert",
  },
  info: {
    outline: "border-info/50 text-info",
    filled: "border-info/60 bg-info/20 text-info",
  },
  accent: {
    outline: "border-accent-dim text-accent",
    filled: "border-accent bg-accent-dim/50 text-accent",
  },
};

/** Compact status label. Presentational only — the caller picks the variant. */
export default function Badge({
  children,
  variant = "neutral",
  filled = false,
  title,
  className = "",
}: BadgeProps) {
  const style = filled ? VARIANT[variant].filled : VARIANT[variant].outline;
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-px font-mono text-[10px] leading-4 ${style} ${className}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Contract value -> variant mappings (shared so panels stay consistent)      */
/* -------------------------------------------------------------------------- */

/** Priority / urgency scale (RadioEvent, UnitAction, DispatchInstruction). */
export function urgencyVariant(priority: Priority): BadgeVariant {
  switch (priority) {
    case "critical":
      return "alert";
    case "high":
      return "accent";
    case "medium":
      return "warn";
    case "low":
      return "neutral";
  }
}

/** French label for the urgency scale. */
export function urgencyLabel(priority: Priority): string {
  switch (priority) {
    case "critical":
      return "critique";
    case "high":
      return "haute";
    case "medium":
      return "moyenne";
    case "low":
      return "basse";
  }
}

/** RadioEvent.confirmation_status. */
export function confirmationVariant(status: ConfirmationStatus): BadgeVariant {
  switch (status) {
    case "confirmed":
      return "ok";
    case "reported":
      return "info";
    case "inferred":
      return "warn";
  }
}

/** French label for RadioEvent.confirmation_status. */
export function confirmationLabel(status: ConfirmationStatus): string {
  switch (status) {
    case "confirmed":
      return "confirmé";
    case "reported":
      return "signalé";
    case "inferred":
      return "déduit";
  }
}

/** SafetyReview.status — the on-stage "revise" moment must read as a warning. */
export function safetyVariant(status: SafetyReviewStatus): BadgeVariant {
  switch (status) {
    case "pass":
      return "ok";
    case "revise":
      return "warn";
    case "block":
      return "alert";
  }
}

/** French label for SafetyReview.status. */
export function safetyLabel(status: SafetyReviewStatus): string {
  switch (status) {
    case "pass":
      return "validé";
    case "revise":
      return "à réviser";
    case "block":
      return "bloqué";
  }
}

/** ToolResult.status. */
export function toolStatusVariant(status: ToolResultStatus): BadgeVariant {
  switch (status) {
    case "success":
      return "ok";
    case "fallback":
      return "warn";
    case "timeout":
      return "warn";
    case "error":
      return "alert";
  }
}

/** DispatchInstruction.dispatch_status. */
export function dispatchStatusVariant(status: DispatchStatus): BadgeVariant {
  switch (status) {
    case "acknowledged":
      return "ok";
    case "sent":
      return "info";
    case "ready":
      return "accent";
    case "tts_generating":
      return "warn";
    case "pending":
      return "neutral";
    case "failed":
      return "alert";
  }
}

/** French label for DispatchInstruction.dispatch_status. */
export function dispatchStatusLabel(status: DispatchStatus): string {
  switch (status) {
    case "acknowledged":
      return "accusé";
    case "sent":
      return "transmis";
    case "ready":
      return "prêt";
    case "tts_generating":
      return "synthèse…";
    case "pending":
      return "en attente";
    case "failed":
      return "échec";
  }
}
