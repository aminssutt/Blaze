// Page /monitor — per-node terminal (Astyr AgentTerminal pattern, Blaze tokens).
//
// A terminal-STYLED live console for one pipeline node. There is no per-agent
// shell server: this replays the REAL events already reduced in the incident
// store (filtered for this node by lib/monitorPipeline.buildTerminalLines) as
// if we were watching the agent's stdout — a boot prompt, event lines tagged
// and coloured by family, indented audit sub-lines (⇒ / ✗ / ⚠ / ↳), the
// newest line typing in under a blinking block cursor, a "reasoning…" row
// while the node is active and an "awaiting orchestration…" waiting state on
// standby. Reduced-motion safe: typing and blinking collapse to the final
// frame (lib/useTypewriter + the blaze-term-cursor CSS media query).

"use client";

import { useEffect, useMemo, useRef } from "react";
import type { MonitorNodeInfo, NodeStatus, TermLine } from "@/lib/monitorPipeline";
import { isTerminalEmpty } from "@/lib/monitorPipeline";
import { useTypewriter } from "@/lib/useTypewriter";

/** Per-glyph accent of the audit sub-lines (see lib/monitorPipeline). */
function outClass(text: string): string {
  const t = text.trimStart();
  if (t.startsWith("⇒")) return "pl-[3.2em] text-ok";
  if (t.startsWith("✗")) return "pl-[3.2em] text-alert";
  if (t.startsWith("⚠")) return "pl-[3.2em] text-warn";
  if (t.startsWith("↳")) return "pl-[3.2em] text-faint";
  return "pl-[3.2em] text-muted";
}

/** Blinking block cursor — amber, steps() blink, static under reduced motion. */
function Cursor() {
  return (
    <span
      aria-hidden
      className="blaze-term-cursor ml-0.5 inline-block h-[1.05em] w-[0.55em] translate-y-[0.18em] bg-accent align-baseline"
    />
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {[0, 0.2, 0.4].map((delay) => (
        <span
          key={delay}
          className="blaze-term-dot inline-block"
          style={{ animationDelay: `${delay}s` }}
        >
          .
        </span>
      ))}
    </span>
  );
}

const STATUS_DOT: Record<NodeStatus, { cls: string; label: string }> = {
  standby: { cls: "bg-faint/40", label: "standby" },
  active: { cls: "bg-info animate-pulse", label: "working" },
  done: { cls: "bg-ok", label: "done" },
};

export default function NodeTerminal({
  info,
  status,
  lines,
}: {
  info: MonitorNodeInfo;
  status: NodeStatus;
  lines: TermLine[];
}) {
  const waiting = isTerminalEmpty(lines);
  const working = status === "active";
  const dot = STATUS_DOT[status];

  // Typewriter on the NEWEST line only — earlier lines render in full. The
  // hook keys on content and honours prefers-reduced-motion internally.
  const last = lines[lines.length - 1];
  const typed = useTypewriter(last.text, { charsPerSecond: 90 });

  // Auto-scroll to the freshest line as it streams in.
  const bodyRef = useRef<HTMLDivElement>(null);
  const lineCount = lines.length;
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lineCount, typed.text]);

  const slugged = useMemo(
    () => info.id.replace("tool:", "tool-").replace(/[_:]/g, "-"),
    [info.id],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border border-edge bg-background">
      {/* chrome bar */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-edge bg-surface px-3 py-2">
        <span className="flex items-center gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-alert/60" />
          <span className="size-2.5 rounded-full bg-warn/60" />
          <span className="size-2.5 rounded-full bg-ok/60" />
        </span>
        <span className="truncate font-mono text-[11px] text-muted">
          agent://{slugged}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${dot.cls}`} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            {dot.label}
          </span>
        </span>
      </div>

      {/* body */}
      <div
        ref={bodyRef}
        className="blaze-scroll relative min-h-0 flex-1 overflow-y-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed"
      >
        {/* scanline + grid texture, amberized on the Blaze background */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(rgba(245,158,11,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.02) 1px, transparent 1px)",
            backgroundSize: "100% 3px, 32px 100%",
          }}
        />

        <div className="relative flex flex-col gap-0.5">
          {lines.map((line, i) => {
            const isLast = i === lines.length - 1;
            const shown = isLast ? typed.text : line.text;
            // While the node works, the cursor lives on the "reasoning…" row
            // below; when idle/done it caps the last printed line.
            const cursorHere = isLast && !working;
            if (line.kind === "cmd") {
              return (
                <p key={line.id} className="flex items-baseline gap-2">
                  <span className="shrink-0 text-faint">$</span>
                  <span className={`shrink-0 ${line.tagClass}`}>{line.tag}</span>
                  <span className="min-w-0 break-words text-foreground/90">
                    {shown}
                    {cursorHere && <Cursor />}
                  </span>
                  <span className="ml-auto shrink-0 pl-3 text-[10px] text-faint">
                    {line.ts}
                  </span>
                </p>
              );
            }
            const cls =
              line.kind === "meta"
                ? "text-muted"
                : line.kind === "comment"
                  ? "italic text-faint"
                  : outClass(line.text);
            return (
              <p key={line.id} className={`break-words ${cls}`}>
                {shown}
                {cursorHere && <Cursor />}
              </p>
            );
          })}

          {/* live thinking row — the node is still working, more streams in */}
          {working && !waiting && (
            <p className="mt-1 flex items-center gap-2 text-info">
              <span className="text-faint">$</span>
              <span>reasoning</span>
              <ThinkingDots />
              <Cursor />
            </p>
          )}

          {waiting && (
            <div className="mt-3 flex items-center gap-2 text-muted">
              <span
                className={`size-1.5 rounded-full ${working ? "bg-info animate-pulse" : "bg-faint/50"}`}
              />
              <span>awaiting orchestration</span>
              <ThinkingDots />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
