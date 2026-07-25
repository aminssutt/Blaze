// Ticket #42 — fil radio (audios & transcriptions). Owner: @six-16.
//
// STUB laid down by ticket #38. Ticket #42 owns this file from now on.
// Real slice: `audios` — the merged per-audio pipeline progress record.

"use client";

import type { AudioStatus } from "@/lib/incidentStore";
import { useIncidentState } from "@/lib/session";
import { Badge, Panel, SourceBadge, StatusDot } from "@/components/ui";
import type { PanelComponentProps, StatusTone } from "@/components/ui";

const STATUS_LABEL: Record<AudioStatus, string> = {
  pending: "annoncé",
  received: "reçu",
  transcribing: "transcription…",
  transcribed: "transcrit",
};

const STATUS_TONE: Record<AudioStatus, StatusTone> = {
  pending: "idle",
  received: "idle",
  transcribing: "running",
  transcribed: "ok",
};

export default function RadioTimeline({ className }: PanelComponentProps) {
  const { audios } = useIncidentState();
  const transcribed = audios.filter((a) => a.status === "transcribed").length;

  return (
    <Panel
      className={className}
      id="radio-timeline"
      title="Fil radio"
      subtitle={audios.length > 0 ? `${transcribed}/${audios.length} transcrits` : undefined}
      live={audios.some((a) => a.status === "transcribing")}
      empty={audios.length === 0}
      emptyLabel="aucun message radio…"
      emptyHint="alimenté par audio.received / transcript.ready"
    >
      <ol className="flex flex-col gap-1.5">
        {audios.map((audio) => (
          <li
            key={audio.audio_id}
            className="rounded-sm border border-edge bg-overlay p-2"
          >
            <div className="flex items-center gap-2">
              <StatusDot
                tone={STATUS_TONE[audio.status]}
                pulse={audio.status === "transcribing"}
              />
              <span className="font-mono text-[11px] text-accent">
                {audio.speaker_hint ?? audio.audio_id}
              </span>
              <span className="font-mono text-[10px] text-faint">
                {audio.audio_id}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {audio.audio_mode && (
                  <Badge variant="neutral" title="audio_variant">
                    {audio.audio_mode}
                  </Badge>
                )}
                <Badge
                  variant={audio.status === "transcribed" ? "ok" : "info"}
                  title={audio.status}
                >
                  {STATUS_LABEL[audio.status]}
                </Badge>
              </span>
            </div>

            {audio.transcript && (
              <p className="mt-1 text-[11px] leading-snug text-foreground">
                « {audio.transcript.text} »
              </p>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-1">
              <SourceBadge source="human_report" sourceName="message radio" />
              {audio.transcript && (
                <span className="font-mono text-[10px] text-faint">
                  {audio.transcript.model_name} · {audio.transcript.latency_ms} ms
                </span>
              )}
              {audio.extracted_event_ids.length > 0 && (
                <span className="font-mono text-[10px] text-info">
                  {audio.extracted_event_ids.length} événement(s)
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
