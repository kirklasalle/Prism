# The Model Matrix — Critical Audit & World-Class Roadmap

**Prism Refraction · Cognitive Routing & the Refraction Spectrum**
Author: prepared for Kirk LaSalle · Status: Proposed · Scope: additive-only (Frontend Protection Guarantee honored)

---

## 0. Executive Summary

The **Model Matrix** is Prism's brain-stem: it maps every reachable model — from a 1B local Gemma to a trillion-parameter frontier cloud model — to a capability profile, and routes each task (and each **Spectrum Refraction** hemisphere) to a model. It works, and the engineering underneath it is strong: tiering, modality routing, deprecation lifecycle, VRAM-awareness, SR isolation invariants, and a kinship model to prevent cognitive homogenization.

But it optimizes for **one axis only: capability tier**. It is *tier-maximizing*, not *value-aware*. It has **no first-class concept of cost**, no **budget-to-frontier spectrum**, and its "Suggest from AI" buttons return **a single maximal pick** rather than a spectrum of trade-offs. Cost lives in a **separate, stale catalog** with its **own duplicate tier field** that can (and does) drift from the Matrix.

This roadmap re-centers the Matrix on a second axis — **cost/value** — and turns it into a **Refraction Spectrum engine**: pick any point from *"cheapest that still does the job"* to *"money is no object,"* for **both** the Primary model **and** the SR Left/Right refraction, and let the Matrix profile the whole spectrum with real cost, quality, and isolation math.

**The one-line thesis:** *Today the Matrix answers "what is the best model?" Tomorrow it must answer "what is the best model for this budget, this task, and this refraction — and what do I gain or lose by spending more or less?"*

---

## 1. What the Model Matrix Is Today

### 1.1 Architecture map

| Layer | File | Responsibility |
|---|---|---|
| **Capability core** | [src/core/operator/model-capability-matrix.ts](../src/core/operator/model-capability-matrix.ts) | `ModelCapabilityProfile`, `KNOWN_PROFILES`, runtime profiles, `resolveProfile()`, `selectModelForRole()`, `ROLE_REQUIREMENTS`, modality routing, SR validation/kinship/triad, adaptive prompt builder |
| **Pricing (separate)** | [src/core/operator/usage-pricing-catalog.ts](../src/core/operator/usage-pricing-catalog.ts) | `PRICING_CATALOG`, `lookupPricing()`, `computeCostUsd()` — **its own `tier` field** |
| **Provider orchestration** | [src/core/operator/llm-provider-manager.ts](../src/core/operator/llm-provider-manager.ts) | `generateSR()` fan-out, `estimateSRCost()`, `suggestRoutingForAllRoles()`, `getSRModelCandidates()` |
| **HTTP surface** | [src/core/operator/dashboard-service.ts](../src/core/operator/dashboard-service.ts) | `/api/sr/suggest`, `/api/sr/cost-estimate`, `/api/sr/catalog` |
| **Model registry API** | [src/core/operator/routes/model-handler.ts](../src/core/operator/routes/model-handler.ts) | recommended-model catalog, GGUF scan, downloads |
| **Web UI** | [src/core/operator/public/tab-settings.js](../src/core/operator/public/tab-settings.js) | routing-strategy pills, "✨ Suggest Optimal", SR panel + "Suggest SR Models", Matrix registry editor |
| **TUI** | [src/tui/tabs/SettingsTab.tsx](../src/tui/tabs/SettingsTab.tsx) | "Model Matrix" read-only table |
| **Power mode** | [src/core/config/workspace-resolver.ts](../src/core/config/workspace-resolver.ts) | `powerMode: "performance" \| "eco" \| "adaptive"` |

### 1.2 The capability profile (today)

```ts
interface ModelCapabilityProfile {
  pattern; label; tier: 1|2|3|4|5;
  parameterSize; parametersBillions; contextWindow;
  estimatedVramMb; maxOutputTokens; adaptivePromptBudget;
  strengths[]; modalities[]; locality: "local"|"cloud";
  versionConstraint?; deprecated?; deprecatedAt?; sunsetDate?; successor?;
}
```

There is **no `costPer1MInput`, no `costPer1MOutput`, no `budgetClass`, no `valueScore`, no `latencyClass`.** Cost is entirely absent from the routing brain.

### 1.3 How selection works today

`selectModelForRole()` in [model-capability-matrix.ts](../src/core/operator/model-capability-matrix.ts) sorts candidates and walks a 5-step ladder:

1. Local meeting **ideal** tier → 2. Cloud meeting ideal → 3. Local meeting minimum (degraded) → 4. Cloud meeting minimum (degraded) → 5. Best available.

`powerMode === "eco"` merely **subtracts 1 from ideal/minimum tier** and **prefers local**. `powerMode === "adaptive"` pushes VRAM-risky local models down. **At no point does a dollar figure enter the decision.** The sort is fundamentally `tier DESC`. This is a *maximizer*.

### 1.4 The "Suggest" buttons today

- **Primary / roles** — `suggestOptimalRouting()` → `/api/llm/routing/suggest` → `suggestRoutingForAllRoles()` runs `selectModelForRole()` per role. Returns **one pick per role** = highest qualifying tier.
- **SR** — `suggestSRModels()` → `/api/sr/suggest` → sorts qualified logic/creative candidates by tier and returns **`list[0]`** (top tier), nudging Right to `list[1]` only to satisfy isolation.

Both buttons answer *"the most capable"* — never *"here is the spectrum, and here's the smart-money pick."*

---

## 2. Critical Audit Findings

Severity: 🔴 critical · 🟠 major · 🟡 moderate.

### 🔴 F1 — No cost dimension in the routing brain

The Matrix routes on tier, locality, VRAM, deprecation. Cost is invisible to `selectModelForRole()`. **You cannot ask the current Matrix "do this cheaper"** — the only lever is `eco`, which drops a whole capability tier rather than finding a cheaper model *at the same tier*. Budget scenarios are structurally impossible today.

### 🔴 F2 — Two disconnected sources of truth for tier

[model-capability-matrix.ts](../src/core/operator/model-capability-matrix.ts) assigns a `tier`, and [usage-pricing-catalog.ts](../src/core/operator/usage-pricing-catalog.ts) **independently** assigns *another* `tier`. They already diverge (e.g. `deepseek-chat` is `tier: 5` in pricing). Two catalogs, two truths, guaranteed drift. Cost and capability must be **one profile**.

### 🔴 F3 — "Suggest" returns a point, not a spectrum

The single most impactful gap versus your ask. Both suggest paths return the maximal option. There is no "Economy / Balanced / Premium / Frontier" set, no cost annotation on the suggestion, no "you'd save 94% and lose ~8% quality" framing. The UI cannot present a spectrum because the backend never computes one.

### 🟠 F4 — SR "Creative" hemisphere requires media-generation modality

`validateSRRightModel()` marks a model **insufficient** unless it has `image-generation` or `video-generation`. In a **text** refraction, this disqualifies essentially every chat/reasoning model from the Right hemisphere and **annihilates budget scenarios** (no cheap text model qualifies as "creative"). The creative hemisphere should accept **divergent/lateral text reasoning** (strengths like `reasoning`, `long-context`, high-temperature creativity) and treat media-gen as an *optional optimal bonus*, not a gate.

### 🟠 F5 — Pricing catalog is stale, manual, and silently zeroing

Comment says *"as of March 2026."* Frontier 2026 models are missing; Ollama-Cloud and local entries are all `$0`; `lookupPricing()` fuzzy-prefix matching can mis-map a model to the wrong row, and **any miss silently returns cost 0** (`computeCostUsd` → 0). Cost estimates can be confidently wrong. No refresh mechanism, no "pricing unknown" surfaced distinctly from "free."

### 🟠 F6 — `powerMode` is a 3-way toggle, not a spectrum

`performance | eco | adaptive` cannot express *"balanced"* or *"money is no object"* or a numeric budget. It is a coarse global switch, not a per-session, per-task **spend profile**. Your requested "full spectrum from cheapest to top-tier" has no home in the current model.

### 🟡 F7 — No value / efficiency metric

There is no *quality-per-dollar*, *tokens-per-dollar*, or *latency* signal. "Cheap" and "good value" are different questions ("value" = the knee of the price/quality curve). Budget users usually want **value**, not merely **cheapest**. The Matrix can express neither.

### 🟡 F8 — Cost preview is SR-only and coarse

`estimateSRCost()` exists (good!), but there's **no equivalent for the Primary single-model path**, and it hard-codes 2000/1000 token defaults. Users choosing a Primary model get no "this will cost ~$X per turn" feedback.

### 🟡 F9 — Isolation suggestion is not budget-aware

`validateSRTriad()` + kinship are excellent for *diversity*, but `/api/sr/suggest` can hand back two frontier models with perfect isolation and a brutal per-turn cost, with no budget-constrained alternative that **preserves isolation while cutting spend**.

### 🟡 F10 — Unknown-model fallback defaults to mid-tier cloud, no cost

`resolveProfile()`'s heuristic branch defaults unknown models to `tier 3` cloud with **no cost** — so an unrecognized expensive model looks free and mid-capable to the router.

---

## 3. The Vision — The Refraction Spectrum

Prism already refracts a prompt through a **spectrum** of cognition (Logic / Creative / Primary). The Model Matrix should refract **model choice** through a **spend spectrum**. Two orthogonal axes:

```
                 CAPABILITY  (tier T1 … T5)
                      ▲
   money-no-object    │   ● Frontier picks
                      │
   Premium            │   ● strong cloud
                      │
   Balanced           │   ● value knee  ◄── default "smart money"
                      │
   Value              │   ● cheap-but-capable
                      │
   Economy            │   ● local / near-free
                      └──────────────────────────►  COST ($/1M tok, blended)
```

**Design principle:** the operator picks a **Spend Profile** (a point or band on the cost axis) and a **task/role/refraction** (which sets a *minimum* capability floor). The Matrix returns the **best model at-or-above the capability floor, at-or-below the spend ceiling**, plus **the neighbors on either side** so the operator always sees "spend a little more → gain X" and "spend less → lose Y."

This is the concrete realization of your directive: *budget case scenarios, low-cost models doing the same work, profiling through all levels for Primary and SR, full spectrum from cheapest to money-no-object.*

---

## 4. New Data Model — One Profile, Two Axes

Merge pricing **into** the capability profile (kill F2), add cost + value fields (kill F1/F7).

```ts
type BudgetClass = "economy" | "value" | "balanced" | "premium" | "frontier";
type LatencyClass = "instant" | "fast" | "standard" | "slow";

interface ModelCapabilityProfile {
  /* …existing fields… */

  // ── Cost axis (single source of truth) ──
  costInputPer1M: number;     // USD; 0 = truly free (local/subscription)
  costOutputPer1M: number;    // USD
  costKnown: boolean;         // false ⇒ "unknown", NOT "free" (fixes F5)
  billingModel: "per-token" | "subscription" | "local-free";

  // ── Derived classification ──
  budgetClass: BudgetClass;   // computed from blended cost (see §5)
  latencyClass?: LatencyClass;

  // ── Value axis ──
  valueScore?: number;        // 0-100 quality-per-dollar (see §6)
  qualityIndex?: number;      // 0-100 normalized capability (independent of price)
}
```

`usage-pricing-catalog.ts` becomes a **thin override/refresh source** that *feeds* the profile at load time (a data seam), not a parallel truth. `lookupPricing()` stays for back-compat but reads from the unified profile.

---

## 5. Budget Classes — "Spend Profiles"

Replace the binary `eco` with a **named spectrum** (superset — additive; `performance/eco/adaptive` keep working as aliases):

| Spend Profile | Intent | Blended cost band (USD/1M) | Typical picks |
|---|---|---|---|
| **Economy** 🟢 | "Free / near-free, local-first" | `$0 – $0.20` | local Ollama, Gemini Flash 8B, Llama 8B (Groq) |
| **Value** 🔵 | "Cheapest that's genuinely capable" | `$0.20 – $1.00` | GPT-4o-mini, Claude 3.5 Haiku, Gemini Flash, DeepSeek V3 |
| **Balanced** ⚪ | *default* — the price/quality knee | `$1 – $5` | o3-mini/o4-mini, Mistral Large, Command R+ |
| **Premium** 🟣 | "Strong, cost is secondary" | `$5 – $20` | Claude 3.5 Sonnet, GPT-4o, o1-mini, Gemini Pro |
| **Frontier** 🔴 | "Money is no object" | `$20+` / best regardless | o1, o3, GPT-4, Claude 3 Opus |

**Blended cost** = `costInputPer1M * w_in + costOutputPer1M * w_out` with role-typical weights (e.g. reasoning skews output-heavy). Bands are config, not hard-coded, so they age gracefully.

Spend Profile is settable **globally** (preferences), **per-session**, and **per-role/hemisphere** — with the narrowest scope winning.

---

## 6. Value Score — the "Smart Money" Signal (fixes F7)

`valueScore` ranks the **knee of the price/quality curve** so "Value/Balanced" can pick *good value*, not merely *cheapest*:

```
qualityIndex   = normalize(tier, strengths, contextWindow, benchmark hints)   // 0-100
priceFactor    = 1 / (1 + blendedCostPer1M)                                   // →1 as cost→0
valueScore     = round(100 * qualityIndex/100 * priceFactor^α)               // α tunes price sensitivity
```

- **Economy/Value** profiles sort by `valueScore DESC` (best bang-per-buck at/above the floor).
- **Premium/Frontier** sort by `qualityIndex DESC` (spend for capability; value is secondary).
- **Balanced** sorts by `valueScore DESC` but only among models `qualityIndex ≥ role floor`.

This is what makes a budget scenario *smart* rather than merely *cheap*.

---

## 7. Cost-Aware Routing (fixes F1, F6)

Extend `selectModelForRole()` with a **spend-aware** sibling (additive; old signature preserved):

```ts
selectModelForRoleWithBudget(role, available, {
  spendProfile,            // Economy…Frontier
  maxCostPer1M?,           // optional hard ceiling
  isolationPeer?,          // for SR: exclude same instance / high kinship
}): ModelRouterSelectionSpectrum
```

Algorithm:

1. **Floor:** keep models with `qualityIndex ≥ ROLE_REQUIREMENTS[role].minimumTier`-equivalent.
2. **Ceiling:** keep models with `blendedCost ≤ spendProfile.band.max` (and `≤ maxCostPer1M` if set).
3. **Rank:** by `valueScore` (Economy/Value/Balanced) or `qualityIndex` (Premium/Frontier).
4. **Neighbors:** also return the top pick from the **class below** and the **class above** → the "spend less / spend more" spectrum.
5. **Fallbacks:** if the band is empty, relax the ceiling one class and flag `budgetRelaxed: true` with a reason (mirrors the existing degraded-reason UX).

Return type carries the spectrum:

```ts
interface ModelRouterSelectionSpectrum {
  chosen: ModelRouterSelection & { estCostPerTurnUsd: number; valueScore: number };
  cheaper?: ModelRouterSelection & { estCostPerTurnUsd; deltaQuality: string };  // "-8% quality, -94% cost"
  premium?: ModelRouterSelection & { estCostPerTurnUsd; deltaQuality: string };  // "+6% quality, +11× cost"
  spendProfile; budgetRelaxed: boolean; reason: string;
}
```

---

## 8. Redesigned "Suggest from AI" (fixes F3)

The buttons stop answering *"the best"* and start answering *"the spectrum."*

**Primary routing** — `/api/llm/routing/suggest` gains `?spectrum=1&spend=<profile>` and returns, per role, a **5-point ladder**:

```json
{
  "chat": {
    "economy":  { "model": "ollama/llama3",        "estPerTurnUsd": 0.000, "value": 71 },
    "value":    { "model": "openai/gpt-4o-mini",   "estPerTurnUsd": 0.001, "value": 88 },
    "balanced": { "model": "anthropic/claude-3-5-haiku", "estPerTurnUsd": 0.004, "value": 84 },
    "premium":  { "model": "openai/gpt-4o",        "estPerTurnUsd": 0.015, "value": 62 },
    "frontier": { "model": "openai/o1",            "estPerTurnUsd": 0.090, "value": 31 },
    "recommended": "value"
  }
}
```

**UI (additive):** the existing "✨ Suggest Optimal" button keeps working; a new **spend-spectrum strip** renders 5 chips (Economy→Frontier) with live `$/turn` and value badges. Clicking a chip applies that pick. The "recommended" pick is highlighted — the *smart-money* default. No existing control is removed (Frontend Protection Guarantee).

**SR** — `/api/sr/suggest` gains the same `spend` parameter and returns a **budget-aware, isolation-preserving triad** plus cheaper/premium neighbors, each with an `estimateSRCost()`-derived per-turn cost so the operator sees exactly what a refraction costs at each spend level.

---

## 9. Spectrum Refraction — Budget Profiling End-to-End (fixes F4, F9)

1. **Fix the creative gate (F4):** `validateSRRightModel()` qualifies on **divergent-text capability** (`reasoning`/`long-context`/creativity strengths, tier floor) — media generation becomes an **optimal-level bonus**, not a hard requirement. Result: cheap text models can serve the Right hemisphere → budget SR becomes real.
2. **Budget-aware triad suggestion (F9):** given a Spend Profile, choose Left (logic) + Right (creative) + Main (coordinator) that (a) satisfy role floors, (b) fit the blended budget across **all three passes** (fan-out ×3 + aggregation — the cost model already in `estimateSRCost()`), and (c) preserve isolation (`validateSRTriad` + kinship). Return the cheaper/premium neighbor triads too.
3. **Spectrum presets:** ship named SR presets that *are* the spectrum — e.g. **"Economy Refraction"** (all-local, ~$0), **"Value Refraction"** (mini/haiku/flash trio), **"Frontier Refraction"** (Opus + o1 + Sonnet). These slot into the existing SR preset system with **zero new UI primitives**.

**Illustrative SR spend spectrum (per-turn, ~2k in / 1k out, 3 fan-out + aggregation):**

| Refraction preset | Left (Logic) | Right (Creative) | Main | ~ $/turn |
|---|---|---|---|---|
| Economy | local Llama 3 | local Mistral | local Phi-3 | ~$0.00 |
| Value | GPT-4o-mini | Claude 3.5 Haiku | Gemini Flash | ~$0.01 |
| Balanced | o4-mini | Mistral Large | GPT-4o-mini | ~$0.05 |
| Premium | Claude 3.5 Sonnet | GPT-4o | Claude 3.5 Haiku | ~$0.20 |
| Frontier | o1 | Claude 3 Opus | GPT-4o | ~$0.80 |

*(Numbers illustrative — computed live from the unified profile; the point is the operator sees the full ramp and its price, then chooses.)*

---

## 10. Phased Roadmap

### Phase 0 — Foundation: unify cost into the Matrix *(fixes F2, F5, F10)*

- Add cost/value fields to `ModelCapabilityProfile`; seed from `usage-pricing-catalog.ts`.
- Make `lookupPricing()` read the unified profile; keep the catalog as a refreshable override seam.
- Distinguish **unknown** cost from **free** (`costKnown`); surface "pricing unknown" in UI.
- Backfill 2026 frontier + Ollama-Cloud + local profiles; add a "pricing last-verified" date.
- **Exit:** every routed model has a known-or-flagged cost; one tier truth.

### Phase 1 — Budget classes & value score *(fixes F6, F7)*

- Implement `budgetClass` derivation + configurable bands; `qualityIndex` + `valueScore`.
- Add `spendProfile` to preferences + per-session/per-role scope; alias existing `powerMode`.
- **Exit:** any model classifiable Economy→Frontier; value ranking available.

### Phase 2 — Cost-aware routing *(fixes F1)*

- Ship `selectModelForRoleWithBudget()` + `ModelRouterSelectionSpectrum` (additive; old API intact).
- Wire `/api/llm/routing/suggest?spectrum=1&spend=`.
- Add a **Primary-path cost preview** (`estimatePrimaryCost`) mirroring `estimateSRCost()` (fixes F8).
- **Exit:** routing honors budget with graceful relax + reasons.

### Phase 3 — Spectrum "Suggest" UX *(fixes F3)* — additive UI only

- 5-chip spend-spectrum strip beside existing "✨ Suggest Optimal"; live `$/turn` + value + "recommended".
- Cheaper/premium neighbor hints ("-8% quality, -94% cost").
- Mirror in TUI "Model Matrix" tab as extra columns (cost, budgetClass, value).
- **Exit:** operators see and pick the full spectrum for the Primary model.

### Phase 4 — SR budget refraction *(fixes F4, F9)*

- Reframe `validateSRRightModel()` (divergent-text; media = bonus).
- Budget-aware isolation-preserving triad suggestion; ship Economy/Value/Balanced/Premium/Frontier SR presets.
- Per-turn SR cost shown at each spend level.
- **Exit:** full SR spectrum from ~$0 local to frontier, isolation preserved.

### Phase 5 — Learning & guardrails

- Feed real usage (`usage-metering-service.ts`) back into `valueScore` (observed cost + success).
- **Budget ceilings & alerts:** per-session/day spend caps with soft warnings.
- **Auto-downshift:** when a cheaper model succeeds on a task class N times, suggest it as the new default for that class ("this workflow ran fine on Value — save 12×?").
- **Exit:** the Matrix *learns* the cheapest model that reliably does each job — your core budget thesis, automated.

---

## 11. Success Metrics

| KPI | Baseline (today) | Target |
|---|---|---|
| Models with known cost in profile | ~40% (catalog only) | 100% (or flagged unknown) |
| Tier sources of truth | 2 (drifting) | 1 |
| "Suggest" options presented | 1 (max) | 5 (Economy→Frontier) |
| Cost visible before running a turn | SR only | Primary + SR |
| Text models eligible for SR Right | ~0 | all with divergent-text capability |
| Avg $/task after "Value" adoption | — | ≥ 80% reduction vs frontier default at ≤ ~10% quality delta |

---

## 12. Risks & Mitigations

- **Pricing drift** → `costKnown` + last-verified date + refresh seam; never silently zero (F5).
- **Value-score gaming a weak model into "best value"** → hard capability floor per role before value ranking.
- **Frontend regressions** → strictly additive per the Frontend Protection Guarantee; existing buttons/flows untouched, spectrum controls sit *beside* them.
- **Over-aggressive auto-downshift** → suggestion-only by default; require N successes + operator opt-in before changing a default.
- **Cost model inaccuracy on cached/batched pricing** → treat estimates as advisory ranges, refine from real metering in Phase 5.

---

## 13. Appendix A — Proposed Interfaces (reference)

```ts
type BudgetClass = "economy" | "value" | "balanced" | "premium" | "frontier";

interface SpendProfile {
  class: BudgetClass;
  maxBlendedCostPer1M: number;   // ceiling
  rankBy: "value" | "quality";   // Economy/Value/Balanced→value, Premium/Frontier→quality
}

interface ModelRouterSelectionSpectrum {
  chosen: ModelRouterSelection & { estCostPerTurnUsd: number; valueScore: number; budgetClass: BudgetClass };
  cheaper?: NeighborPick;   // one class down
  premium?: NeighborPick;   // one class up
  spendProfile: BudgetClass;
  budgetRelaxed: boolean;
  reason: string;
}

interface NeighborPick {
  providerId: string; model: string; tier: number;
  estCostPerTurnUsd: number; deltaQuality: string; // e.g. "-8% quality, -94% cost"
}
```

## 14. Appendix B — File-Level Change Map (additive)

| Change | File |
|---|---|
| Cost/value fields, budgetClass/valueScore helpers, `selectModelForRoleWithBudget()` | [model-capability-matrix.ts](../src/core/operator/model-capability-matrix.ts) |
| Feed unified profile; unknown≠free; refresh seam | [usage-pricing-catalog.ts](../src/core/operator/usage-pricing-catalog.ts) |
| `estimatePrimaryCost()`, spectrum SR suggest, budget-aware triad | [llm-provider-manager.ts](../src/core/operator/llm-provider-manager.ts) |
| `?spectrum`/`?spend` params on suggest + cost-estimate | [dashboard-service.ts](../src/core/operator/dashboard-service.ts) |
| Spend-spectrum strip beside "Suggest Optimal"; SR spectrum chips | [tab-settings.js](../src/core/operator/public/tab-settings.js) |
| Cost/budgetClass/value columns | [SettingsTab.tsx](../src/tui/tabs/SettingsTab.tsx) |
| `spendProfile` preference (alias powerMode) | [workspace-resolver.ts](../src/core/config/workspace-resolver.ts) |

---

*"The Matrix should not just find the sharpest lens — it should show you the whole spectrum of lenses and the price of light through each."*
