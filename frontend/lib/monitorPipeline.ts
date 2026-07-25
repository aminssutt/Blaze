/**
 * BLAZE monitor pipeline model (page /monitor).
 *
 * Pure derivations over the incident store for the agent-control view:
 *   - the fixed node catalogue of the pipeline graph (services, Gemma agents,
 *     the human gate, plus the 7 allowlisted tool mini-nodes);
 *   - per-node status (standby / active / done), derived EXCLUSIVELY from
 *     reduced events (`*_agent.started` runs, `*.ready` completions, TTS and
 *     approval slices) — never guessed, never stored ad hoc;
 *   - the per-node terminal transcript: the REAL ordered event log filtered
 *     for one node and rendered as stdout-style lines (cmd lines tagged by
 *     event family + indented sub-lines with audit glyphs).
 *
 * Glyph convention of the terminal sub-lines (mirrors the audit semantics):
 *   ⇒  facts extracted / actions retained / successful outputs  (green)
 *   ✗  objections, rejections, corrections, errors              (red)
 *   ⚠  uncertainties, warnings, pending human decisions          (amber)
 *   ↳  tool calls, retrievals, evidence, provenance              (dim)
 *
 * NO chain-of-thought is ever rendered (same product rule as ticket #44):
 * every line is auditable contract data — facts, statuses, rule checks,
 * provenance, and the concise `reason` fields.
 */

import type {
  ApprovalDecision,
  DispatchInstruction,
  DraftTacticalPlan,
  EventEnvelope,
  RadioEvent,
  SafetyReview,
  SituationSnapshot,
  ToolRequest,
  ToolResult,
  TranscriptResult,
} from "./contracts";
import type { IncidentState } from "./incidentStore";

/* -------------------------------------------------------------------------- */
/* Node catalogue                                                             */
/* -------------------------------------------------------------------------- */

export type NodeStatus = "standby" | "active" | "done";

/** Main pipeline nodes, in flow order. Tool mini-nodes are `tool:<name>`. */
export const PIPELINE_NODE_IDS = [
  "ingestion",
  "stt",
  "radio_intelligence",
  "situation_context",
  "tactical_planning",
  "safety_critic",
  "human_gate",
  "dispatch",
  "tts",
] as const;

export type PipelineNodeId = (typeof PIPELINE_NODE_IDS)[number];
export type MonitorNodeId = PipelineNodeId | `tool:${string}`;

export interface MonitorNodeInfo {
  id: MonitorNodeId;
  emoji: string;
  label: string;
  kind: "service" | "agent" | "human" | "tool";
  /** One-line French role, shown in the overlay header + terminal comment. */
  role: string;
}

export const NODE_INFO: Record<PipelineNodeId, MonitorNodeInfo> = {
  ingestion: {
    id: "ingestion",
    emoji: "📻",
    label: "Ingestion",
    kind: "service",
    role: "réception du trafic radio terrain (audios du scénario)",
  },
  stt: {
    id: "stt",
    emoji: "📝",
    label: "STT",
    kind: "service",
    role: "transcription locale faster-whisper — aucun cloud",
  },
  radio_intelligence: {
    id: "radio_intelligence",
    emoji: "🤖",
    label: "Radio Intelligence",
    kind: "agent",
    role: "extraction de faits structurés depuis chaque transcript",
  },
  situation_context: {
    id: "situation_context",
    emoji: "🌍",
    label: "Situation Context",
    kind: "agent",
    role: "synthèse de situation via 7 outils allowlistés, provenance tracée",
  },
  tactical_planning: {
    id: "tactical_planning",
    emoji: "🗺️",
    label: "Tactical Planning",
    kind: "agent",
    role: "fusion faits + contexte en plan tactique versionné",
  },
  safety_critic: {
    id: "safety_critic",
    emoji: "🛡️",
    label: "Safety Critic",
    kind: "agent",
    role: "revue adversariale du plan — objections et règles de sécurité",
  },
  human_gate: {
    id: "human_gate",
    emoji: "👤",
    label: "Human Gate",
    kind: "human",
    role: "validation commandant — rien ne part sans décision humaine",
  },
  dispatch: {
    id: "dispatch",
    emoji: "📢",
    label: "Dispatch",
    kind: "agent",
    role: "messages par unité générés après approbation",
  },
  tts: {
    id: "tts",
    emoji: "🔊",
    label: "TTS",
    kind: "service",
    role: "synthèse vocale locale des messages de diffusion",
  },
};

/** The 7 allowlisted tools of the Situation Context agent (contracts). */
export const TOOL_NODES: { name: string; emoji: string }[] = [
  { name: "weather", emoji: "🌤️" },
  { name: "elevation", emoji: "⛰️" },
  { name: "firms", emoji: "🛰️" },
  { name: "cadastre", emoji: "🏘️" },
  { name: "osm", emoji: "🧭" },
  { name: "routing", emoji: "🛣️" },
  { name: "resources", emoji: "🚒" },
];

export function toolNodeId(toolName: string): MonitorNodeId {
  return `tool:${toolName}`;
}

/** Info record for any node id, tool mini-nodes included. */
export function nodeInfo(id: MonitorNodeId): MonitorNodeInfo {
  if (id.startsWith("tool:")) {
    const name = id.slice(5);
    const known = TOOL_NODES.find((t) => t.name === name);
    return {
      id,
      emoji: known?.emoji ?? "🔧",
      label: name,
      kind: "tool",
      role: `outil déterministe « ${name} » — exécuté par la couche outils, jamais par le modèle`,
    };
  }
  return NODE_INFO[id as PipelineNodeId];
}

/* -------------------------------------------------------------------------- */
/* Status derivation                                                          */
/* -------------------------------------------------------------------------- */

/** Fold the agent runs of one agent_id into a node status. */
function agentStatus(state: IncidentState, agentId: string): NodeStatus {
  const runs = state.agentRuns.filter((r) => r.agent_id === agentId);
  if (runs.some((r) => !r.finished)) return "active";
  return runs.length > 0 ? "done" : "standby";
}

/**
 * Status of every pipeline node + every tool mini-node, derived from the
 * store: `*_agent.started` opens a run (active), the matching `*.ready`
 * completion closes it (done) — see AGENT_COMPLETION in incidentStore.
 */
export function deriveNodeStatuses(
  state: IncidentState,
): Record<MonitorNodeId, NodeStatus> {
  const statuses: Record<MonitorNodeId, NodeStatus> = {
    // The radio intake listens for the whole incident lifetime.
    ingestion:
      state.incidentStatus === "waiting"
        ? "standby"
        : state.incidentStatus === "completed"
          ? "done"
          : "active",
    stt: state.audios.some((a) => a.status === "transcribing")
      ? "active"
      : state.transcripts.length > 0
        ? "done"
        : "standby",
    radio_intelligence: agentStatus(state, "radio_intelligence"),
    situation_context: agentStatus(state, "situation_context"),
    tactical_planning: agentStatus(state, "tactical_planning"),
    safety_critic: agentStatus(state, "safety_critic"),
    human_gate: state.approval
      ? "done"
      : state.approvalRequested
        ? "active"
        : "standby",
    dispatch: agentStatus(state, "dispatch"),
    tts: ((): NodeStatus => {
      const tts = Object.values(state.ttsByDispatchId);
      if (tts.some((t) => t.status === "generating")) return "active";
      return tts.length > 0 ? "done" : "standby";
    })(),
  };

  for (const tool of TOOL_NODES) {
    const calls = state.toolCalls.filter((c) => c.tool_name === tool.name);
    statuses[toolNodeId(tool.name)] = calls.some((c) => !c.completed)
      ? "active"
      : calls.length > 0
        ? "done"
        : "standby";
  }

  return statuses;
}

/* -------------------------------------------------------------------------- */
/* Terminal lines                                                             */
/* -------------------------------------------------------------------------- */

/** One rendered terminal line. `cmd` lines carry a coloured tag + timestamp. */
export type TermLine =
  | { id: string; kind: "meta" | "comment" | "out"; text: string }
  | {
      id: string;
      kind: "cmd";
      /** Short verb of the event family (extract, tool, plan, review…). */
      tag: string;
      /** Tailwind text-colour class of the tag (Blaze theme colours only). */
      tagClass: string;
      text: string;
      ts: string;
    };

/** Event-family colours — one distinct Blaze token colour per family. */
const TAG = {
  ingest: { tag: "ingest", tagClass: "text-src-human" },
  stt: { tag: "stt", tagClass: "text-src-cached" },
  exec: { tag: "exec", tagClass: "text-info" },
  extract: { tag: "extract", tagClass: "text-info" },
  tool: { tag: "tool", tagClass: "text-src-seeded" },
  synth: { tag: "synth", tagClass: "text-src-live" },
  plan: { tag: "plan", tagClass: "text-accent" },
  review: { tag: "review", tagClass: "text-warn" },
  human: { tag: "human", tagClass: "text-accent-strong" },
  dispatch: { tag: "dispatch", tagClass: "text-ok" },
  tts: { tag: "tts", tagClass: "text-src-model" },
} as const;

/** "10:00:02" from an ISO timestamp, or "—" when absent/invalid. */
function clock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(11, 19);
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** One primitive rendered compactly for one-line result summaries. */
function compactValue(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "string") return truncate(value, 24);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return `{${Object.keys(value as object).length}}`;
  return String(value);
}

/** Auditable one-line summary of a tool result payload (never model text). */
function summarizeToolData(data: ToolResult["data"]): string {
  if (data === null || data === undefined) return "—";
  if (Array.isArray(data)) return `${data.length} éléments`;
  const entries = Object.entries(data);
  if (entries.length === 0) return "∅";
  const shown = entries
    .slice(0, 4)
    .map(([k, v]) => `${k}=${compactValue(v)}`)
    .join(" · ");
  return entries.length > 4 ? `${shown} · +${entries.length - 4}` : shown;
}

/**
 * Which nodes an event belongs to. An event may feed several terminals
 * (tool.* feeds situation_context AND its tool mini-node; the revision
 * request is visible from both the planner and the critic).
 */
function nodesOfEvent(event: EventEnvelope): MonitorNodeId[] {
  const p = event.payload as Record<string, unknown>;
  switch (event.event_type) {
    case "incident.started":
    case "audio.received":
    case "network.mode.changed":
      return ["ingestion"];
    case "transcription.started":
    case "transcript.ready":
      return ["stt"];
    case "radio_agent.started":
    case "radio_event.extracted":
      return ["radio_intelligence"];
    case "context_agent.started":
    case "situation.snapshot.ready":
      return ["situation_context"];
    case "tool.call.requested":
    case "tool.call.completed": {
      const toolName = typeof p.tool_name === "string" ? p.tool_name : null;
      return toolName
        ? ["situation_context", toolNodeId(toolName)]
        : ["situation_context"];
    }
    case "planning.started":
    case "plan.draft.ready":
      return ["tactical_planning"];
    case "plan.revision.requested":
      return ["tactical_planning", "safety_critic"];
    case "safety_review.started":
    case "safety_review.ready":
      return ["safety_critic"];
    case "approval.requested":
    case "approval.received":
      return ["human_gate"];
    case "dispatch.started":
    case "dispatch.instruction.ready":
    case "dispatch.sent":
      return ["dispatch"];
    case "tts.started":
    case "tts.ready":
      return ["tts"];
    default:
      return [];
  }
}

/** Push helper: cmd line + its sub-lines share the envelope id as key base. */
function cmd(
  lines: TermLine[],
  event: EventEnvelope,
  family: keyof typeof TAG,
  text: string,
): void {
  lines.push({
    id: `${event.event_id}-c`,
    kind: "cmd",
    tag: TAG[family].tag,
    tagClass: TAG[family].tagClass,
    text,
    ts: clock(event.timestamp),
  });
}

function out(lines: TermLine[], event: EventEnvelope, text: string): void {
  lines.push({
    id: `${event.event_id}-o${lines.length}`,
    kind: "out",
    text,
  });
}

/** Terminal lines contributed by ONE event (already known to match the node). */
function eventLines(lines: TermLine[], event: EventEnvelope): void {
  const p = event.payload as Record<string, unknown>;
  switch (event.event_type) {
    case "incident.started": {
      cmd(lines, event, "ingest", `incident « ${String(p.name ?? event.incident_id)} »`);
      const loc = p.location as { label?: string } | undefined;
      out(
        lines,
        event,
        `↳ zone ${loc?.label ?? "—"} · réseau ${String(p.network_mode ?? "—")} · audio ${String(p.audio_mode ?? "—")}`,
      );
      break;
    }
    case "audio.received":
      cmd(
        lines,
        event,
        "ingest",
        `${String(p.audio_id)} reçu — ${String(p.speaker_hint ?? "unité inconnue")}`,
      );
      out(
        lines,
        event,
        `↳ ${String(p.audio_path ?? "—")} · ${String(p.duration_seconds ?? "—")} s · T+${String(p.scenario_timestamp ?? "—")} s`,
      );
      break;
    case "network.mode.changed": {
      const mode = String(p.network_mode ?? p.mode ?? "—");
      cmd(lines, event, "ingest", `réseau → ${mode}`);
      if (mode.toLowerCase() !== "online")
        out(lines, event, "⚠ mode dégradé — bascule sur les caches locaux");
      break;
    }

    case "transcription.started":
      cmd(
        lines,
        event,
        "stt",
        `transcription ${String(p.audio_id)} — ${String(p.model_name ?? "modèle local")}`,
      );
      break;
    case "transcript.ready": {
      const t = event.payload as unknown as TranscriptResult;
      cmd(lines, event, "stt", `transcript ${t.audio_id} prêt · ${t.latency_ms} ms`);
      out(lines, event, `⇒ « ${truncate(t.text)} »`);
      if (t.fallback_used) out(lines, event, "⚠ fallback utilisé (audio clean / transcript de référence)");
      break;
    }

    case "radio_agent.started":
    case "context_agent.started":
    case "planning.started":
    case "safety_review.started":
    case "dispatch.started": {
      const family =
        event.event_type === "planning.started"
          ? "plan"
          : event.event_type === "safety_review.started"
            ? "review"
            : event.event_type === "dispatch.started"
              ? "dispatch"
              : "exec";
      cmd(
        lines,
        event,
        family,
        `run ${String(p.agent_id ?? event.event_type)}${p.model_id ? ` (${String(p.model_id)})` : ""}`,
      );
      break;
    }

    case "radio_event.extracted": {
      const e = event.payload as unknown as RadioEvent;
      cmd(
        lines,
        event,
        "extract",
        `${e.event_id} · ${e.event_type} · ${e.unit_id ?? "unité ?"} · urgence ${e.urgency}`,
      );
      for (const fact of e.facts) out(lines, event, `⇒ ${fact}`);
      if (e.is_correction && e.corrects_event_id)
        out(lines, event, `✗ corrige ${e.corrects_event_id} — l'original reste au journal`);
      for (const u of e.uncertainties ?? []) out(lines, event, `⚠ ${u}`);
      out(lines, event, `↳ evidence: « ${truncate(e.evidence_text, 90)} » · confiance ${e.confidence.toFixed(2)}`);
      break;
    }

    case "tool.call.requested": {
      const r = event.payload as unknown as ToolRequest;
      const args = Object.entries(r.arguments ?? {})
        .map(([k, v]) => `${k}=${compactValue(v)}`)
        .join(", ");
      cmd(lines, event, "tool", `${r.tool_name}(${truncate(args, 70)})`);
      if (r.reason) out(lines, event, `↳ ${r.reason}`);
      break;
    }
    case "tool.call.completed": {
      const r = event.payload as unknown as ToolResult;
      cmd(
        lines,
        event,
        "tool",
        `${r.tool_name} → ${r.status} · ${r.source_name}${r.is_cached ? " (cache)" : ""}`,
      );
      if (r.error) out(lines, event, `✗ ${r.error}`);
      else out(lines, event, `⇒ ${summarizeToolData(r.data ?? null)}`);
      break;
    }

    case "situation.snapshot.ready": {
      const s = event.payload as unknown as SituationSnapshot;
      cmd(lines, event, "synth", `snapshot v${s.version} généré (${s.radio_events.length} radio events intégrés)`);
      for (const f of s.known_facts) out(lines, event, `⇒ ${f}`);
      for (const f of s.uncertain_facts) out(lines, event, `⚠ ${f}`);
      for (const c of s.conflicts) out(lines, event, `✗ conflit: ${c}`);
      for (const m of s.missing_information) out(lines, event, `⚠ manquant: ${m}`);
      out(lines, event, `↳ provenance: ${s.provenance.length} champs tracés`);
      break;
    }

    case "plan.draft.ready": {
      const plan = event.payload as unknown as DraftTacticalPlan;
      cmd(lines, event, "plan", `plan ${plan.plan_id} v${plan.version} prêt`);
      out(lines, event, `↳ ${truncate(plan.summary)}`);
      for (const a of plan.unit_actions)
        out(lines, event, `⇒ ${a.unit_id} · ${a.action_type} — ${truncate(a.instruction, 90)}`);
      for (const r of plan.rejected_options ?? [])
        out(lines, event, `✗ rejeté: ${r.option} — ${truncate(r.reason, 80)}`);
      for (const u of plan.uncertainties ?? []) out(lines, event, `⚠ ${u}`);
      break;
    }
    case "plan.revision.requested":
      cmd(lines, event, "review", `révision demandée par ${String(p.requested_by ?? "?")} sur ${String(p.plan_id ?? "?")}`);
      out(lines, event, `✗ ${String(p.reason ?? "—")}`);
      break;

    case "safety_review.ready": {
      const r = event.payload as unknown as SafetyReview;
      cmd(lines, event, "review", `revue ${r.review_id} → ${r.status} (plan ${r.plan_id})`);
      for (const o of r.critical_objections) out(lines, event, `✗ ${o}`);
      for (const c of r.required_changes) out(lines, event, `⚠ requis: ${c}`);
      for (const c of r.required_confirmations ?? [])
        out(lines, event, `⚠ à confirmer terrain: ${c}`);
      for (const check of r.rule_checks)
        out(
          lines,
          event,
          check.passed
            ? `⇒ ${check.rule_id} conforme${check.detail ? ` — ${truncate(check.detail, 70)}` : ""}`
            : `✗ ${check.rule_id}${check.detail ? ` — ${truncate(check.detail, 70)}` : ""}`,
        );
      break;
    }

    case "approval.requested":
      cmd(lines, event, "human", "validation commandant demandée");
      out(lines, event, "⚠ diffusion verrouillée en attendant la décision humaine (invariant #1)");
      break;
    case "approval.received": {
      const d = event.payload as unknown as ApprovalDecision;
      cmd(lines, event, "human", `décision: ${d.decision} — ${d.operator_name}`);
      out(
        lines,
        event,
        d.decision === "approve"
          ? "⇒ plan approuvé — diffusion déverrouillée"
          : `✗ plan non approuvé (${d.decision})`,
      );
      if (d.operator_note) out(lines, event, `↳ note: « ${truncate(d.operator_note, 90)} »`);
      break;
    }

    case "dispatch.instruction.ready": {
      const d = event.payload as unknown as DispatchInstruction;
      cmd(lines, event, "dispatch", `${d.dispatch_id} → ${d.unit_id} (${d.priority})`);
      out(lines, event, `⇒ « ${truncate(d.message_text)} »`);
      if (d.acknowledgement_required) out(lines, event, "↳ accusé de réception requis");
      break;
    }
    case "dispatch.sent":
      cmd(lines, event, "dispatch", `${String(p.dispatch_id ?? "?")} transmis (diffusion simulée)`);
      break;

    case "tts.started":
      cmd(
        lines,
        event,
        "tts",
        `synthèse ${String(p.dispatch_id ?? "?")}${p.engine ? ` — ${String(p.engine)}` : ""}${p.voice ? ` · ${String(p.voice)}` : ""}`,
      );
      break;
    case "tts.ready":
      cmd(
        lines,
        event,
        "tts",
        `audio prêt ${String(p.dispatch_id ?? "?")}${typeof p.latency_ms === "number" ? ` · ${p.latency_ms} ms` : ""}`,
      );
      if (p.tts_audio_path) out(lines, event, `⇒ ${String(p.tts_audio_path)}`);
      break;

    default:
      break;
  }
}

/** kebab-case agent name for the boot prompt (`attach --agent radio-intelligence`). */
function slug(id: MonitorNodeId): string {
  return id.replace("tool:", "tool-").replace(/[_:]/g, "-");
}

/**
 * The full terminal transcript of one node: boot prompt + role comment +
 * every matching event of the ordered log rendered as stdout lines.
 */
export function buildTerminalLines(
  nodeId: MonitorNodeId,
  state: IncidentState,
): TermLine[] {
  const info = nodeInfo(nodeId);
  const lines: TermLine[] = [
    {
      id: "boot",
      kind: "meta",
      text: `blaze@orchestrator:~$ attach --agent ${slug(nodeId)}`,
    },
    { id: "role", kind: "comment", text: `// ${info.role}` },
  ];
  for (const event of state.events) {
    if (nodesOfEvent(event).includes(nodeId)) eventLines(lines, event);
  }
  return lines;
}

/** True when the node terminal has no event lines yet (boot lines only). */
export function isTerminalEmpty(lines: TermLine[]): boolean {
  return !lines.some((l) => l.kind === "cmd");
}
