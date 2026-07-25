# BLAZE — Pitch Skeleton (3 minutes)

> Working skeleton for the live pitch. Sections marked **TODO: rehearse** must be practiced out loud and timed. Target: ~3:00 total, synchronized with the live demo (see `DEMO_SCRIPT.md`).

---

## 1. Hook (~0:00–0:15)

> "Firefighters already describe the battlefield every second. Every radio call is a sensor reading: smoke, wind, blocked roads, water levels, explosions. But today, those voices evaporate into the noise."

**TODO: rehearse** — deliver over the initial control-room view (units on map, D17 open, Gemma 4 + vLLM status green).

## 2. Problem (~0:15–0:35)

- Radio communications are **fragmented**: five urgent messages from three units in minutes.
- The command post must **manually correlate** everything under extreme stress — cognitive overload.
- Information gets lost, corrections get missed, and there is no live structured operational picture.
- On the fireground, **connectivity is unreliable** — cloud AI is not an option.

**TODO: rehearse** — keep under 20 seconds; one concrete example ("a correction about which vehicles can pass on D17 can be the difference between a retreat and a trap").

## 3. Solution: BLAZE (~0:35–1:00)

- BLAZE listens to firefighter radio, transcribes it locally, and turns every message into **structured operational events**.
- Five specialized **Gemma 4 agents** — Radio Intelligence, Situation Context, Tactical Planning, Safety Critic, Dispatch — correlate voices with live territorial data (weather, terrain, buildings, roads, hotspots) into a versioned tactical plan.
- A dedicated **Safety Critic agent** attacks the plan before any human sees it.
- The **human incident commander approves, modifies, or rejects** — then, and only then, BLAZE generates personalized voice instructions per unit, spoken by local TTS.

**TODO: rehearse** — say this while the demo shows Audio 1–2 becoming structured events.

## 4. Why Gemma 4 local + NVIDIA (~1:00–1:20)

- The fireground has no reliable network: **everything runs offline** — STT (faster-whisper), all five Gemma 4 agents (vLLM on an NVIDIA GPU), TTS (Piper).
- Gemma 4's function calling drives real autonomous tool selection — not a chatbot, a workflow.
- Cloud LLM calls: **zero**, displayed live in the UI.

**TODO: rehearse** — point at the NVIDIA metrics panel (GPU name, engine, latency, tokens/s) — measured values only.

## 5. Demo (~1:20–2:40)

Follow `DEMO_SCRIPT.md`. Beats to narrate:

1. Corrections update the world model **without erasing history** (Audio 4).
2. **Safety Critic catches a real risk** (Alpha 3: 30% water, near-zero visibility) and forces a revision.
3. Hazard confirmation (gas cylinders) adds an exclusion zone.
4. **Human clicks Approve** — dispatch was impossible before this click.
5. Per-unit French voice instructions play, generated locally by Piper.
6. **Network blackout** — everything keeps working; NVIDIA panel proves local inference.

**TODO: rehearse** — full run-through with speaker handoffs; decide who narrates which beat.

## 6. Differentiators (~2:40–2:55)

- **Real autonomous agents**, not a wrapper: five specialized Gemma 4 agents with separate roles, real tool selection, structured outputs, and an auditable trace.
- **An adversarial Safety Critic** that tries to break the plan before a human sees it.
- **Human-in-the-loop by construction**: approval is a hard gate in the state machine, not a UI suggestion.
- **Honest by design**: every datum labeled (live / cached / seeded / human report / model inference); no invented benchmarks; no hidden cloud.
- **Fully offline** on NVIDIA hardware — built for the place where it would actually be used.

## 7. Core statement (~2:55–3:00)

> "We are not adding another sensor to the fireground. We are unlocking the sensor that was already there: **every firefighter**."

**TODO: rehearse** — final line, pause, end.

---

## Open items

- [ ] TODO: assign speakers per section (aminssutt / selyan-mhli / six-16)
- [ ] TODO: timed rehearsal x3 (target ≤ 3:10 including demo)
- [ ] TODO: fallback narration if demo must switch to backup video
- [ ] TODO: anticipated Q&A (why not fine-tuned? why 5 agents? what breaks first in production?)
