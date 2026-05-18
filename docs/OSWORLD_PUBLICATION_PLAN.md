# PRISM OSWorld Benchmark — Honest Status & Publication Plan

> **Audience:** PRISM operators, investors, and the broader agentic-AI
> evaluation community.
> **TL;DR:** PRISM has not yet been independently evaluated against the
> OSWorld benchmark. This document records why, what we'd publish if we did,
> and the conditions under which we will publish a score. The goal is to
> avoid the all-too-common pattern of cherry-picked or unverifiable
> benchmark claims in agent marketing.

## Why this document exists

OSWorld (Xie et al., 2024) is the de-facto end-to-end benchmark for computer-
use agents — 369 real-world tasks across Ubuntu, Windows, and macOS that an
agent must accomplish via mouse, keyboard, and screen pixels. Vendor-
reported OSWorld scores are increasingly cited in agent marketing material,
often without:

1. The **exact task subset** evaluated (full 369? a curated 50?).
2. The **maximum number of steps per task** allowed (steps caps drastically
   change pass rates).
3. The **model and provider** driving the agent (OSWorld measures the
   *system*, but the underlying foundation model dominates the score).
4. The **failure-mode breakdown** (timeout vs deny vs incorrect).
5. **Reproducibility artefacts** — config, scaffolding, raw traces.

PRISM's position: we will not publish an OSWorld score until we can publish
all five.

## Current status

| Field                          | Value                                              |
| ------------------------------ | -------------------------------------------------- |
| OSWorld evaluated?             | **No.**                                            |
| Reason                         | Benchmark scaffold not yet integrated.             |
| Internal smoke tests           | PRISM's own PTAC harness (28 scenarios, headed).   |
| Tier of self-test rigor        | Sandbox + host profiles, triple-gated recording.   |
| Foundation models tested       | OpenAI, Anthropic, Gemini, Ollama (local).         |
| Honest competitive benchmark   | See "Defensible claims" below.                     |

PTAC ≠ OSWorld. PTAC verifies that *PRISM's own surface* keeps working
end-to-end across releases — it's a regression and demo harness, not an
external generalisation benchmark.

## What PRISM would publish (when we run OSWorld)

When we land OSWorld evaluation, the published artefact will include:

1. **Score table** with per-domain breakdown (Office, OS, web-browsing,
   coding, multi-app workflow). Both Pass@1 and Pass@3 if budget allows.
2. **Step-cap and time-cap declarations** for every run.
3. **Driver model declaration** — e.g. "PRISM v0.21 + Anthropic Claude
   Sonnet 4.5" — and a separate run for each model class we support.
4. **Failure-mode pie chart** — `timeout / policy_deny / tool_error /
   incorrect_result / other` so readers can see *why* tasks failed.
5. **Reproducibility bundle** — Docker image hash, exact `prism-core`
   version, full config dump, raw step-level traces.
6. **Comparison table against contemporary public results**: Anthropic's
   reported OSWorld figures, the OSWorld leaderboard top-N, OpenAI
   Operator's published numbers.

## Defensible claims today (no OSWorld required)

These are claims we *can* make today without OSWorld:

- **Open-source, self-hostable, governance-native AaaS runtime.** This is a
  category claim, not a benchmark claim. Verifiable by reading the
  Apache-2.0 license and running `start_web.bat`.
- **PAD integrity provable at boot.** Verifiable by `npm run doctor` and the
  PTAC `s20` scenario.
- **28-scenario PTAC harness covers the full Tier-1/2/3 governance
  lifecycle.** Verifiable by `npm run ptac:fast`.
- **First open-source AaaS runtime with a self-driving demo recorder.**
  Verifiable by `npm run ptac:demo-recording`.

We will *not* claim:

- "Outperforms GPT-X" or "best-in-class autonomous agent" (no benchmark).
- "First AaaS technology" (Salesforce Agentforce, Sept 2024, predates).
- A specific OSWorld pass rate.

## When we'll publish OSWorld results

Conditions, all of which must hold:

1. The OSWorld scaffold is integrated as a PTAC suite (`ptac:osworld`).
2. We have run the full 369-task suite at least once on each foundation
   model class we ship (OpenAI, Anthropic, Gemini, Ollama-local).
3. Step-cap, time-cap, and failure-mode breakdowns are recorded.
4. The reproducibility bundle is published alongside the score on the
   PRISM repo (`docs/benchmarks/osworld-vN.md`).
5. The score is signed off by a maintainer who is *not* the engineer who
   ran the evaluation.

## Tracking

This document is referenced from [`docs/STATUS.md`](STATUS.md) under
"What's Pending." When OSWorld results land, the entry there will move to
"What's Shipped" and link to the per-version benchmark report.

---

*Last reviewed: 2026-05-09. Next review: when OSWorld v2 is published, or
when PRISM v0.22 ships, whichever comes first.*
