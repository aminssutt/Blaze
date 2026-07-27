// Ticket #38 — header / status region (region 1). Owner: @six-16.
//
// THE header of the control room. Composes:
//   - the BLAZE wordmark, incident identity and state-machine phase,
//   - the Gemma 4 / vLLM / NVIDIA GPU pills derived by lib/systemStatus.ts,
//   - the network and audio mode pills (a blackout must be unmistakable),
//   - the headline "Appels LLM cloud" claim.
// Every value is read from the incident store. Nothing is hardcoded, nothing
// is invented: an unknown value renders "—" / "en attente", and mock metric
// values are visibly flagged (product invariant #4).

"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { areMetricsPlaceholder, type IncidentState } from "@/lib/incidentStore";
import { useIncidentState } from "@/lib/session";
import { deriveSystemStatuses } from "@/lib/systemStatus";
import { Badge, StatusDot, StatusPill } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* Derived header values                                                      */
/* -------------------------------------------------------------------------- */

/** Coarse phase of the incident state machine, derived from reduced events. */
interface Phase {
  label: string;
  tone: "idle" | "running" | "ok" | "warn" | "alert";
}

/**
 * The demo runs one linear scenario, so the furthest milestone reached IS the
 * phase. Checked from the most advanced backwards; every branch is backed by a
 * real store slice, none is guessed.
 */
function derivePhase(s: IncidentState): Phase {
  if (s.incidentStatus === "waiting") return { label: "en attente", tone: "idle" };
  if (s.incidentStatus === "completed") return { label: "terminé", tone: "ok" };
  if (s.dispatchesSent > 0) return { label: "diffusion", tone: "ok" };
  if (s.dispatchUnlocked) return { label: "diffusion", tone: "running" };
  if (s.approvalRequested) return { label: "validation commandant", tone: "warn" };
  if (s.safetyReviews.length > 0) return { label: "revue sécurité", tone: "warn" };
  if (s.plans.length > 0) return { label: "planification", tone: "running" };
  if (s.snapshot) return { label: "contexte", tone: "running" };
  if (s.audios.length > 0) return { label: "acquisition radio", tone: "running" };
  return { label: "démarrage", tone: "running" };
}

const PHASE_CLASS: Record<Phase["tone"], string> = {
  alert: "border-alert bg-alert-dim/50 text-alert",
  warn: "border-warn/70 bg-warn/15 text-warn",
  ok: "border-ok/70 bg-ok-dim/50 text-ok",
  running: "border-accent-dim bg-accent-dim/30 text-accent",
  idle: "border-edge-strong text-faint",
};

/** Reads a numeric metric, or null when it has not been emitted yet. */
function metricNumber(
  metrics: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Header building blocks                                                     */
/* -------------------------------------------------------------------------- */

/** Labelled pill used for the network and audio modes. */
function ModePill({
  label,
  children,
  className,
  title,
  testId,
}: {
  label: string;
  children: ReactNode;
  className: string;
  title?: string;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="whitespace-nowrap text-[9px] uppercase tracking-[0.16em] text-faint">
        {label}
      </span>
      <span
        data-testid={testId}
        title={title}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${className}`}
      >
        {children}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* HeaderBar                                                                  */
/* -------------------------------------------------------------------------- */

export default function HeaderBar() {
  const state = useIncidentState();

  const phase = derivePhase(state);
  const metrics = state.metrics;
  const placeholder = areMetricsPlaceholder(metrics);
  const cloudCalls = metricNumber(metrics, "cloud_llm_calls");

  // Gemma / vLLM / GPU come from the shared honest derivation. Network and
  // incident are rendered below with the visual weight the demo requires.
  const infraStatuses = deriveSystemStatuses(state).filter(
    (s) => s.id === "gemma" || s.id === "vllm" || s.id === "gpu",
  );

  const network = state.networkMode;
  const networkKnown = network !== null;
  const online = network?.toLowerCase() === "online";

  return (
    <header
      id="header-status"
      className="flex shrink-0 items-stretch gap-3 rounded-md border border-edge bg-surface px-3 py-2"
    >
      {/* Identity + incident + state-machine phase */}
      <div className="flex min-w-0 items-center gap-3">
        {/* Logo only — the wordmark is carried by the mark itself. */}
        <div className="flex items-center gap-2">
          <Image
            src="/logo-blaze.png"
            alt="BLAZE"
            width={34}
            height={34}
            className="shrink-0 rounded-full"
            loading="eager"
          />
          <span className="hidden text-[10px] uppercase tracking-[0.2em] text-faint 2xl:inline">
            control room
          </span>
        </div>

        <div className="min-w-0 border-l border-edge pl-3">
          <div
            data-testid="incident-name"
            className="truncate text-[13px] font-semibold text-foreground"
            title={state.incidentName ?? undefined}
          >
            {state.incidentName ?? "en attente de incident.started"}
          </div>
          <div className="truncate font-mono text-[10px] text-faint">
            {state.incidentId ?? "—"}
            {state.lastSequence > 0 ? ` · seq ${state.lastSequence}` : ""}
          </div>
        </div>

        <div
          data-testid="incident-status"
          title="Phase de la machine à états de l'incident"
          className={`flex items-center gap-2 whitespace-nowrap rounded-sm border px-3 py-1 text-sm font-bold uppercase tracking-[0.14em] ${PHASE_CLASS[phase.tone]}`}
        >
          <StatusDot
            tone={phase.tone}
            pulse={phase.tone === "running" || phase.tone === "warn"}
          />
          {phase.label}
        </div>
      </div>

      {/* Local inference stack — driven by metric.updated / agent runs */}
      <div
        className="ml-auto flex items-center gap-1.5"
        role="status"
        aria-label="État du système"
      >
        {infraStatuses.map((status) => (
          <StatusPill
            key={status.id}
            testId={status.id}
            label={status.label}
            value={status.value}
            level={status.level}
            detail={status.detail}
            measured={status.measured}
          />
        ))}
      </div>

      {/* Modes — a network blackout must be unmistakable from the back row */}
      <div className="flex items-center gap-2.5 border-l border-edge pl-2.5">
        <ModePill
          label="network"
          testId="network-mode"
          title={
            networkKnown
              ? `network_mode = ${network}`
              : "aucun événement réseau reçu"
          }
          className={
            !networkKnown
              ? "border-edge-strong text-faint"
              : online
                ? "border-ok/70 bg-ok-dim/50 text-ok"
                : "animate-pulse border-alert bg-alert-dim text-alert"
          }
        >
          {!networkKnown ? (
            "—"
          ) : online ? (
            "en ligne"
          ) : (
            <>
              <StatusDot tone="alert" pulse />
              hors ligne
            </>
          )}
        </ModePill>

        <ModePill
          label="audio"
          testId="audio-mode"
          title={
            state.audioMode
              ? `audio_mode = ${state.audioMode}`
              : "mode audio non annoncé"
          }
          className={
            state.audioMode
              ? "border-accent-dim bg-accent-dim/30 text-accent"
              : "border-edge-strong text-faint"
          }
        >
          {state.audioMode ?? "—"}
        </ModePill>
      </div>

      {/* Headline claim — zero cloud inference */}
      <div
        id="cloud-llm-claim"
        className="flex items-center gap-3 rounded-sm border border-accent-dim bg-accent-dim/20 px-3 py-1"
        title="Aucun appel à un LLM distant : toute l'inférence tourne localement"
      >
        <div className="flex flex-col leading-tight">
          <span className="whitespace-nowrap text-[9px] uppercase tracking-[0.16em] text-accent/80">
            appels LLM cloud
          </span>
          <span className="flex items-center gap-1 whitespace-nowrap font-mono text-[9px] text-faint">
            {cloudCalls === null ? (
              "en attente de la métrique"
            ) : placeholder ? (
              <>
                <Badge
                  variant="warn"
                  title="Valeur mock du flux de démonstration — non mesurée"
                >
                  mock
                </Badge>
                non mesurée
              </>
            ) : (
              "mesuré localement"
            )}
          </span>
        </div>
        <span
          data-testid="cloud-llm-calls"
          className={`font-mono text-3xl font-bold leading-none ${
            cloudCalls === null ? "text-faint" : "text-accent-strong"
          }`}
        >
          {cloudCalls === null ? "—" : cloudCalls}
        </span>
      </div>
    </header>
  );
}
