// Page /monitor — the live pipeline graph (Astyr AgentGraph pattern, Blaze
// tokens). Two bands map 1:1 onto the real event flow:
//   ACQUISITION — Ingestion → STT → Radio Intelligence →
//                 Situation Context (+ the 7 tool mini-nodes);
//   DÉCISION    — Tactical Planning → Safety Critic → HUMAN GATE
//                 (special amber node) → Dispatch → TTS.
// Each node carries a two-letter monogram badge (RA, ST, RI, SC, TP, SG, HG,
// DP, TT — tools WX/EL/FS/CA/OS/RT/RS); the state colours carry the meaning.
// Node statuses (standby / active / done) are DERIVED from the store by
// lib/monitorPipeline.deriveNodeStatuses — this component only renders.
// Connectors take the colour of their target's status and stream an animated
// dash-flow + travelling token while the target works; a dashed warn-coloured
// return edge (Safety Critic → Planning) lights up once a plan revision has
// been requested. Desktop: a fixed canvas scaled to fit (ResizeObserver).
// Mobile (<lg): the same nodes as a vertical stacked pipeline, no horizontal
// scroll. Reduced-motion: flows and pulses are static (CSS media queries).
//
// CLICK AFFORDANCE — every node OPENS (its terminal + expert pane), and the
// page auto-plays, so nothing but the card itself can say so. Three layers:
// a quiet corner glyph present from the first frame on every node, an amber
// outline shared by :hover and :focus-visible (mouse and keyboard get the very
// same cue), and — only while `coach` is true, i.e. the visitor has never
// opened a node — an "inspect" chip on the node that is currently working.



"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  NODE_INFO,
  PIPELINE_NODE_IDS,
  TOOL_NODES,
  toolNodeId,
  type MonitorNodeId,
  type NodeStatus,
  type PipelineNodeId,
} from "@/lib/monitorPipeline";
import InspectGlyph from "./InspectGlyph";

const CANVAS = { width: 1240, height: 600 };

type Rect = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

/* Row 1 — acquisition band. */
const ROW1_Y = 64;
const ROW1_H = 112;
/* Row 2 — decision band. */
const ROW2_Y = 396;
const ROW2_H = 128;
/* Tool mini-node column, to the right of Situation Context. */
const TOOL_X = 1046;
const TOOL_W = 176;
const TOOL_H = 32;
const TOOL_Y0 = 36;
const TOOL_GAP = 44;

const RECT: Record<PipelineNodeId, Rect> = {
  ingestion: { x: 24, y: ROW1_Y, w: 180, h: ROW1_H },
  stt: { x: 264, y: ROW1_Y, w: 170, h: ROW1_H },
  radio_intelligence: { x: 494, y: ROW1_Y, w: 200, h: ROW1_H },
  situation_context: { x: 754, y: ROW1_Y, w: 210, h: ROW1_H },
  tactical_planning: { x: 24, y: ROW2_Y, w: 210, h: ROW2_H },
  safety_critic: { x: 288, y: ROW2_Y, w: 204, h: ROW2_H },
  human_gate: { x: 546, y: ROW2_Y, w: 220, h: ROW2_H },
  dispatch: { x: 820, y: ROW2_Y, w: 196, h: ROW2_H },
  tts: { x: 1070, y: ROW2_Y, w: 152, h: ROW2_H },
};

function toolRect(index: number): Rect {
  return { x: TOOL_X, y: TOOL_Y0 + index * TOOL_GAP, w: TOOL_W, h: TOOL_H };
}

function mid(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function roundedOrthogonalPath(points: Point[], radius = 12): string {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inDir = { x: Math.sign(corner.x - prev.x), y: Math.sign(corner.y - prev.y) };
    const outDir = { x: Math.sign(next.x - corner.x), y: Math.sign(next.y - corner.y) };
    const inLen = Math.abs(corner.x - prev.x) + Math.abs(corner.y - prev.y);
    const outLen = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    d += ` L ${corner.x - inDir.x * r} ${corner.y - inDir.y * r}`;
    d += ` Q ${corner.x} ${corner.y} ${corner.x + outDir.x * r} ${corner.y + outDir.y * r}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/* Main-flow links (source → target); connector colour follows the TARGET. */
type Link = { from: MonitorNodeId; to: MonitorNodeId; points: Point[] };

function chainLink(from: PipelineNodeId, to: PipelineNodeId): Link {
  const a = RECT[from];
  const b = RECT[to];
  return {
    from,
    to,
    points: [
      { x: a.x + a.w, y: mid(a).y },
      { x: b.x, y: mid(b).y },
    ],
  };
}

const WRAP_Y = 300; // corridor between the two bands

const LINKS: Link[] = [
  chainLink("ingestion", "stt"),
  chainLink("stt", "radio_intelligence"),
  chainLink("radio_intelligence", "situation_context"),
  // Situation Context wraps down-left into the decision band.
  {
    from: "situation_context",
    to: "tactical_planning",
    points: [
      { x: mid(RECT.situation_context).x, y: ROW1_Y + ROW1_H },
      { x: mid(RECT.situation_context).x, y: WRAP_Y },
      { x: mid(RECT.tactical_planning).x, y: WRAP_Y },
      { x: mid(RECT.tactical_planning).x, y: ROW2_Y },
    ],
  },
  chainLink("tactical_planning", "safety_critic"),
  chainLink("safety_critic", "human_gate"),
  chainLink("human_gate", "dispatch"),
  chainLink("dispatch", "tts"),
  // Tool fan-out: Situation Context → each mini-node.
  ...TOOL_NODES.map((tool, i): Link => {
    const target = toolRect(i);
    return {
      from: "situation_context",
      to: toolNodeId(tool.name),
      points: [
        { x: RECT.situation_context.x + RECT.situation_context.w, y: mid(RECT.situation_context).y },
        { x: (RECT.situation_context.x + RECT.situation_context.w + TOOL_X) / 2, y: mid(RECT.situation_context).y },
        { x: (RECT.situation_context.x + RECT.situation_context.w + TOOL_X) / 2, y: target.y + TOOL_H / 2 },
        { x: target.x, y: target.y + TOOL_H / 2 },
      ],
    };
  }),
];

/* The Safety Critic → Planning revision loop (dashed, warn-coloured). */
const REVISION_PATH = roundedOrthogonalPath([
  { x: mid(RECT.safety_critic).x, y: ROW2_Y + ROW2_H },
  { x: mid(RECT.safety_critic).x, y: ROW2_Y + ROW2_H + 40 },
  { x: mid(RECT.tactical_planning).x + 40, y: ROW2_Y + ROW2_H + 40 },
  { x: mid(RECT.tactical_planning).x + 40, y: ROW2_Y + ROW2_H },
]);

/* Status → visual treatment. "Working" is info-blue (the control-room
   convention of the trace panel); done is ok-green; the HUMAN GATE overrides
   with the amber commander identity while it awaits the decision. */
const STATUS_STYLE: Record<
  NodeStatus,
  { card: string; text: string; label: string; glow: string }
> = {
  standby: {
    card: "border-edge bg-surface",
    text: "text-faint",
    label: "standby",
    glow: "none",
  },
  active: {
    card: "border-info bg-surface",
    text: "text-info",
    label: "working",
    glow: "0 0 30px -6px rgba(56,189,248,0.55)",
  },
  done: {
    card: "border-ok/60 bg-ok-dim/20",
    text: "text-ok",
    label: "done",
    glow: "0 0 18px -8px rgba(34,197,94,0.45)",
  },
};

const GATE_ACTIVE_GLOW = "0 0 34px -4px rgba(245,158,11,0.6)";

function linkColor(status: NodeStatus): string {
  if (status === "active") return "var(--blaze-info)";
  if (status === "done") return "var(--blaze-ok)";
  return "var(--blaze-border-strong)";
}

function WorkingDots() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden>
      {[0, 0.2, 0.4].map((delay) => (
        <span
          key={delay}
          className="blaze-term-dot size-1 rounded-full bg-current"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Click affordance                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Shared interactive treatment of every node button.
 *
 * OUTLINE, NOT RING — the cards animate `boxShadow` through motion (inline
 * style), and Tailwind's `ring-*` compiles to box-shadow, so a ring is silently
 * overwritten by the status glow. `outline` is a different property: it always
 * shows, it takes the same value on hover and on focus-visible (keyboard parity
 * for free) and it costs no layout.
 */
const INTERACTIVE = [
  "group cursor-pointer outline-offset-2",
  "transition-[outline-color,border-color] duration-200",
  "hover:outline-2 hover:outline-accent/80",
  "focus-visible:outline-2 focus-visible:outline-accent",
].join(" ");

/** Selected node — foreground outline, distinct from the amber hover/focus. */
const SELECTED_OUTLINE = "outline-2 outline-foreground";

/**
 * The "this card opens" mark carried by every node.
 *
 * At rest it is a quiet corner glyph — present from the first frame (a
 * hover-only affordance is invisible to someone who never hovers) yet dim
 * enough to disappear into the card once understood. On hover OR keyboard
 * focus it turns amber, in sync with the outline.
 *
 * `amplified` is the first-run state: on the node that is CURRENTLY working —
 * the one the eye is already on — the glyph grows into a labelled "inspect"
 * chip that breathes, so the click is offered exactly when it is interesting.
 * It reverts to the quiet glyph for good once the visitor has opened a node.
 * Reduced motion: same chip, no breathing.
 */
function InspectAffordance({
  amplified,
  reduce,
}: {
  amplified: boolean;
  reduce: boolean | null;
}) {
  if (amplified)
    return (
      <motion.span
        aria-hidden
        className="pointer-events-none absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-sm border border-accent bg-accent-dim/50 px-1.5 py-[3px] font-mono text-[9px] font-semibold uppercase leading-none tracking-[0.1em] text-accent"
        animate={reduce ? undefined : { opacity: [1, 0.55, 1] }}
        transition={{ duration: 1.8, ease: "easeInOut", repeat: Infinity }}
      >
        <InspectGlyph size={9} />
        inspect
      </motion.span>
    );
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-sm border border-edge-strong bg-overlay/70 text-faint opacity-70 transition-[color,border-color,opacity] duration-200 group-hover:border-accent group-hover:text-accent group-hover:opacity-100 group-focus-visible:border-accent group-focus-visible:text-accent group-focus-visible:opacity-100"
    >
      <InspectGlyph size={9} />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Node card (shared desktop/mobile content)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Two-letter monogram badge — the professional replacement of node emojis.
 * Discreet by design: the node state (border/background colours) keeps
 * carrying the meaning; the badge only identifies the node.
 */
function MonogramBadge({ mono, size = "md" }: { mono: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-sm border border-edge-strong bg-overlay font-mono font-semibold tracking-[0.08em] text-muted ${
        size === "sm" ? "size-5 text-[9px]" : "size-7 text-[11px]"
      }`}
    >
      {mono}
    </span>
  );
}

function NodeCardContent({
  id,
  status,
  compact,
}: {
  id: PipelineNodeId;
  status: NodeStatus;
  compact?: boolean;
}) {
  const info = NODE_INFO[id];
  const isGate = id === "human_gate";
  const style = STATUS_STYLE[status];
  const gateActive = isGate && status === "active";
  const statusText = gateActive ? "decision pending" : style.label;
  const statusCls = gateActive ? "text-accent" : style.text;
  return (
    <>
      <MonogramBadge mono={info.mono} size={compact ? "sm" : "md"} />
      <span className="flex min-w-0 flex-col items-center gap-0.5">
        <span
          className={`leading-tight text-foreground ${compact ? "text-[12px]" : "text-[13px]"} font-semibold`}
        >
          {info.label}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
          {info.kind === "agent"
            ? "gemma agent"
            : info.kind === "human"
              ? "human-in-the-loop"
              : "service"}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${statusCls}`}
        >
          {statusText}
          {status === "active" && <WorkingDots />}
        </span>
      </span>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Graph                                                                      */
/* -------------------------------------------------------------------------- */

export default function PipelineGraph({
  statuses,
  revisionRequested,
  selected,
  onSelect,
  coach = false,
}: {
  statuses: Record<MonitorNodeId, NodeStatus>;
  revisionRequested: boolean;
  selected: MonitorNodeId | null;
  onSelect: (id: MonitorNodeId | null) => void;
  /** True while the visitor has never opened a node — amplifies the affordance. */
  coach?: boolean;
}) {
  const reduce = useReducedMotion();

  // Fit-to-container scaling of the fixed canvas (Astyr pattern).
  const fitRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0)
        setScale(Math.min(1, width / CANVAS.width, height / CANVAS.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const planningActive = statuses.tactical_planning === "active";

  return (
    <>
      {/* ── DESKTOP (≥lg): fit-to-width canvas ─────────────────────────────── */}
      <div className="hidden h-full min-h-0 w-full lg:flex">
        <div ref={fitRef} className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
          <div
            className="relative shrink-0"
            style={{
              width: CANVAS.width,
              height: CANVAS.height,
              transform: `scale(${scale})`,
              transformOrigin: "center",
            }}
          >
            {/* band captions */}
            <span
              className="pointer-events-none absolute font-mono text-[11px] uppercase tracking-[0.18em] text-faint"
              style={{ left: RECT.ingestion.x, top: ROW1_Y - 26 }}
            >
              Acquisition · the field becomes facts
            </span>
            <span
              className="pointer-events-none absolute font-mono text-[11px] uppercase tracking-[0.18em] text-faint"
              style={{ left: RECT.tactical_planning.x, top: ROW2_Y - 26 }}
            >
              Decision · from plan to dispatch
            </span>
            <span
              className="pointer-events-none absolute font-mono text-[10px] uppercase tracking-[0.18em] text-faint"
              style={{ left: TOOL_X, top: TOOL_Y0 - 22 }}
            >
              Allowlisted tools
            </span>

            <svg
              className="pointer-events-none absolute inset-0"
              viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
              width={CANVAS.width}
              height={CANVAS.height}
            >
              {LINKS.map((link) => {
                const targetStatus = statuses[link.to] ?? "standby";
                const color = linkColor(targetStatus);
                const d = roundedOrthogonalPath(link.points);
                const flowing = targetStatus === "active";
                const isToolLink = link.to.startsWith("tool:");
                const ends = [link.points[0], link.points[link.points.length - 1]];
                return (
                  <g key={`${link.from}-${link.to}`}>
                    <path
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={isToolLink ? 1.5 : 2.5}
                      style={{ transition: "stroke 0.4s ease" }}
                    />
                    {/* live handoff beam — dash-flow into the working node */}
                    {flowing && (
                      <path
                        d={d}
                        fill="none"
                        stroke="var(--blaze-info)"
                        strokeWidth={isToolLink ? 2 : 3}
                        strokeLinecap="round"
                        strokeDasharray="5 11"
                        className={reduce ? "" : "blaze-dash-flow"}
                        opacity={0.95}
                      />
                    )}
                    {/* travelling token — the state moving between nodes */}
                    {flowing && !reduce && (
                      <circle r={isToolLink ? 3.5 : 5} fill="var(--blaze-info)">
                        <animateMotion dur="1.15s" repeatCount="indefinite" path={d} />
                      </circle>
                    )}
                    {ends.map((dot, i) => (
                      <circle
                        key={i}
                        cx={dot.x}
                        cy={dot.y}
                        r={isToolLink ? 3.5 : 5}
                        fill="var(--blaze-bg)"
                        stroke={color}
                        strokeWidth={2}
                        style={{ transition: "stroke 0.4s ease" }}
                      />
                    ))}
                  </g>
                );
              })}

              {/* revision loop — visible once a plan.revision.requested landed */}
              {revisionRequested && (
                <g>
                  <path
                    d={REVISION_PATH}
                    fill="none"
                    stroke="var(--blaze-warn)"
                    strokeWidth={2}
                    strokeDasharray="6 6"
                    className={planningActive && !reduce ? "blaze-dash-flow" : ""}
                    opacity={0.8}
                  />
                  <text
                    x={(mid(RECT.tactical_planning).x + mid(RECT.safety_critic).x) / 2}
                    y={ROW2_Y + ROW2_H + 56}
                    fill="var(--blaze-warn)"
                    fontSize={10}
                    fontFamily="var(--blaze-font-mono)"
                    textAnchor="middle"
                  >
                    revision requested
                  </text>
                </g>
              )}
            </svg>

            {/* main pipeline nodes */}
            {PIPELINE_NODE_IDS.map((id) => {
              const status = statuses[id] ?? "standby";
              const style = STATUS_STYLE[status];
              const rect = RECT[id];
              const isSelected = id === selected;
              const working = status === "active";
              const isGate = id === "human_gate";
              const gateActive = isGate && status === "active";
              const card = gateActive
                ? "border-accent bg-accent-dim/25"
                : isGate && status === "standby"
                  ? "border-accent-dim/60 bg-surface"
                  : style.card;
              return (
                <motion.button
                  key={id}
                  type="button"
                  onClick={() => onSelect(isSelected ? null : id)}
                  title={`${NODE_INFO[id].role} — click to open its terminal`}
                  aria-label={`${NODE_INFO[id].label} — open agent terminal`}
                  className={[
                    "absolute flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md border-2 p-2 text-center",
                    INTERACTIVE,
                    card,
                    isSelected ? SELECTED_OUTLINE : "",
                  ].join(" ")}
                  style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                  animate={{
                    boxShadow: gateActive ? GATE_ACTIVE_GLOW : style.glow,
                    opacity: status === "standby" && !isGate ? 0.65 : 1,
                    scale: working ? 1.03 : 1,
                  }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  {/* working overlays — pulsing ring + shimmer sweep */}
                  {working && !reduce && (
                    <>
                      <motion.span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-md border-2"
                        style={{
                          borderColor: gateActive
                            ? "var(--blaze-accent)"
                            : "var(--blaze-info)",
                        }}
                        initial={{ opacity: 0.6, scale: 1 }}
                        animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.06, 1] }}
                        transition={{ duration: 1.9, ease: "easeInOut", repeat: Infinity }}
                      />
                      <motion.span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 w-1/2"
                        style={{
                          background: gateActive
                            ? "linear-gradient(100deg, transparent, rgba(245,158,11,0.14), transparent)"
                            : "linear-gradient(100deg, transparent, rgba(56,189,248,0.12), transparent)",
                        }}
                        initial={{ x: "-140%" }}
                        animate={{ x: "260%" }}
                        transition={{ duration: 1.8, ease: "easeInOut", repeat: Infinity }}
                      />
                    </>
                  )}
                  <InspectAffordance
                    amplified={coach && working && !isSelected}
                    reduce={reduce}
                  />
                  <NodeCardContent id={id} status={status} />
                </motion.button>
              );
            })}

            {/* tool mini-nodes */}
            {TOOL_NODES.map((tool, i) => {
              const id = toolNodeId(tool.name);
              const status = statuses[id] ?? "standby";
              const style = STATUS_STYLE[status];
              const rect = toolRect(i);
              const isSelected = id === selected;
              return (
                <motion.button
                  key={id}
                  type="button"
                  onClick={() => onSelect(isSelected ? null : id)}
                  title={`${tool.name} tool — click to open its terminal`}
                  aria-label={`${tool.name} tool — open terminal`}
                  className={[
                    "absolute flex items-center gap-2 rounded-sm border px-2 text-left",
                    INTERACTIVE,
                    style.card,
                    isSelected ? SELECTED_OUTLINE : "",
                  ].join(" ")}
                  style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                  animate={{
                    boxShadow: status === "active" ? STATUS_STYLE.active.glow : "none",
                    opacity: status === "standby" ? 0.55 : 1,
                  }}
                  transition={{ duration: 0.3 }}
                >
                  <MonogramBadge mono={tool.mono} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">
                    {tool.name}
                  </span>
                  <span className={`font-mono text-[9px] uppercase ${style.text}`}>
                    {status === "active" ? "…" : status === "done" ? "ok" : "—"}
                  </span>
                  <span
                    aria-hidden
                    className="text-faint opacity-60 transition-[color,opacity] duration-200 group-hover:text-accent group-hover:opacity-100 group-focus-visible:text-accent group-focus-visible:opacity-100"
                  >
                    <InspectGlyph size={9} />
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── MOBILE (<lg): vertical stacked pipeline ────────────────────────── */}
      <div className="flex w-full flex-col p-3 lg:hidden">
        {PIPELINE_NODE_IDS.map((id, index) => {
          const status = statuses[id] ?? "standby";
          const style = STATUS_STYLE[status];
          const isGate = id === "human_gate";
          const gateActive = isGate && status === "active";
          return (
            <Fragment key={id}>
              {index > 0 && (
                <div className="flex h-4 items-stretch justify-center" aria-hidden>
                  <span
                    className={`w-[2px] rounded-full ${status === "active" && !reduce ? "animate-pulse" : ""}`}
                    style={{ background: linkColor(status) }}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => onSelect(id === selected ? null : id)}
                aria-label={`${NODE_INFO[id].label} — open agent terminal`}
                className={[
                  "relative flex w-full items-center gap-3 rounded-md border-2 p-2.5 pr-9 text-left",
                  INTERACTIVE,
                  gateActive ? "border-accent bg-accent-dim/25" : style.card,
                  id === selected ? SELECTED_OUTLINE : "",
                ].join(" ")}
                style={{ opacity: status === "standby" && !isGate ? 0.65 : 1 }}
              >
                <NodeCardContent id={id} status={status} compact />
                <InspectAffordance
                  amplified={coach && status === "active" && id !== selected}
                  reduce={reduce}
                />
              </button>
              {/* tool chips under Situation Context */}
              {id === "situation_context" && (
                <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                  {TOOL_NODES.map((tool) => {
                    const tid = toolNodeId(tool.name);
                    const tStatus = statuses[tid] ?? "standby";
                    return (
                      <button
                        key={tid}
                        type="button"
                        onClick={() => onSelect(tid === selected ? null : tid)}
                        aria-label={`${tool.name} tool — open terminal`}
                        className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${INTERACTIVE} ${STATUS_STYLE[tStatus].card} ${STATUS_STYLE[tStatus].text} ${tid === selected ? SELECTED_OUTLINE : ""}`}
                      >
                        <span aria-hidden className="font-semibold">
                          {tool.mono}
                        </span>
                        {tool.name}
                        <InspectGlyph
                          size={8}
                          className="text-faint opacity-70 group-hover:text-accent group-focus-visible:text-accent"
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </>
  );
}
