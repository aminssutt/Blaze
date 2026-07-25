# BLAZE — Demo Script (3 minutes)

Target duration: **approximately 3 minutes** (0:00 → 3:10). The demo is a scripted but **genuinely executed** crisis scenario: all Gemma reasoning, tool selection, plan generation, safety review and dispatch generation are real. External API responses may be cached locally for reliability and offline demonstration.

## The five prerecorded French radio audios

| # | Speaker | Message (French) | Key expected effect |
|---|---|---|---|
| 1 | Alpha 3 | « Alpha 3 au PC, fumée noire très dense près du hangar. La D17 est bloquée pour notre CCF et on entend plusieurs explosions. » | Dense smoke near hangar; D17 blocked for CCF; explosions heard but **unconfirmed**; high urgency |
| 2 | Alpha 3 | « Alpha 3, mise à jour : il nous reste environ trente pour cent d'eau et la visibilité devient presque nulle. » | Alpha 3 water → 30%; visibility critical; mission must be reassessed |
| 3 | Bravo 2 | « Bravo 2 au PC, le vent vient de tourner vers le sud-est. Le feu progresse beaucoup plus vite vers la D17. » | Field-reported wind shift; conflicts with/updates weather context; propagation risk increases |
| 4 | Alpha 3 | « Alpha 3 au poste de commandement. Correction concernant la D17 : la route n'est pas totalement bloquée, mais elle reste inaccessible aux camions lourds. Les véhicules légers peuvent encore passer par le côté nord. » | **Correction**: D17 restricted by vehicle type; previous event updated, not duplicated. Charlie 1 (light vehicle) is then tasked to verify. |
| 5 | Bravo 2 | « Bravo 2 au PC, explosions confirmées derrière le hangar. Présence possible de bouteilles de gaz. On reste à distance. » | Explosions **confirmed**; possible gas cylinders; exclusion perimeter required |

The demo defaults to the **radio-degraded** versions of these audios, with a one-click fallback to clean audio.

---

## Minute-by-minute flow

### 0:00–0:20 — Human problem and initial state

Show:

- Alpha 3 assigned to reach Sector B12 through D17;
- Alpha 3 at 65% water;
- Bravo 2 available for reconnaissance;
- Charlie 1 on a light vehicle;
- D17 initially open;
- local Gemma 4 and vLLM running on NVIDIA (visible in the header/status bar).

Narration goal:

> Firefighters already communicate critical information over radio, but those messages are fragmented and difficult to correlate under stress.

### 0:20–0:45 — Start incident and parallel processing

Click **`Start incident`**.

The system visibly launches, **in parallel**:

- five audio transcriptions (concurrent faster-whisper);
- context collection tools (weather, elevation, cadastre, OSM, FIRMS, units/resources);
- cached/live status checks.

### 0:45–1:10 — Audio 1 and 2 become operational events

Release Audio 1 and Audio 2 according to their scenario timestamps.

Show:

- raw transcript;
- Radio Intelligence extraction (structured `RadioEvent` cards);
- D17 becomes **blocked for CCF**;
- explosions remain **unconfirmed**;
- Alpha 3 water falls to 30%;
- visibility becomes critical.

### 1:10–1:30 — Context correlation

Show tool results in the agent/tool trace:

- wind and humidity;
- elevation/terrain;
- cadastral hangar/buildings;
- roads and water point;
- FIRMS hotspot, if available in the cached scenario;
- unit and resource state.

The Situation Context Agent produces **one snapshot with provenance** (source badges: live / cached / seeded).

### 1:30–1:50 — Audio 3 and 4 update the world model

Show:

- field-reported wind shift;
- D17 risk increases;
- **correction**: D17 is accessible to light vehicles but not CCF;
- the previous event is **corrected, not deleted** (audit trail visible);
- map styling changes by vehicle type.

### 1:50–2:10 — Draft plan and Safety Critic ⭐ key moment

The Tactical Planning Agent proposes an initial plan.

The **Safety Critic must identify at least one material risk**, such as:

- Alpha 3 has insufficient water and near-zero visibility;
- the alternative route adds unsafe travel time;
- D17 restriction is vehicle-specific;
- explosions/hazardous materials require an exclusion perimeter;
- a route may conflict with the reported wind shift.

The planning agent revises the plan, or the critic returns a `revise` status.

### 2:10–2:25 — Audio 5 confirms hazard

Show:

- explosions **confirmed**;
- possible gas cylinders;
- exclusion zone added on the map;
- reconnaissance unit remains at distance;
- final plan version generated.

### 2:25–2:40 — Human validation ⭐ key moment

The incident commander sees:

- unit-specific actions;
- evidence;
- uncertainties;
- Safety Critic review.

The presenter clicks **`Approve plan`**. (Until this click, dispatch controls are disabled.)

### 2:40–2:55 — Dispatch and TTS ⭐ key moment

The Dispatch Agent creates concise approved messages — one per unit. Expected outputs:

**Alpha 3**

> « Alpha 3, mission d'attaque annulée. Repli par l'accès nord vers le point d'eau 2. D17 interdite aux CCF. Accusez réception. »

**Bravo 2**

> « Bravo 2, maintenez une reconnaissance à distance du hangar. Suspicion de bouteilles de gaz. N'entrez pas dans le périmètre d'exclusion. Accusez réception. »

**Charlie 1**

> « Charlie 1, confirmez l'accès D17 pour véhicules légers uniquement et restez hors du corridor de propagation. »

**Piper generates and plays the messages locally** (one WAV per unit).

### 2:55–3:10 — Offline and NVIDIA proof ⭐ key moment

Switch to **`Network blackout`**.

Show:

- cloud unavailable;
- Gemma 4 still operational locally;
- vLLM operational;
- cached territorial data available;
- STT and TTS local;
- **measured NVIDIA inference panel**: GPU name, engine, model, Gemma latency, end-to-end latency, tokens/s (when available), agent calls, concurrent requests, cloud LLM calls = 0.

Final narration:

> We are not adding another sensor to the fireground. We are unlocking the sensor that was already there: every firefighter.

---

## Reset & rerun procedure

> **TODO** — to be completed once the reset endpoint and demo controller are implemented. Must cover:
>
> - [ ] TODO: single-command / single-click scenario reset (backend state machine back to `IDLE`, plan versions cleared, event stream reset)
> - [ ] TODO: verification checklist before going on stage (vLLM health check, GPU visible, faster-whisper model loaded, Piper voice loaded, caches present)
> - [ ] TODO: how to switch clean/radio audio fallback mid-demo
> - [ ] TODO: how to activate each fallback level (cached data, reference transcripts, pre-generated TTS, precomputed agent events, backup video)
> - [ ] TODO: expected total rerun time and how many consecutive reruns were tested
