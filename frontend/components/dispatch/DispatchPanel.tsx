// Ticket #49 — diffusion aux unités. Owner: @selyan-mhli.
//
// PRODUCT INVARIANT #1 — this panel stays INERT until `dispatchUnlocked`.
// Real slices: `dispatches` and `ttsByDispatchId` (per-dispatch TTS state).
// Every element here is SIMULATED radio traffic and labeled as such — the
// tts.ready audio paths resolve to repo files copied by sync-data.mjs.

"use client";

import { useState } from "react";
import { useIncidentState } from "@/lib/session";
import { getBackendBase, isLiveMode } from "@/lib/streamMode";
import {
  AudioPlayer,
  Badge,
  Panel,
  dispatchStatusLabel,
  dispatchStatusVariant,
} from "@/components/ui";
import type { PanelComponentProps } from "@/components/ui";

/**
 * Mock mode: tts_audio_path is repo-relative ("data/audio/tts/…"), mirrored
 * under public/ by sync-data.mjs → "/<path>". Live mode (#54/#55): the WAV
 * lives on the backend, served by GET /dispatch/audio/{unit_id}.
 */
function audioUrl(ttsAudioPath: string | null, unitId: string): string | null {
  if (isLiveMode()) return `${getBackendBase()}/dispatch/audio/${unitId}`;
  return ttsAudioPath ? `/${ttsAudioPath.replace(/^\/+/, "")}` : null;
}

/** Per-unit TTS player that degrades to a labeled badge when the WAV is absent. */
function TtsPlayer({ src, unitId }: { src: string; unitId: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Badge variant="warn" title={`audio file unavailable: ${src}`}>
        audio unavailable — text only
      </Badge>
    );
  }
  // No <track> caption: the exact message_text is rendered next to the player.
  return (
    <AudioPlayer
      src={src}
      onError={() => setFailed(true)}
      ariaLabel={`TTS voice message for ${unitId}`}
    />
  );
}

export default function DispatchPanel({ className }: PanelComponentProps) {
  const { dispatches, dispatchesSent, dispatchUnlocked, ttsByDispatchId } =
    useIncidentState();

  // Invariant #1: nothing operational is shown before human approval.
  if (!dispatchUnlocked) {
    return (
      <Panel
        className={className}
        id="dispatch-panel"
        title="Dispatch to units"
        right={
          <Badge variant="alert" filled title="Invariant produit #1">
            locked
          </Badge>
        }
        empty
        emptyLabel="dispatch locked"
        emptyHint="per-unit voice messages — unlocked once the commander approves"
      />
    );
  }

  return (
    <Panel
      className={className}
      id="dispatch-panel"
      title="Dispatch to units"
      subtitle={`${dispatchesSent}/${dispatches.length} sent · simulated`}
      right={
        <span className="flex items-center gap-1.5">
          <Badge
            variant="info"
            title="Aucune transmission radio réelle — endpoint simulated_dispatch"
          >
            simulated dispatch
          </Badge>
          <Badge variant="ok" filled>
            unlocked
          </Badge>
        </span>
      }
      empty={dispatches.length === 0}
      emptyLabel="no message generated yet…"
      emptyHint="per-unit voice messages — generated after approval"
    >
      <ul className="flex flex-col gap-1.5">
        {dispatches.map((dispatch) => {
          const tts = ttsByDispatchId[dispatch.dispatch_id];
          const src = audioUrl(
            tts?.tts_audio_path ?? dispatch.tts_audio_path ?? null,
            dispatch.unit_id,
          );
          return (
            <li
              key={dispatch.dispatch_id}
              className="rounded-sm border border-edge bg-overlay p-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-accent">
                  {dispatch.unit_id}
                </span>
                <Badge variant={dispatchStatusVariant(dispatch.dispatch_status)}>
                  {dispatchStatusLabel(dispatch.dispatch_status)}
                </Badge>
                {tts && (
                  <Badge
                    variant={tts.status === "ready" ? "ok" : "warn"}
                    title={tts.engine ?? undefined}
                  >
                    tts {tts.status === "ready" ? "ready" : "running"}
                    {tts.latency_ms !== null ? ` · ${tts.latency_ms} ms` : ""}
                  </Badge>
                )}
                {dispatch.acknowledgement_required && (
                  <Badge
                    variant="info"
                    title="The unit must acknowledge this message"
                  >
                    ack required
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-foreground">
                « {dispatch.message_text} »
              </p>
              {tts?.status === "ready" && src && (
                <div className="mt-1.5">
                  <TtsPlayer src={src} unitId={dispatch.unit_id} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
