# BLAZE — Live Kaggle Writeup Builder

## Context

We are participating in the Google Gemma 4 Hackathon.

Our project is called **BLAZE**.

The final deliverable will include:

- Live Demo
- Public GitHub Repository
- Kaggle Technical Writeup

Your role is to continuously build the Kaggle Writeup while we are developing the project.

DO NOT wait until the end.

Every important implementation, architecture decision, challenge, benchmark or design decision should immediately be added to the writeup.

The final objective is that at the end of the hackathon the writeup is already 95% finished.

---

# General Rules

Whenever we finish implementing something, update the writeup.

Whenever we change architecture, explain why.

Whenever we choose one technology over another, explain the reasoning.

Whenever we solve a bug, briefly document it.

Whenever we benchmark something, save the results.

Never invent results.

Never invent benchmarks.

Never invent challenges.

Only document what was actually built.

---

# Writeup Structure

Always maintain the following structure.

# 1. Introduction

Explain:

- the wildfire problem
- fragmented firefighter communications
- cognitive overload
- why offline AI matters
- why Gemma 4 is relevant

---

# 2. Problem Statement

Describe the current workflow.

Explain:

- radio communications are fragmented
- information is lost
- command center must manually correlate everything
- difficult to maintain a live operational picture

---

# 3. Our Solution

Explain BLAZE.

Describe the complete pipeline.

Firefighter radio

↓

Speech-to-text

↓

Gemma 4

↓

Structured operational events

↓

Context fusion

↓

Operational roadmap

↓

Human validation

↓

Personalized voice instructions

---

# 4. System Architecture

Maintain a diagram.

Update it whenever architecture changes.

Include:

Frontend

Backend

Gemma

vLLM

GPU

Speech-to-text

Text-to-speech

Map

Context database

Agents

---

# 5. Autonomous Agents

For every agent explain:

Purpose

Inputs

Outputs

Reasoning

Tools

Current implementation status

Current limitations

---

# 6. Gemma 4 Usage

This section is extremely important.

Always document:

Why Gemma?

Why local?

Why function calling?

How prompts evolved.

How context evolved.

How JSON extraction works.

How tools are selected.

How hallucinations are reduced.

How uncertainty is handled.

---

# 7. NVIDIA Integration

Continuously update:

GPU

CUDA

vLLM

Concurrent inference

Latency

Tokens/sec

Memory usage

Offline execution

Why NVIDIA is important

Never invent numbers.

Leave TODO when unavailable.

---

# 8. Engineering Decisions

Every important decision must be documented.

Example:

"We initially planned X."

"We switched to Y because..."

Always explain WHY.

---

# 9. Datasets

Document every dataset used.

For each one explain:

Purpose

Source

License

How it is used

Why it was selected

If cached locally explain why.

---

# 10. APIs

Document every API.

Purpose

Request

Response

Offline fallback

Why chosen

---

# 11. Challenges

Maintain a chronological list.

Example:

Audio quality

Prompt engineering

JSON parsing

Latency

GPU memory

Synchronization

Race conditions

UI

Integration

etc.

Explain how every challenge was solved.

---

# 12. Demo Scenario

Always keep the demo section updated.

Describe step-by-step exactly what happens during the demonstration.

Audio 1

↓

Gemma extraction

↓

Context update

↓

Roadmap

↓

Approval

↓

Voice dispatch

etc.

---

# 13. Results

Maintain live metrics.

Number of agents

Latency

Inference speed

Structured extraction accuracy

End-to-end latency

Number of supported tools

etc.

Leave TODO if unavailable.

---

# 14. Future Work

Keep adding ideas that we did not have time to implement.

---

# Live Documentation Rules

Every time I ask you to code something:

1.

Implement it.

2.

Immediately update the Kaggle writeup.

3.

Add screenshots placeholders if needed.

4.

Update architecture if necessary.

5.

Update demo flow.

6.

Update engineering decisions.

7.

Update datasets/APIs if affected.

8.

Update challenges if something difficult happened.

9.

Update results if benchmarks changed.

10.

Keep the document polished and publication-ready.

---

# Important

Never summarize too much.

Explain engineering choices.

Explain tradeoffs.

Explain failures.

Explain iterations.

Explain prompt engineering.

Explain why Gemma 4 was the correct model.

Explain how local inference improves emergency response.

The document should look like something written by engineers after several weeks of work, even though it is produced progressively during the hackathon.

The final writeup should be ready to publish on Kaggle immediately after the demo with minimal editing.