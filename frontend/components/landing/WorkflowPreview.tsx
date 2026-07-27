// Landing — demo-orientation teaser as a LIVE miniature of /workflow.
//
// Instead of telling visitors "click any agent", this auto-playing loop SHOWS
// the gesture: a focus ring glides onto a mini agent node (RI - TP - SG - DP),
// the node pulses as if clicked, a miniature terminal springs open beneath the
// row (chrome bar, agent:// slug, scanline texture — a lightweight recreation
// of monitor/NodeTerminal, no imports from it), two or three realistic lines
// type in under an amber block cursor, hold, close, next node. ~13 s/loop.
//
// The whole preview links to /workflow. The loop only runs while in the
// viewport (useInView; timers cleaned up when scrolled away) and collapses to
// a single static open terminal under prefers-reduced-motion.

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";

type PreviewAgent = {
  mono: string;
  label: string;
  slug: string;
  lines: string[];
};

const AGENTS: PreviewAgent[] = [
  {
    mono: "RI",
    label: "Radio Intelligence",
    slug: "radio-intelligence",
    lines: [
      "$ extract re-001 · alpha-3",
      "⚠ explosions heard, unconfirmed",
      "⇒ evidence quoted from transcript",
    ],
  },
  {
    mono: "TP",
    label: "Tactical Planning",
    slug: "tactical-planning",
    lines: [
      "$ draft plan v2",
      "⇒ alpha-3 — retreat via North Access",
      "↳ evidence: re-001 · ctx-weather",
    ],
  },
  {
    mono: "SG",
    label: "Safety Critic",
    slug: "safety-critic",
    lines: [
      "$ review plan-v1",
      "✗ engaged unit alpha-3 has no retreat option",
      "⇒ status: revise",
    ],
  },
  {
    mono: "DP",
    label: "Dispatch + Piper",
    slug: "dispatch",
    lines: [
      "$ synthesize voice orders",
      "⇒ alpha-3 — French radio order queued",
      "↳ awaiting commander approval",
    ],
  },
];

/** Static fallback agent under prefers-reduced-motion (Safety Critic). */
const STATIC_IDX = 2;

const FOCUS_MS = 550; // ring glides + node pulses ("click")
const TYPE_MS = 18; // per typed character
const HOLD_MS = 1250; // pause on the finished terminal
const SPRING = { type: "spring" as const, stiffness: 380, damping: 26 };

type Phase = "focus" | "typing" | "hold";

/** Per-glyph accent, mirroring the real terminal's audit sub-lines. */
function lineClass(full: string): string {
  if (full.startsWith("⇒")) return "pl-4 text-ok";
  if (full.startsWith("✗")) return "pl-4 text-alert";
  if (full.startsWith("⚠")) return "pl-4 text-warn";
  if (full.startsWith("↳")) return "pl-4 text-faint";
  return "text-foreground/90";
}

function BlockCursor() {
  return (
    <span
      aria-hidden
      className="blaze-term-cursor ml-0.5 inline-block h-[1.05em] w-[0.55em] translate-y-[0.18em] bg-accent align-baseline"
    />
  );
}

/** The miniature terminal — chrome bar + typed lines on scanline texture. */
function MiniTerminal({
  agent,
  chars,
  done,
}: {
  agent: PreviewAgent;
  chars: number;
  done: boolean;
}) {
  let budget = chars;
  const visible: { full: string; text: string }[] = [];
  for (const full of agent.lines) {
    if (budget <= 0) break;
    visible.push({ full, text: full.slice(0, budget) });
    budget -= full.length;
  }

  return (
    <div
      className="mx-auto w-full max-w-[430px] overflow-hidden rounded-md border border-edge bg-background text-left shadow-[0_24px_60px_-24px_rgba(0,0,0,0.85)]"
    >
      {/* chrome bar */}
      <div className="flex items-center gap-2.5 border-b border-edge bg-surface px-3 py-1.5">
        <span className="flex items-center gap-1.5" aria-hidden>
          <span className="size-2 rounded-full bg-alert/60" />
          <span className="size-2 rounded-full bg-warn/60" />
          <span className="size-2 rounded-full bg-ok/60" />
        </span>
        <span className="truncate font-mono text-[10.5px] text-muted">
          agent://{agent.slug}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
          <span
            className={`size-1.5 rounded-full ${done ? "bg-ok" : "bg-info animate-pulse"}`}
          />
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted">
            {done ? "done" : "working"}
          </span>
        </span>
      </div>

      {/* body */}
      <div className="relative px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed">
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
          {visible.map((line, i) => {
            const isLast = i === visible.length - 1;
            const prompt = line.full.startsWith("$");
            return (
              <p key={line.full} className={`break-words ${lineClass(line.full)}`}>
                {prompt ? (
                  <>
                    <span className="text-faint">$</span>
                    <span>{line.text.slice(1)}</span>
                  </>
                ) : (
                  line.text
                )}
                {isLast && <BlockCursor />}
              </p>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function WorkflowPreview() {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.35 });
  const running = inView && !reduced;

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("focus");
  const [chars, setChars] = useState(0);

  const activeIdx = reduced ? STATIC_IDX : idx;
  const agent = AGENTS[activeIdx];
  const totalChars = agent.lines.join("").length;

  // Sequencer — one full cycle per (running, idx): reset → focus pulse →
  // terminal opens and types → hold → close and advance. Every state change
  // happens inside a timer callback; all timers are cleared on cleanup, so
  // nothing runs while the preview is off-screen.
  useEffect(() => {
    if (!running) return;
    const total = AGENTS[idx].lines.join("").length;
    const typedMs = FOCUS_MS + total * TYPE_MS + 120;
    let interval: number | undefined;

    const resetT = window.setTimeout(() => {
      setPhase("focus");
      setChars(0);
    }, 0);
    const openT = window.setTimeout(() => {
      setPhase("typing");
      interval = window.setInterval(
        () => setChars((c) => Math.min(c + 1, total)),
        TYPE_MS,
      );
    }, FOCUS_MS);
    const holdT = window.setTimeout(() => {
      if (interval !== undefined) window.clearInterval(interval);
      setChars(total);
      setPhase("hold");
    }, typedMs);
    const nextT = window.setTimeout(() => {
      setPhase("focus");
      setChars(0);
      setIdx((i) => (i + 1) % AGENTS.length);
    }, typedMs + HOLD_MS);

    return () => {
      window.clearTimeout(resetT);
      window.clearTimeout(openT);
      window.clearTimeout(holdT);
      window.clearTimeout(nextT);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [running, idx]);

  const terminalOpen = reduced || (running && phase !== "focus");
  const shownChars = reduced ? totalChars : chars;
  const done = reduced || phase === "hold";

  return (
    <div
      ref={rootRef}
      className="rounded-lg border px-5 py-6 sm:px-8"
      style={{ borderColor: "var(--blaze-border)" }}
    >
      <p
        className="font-mono text-[10px] uppercase tracking-[0.2em]"
        style={{ color: "var(--blaze-text-faint)" }}
      >
        Live preview · /workflow
      </p>

      {/* the animated miniature — entirely clickable, goes to the demo */}
      <Link
        href="/workflow"
        aria-label="Open the interactive demo — click any agent there to inspect it"
        className="group mt-5 block"
      >
        {/* mini agent nodes */}
        <div className="flex items-center justify-center gap-2.5 sm:gap-4" aria-hidden>
          {AGENTS.map((a, i) => {
            const isActive = i === activeIdx;
            return (
              <div key={a.mono} className="relative flex flex-col items-center gap-1.5">
                <motion.span
                  className={`relative grid size-10 place-items-center rounded-md border font-mono text-[13px] font-semibold tracking-[0.08em] transition-colors duration-300 ${
                    isActive
                      ? "border-accent bg-overlay text-accent"
                      : "border-edge-strong bg-surface text-muted"
                  }`}
                  animate={
                    running && isActive && phase === "focus"
                      ? { scale: [1, 0.9, 1] }
                      : { scale: 1 }
                  }
                  transition={{ duration: 0.35, times: [0, 0.5, 1] }}
                >
                  {a.mono}
                  {/* focus ring — glides between nodes via shared layout */}
                  {isActive && (
                    <motion.span
                      layoutId="wp-focus-ring"
                      className="absolute -inset-[5px] rounded-lg border border-accent/70"
                      transition={SPRING}
                    />
                  )}
                </motion.span>
                <span
                  className={`font-mono text-[8.5px] uppercase tracking-[0.12em] transition-colors duration-300 ${
                    isActive ? "text-accent" : "text-faint"
                  }`}
                >
                  {a.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* reserved slot so the opening/closing terminal never shifts layout */}
        <div className="relative mt-5 h-[132px] sm:h-[122px]" aria-hidden>
          <AnimatePresence>
            {terminalOpen && (
              <motion.div
                key={agent.mono}
                className="absolute inset-x-0 top-0"
                initial={reduced ? false : { opacity: 0, scale: 0.85, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.9, transition: { duration: 0.16 } }}
                transition={SPRING}
              >
                <MiniTerminal agent={agent} chars={shownChars} done={done} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Link>

      {/* Deliberately NOT a third "Open demo" button: the whole card is already
          the link, and the page keeps exactly one primary CTA per screen. */}
      <p
        className="mt-4 text-center text-[12.5px]"
        style={{ color: "var(--blaze-text-faint)" }}
      >
        <Link
          href="/workflow"
          className="underline decoration-dotted underline-offset-4"
          style={{ color: "var(--blaze-text-muted)" }}
        >
          Try it yourself →
        </Link>
      </p>
    </div>
  );
}
