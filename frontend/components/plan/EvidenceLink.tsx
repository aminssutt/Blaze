// Ticket #46 — clickable evidence reference. Owner: @six-16.
//
// Renders one `evidence_id` (re-* RadioEvent, tc-* tool call, sr-* safety
// review, plan-* plan version) as a clickable chip.
//
// CLICK BEHAVIOUR (acceptance criterion #46 "evidence links open the
// corresponding RadioEvent/tool result"):
//   1. If an element elsewhere in the control room carries
//      `data-evidence-id="<id>"`, scroll it into view and flash it. Panels
//      opt in by stamping that attribute (the plan and safety panels do).
//   2. Otherwise resolve the id against the incident store and open an
//      inline popover with the referenced RadioEvent / tool result content.
//   3. If the id resolves to nothing (yet), the popover still shows the raw
//      id so the operator can quote it — never a dead click.

"use client";

import { useEffect, useRef, useState } from "react";
import { useIncidentState } from "@/lib/session";
import { Badge, urgencyLabel, urgencyVariant, safetyLabel } from "@/components/ui";
import type { RadioEvent, SafetyReview } from "@/lib/contracts";
import type { ToolCall } from "@/lib/incidentStore";

export interface EvidenceLinkProps {
  /** The raw evidence identifier from the contract payload. */
  id: string;
  className?: string;
}

/** What an evidence id resolved to in the incident store. */
type Resolved =
  | { kind: "radio"; event: RadioEvent }
  | { kind: "tool"; call: ToolCall }
  | { kind: "review"; review: SafetyReview }
  | { kind: "unknown" };

const KIND_TEXT: Record<Resolved["kind"], string> = {
  radio: "text-src-human border-src-human-dim",
  tool: "text-info border-info/40",
  review: "text-warn border-warn/40",
  unknown: "text-faint border-edge",
};

const KIND_LABEL: Record<Resolved["kind"], string> = {
  radio: "message radio",
  tool: "appel outil",
  review: "revue sécurité",
  unknown: "référence",
};

/** Scrolls to + flashes the DOM element anchored on this evidence id. */
function focusAnchor(id: string): boolean {
  const anchor = document.querySelector<HTMLElement>(
    `[data-evidence-id="${CSS.escape(id)}"]`,
  );
  if (!anchor) return false;
  anchor.scrollIntoView({ behavior: "smooth", block: "center" });
  // WAAPI flash — no shared CSS touched, cleans itself up.
  anchor.animate(
    [
      { boxShadow: "0 0 0 2px var(--blaze-accent)", offset: 0 },
      { boxShadow: "0 0 0 2px var(--blaze-accent)", offset: 0.6 },
      { boxShadow: "0 0 0 2px transparent", offset: 1 },
    ],
    { duration: 1600, easing: "ease-out" },
  );
  return true;
}

export default function EvidenceLink({ id, className = "" }: EvidenceLinkProps) {
  const { radioEvents, toolCalls, safetyReviews } = useIncidentState();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // Close the popover on Escape (click-away is the transparent backdrop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const radio = radioEvents.find((e) => e.event_id === id);
  const call = radio ? undefined : toolCalls.find((c) => c.tool_call_id === id);
  const review =
    radio || call ? undefined : safetyReviews.find((r) => r.review_id === id);
  const resolved: Resolved = radio
    ? { kind: "radio", event: radio }
    : call
      ? { kind: "tool", call }
      : review
        ? { kind: "review", review }
        : { kind: "unknown" };

  const onClick = () => {
    if (open) {
      setOpen(false);
      return;
    }
    // Own anchor excluded: a chip inside the element it references must not
    // "scroll to itself" — fall through to the popover instead.
    const anchor = document.querySelector<HTMLElement>(
      `[data-evidence-id="${CSS.escape(id)}"]`,
    );
    if (anchor && rootRef.current && anchor.contains(rootRef.current)) {
      setOpen(true);
      return;
    }
    if (!focusAnchor(id)) setOpen(true);
  };

  return (
    <span ref={rootRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={onClick}
        title={`${KIND_LABEL[resolved.kind]} · ${id}`}
        className={`inline-flex cursor-pointer items-center whitespace-nowrap rounded-sm border bg-overlay px-1.5 py-px font-mono text-[10px] leading-4 underline decoration-dotted underline-offset-2 hover:bg-edge focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${KIND_TEXT[resolved.kind]}`}
      >
        {id}
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <span
            aria-hidden
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <span className="absolute left-0 top-full z-50 mt-1 block w-60 whitespace-normal rounded-md border border-edge-strong bg-overlay p-2 text-left shadow-lg">
            <span className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-faint">{id}</span>
              <Badge variant="neutral">{KIND_LABEL[resolved.kind]}</Badge>
            </span>

            {resolved.kind === "radio" && (
              <span className="mt-1 block">
                <span className="flex flex-wrap items-center gap-1">
                  {resolved.event.unit_id && (
                    <span className="font-mono text-[10px] text-accent">
                      {resolved.event.unit_id}
                    </span>
                  )}
                  <Badge variant={urgencyVariant(resolved.event.urgency)} filled>
                    {urgencyLabel(resolved.event.urgency)}
                  </Badge>
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-foreground">
                  {resolved.event.facts.join(" · ")}
                </span>
                <span className="mt-1 block font-mono text-[10px] italic leading-snug text-muted">
                  « {resolved.event.evidence_text} »
                </span>
              </span>
            )}

            {resolved.kind === "tool" && (
              <span className="mt-1 block">
                <span className="block font-mono text-[11px] text-info">
                  {resolved.call.tool_name}
                  {resolved.call.status ? ` · ${resolved.call.status}` : ""}
                </span>
                {resolved.call.source_name && (
                  <span className="block font-mono text-[10px] text-muted">
                    source : {resolved.call.source_name}
                  </span>
                )}
                {resolved.call.reason && (
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                    {resolved.call.reason}
                  </span>
                )}
              </span>
            )}

            {resolved.kind === "review" && (
              <span className="mt-1 block text-[11px] leading-snug text-muted">
                Revue {safetyLabel(resolved.review.status)} du plan{" "}
                <span className="font-mono">{resolved.review.plan_id}</span> —
                voir le panneau « Critique sécurité ».
              </span>
            )}

            {resolved.kind === "unknown" && (
              <span className="mt-1 block text-[11px] leading-snug text-faint">
                Référence non encore reçue dans le flux — identifiant brut
                ci-dessus.
              </span>
            )}
          </span>
        </>
      )}
    </span>
  );
}
