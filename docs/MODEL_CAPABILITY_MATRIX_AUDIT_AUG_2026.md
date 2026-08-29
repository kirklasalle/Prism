# Model Capability Matrix Audit & Update — August 2026

Kirk, I've completed a thorough audit of the model matrix in [model-capability-matrix.ts](file:///d:/Projects/PrismRefraction/src/core/operator/model-capability-matrix.ts). The matrix is significantly out of date — multiple entire model families have launched since the last update, existing entries have stale specs, and several deprecated models are missing lifecycle annotations. Here's the full plan.

## Key Findings

### What's Missing (Major Gaps)

| Provider | Missing Models | Significance |
|:---|:---|:---|
| **Google** | Gemini 3.7 Flash, Gemini 3.6 Flash, Gemini Omni 1.1 Flash, Gemini 3.5 Transcribe | Gemini 3.7 Flash is the current flagship workhorse — critical gap |
| **OpenAI** | GPT-5.6 Sol/Terra/Luna, o3-pro | GPT-5.6 is the current production line; o3-pro was a major reasoning model |
| **Anthropic** | Claude Fable 5, Claude Opus 5, Claude Sonnet 5 | The entire 5-series is missing — Claude 4 series was deprecated June 2026 |
| **xAI/Grok** | Grok 4.6, 4.3, 4.1 Fast | Entirely new provider not in the matrix at all |
| **Meta** | Llama 4 Scout, Llama 4 Maverick, Muse Glimmer | Major open-weight models missing |
| **DeepSeek** | DeepSeek-V4-Pro, DeepSeek-V4-Flash | V4 is the current generation, V3.1 in the matrix is outdated |
| **Mistral** | Mistral Large 3, Codestral, Magistral, Pixtral | Major models missing or outdated |
| **Qwen** | Qwen3.8-Max, Qwen3.8-Flash-Next | Current frontier models not represented |
| **Cohere** | Command A+, Command R+, North Mini Code | Missing entirely from direct API models |

### What Needs Deprecation Annotations

| Model | Status | Notes |
|:---|:---|:---|
| `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-sonnet-4`, `claude-opus-4` | **Deprecated** | Claude 4-series retired June 15, 2026 |
| `claude-3-5-sonnet`, `claude-3-7-sonnet`, `claude-3-5-haiku` | **Deprecated** | Pre-4 legacy models |
| `gpt-4o`, `gpt-4o-mini`, `gpt-4o-audio`, `gpt-4o-realtime` | **Deprecated** | GPT-4o retired from ChatGPT Feb 2026 |
| `o1`, `o1-mini`, `o1-pro`, `o3`, `o3-mini` | **Deprecated** | o3 EOL'd Aug 26, 2026; API sunset Dec 2026 |
| `o4-mini` | **Deprecated** | Retired earlier in 2026 |
| `gpt-3.5-turbo`, `gpt-4-turbo`, `gpt-4` | **Sunset** | Long deprecated |
| `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano` | **Deprecated** | Superseded by GPT-5.x series |

### What Needs Spec Updates

- `deepseek-chat` / `deepseek-reasoner` context windows need updating for V3.2 → 128K
- Gemini 3.1 Pro — should be validated as still current
- Several `gpt-5*` entries are speculative (gpt-5.5, gpt-5.5-pro) and should be deprecated in favor of the actual GPT-5.6 line

> [!IMPORTANT]
> The `detectProviderForModel()` function in [llm-provider-manager.ts](file:///d:/Projects/PrismRefraction/src/core/operator/llm-provider-manager.ts#L455-L510) also needs updating to route new model patterns (`grok-`, `llama-4-`, `muse-`, `command-a`) to the correct providers.

> [!IMPORTANT]
> The `PROVIDER_PROMPT_STRATEGIES` array needs new entries for xAI/Grok and updated patterns for the new model naming conventions.

## Proposed Changes

### 1. Model Capability Matrix — Core Update
#### [MODIFY] [model-capability-matrix.ts](file:///d:/Projects/PrismRefraction/src/core/operator/model-capability-matrix.ts)

**New model profiles to add (~30 new entries):**

**Google Gemini (6 new):**
- `gemini-3.7-flash` — T5 Frontier, 2M context, fast+reasoning+code+agentic
- `gemini-3.6-flash` — T4, 2M context, fast+reasoning+code+agentic
- `gemini-omni-1.1-flash` — T4, video-generation modality
- `gemini-3.5-transcribe` — T2, STT modality (dedicated transcription)
- Update prompt strategy notes for Gemini 3.7+ temperature and agentic instructions

**OpenAI GPT-5.6 Family (3 new):**
- `gpt-5.6-sol` — T5 Frontier, 256K context, reasoning+code+agentic+long-context
- `gpt-5.6-terra` — T4, 256K context, balanced reasoning+code
- `gpt-5.6-luna` — T3, 128K context, fast+instruction-following

**OpenAI Reasoning (1 new):**
- `o3-pro` — T5 Frontier, 200K context, reasoning+agentic

**Anthropic Claude 5-Series (3 new):**
- `claude-fable-5` — T5 Frontier, 1M context, reasoning+code+agentic (above Opus)
- `claude-opus-5` — T5 Frontier, 1M context, code+agentic
- `claude-sonnet-5` — T4, 1M context, balanced

**xAI Grok Family (3 new):**
- `grok-4.6` — T5 Frontier, 500K context, reasoning+code+agentic
- `grok-4.3` — T4, 1M context, reasoning+long-context
- `grok-4.1-fast` — T3, 2M context, fast+long-context

**Meta Llama 4 + Muse (3 new):**
- `llama-4-scout` — T4, 10M context(!), multimodal, MoE
- `llama-4-maverick` — T4, 128K context, code+reasoning
- `muse-glimmer` — T3, open-weights 30B

**DeepSeek V4 (2 new):**
- `deepseek-v4-pro` — T5, 1M context, reasoning+agentic
- `deepseek-v4-flash` — T4, 1M context, fast+reasoning

**Mistral (3 new):**
- `mistral-large-3` — T5, 262K context, MoE 675B, agentic+multilingual
- `codestral` — T4, code-specialized
- `magistral` — T4, reasoning-specialized

**Qwen (2 new):**
- `qwen3.8-max` — T5, 2.4T MoE, code+reasoning+agentic
- `qwen3.8-flash-next` — T4, hybrid architecture, fast

**Cohere (2 new):**
- `command-a-plus` — T4, MoE 25B active, agentic+tool-use
- `command-r-plus` — T4, RAG-optimized

**OpenRouter expansions (4 new):**
- `meta-llama/llama-4-maverick` 
- `meta-llama/llama-4-scout`
- `xai/grok-4.6`
- `cohere/command-a-plus`

**Deprecation annotations to add** on ~15 existing entries (see table above), including `deprecated: true`, `deprecatedAt`, `sunsetDate`, `successor`, and `deprecationReason` fields.

**Spec corrections** on existing entries where context windows, output limits, or modalities have been updated.

---

### 2. Provider Detection Update
#### [MODIFY] [llm-provider-manager.ts](file:///d:/Projects/PrismRefraction/src/core/operator/llm-provider-manager.ts)

Update `detectProviderForModel()` to recognize:
- `grok-` → xAI provider (new)
- `llama-4-` and `muse-` → Meta provider patterns
- `command-a` → Cohere
- `codestral-`, `magistral-` → Mistral
- `deepseek-v4-` → DeepSeek
- `qwen3.8-` → Qwen (via OpenRouter or direct)

---

### 3. Prompt Strategy Updates
#### [MODIFY] [model-capability-matrix.ts](file:///d:/Projects/PrismRefraction/src/core/operator/model-capability-matrix.ts)

Add new `PROVIDER_PROMPT_STRATEGIES` entries for:
- **xAI Grok** — markdown structure, explicit CoT, configurable reasoning effort
- Update **Anthropic Claude** strategy notes for Claude 5-series

Update `getModelFamily()` and `KINSHIP_MATRIX` to include `grok`, `muse`, and `cohere` families.

---

## Verification Plan

### Automated Tests
```bash
cd d:\Projects\PrismRefraction
npx tsc --noEmit
```

### Manual Verification
- Confirm `resolveProfile()` correctly resolves all new model patterns
- Confirm `detectProviderForModel()` routes new patterns to correct providers
- Confirm deprecated models have proper lifecycle status via `getDeprecationStatus()`
- Confirm new models appear in the Settings tab model matrix UI
- Spot-check `getKnownProfiles()` returns the full updated list

## Open Questions

> [!IMPORTANT]
> **xAI/Grok Provider Configuration**: The existing `PrismLlmProviderId` type doesn't include `xai` or `grok`. Adding these models to the matrix is straightforward, but enabling them as a _routable first-class provider_ would require adding the provider ID to the provider type union and default settings. For now, I'll add the Grok models under the OpenRouter provider (which handles `slash/model` patterns) and as direct API entries. Should I also scaffold the full xAI provider integration?

> [!IMPORTANT]  
> **Speculative Models**: The matrix currently has entries for `gpt-5.5`, `gpt-5.5-pro` which don't exist in reality (the actual line jumped from GPT-5 to GPT-5.6). Should I remove these speculative entries or deprecate them?

> [!IMPORTANT]
> **Claude Mythos 5**: Research mentions this as a restricted-access/benchmark model from Anthropic. Should I include it in the matrix as a T5 frontier model, or omit it since it may not be generally available?
