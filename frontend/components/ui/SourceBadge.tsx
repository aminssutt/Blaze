// Ticket #38 — shared UI primitive: provenance badge. Owner: @six-16.

import type { SourceType } from "@/lib/contracts";

/**
 * PRODUCT INVARIANT #2 — every datum shown in the control room carries its
 * provenance. This badge is the single rendering of the 5 `SourceType`
 * values: one distinct colour (design/tokens.css `--blaze-src-*`), one short
 * French label, one explanatory tooltip. Every panel must use it rather than
 * inventing its own provenance styling.
 */
interface SourceStyle {
  /** Short uppercase French label shown in the badge. */
  label: string;
  /** Tooltip: what the provenance category actually means. */
  title: string;
  /** Token-mapped Tailwind classes (never a raw hex). */
  className: string;
}

const SOURCE_STYLES: Record<SourceType, SourceStyle> = {
  live_public: {
    label: "direct",
    title: "live_public — donnée publique récupérée en direct",
    className: "border-src-live/60 bg-src-live-dim/40 text-src-live",
  },
  cached_public: {
    label: "cache",
    title: "cached_public — donnée publique servie depuis le cache local",
    className: "border-src-cached/60 bg-src-cached-dim/40 text-src-cached",
  },
  seeded_demo: {
    label: "démo",
    title: "seeded_demo — donnée de scénario préchargée pour la démonstration",
    className: "border-src-seeded/60 bg-src-seeded-dim/40 text-src-seeded",
  },
  human_report: {
    label: "radio",
    title: "human_report — signalement humain issu d'un message radio",
    className: "border-src-human/60 bg-src-human-dim/40 text-src-human",
  },
  model_inference: {
    label: "modèle",
    title:
      "model_inference — inférence produite par le modèle, non vérifiée sur le terrain",
    className: "border-src-model/60 bg-src-model-dim/40 text-src-model",
  },
};

export interface SourceBadgeProps {
  source: SourceType;
  /** Human-readable source appended to the tooltip (e.g. "open-meteo"). */
  sourceName?: string | null;
  /** Adds a "· cache" marker for results served from the local cache. */
  cached?: boolean | null;
  className?: string;
}

/** Provenance badge for one of the 5 SourceType values. */
export default function SourceBadge({
  source,
  sourceName,
  cached,
  className = "",
}: SourceBadgeProps) {
  const style = SOURCE_STYLES[source];
  const title = sourceName ? `${style.title} — ${sourceName}` : style.title;

  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 py-px font-mono text-[10px] uppercase leading-4 tracking-wider ${style.className} ${className}`}
    >
      {style.label}
      {cached ? <span className="ml-1 opacity-70">·c</span> : null}
    </span>
  );
}

/** The short French label of a SourceType, for dense inline contexts. */
export function sourceLabel(source: SourceType): string {
  return SOURCE_STYLES[source].label;
}

/** The explanatory tooltip of a SourceType. */
export function sourceTitle(source: SourceType): string {
  return SOURCE_STYLES[source].title;
}
