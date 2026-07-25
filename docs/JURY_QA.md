# BLAZE — Anticipated Jury Q&A

> Companion to [PITCH.md](PITCH.md). Answers are written to be spoken as-is after the
> 3-minute pitch. Rehearse at least: *offline vs cloud GPU*, *what breaks first*,
> *why 5 agents* — the three most likely questions.

## The GPU sizing line (pitch section 4, if asked to elaborate)

> "We sized the GPU on our real constraint — not model size, but **concurrency**: five
> Gemma agents hitting one server in parallel. The weights are the model's knowledge —
> 15 GB in bf16, full precision, no quantization because our outputs are safety-critical.
> The KV cache is its working memory, and that's what limits concurrent agents. A 24 GB
> card left almost no cache; an H100 was paying for training bandwidth we'd never use.
> The L40S at 48 GB gives us 25 GB of measured cache for a dollar an hour — best
> usable-VRAM-per-dollar on the catalog, with headroom to grow the model or the context
> without changing a line of code."

## Architecture & AI

**"Why five agents instead of one big prompt?"**

> "Separation of concerns, exactly like in software. Each agent has one job, one prompt,
> one input/output schema — so each is testable and auditable in isolation. And it's what
> makes the Safety Critic meaningful: it's genuinely adversarial because it's not the same
> context that wrote the plan. One mega-prompt can't attack its own output."

**"Why not a fine-tuned model?"**

> "Deliberate choice for this stage. Fine-tuning on the tiny amount of firefighter radio
> data we could get would mostly teach the model our five demo audios — overfitting
> dressed up as domain adaptation. Instead we constrain the base model hard: domain
> lexicon in the prompt, JSON schemas enforced by guided decoding, and an adversarial
> review stage. Fine-tuning on real corpus data from a fire service is the obvious next
> step — the architecture doesn't change."

**"What if the model mishears or hallucinates — a wrong water level, a wrong road?"**

> "Three layers. Every extraction carries an **evidence span** pointing back to the exact
> words in the transcript, plus a confidence score — nothing is presented as more certain
> than it is. The Safety Critic attacks the plan before any human sees it. And the
> commander's approval is a hard gate in the state machine: no dispatch can physically
> happen before that click. We designed for a model that will sometimes be wrong."

**"How do you know the Safety Critic actually works, and isn't just rubber-stamping?"**

> "You saw it work in the demo: Alpha reporting 30% water and near-zero visibility, and
> the Critic blocking the draft and forcing a revision. It runs with its own prompt and
> its own success criterion — finding problems — and its objections are part of the
> auditable trace shown to the commander, so a silent pass is visible too."

**"Why Gemma 4, and why the small E4B?"**

> "Gemma 4 gives us the two things this workflow lives on: native function calling —
> agents genuinely choosing territorial tools — and reliable structured output. E4B is a
> mixture-of-experts, about 4B active parameters, so it fits comfortably in full
> precision on affordable hardware. That's the point: this has to run in a command truck,
> not a datacenter."

## The offline / NVIDIA claims

**"You say offline, but your GPU is rented in a cloud…"**

> "Don't confuse a rented GPU with a cloud LLM. The Brev machine is hackathon hardware —
> the identical stack runs on any local NVIDIA box; that's literally our docker-compose.
> 'Offline' means zero calls to any external AI service: the inference client refuses
> non-local URLs, the cloud-call counter stays at zero on screen, and you watched us cut
> the network live and nothing stopped."

**"Could this run on cheaper hardware in a real truck?"**

> "Yes. Full precision E4B needs a 16 GB+ card — RTX 4080 class, consumer hardware. And
> we keep an E2B fallback that runs on 8 GB. That's a one-time hardware cost comparable
> to the radio equipment already in the vehicle, with no per-token bill and no
> subscription."

**"Is it fast enough for real operations?"**

> "Yes — the answer arrives in seconds, and the demo you just watched ran at real speed,
> unedited. But the honest framing is: BLAZE competes with a human doing manual
> correlation under stress in minutes, not with milliseconds."

## Product & reality

**"Have you validated this with actual firefighters?"**

> "Not yet, and we won't pretend otherwise — the scenario is built from public
> operational doctrine and realistic radio phrasing. That's the first post-hackathon
> step: put this in front of an SDIS command officer and let them tear the workflow
> apart. The system was designed so their corrections land in prompts and schemas, not in
> a rebuild."

**"Your demo uses prerecorded audio. What about real, noisy radio?"**

> "By design — a live demo needs a reproducible scenario. But we didn't dodge the
> problem: we have degraded, radio-noised versions of every message, and the same
> pipeline handles them. Real-world robustness — accents, cross-talk, PTT clipping — is
> exactly the kind of thing the STT stage isolates: improving it never touches the
> agents."

**"What breaks first in production?"**

> "The STT stage, honestly. Real fireground audio is much harder than our recordings.
> Second, the domain lexicon: every fire service has its own phrasing and unit naming.
> Both are at the edges of the architecture — the agent core, the state machine and the
> approval gate survive contact with reality."

**"Isn't the human approval gate a bottleneck?"**

> "It's the opposite of a bottleneck — it's the product. Today the commander correlates
> raw voices in their head; BLAZE hands them a structured, safety-reviewed,
> evidence-linked plan and asks for one decision. We compress everything before the
> decision, never the decision itself."

**"What's real in this demo and what's mocked?"**

> "Every datum on screen is labeled — live, cached, seeded, human report, or model
> inference. The five audios are scripted; the transcription, the five agents, the tool
> calls, the plan, and the voice dispatch are all computed live on the GPU next to us. No
> hidden cloud, no invented numbers."
