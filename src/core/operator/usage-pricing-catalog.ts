/**
 * Usage Pricing Catalog
 * USD rates per 1,000,000 tokens (input / output) for known providers + models.
 * Pricing sourced from public provider pages as of March 2026.
 * Extend as needed — `lookupPricing()` does fuzzy prefix matching.
 */

export interface ModelPricing {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
  label?: string;       // friendly label for UI
  tier?: number;        // capability tier 1-5 (matches model-capability-matrix)
}

/** Catalog keyed by "<providerId>/<modelPattern>" — patterns are prefix-matched. */
export const PRICING_CATALOG: Record<string, ModelPricing> = {
  // ── OpenAI ────────────────────────────────────────────────────────────────
  "openai/gpt-4o": { inputPer1M: 2.50, outputPer1M: 10.00, label: "GPT-4o", tier: 5 },
  "openai/gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60, label: "GPT-4o mini", tier: 3 },
  "openai/gpt-4-turbo": { inputPer1M: 10.00, outputPer1M: 30.00, label: "GPT-4 Turbo", tier: 5 },
  "openai/gpt-4": { inputPer1M: 30.00, outputPer1M: 60.00, label: "GPT-4", tier: 5 },
  "openai/gpt-3.5-turbo": { inputPer1M: 0.50, outputPer1M: 1.50, label: "GPT-3.5 Turbo", tier: 2 },
  "openai/o1": { inputPer1M: 15.00, outputPer1M: 60.00, label: "o1", tier: 5 },
  "openai/o1-mini": { inputPer1M: 3.00, outputPer1M: 12.00, label: "o1 mini", tier: 4 },
  "openai/o3": { inputPer1M: 10.00, outputPer1M: 40.00, label: "o3", tier: 5 },
  "openai/o3-mini": { inputPer1M: 1.10, outputPer1M: 4.40, label: "o3 mini", tier: 4 },
  "openai/o4-mini": { inputPer1M: 1.10, outputPer1M: 4.40, label: "o4 mini", tier: 4 },

  // ── Anthropic ─────────────────────────────────────────────────────────────
  "anthropic/claude-3-5-sonnet": { inputPer1M: 3.00, outputPer1M: 15.00, label: "Claude 3.5 Sonnet", tier: 5 },
  "anthropic/claude-3-5-haiku": { inputPer1M: 0.80, outputPer1M: 4.00, label: "Claude 3.5 Haiku", tier: 3 },
  "anthropic/claude-3-opus": { inputPer1M: 15.00, outputPer1M: 75.00, label: "Claude 3 Opus", tier: 5 },
  "anthropic/claude-3-sonnet": { inputPer1M: 3.00, outputPer1M: 15.00, label: "Claude 3 Sonnet", tier: 4 },
  "anthropic/claude-3-haiku": { inputPer1M: 0.25, outputPer1M: 1.25, label: "Claude 3 Haiku", tier: 2 },
  "anthropic/claude-2": { inputPer1M: 8.00, outputPer1M: 24.00, label: "Claude 2", tier: 4 },

  // ── Google ────────────────────────────────────────────────────────────────
  "google/gemini-1.5-pro": { inputPer1M: 3.50, outputPer1M: 10.50, label: "Gemini 1.5 Pro", tier: 5 },
  "google/gemini-1.5-flash": { inputPer1M: 0.075, outputPer1M: 0.30, label: "Gemini 1.5 Flash", tier: 3 },
  "google/gemini-1.5-flash-8b": { inputPer1M: 0.0375, outputPer1M: 0.15, label: "Gemini 1.5 Flash 8B", tier: 2 },
  "google/gemini-2.0-flash": { inputPer1M: 0.10, outputPer1M: 0.40, label: "Gemini 2.0 Flash", tier: 4 },
  "google/gemini-2.0-pro": { inputPer1M: 3.50, outputPer1M: 10.50, label: "Gemini 2.0 Pro", tier: 5 },

  // ── Mistral ───────────────────────────────────────────────────────────────
  "mistral/mistral-large": { inputPer1M: 2.00, outputPer1M: 6.00, label: "Mistral Large", tier: 5 },
  "mistral/mistral-small": { inputPer1M: 0.20, outputPer1M: 0.60, label: "Mistral Small", tier: 3 },
  "mistral/mistral-medium": { inputPer1M: 2.70, outputPer1M: 8.10, label: "Mistral Medium", tier: 4 },
  "mistral/codestral": { inputPer1M: 0.20, outputPer1M: 0.60, label: "Codestral", tier: 4 },
  "mistral/mistral-7b": { inputPer1M: 0.25, outputPer1M: 0.25, label: "Mistral 7B", tier: 2 },

  // ── Groq ──────────────────────────────────────────────────────────────────
  "groq/llama-3.1-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79, label: "Llama 3.1 70B (Groq)", tier: 4 },
  "groq/llama-3.1-8b-instant": { inputPer1M: 0.05, outputPer1M: 0.08, label: "Llama 3.1 8B (Groq)", tier: 2 },
  "groq/llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79, label: "Llama 3.3 70B (Groq)", tier: 4 },
  "groq/mixtral-8x7b": { inputPer1M: 0.24, outputPer1M: 0.24, label: "Mixtral 8x7B (Groq)", tier: 3 },

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  "deepseek/deepseek-chat": { inputPer1M: 0.27, outputPer1M: 1.10, label: "DeepSeek V3", tier: 5 },
  "deepseek/deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19, label: "DeepSeek R1", tier: 5 },

  // ── Cohere ────────────────────────────────────────────────────────────────
  "cohere/command-r-plus": { inputPer1M: 2.50, outputPer1M: 10.00, label: "Command R+", tier: 4 },
  "cohere/command-r": { inputPer1M: 0.15, outputPer1M: 0.60, label: "Command R", tier: 3 },

  // ── Perplexity ────────────────────────────────────────────────────────────
  "perplexity/sonar-pro": { inputPer1M: 3.00, outputPer1M: 15.00, label: "Sonar Pro", tier: 4 },
  "perplexity/sonar": { inputPer1M: 1.00, outputPer1M: 1.00, label: "Sonar", tier: 3 },

  // ── Together ──────────────────────────────────────────────────────────────
  "together/meta-llama-3.1-70b-instruct": { inputPer1M: 0.88, outputPer1M: 0.88, label: "Llama 3.1 70B (Together)", tier: 4 },
  "together/meta-llama-3.1-8b-instruct": { inputPer1M: 0.18, outputPer1M: 0.18, label: "Llama 3.1 8B (Together)", tier: 2 },

  // ── Fireworks ─────────────────────────────────────────────────────────────
  "fireworks/accounts-fireworks-models-llama-v3p1-70b-instruct": { inputPer1M: 0.90, outputPer1M: 0.90, label: "Llama 3.1 70B (Fireworks)", tier: 4 },

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
export function computeCostUsd(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = lookupPricing(provider, model);
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.inputPer1M
    + (outputTokens / 1_000_000) * pricing.outputPer1M;
}
