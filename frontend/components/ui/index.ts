// Ticket #38 — shared UI primitives barrel. Owner: @six-16.
//
// Presentational, prop-driven components only: NOTHING in components/ui/
// reads the incident store. Panels (#40–#51) import from "@/components/ui".

export { default as AudioPlayer } from "./AudioPlayer";
export type { AudioPlayerProps } from "./AudioPlayer";
export { default as Panel } from "./Panel";
export type { PanelProps } from "./Panel";
export type { PanelComponentProps } from "./panelProps";

export {
  default as Badge,
  confirmationLabel,
  confirmationVariant,
  dispatchStatusLabel,
  dispatchStatusVariant,
  safetyLabel,
  safetyVariant,
  toolStatusVariant,
  urgencyLabel,
  urgencyVariant,
} from "./Badge";
export type { BadgeProps, BadgeVariant } from "./Badge";

export { default as SourceBadge, sourceLabel, sourceTitle } from "./SourceBadge";
export type { SourceBadgeProps } from "./SourceBadge";

export { default as StatusDot } from "./StatusDot";
export type { StatusDotProps, StatusTone } from "./StatusDot";

export { default as StatusPill } from "./StatusPill";
export type { PillLevel, StatusPillProps } from "./StatusPill";

export { default as Chip } from "./Chip";
export type { ChipProps, ChipTone } from "./Chip";

export { default as Meter } from "./Meter";
export type { MeterProps, MeterTone } from "./Meter";

export { default as EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";
