/**
 * Usage Pricing Catalog
 * USD rates per 1,000,000 tokens (input / output) for known providers + models.
 * Pricing sourced from public provider pages.
 * Extend as needed — `lookupPricing()` does fuzzy prefix matching.
 */

/** ISO date the pricing figures below were last verified. Surfaced by the Matrix "Update" button. */
export const PRICING_VERIFIED_AT = "2026-08-29";

export interface ModelPricing {
    inputPer1M: number; // USD per 1M input tokens
    outputPer1M: number; // USD per 1M output tokens
    label?: string; // friendly label for UI
    tier?: number; // capability tier 1-5 (matches model-capability-matrix)
    verifiedAt?: string; // ISO date this row was last verified (defaults to PRICING_VERIFIED_AT)
}

/** Catalog keyed by "<providerId>/<modelPattern>" — patterns are prefix-matched. */
export const PRICING_CATALOG: Record<string, ModelPricing> = {
    // ── OpenAI ────────────────────────────────────────────────────────────────
    "openai/gpt-5.6-sol": { inputPer1M: 1.25, outputPer1M: 10.0, label: "GPT-5.6 Sol", tier: 5 },
    "openai/gpt-5.6-terra": { inputPer1M: 0.5, outputPer1M: 3.0, label: "GPT-5.6 Terra", tier: 4 },
    "openai/gpt-5.6-luna": { inputPer1M: 0.15, outputPer1M: 0.6, label: "GPT-5.6 Luna", tier: 3 },
    "openai/gpt-5": { inputPer1M: 1.25, outputPer1M: 10.0, label: "GPT-5", tier: 5 },
    "openai/gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2.0, label: "GPT-5 mini", tier: 4 },
    "openai/o3-pro": { inputPer1M: 15.0, outputPer1M: 60.0, label: "o3 Pro", tier: 5 },
    "openai/gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0, label: "GPT-4o", tier: 5 },
    "openai/gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6, label: "GPT-4o mini", tier: 3 },
    "openai/gpt-4-turbo": { inputPer1M: 10.0, outputPer1M: 30.0, label: "GPT-4 Turbo", tier: 5 },
    "openai/gpt-4": { inputPer1M: 30.0, outputPer1M: 60.0, label: "GPT-4", tier: 5 },
    "openai/gpt-3.5-turbo": { inputPer1M: 0.5, outputPer1M: 1.5, label: "GPT-3.5 Turbo", tier: 2 },
    "openai/o1": { inputPer1M: 15.0, outputPer1M: 60.0, label: "o1", tier: 5 },
    "openai/o1-mini": { inputPer1M: 3.0, outputPer1M: 12.0, label: "o1 mini", tier: 4 },
    "openai/o3": { inputPer1M: 10.0, outputPer1M: 40.0, label: "o3", tier: 5 },
    "openai/o3-mini": { inputPer1M: 1.1, outputPer1M: 4.4, label: "o3 mini", tier: 4 },
    "openai/o4-mini": { inputPer1M: 1.1, outputPer1M: 4.4, label: "o4 mini", tier: 4 },

    // ── Anthropic ─────────────────────────────────────────────────────────────
    "anthropic/claude-fable-5": { inputPer1M: 15.0, outputPer1M: 75.0, label: "Claude Fable 5", tier: 5 },
    "anthropic/claude-opus-5": { inputPer1M: 15.0, outputPer1M: 75.0, label: "Claude Opus 5", tier: 5 },
    "anthropic/claude-sonnet-5": { inputPer1M: 3.0, outputPer1M: 15.0, label: "Claude Sonnet 5", tier: 4 },
    "anthropic/claude-mythos-5": { inputPer1M: 25.0, outputPer1M: 125.0, label: "Claude Mythos 5", tier: 5 },
    "anthropic/claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4.0, label: "Claude Haiku 4.5", tier: 3 },
    "anthropic/claude-opus-4": { inputPer1M: 15.0, outputPer1M: 75.0, label: "Claude Opus 4", tier: 5 },
    "anthropic/claude-sonnet-4": { inputPer1M: 3.0, outputPer1M: 15.0, label: "Claude Sonnet 4", tier: 5 },
    "anthropic/claude-3-5-sonnet": { inputPer1M: 3.0, outputPer1M: 15.0, label: "Claude 3.5 Sonnet", tier: 5 },
    "anthropic/claude-3-5-haiku": { inputPer1M: 0.8, outputPer1M: 4.0, label: "Claude 3.5 Haiku", tier: 3 },
    "anthropic/claude-3-opus": { inputPer1M: 15.0, outputPer1M: 75.0, label: "Claude 3 Opus", tier: 5 },
    "anthropic/claude-3-sonnet": { inputPer1M: 3.0, outputPer1M: 15.0, label: "Claude 3 Sonnet", tier: 4 },
    "anthropic/claude-3-haiku": { inputPer1M: 0.25, outputPer1M: 1.25, label: "Claude 3 Haiku", tier: 2 },
    "anthropic/claude-2": { inputPer1M: 8.0, outputPer1M: 24.0, label: "Claude 2", tier: 4 },

    // ── Google ────────────────────────────────────────────────────────────────
    "google/gemini-3.7-flash": { inputPer1M: 0.1, outputPer1M: 0.4, label: "Gemini 3.7 Flash", tier: 5 },
    "google/gemini-3.6-flash": { inputPer1M: 0.1, outputPer1M: 0.4, label: "Gemini 3.6 Flash", tier: 4 },
    "google/gemini-omni-1.1-flash": { inputPer1M: 0.15, outputPer1M: 0.6, label: "Gemini Omni 1.1 Flash", tier: 4 },
    "google/gemini-3.1-pro": { inputPer1M: 3.5, outputPer1M: 10.5, label: "Gemini 3.1 Pro", tier: 5 },
    "google/gemini-3.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4, label: "Gemini 3.0 Flash", tier: 4 },
    "google/gemini-3-flash": { inputPer1M: 0.1, outputPer1M: 0.4, label: "Gemini 3 Flash", tier: 4 },
    "google/gemini-2.5-flash": { inputPer1M: 0.1, outputPer1M: 0.4, label: "Gemini 2.5 Flash", tier: 4 },
    "google/gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4, label: "Gemini 2.0 Flash", tier: 4 },
    "google/gemini-2.0-pro": { inputPer1M: 3.5, outputPer1M: 10.5, label: "Gemini 2.0 Pro", tier: 5 },
    "google/gemini-1.5-pro": { inputPer1M: 3.5, outputPer1M: 10.5, label: "Gemini 1.5 Pro", tier: 5 },
    "google/gemini-1.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3, label: "Gemini 1.5 Flash", tier: 3 },
    "google/gemini-1.5-flash-8b": { inputPer1M: 0.0375, outputPer1M: 0.15, label: "Gemini 1.5 Flash 8B", tier: 2 },

    // ── xAI ───────────────────────────────────────────────────────────────────
    "xai/grok-4.6": { inputPer1M: 3.0, outputPer1M: 15.0, label: "Grok 4.6", tier: 5 },
    "xai/grok-4.3": { inputPer1M: 1.5, outputPer1M: 6.0, label: "Grok 4.3", tier: 4 },
    "xai/grok-4.1-fast": { inputPer1M: 0.2, outputPer1M: 0.8, label: "Grok 4.1 Fast", tier: 3 },
    "xai/grok-2": { inputPer1M: 2.0, outputPer1M: 10.0, label: "Grok 2", tier: 4 },

    // ── Mistral ───────────────────────────────────────────────────────────────
    "mistral/mistral-large-3": { inputPer1M: 2.0, outputPer1M: 6.0, label: "Mistral Large 3", tier: 5 },
    "mistral/mistral-large": { inputPer1M: 2.0, outputPer1M: 6.0, label: "Mistral Large", tier: 4 },
    "mistral/mistral-small": { inputPer1M: 0.2, outputPer1M: 0.6, label: "Mistral Small", tier: 3 },
    "mistral/mistral-medium": { inputPer1M: 2.7, outputPer1M: 8.1, label: "Mistral Medium", tier: 4 },
    "mistral/codestral": { inputPer1M: 0.2, outputPer1M: 0.6, label: "Codestral", tier: 4 },
    "mistral/magistral": { inputPer1M: 1.5, outputPer1M: 4.5, label: "Magistral", tier: 4 },
    "mistral/pixtral-large": { inputPer1M: 2.0, outputPer1M: 6.0, label: "Pixtral Large", tier: 4 },
    "mistral/mistral-7b": { inputPer1M: 0.25, outputPer1M: 0.25, label: "Mistral 7B", tier: 2 },

    // ── Groq ──────────────────────────────────────────────────────────────────
    "groq/llama-3.1-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79, label: "Llama 3.1 70B (Groq)", tier: 4 },
    "groq/llama-3.1-8b-instant": { inputPer1M: 0.05, outputPer1M: 0.08, label: "Llama 3.1 8B (Groq)", tier: 2 },
    "groq/llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79, label: "Llama 3.3 70B (Groq)", tier: 4 },
    "groq/mixtral-8x7b": { inputPer1M: 0.24, outputPer1M: 0.24, label: "Mixtral 8x7B (Groq)", tier: 3 },

    // ── DeepSeek ──────────────────────────────────────────────────────────────
    "deepseek/deepseek-v4-pro": { inputPer1M: 0.27, outputPer1M: 1.1, label: "DeepSeek V4 Pro", tier: 5 },
    "deepseek/deepseek-v4-flash": { inputPer1M: 0.1, outputPer1M: 0.4, label: "DeepSeek V4 Flash", tier: 4 },
    "deepseek/deepseek-chat": { inputPer1M: 0.27, outputPer1M: 1.1, label: "DeepSeek V3", tier: 4 },
    "deepseek/deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19, label: "DeepSeek R1", tier: 5 },

    // ── Cohere ────────────────────────────────────────────────────────────────
    "cohere/command-a-plus": { inputPer1M: 2.5, outputPer1M: 10.0, label: "Command A+", tier: 4 },
    "cohere/command-r-plus": { inputPer1M: 2.5, outputPer1M: 10.0, label: "Command R+", tier: 4 },
    "cohere/command-r": { inputPer1M: 0.15, outputPer1M: 0.6, label: "Command R", tier: 3 },
    "cohere/north-mini-code": { inputPer1M: 0.2, outputPer1M: 0.8, label: "North Mini Code", tier: 3 },

    // ── Perplexity ────────────────────────────────────────────────────────────
    "perplexity/sonar-pro": { inputPer1M: 3.0, outputPer1M: 15.0, label: "Sonar Pro", tier: 4 },
    "perplexity/sonar": { inputPer1M: 1.0, outputPer1M: 1.0, label: "Sonar", tier: 3 },

    // ── Together ──────────────────────────────────────────────────────────────
    "together/meta-llama-3.1-70b-instruct": {
        inputPer1M: 0.88,
        outputPer1M: 0.88,
        label: "Llama 3.1 70B (Together)",
        tier: 4,
    },
    "together/meta-llama-3.1-8b-instruct": {
        inputPer1M: 0.18,
        outputPer1M: 0.18,
        label: "Llama 3.1 8B (Together)",
        tier: 2,
    },

    // ── Fireworks ─────────────────────────────────────────────────────────────
    "fireworks/accounts-fireworks-models-llama-v3p1-70b-instruct": {
        inputPer1M: 0.9,
        outputPer1M: 0.9,
        label: "Llama 3.1 70B (Fireworks)",
        tier: 4,
    },

    // ── OpenRouter (passthrough — zero markup row) ────────────────────────────
    "openrouter/auto": { inputPer1M: 0, outputPer1M: 0, label: "OpenRouter (auto)", tier: 0 },

    // ── Local / Ollama ────────────────────────────────────────────────────────
    "ollama/llama3": { inputPer1M: 0, outputPer1M: 0, label: "Llama 3 (local)", tier: 3 },
    "ollama/mistral": { inputPer1M: 0, outputPer1M: 0, label: "Mistral (local)", tier: 3 },
    "ollama/phi3": { inputPer1M: 0, outputPer1M: 0, label: "Phi-3 (local)", tier: 2 },
    "lmstudio/local": { inputPer1M: 0, outputPer1M: 0, label: "LM Studio (local)", tier: 0 },

    // ── Ollama Cloud (Subscription based — $0 per-token) ──────────────────────
    "ollama-cloud/gpt-oss:120b": { inputPer1M: 0, outputPer1M: 0, label: "GPT-OSS 120B (Cloud)", tier: 5 },
    "ollama-cloud/gpt-oss:20b": { inputPer1M: 0, outputPer1M: 0, label: "GPT-OSS 20B (Cloud)", tier: 4 },
    "ollama-cloud/deepseek-v3.1:671b": { inputPer1M: 0, outputPer1M: 0, label: "DeepSeek V3.1 671B (Cloud)", tier: 5 },
    "ollama-cloud/kimi-k2:1t": { inputPer1M: 0, outputPer1M: 0, label: "Kimi K2 1T (Cloud)", tier: 5 },
    "ollama-cloud/qwen3-coder:480b": { inputPer1M: 0, outputPer1M: 0, label: "Qwen3 Coder 480B (Cloud)", tier: 5 },
    "ollama-cloud/kimi-k2-thinking": { inputPer1M: 0, outputPer1M: 0, label: "Kimi K2 Thinking (Cloud)", tier: 5 },
};

/**
 * Lookup pricing for a given provider + model.
 *
 * Matching strategy (first-match wins, case-insensitive):
 *   1. Exact key  "<provider>/<model>"
 *   2. Prefix key — catalog key is a prefix of "<provider>/<model>"
 *   3. Model-only prefix — catalog key (after the slash) is a prefix of model
 *
 * Returns `null` if no match (UI should treat as "unknown / free").
 */
export function lookupPricing(provider: string, model: string): ModelPricing | null {
    const needle = `${provider.toLowerCase()}/${model.toLowerCase()}`;

    // 1. Exact match
    if (PRICING_CATALOG[needle]) return PRICING_CATALOG[needle];

    // 2. Catalog key is a prefix of the needle
    for (const key of Object.keys(PRICING_CATALOG)) {
        if (needle.startsWith(key.toLowerCase())) return PRICING_CATALOG[key];
    }

    // 3. Match only on the model portion (provider-agnostic fallback)
    const modelLower = model.toLowerCase();
    for (const key of Object.keys(PRICING_CATALOG)) {
        const catalogModel = key.split("/")[1];
        if (catalogModel && modelLower.startsWith(catalogModel)) return PRICING_CATALOG[key];
    }

    return null;
}

/**
 * Compute the USD cost for a single LLM call.
 * Returns 0 if no pricing data found (local/unknown models).
 */
export function computeCostUsd(provider: string, model: string, inputTokens: number, outputTokens: number): number {
    const pricing = lookupPricing(provider, model);
    if (!pricing) return 0;
    return (inputTokens / 1_000_000) * pricing.inputPer1M + (outputTokens / 1_000_000) * pricing.outputPer1M;
}

/**
 * Whether we have a pricing row for this provider/model at all.
 * Distinguishes "pricing unknown" (no row) from "free" (row with $0), which
 * `computeCostUsd` conflates by returning 0 for both.
 */
export function hasPricing(provider: string, model: string): boolean {
    return lookupPricing(provider, model) !== null;
}

/** Count of catalog rows — surfaced by the Matrix "Update" button. */
export function getPricingCatalogSize(): number {
    return Object.keys(PRICING_CATALOG).length;
}
