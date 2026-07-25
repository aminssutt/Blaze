# BLAZE — Pitch Script (3 minutes)

> Full spoken script for the live pitch, in English. Timing targets are synchronized with the live demo (see `DEMO_SCRIPT.md`). Sections marked **rehearse** must be practiced out loud and timed. Target: ~3:00 total.

---

## 1. Hook — the black box (0:00–0:15) — SPEAKER: TBD

> "When a plane goes down, we have the black box — every voice preserved, so we can understand the disaster afterwards.
> When a wildfire burns, the voices of the firefighters inside it — the most valuable data on the fireground — just evaporate.
> But a black box only speaks **after** the disaster.
> We built the one that speaks **during** it."

**rehearse** — deliver over the initial control-room view (units on map, D17 open, Gemma 4 + vLLM status green). Pause one beat after "during it" before moving on.

## 2. Problem (0:15–0:40) — SPEAKER: TBD (handoff point A)

> "Here is what a real fire sounds like: five urgent radio messages, from three different units, in a couple of minutes. Smoke, wind, blocked roads, water levels.
> The command post has to correlate all of it — by ear, from memory, under maximum stress.
> And when a correction gets lost, it's not a detail. 'The D17 only takes heavy vehicles' — miss that one message, and a light crew drives into a trap. The information existed. It was spoken. And then it was gone.
> You can't fix this with the cloud, either — on a fireground, connectivity is the first thing that dies."

**rehearse** — keep under 25 seconds. Hit three beats: the flood of messages → the lost correction (D17 example) → no cloud possible. Slow down on "It was spoken. And then it was gone."

## 3. Solution — BLAZE (0:40–1:05) — SPEAKER: TBD (handoff point B)

> "BLAZE listens to firefighter radio, transcribes it locally, and turns every message into structured operational events.
> Five specialized Gemma 4 agents — Radio Intelligence, Situation Context, Tactical Planning, Safety Critic, Dispatch — correlate those voices with live territorial data: weather, terrain, buildings, roads, hotspots. The result is a versioned tactical plan.
> Before any human sees that plan, a dedicated Safety Critic agent attacks it, looking for what could get someone killed.
> Then the human incident commander approves, modifies, or rejects. And only then does BLAZE generate personalized voice instructions for each unit — spoken by local text-to-speech, back over the radio."

**rehearse** — say this while the demo shows Audio 1–2 becoming structured events. Emphasize the order: agents → critic → **human** → dispatch.

## 4. How we built it (1:05–1:25) — SPEAKER: TBD

> "Everything runs offline, on a single NVIDIA GPU.
> Speech-to-text is faster-whisper. All five agents are Gemma 4 served by vLLM. The voices are Piper. Cloud LLM calls: zero — and the UI displays that live.
> These are not five prompts on a chatbot. Gemma 4's function calling drives real autonomous tool selection: each agent decides which territorial tools to call, and every decision lands in an auditable trace."

**rehearse** — point at the NVIDIA metrics panel (GPU name, engine, latency, tokens/s) — measured values only, never invented numbers.

## 5. Live demo (1:25–2:40) — SPEAKERS: TBD per beat (handoff point C)

Follow `DEMO_SCRIPT.md`. Beats to narrate:

1. Corrections update the world model **without erasing history** (Audio 4).
2. **Safety Critic catches a real risk** (Alpha 3: 30% water, near-zero visibility) and forces a revision.
3. Hazard confirmation (gas cylinders) adds an exclusion zone.
4. **Human clicks Approve** — dispatch was impossible before this click.
5. Per-unit French voice instructions play, generated locally by Piper.
6. **Network blackout** — everything keeps working; NVIDIA panel proves local inference.

**rehearse** — full run-through with speaker handoffs; decide who narrates which beat. Fallback narration ready if the demo switches to the backup video.

## 6. Differentiators (2:40–2:50) — SPEAKER: TBD (handoff point D)

> "Three things make BLAZE different.
> Real autonomous agents — five specialized roles, real tool selection, an auditable trace. Not a wrapper.
> Human-in-the-loop by construction — approval is a hard gate in the state machine, not a UI suggestion.
> And fully offline, honest by design — every datum labeled live, cached, seeded, or inferred. No hidden cloud, no invented benchmarks."

**rehearse** — three fingers, three sentences, ten seconds. Do not expand.

## 7. Closing — the loop (2:50–3:00) — SPEAKER: TBD (same voice as the hook, for the callback)

> "Firefighters are already the best sensors on the fireground.
> A black box would only tell you what they said — after the disaster.
> BLAZE listens while it burns."

**rehearse** — final line, pause, end. Do not add anything after "while it burns."

---

## Open items

- [ ] TODO: assign speakers per section (aminssutt / selyan-mhli / six-16) — fill every `SPEAKER: TBD` at the first rehearsal; handoff points are A (hook→problem), B (problem→solution), C (into the demo), D (demo→differentiators); hook and closing should be the same voice
- [ ] TODO: timed rehearsal x3 (target ≤ 3:10 including demo)
- [ ] TODO: fallback narration if demo must switch to backup video
- [x] Anticipated Q&A → [JURY_QA.md](JURY_QA.md) (rehearse at least: offline vs cloud GPU · what breaks first · why 5 agents)
