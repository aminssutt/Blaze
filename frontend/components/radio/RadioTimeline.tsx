// Ticket #42 — fil radio (audios & transcriptions). Owner: @six-16.
//
// One entry per scenario audio, folded from the `audios` slice of the store
// (audio.received → transcription.started → transcript.ready →
// radio_event.extracted). Per audio: speaker, scenario time, HTML5 player on
// the real WAV, transcript, clean/radio badge, and a 3-step processing
// stepper (reçu → transcription → extrait) that advances with the events.
//
// AUDIO SERVING — the WAVs live in `data/audio/` at the repo root and are
// copied into `frontend/public/data/audio/` by scripts/sync-data.mjs (predev /
// prebuild hooks), so the payload's repo-relative `audio_path`
// ("data/audio/01_….wav") maps 1:1 to the public URL "/data/audio/01_….wav".

"use client";

import type { AudioProgress, AudioStatus } from "@/lib/incidentStore";
import { useIncidentState } from "@/lib/session";
import { Badge, Panel, SourceBadge, StatusDot } from "@/components/ui";
import type { PanelComponentProps, StatusTone } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Repo-relative audio_path → public URL (sync-data.mjs mirrors data/audio/). */
function audioUrl(audioPath: string): string {
  return `/${audioPath.replace(/^\/+/, "")}`;
}

/** Scenario offset in seconds → "T+m:ss". */
function scenarioTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `T+${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The ticket-#42 pipeline reading of one audio: the store's monotonic
 * `AudioStatus` plus a final "extrait" stage once radio_event.extracted
 * attached at least one structured event to this audio.
 */
type PipelineStage = AudioStatus | "extracted";

function pipelineStage(audio: AudioProgress): PipelineStage {
  if (audio.status === "transcribed" && audio.extracted_event_ids.length > 0) {
    return "extracted";
  }
  return audio.status;
}

const STAGE_ORDER: Record<PipelineStage, number> = {
  pending: 0,
  received: 1,
  transcribing: 2,
  transcribed: 3,
  extracted: 4,
};

const STAGE_LABEL: Record<PipelineStage, string> = {
  pending: "annoncé",
  received: "reçu",
  transcribing: "transcription…",
  transcribed: "transcrit",
  extracted: "extrait",
};

const STAGE_BADGE: Record<PipelineStage, "neutral" | "info" | "ok"> = {
  pending: "neutral",
  received: "neutral",
  transcribing: "info",
  transcribed: "info",
  extracted: "ok",
};

const STAGE_DOT: Record<PipelineStage, StatusTone> = {
  pending: "idle",
  received: "idle",
  transcribing: "running",
  transcribed: "running",
  extracted: "ok",
};

/** The 3 steps of the visible processing stepper, in pipeline order. */
const STEPS: { label: string; reached: PipelineStage; active: PipelineStage }[] =
  [
    { label: "reçu", reached: "received", active: "received" },
    { label: "transcription", reached: "transcribing", active: "transcribing" },
    { label: "extrait", reached: "extracted", active: "transcribed" },
  ];

/** Compact reçu → transcription → extrait stepper for one audio. */
function ProcessingSteps({ stage }: { stage: PipelineStage }) {
  const rank = STAGE_ORDER[stage];
  return (
    <ol
      className="flex items-center gap-1"
      aria-label={`traitement : ${STAGE_LABEL[stage]}`}
    >
      {STEPS.map((step, i) => {
        const reached = rank >= STAGE_ORDER[step.reached];
        const active = stage === step.active;
        return (
          <li key={step.label} className="flex items-center gap-1">
            {i > 0 && (
              <span
                aria-hidden
                className={`h-px w-3 ${reached ? "bg-info/60" : "bg-edge"}`}
              />
            )}
            <StatusDot
              tone={reached ? (active ? "running" : "ok") : "idle"}
              pulse={active}
              label={step.label}
              title={step.label}
            />
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

export default function RadioTimeline({ className }: PanelComponentProps) {
  const { audios } = useIncidentState();
  const transcribed = audios.filter(
    (a) => a.status === "transcribed",
  ).length;

  return (
    <Panel
      className={className}
      id="radio-timeline"
      title="Fil radio"
      subtitle={
        audios.length > 0
          ? `${transcribed}/${audios.length} transcrits`
          : undefined
      }
      live={audios.some((a) => a.status === "transcribing")}
      empty={audios.length === 0}
      emptyLabel="aucun message radio…"
      emptyHint="alimenté par audio.received / transcript.ready"
    >
      <ol className="flex flex-col gap-1.5">
        {audios.map((audio) => {
          const stage = pipelineStage(audio);
          return (
            <li
              key={audio.audio_id}
              className="rounded-sm border border-edge bg-overlay p-2"
            >
              {/* header line: dot, speaker, scenario time, badges */}
              <div className="flex items-center gap-2">
                <StatusDot
                  tone={STAGE_DOT[stage]}
                  pulse={stage === "transcribing"}
                />
                <span className="font-mono text-[11px] text-accent">
                  {audio.speaker_hint ?? audio.audio_id}
                </span>
                {audio.scenario_timestamp !== null && (
                  <span
                    className="font-mono text-[10px] text-faint"
                    title="temps scénario (offset depuis le début de l'incident)"
                  >
                    {scenarioTime(audio.scenario_timestamp)}
                  </span>
                )}
                <span className="font-mono text-[10px] text-faint">
                  {audio.audio_id}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {audio.audio_mode && (
                    <Badge
                      variant={audio.audio_mode === "radio" ? "warn" : "neutral"}
                      title={`audio_variant : ${audio.audio_mode}`}
                    >
                      {audio.audio_mode === "radio" ? "radio dégradé" : "clean"}
                    </Badge>
                  )}
                  <Badge variant={STAGE_BADGE[stage]} title={stage}>
                    {STAGE_LABEL[stage]}
                  </Badge>
                </span>
              </div>

              {/* real WAV, served from /data/audio/ (sync-data.mjs) */}
              {audio.audio_path && (
                <audio
                  controls
                  preload="none"
                  src={audioUrl(audio.audio_path)}
                  className="mt-1.5 h-8 w-full"
                  aria-label={`audio ${audio.audio_id} — ${audio.speaker_hint ?? "unité inconnue"}`}
                />
              )}

              {audio.transcript && (
                <p className="mt-1 text-[11px] leading-snug text-foreground">
                  « {audio.transcript.text} »
                </p>
              )}

              {/* processing stepper + provenance / model footprint */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <ProcessingSteps stage={stage} />
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  <SourceBadge source="human_report" sourceName="message radio" />
                  {audio.duration_seconds !== null && (
                    <span className="font-mono text-[10px] text-faint">
                      {audio.duration_seconds.toFixed(1)} s
                    </span>
                  )}
                  {audio.transcript && (
                    <span className="font-mono text-[10px] text-faint">
                      {audio.transcript.model_name} ·{" "}
                      {audio.transcript.latency_ms} ms
                    </span>
                  )}
                  {audio.extracted_event_ids.length > 0 && (
                    <span className="font-mono text-[10px] text-info">
                      {audio.extracted_event_ids.length} événement(s)
                    </span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
