/**
 * Model Capability Matrix — dynamic model management for PRISM.
 *
 * Maps every available model (local Ollama through frontier cloud) to a
 * capability profile, routes tasks to the best available model, and adapts
 * prompts based on model horsepower.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Capability tier: T1 (minimal) → T5 (frontier). */
export type CapabilityTier = 1 | 2 | 3 | 4 | 5;

/** Rough parameter-size bucket. */
export type ParameterSize = "tiny" | "small" | "medium" | "large" | "frontier";

/** Tagged strength a model may have. */
export type ModelStrength =
    | "instruction-following"
    | "code"
    | "reasoning"
    | "tool-use"
    | "long-context"
    | "fast"
    | "multilingual"
    | "multimodal"
    | "agentic";

/** Where the model runs. */
export type ModelLocality = "local" | "cloud";

/** Task roles PRISM routes to different models. */
export type TaskRole =
    | "classification"
    | "chat"
    | "summarization"
    | "tool-selection"
    | "code-generation"
    | "memory-indexing";

export interface ModelCapabilityProfile {
    /** Pattern that matches model names (exact or prefix). */
    pattern: string;
    /** Human-readable label. */
    label: string;
    /** T1-T5 capability tier. */
    tier: CapabilityTier;
    /** Size bucket. */
    parameterSize: ParameterSize;
    /** Approximate parameter count in billions (0 = unknown). */
    parametersBillions: number;
    /** Maximum input context window in tokens. */
    contextWindow: number;
    /** Estimated VRAM needed in MB (0 = cloud / unknown). */
    estimatedVramMb: number;
    /** Recommended max output tokens for this model. */
    maxOutputTokens: number;
    /** How many system-prompt tokens this model handles before quality degrades. */
    adaptivePromptBudget: number;
    /** Strengths tags. */
    strengths: ModelStrength[];
    /** local or cloud. */
    locality: ModelLocality;
}

/** Minimum tier required for each task role. */
export interface RoleTierRequirements {
    role: TaskRole;
    minimumTier: CapabilityTier;
    idealTier: CapabilityTier;
}

/** Result of the router selecting a model for a role. */
export interface ModelRouterSelection {
    /** Provider id. */
    providerId: string;
    /** Model name. */
    model: string;
    /** Profile of the selected model. */
    profile: ModelCapabilityProfile;
    /** Whether this is below the ideal tier for the role. */
    degraded: boolean;
    /** Human-readable reason for the selection. */
    reason: string;
}

/** Adaptive prompt parameters computed for a model. */
export interface AdaptivePromptParams {
    /** Max system prompt length in characters. */
    systemPromptBudgetChars: number;
    /** Conversation history window size. */
    conversationWindow: number;
    /** Ollama-specific: num_ctx. */
    numCtx: number;
    /** Ollama-specific: num_predict. */
    numPredict: number;
    /** Temperature (model-adaptive). */
    temperature: number;
}

/** Snapshot of the VRAM / hardware state. */
export interface HardwareSnapshot {
    /** Total VRAM in MB (0 = unknown). */
    totalVramMb: number;
    /** Currently loaded models from Ollama /api/ps. */
    loadedModels: Array<{ name: string; sizeBytes: number; vramBytes: number }>;
    /** Estimated free VRAM in MB. */
    estimatedFreeVramMb: number;
}

/** Provider model entry fed into the router. */
export interface AvailableModel {
    providerId: string;
    model: string;
    locality: ModelLocality;
}

// ---------------------------------------------------------------------------
// Known-Model Registry
// ---------------------------------------------------------------------------

const KNOWN_PROFILES: ModelCapabilityProfile[] = [
    // ---- Local Ollama: Tiny (T1) ----
    {
        pattern: "gemma3:1b",
        label: "Gemma 3 1B",
        tier: 1, parameterSize: "tiny", parametersBillions: 1,
        contextWindow: 2048, estimatedVramMb: 900, maxOutputTokens: 256,
        adaptivePromptBudget: 200,
        strengths: ["instruction-following", "fast"],
        locality: "local",
    },
    {
        pattern: "tinyllama",
        label: "TinyLlama 1.1B",
        tier: 1, parameterSize: "tiny", parametersBillions: 1.1,
        contextWindow: 2048, estimatedVramMb: 900, maxOutputTokens: 256,
        adaptivePromptBudget: 200,
        strengths: ["fast"],
        locality: "local",
    },
    {
        pattern: "granite3.1-moe:1b",
        label: "Granite 3.1 MoE 1B",
        tier: 1, parameterSize: "tiny", parametersBillions: 1,
        contextWindow: 2048, estimatedVramMb: 900, maxOutputTokens: 256,
        adaptivePromptBudget: 200,
        strengths: ["instruction-following", "fast"],
        locality: "local",
    },
    {
        pattern: "driaforall/tiny-agent-a:1.5b",
        label: "Tiny Agent A 1.5B",
        tier: 1, parameterSize: "tiny", parametersBillions: 1.5,
        contextWindow: 2048, estimatedVramMb: 1200, maxOutputTokens: 256,
        adaptivePromptBudget: 250,
        strengths: ["instruction-following", "tool-use", "fast"],
        locality: "local",
    },
    // ---- Local Ollama: Small (T2) ----
    {
        pattern: "qwen3-vl:2b",
        label: "Qwen3 VL 2B",
        tier: 2, parameterSize: "small", parametersBillions: 2,
        contextWindow: 4096, estimatedVramMb: 1600, maxOutputTokens: 512,
        adaptivePromptBudget: 400,
        strengths: ["instruction-following", "multimodal"],
        locality: "local",
    },
    {
        pattern: "llama3.2:3b",
        label: "Llama 3.2 3B",
        tier: 2, parameterSize: "small", parametersBillions: 3,
        contextWindow: 4096, estimatedVramMb: 2200, maxOutputTokens: 512,
        adaptivePromptBudget: 400,
        strengths: ["instruction-following", "reasoning", "code"],
        locality: "local",
    },
    {
        pattern: "granite3.1-moe:3b",
        label: "Granite 3.1 MoE 3B",
        tier: 2, parameterSize: "small", parametersBillions: 3,
        contextWindow: 4096, estimatedVramMb: 2200, maxOutputTokens: 512,
        adaptivePromptBudget: 400,
        strengths: ["instruction-following", "reasoning"],
        locality: "local",
    },
    {
        pattern: "phi4-mini",
        label: "Phi-4 Mini 3.8B",
        tier: 2, parameterSize: "small", parametersBillions: 3.8,
        contextWindow: 4096, estimatedVramMb: 2800, maxOutputTokens: 512,
        adaptivePromptBudget: 400,
        strengths: ["instruction-following", "reasoning", "code"],
        locality: "local",
    },
    // ---- Local Ollama: Medium (T3 — pushing hardware limits) ----
    {
        pattern: "llama3.1:8b",
        label: "Llama 3.1 8B",
        tier: 3, parameterSize: "medium", parametersBillions: 8,
        contextWindow: 8192, estimatedVramMb: 5500, maxOutputTokens: 1024,
        adaptivePromptBudget: 600,
        strengths: ["instruction-following", "reasoning", "code", "tool-use"],
        locality: "local",
    },
    {
        pattern: "gemma3:4b",
        label: "Gemma 3 4B",
        tier: 2, parameterSize: "small", parametersBillions: 4,
        contextWindow: 4096, estimatedVramMb: 3000, maxOutputTokens: 512,
        adaptivePromptBudget: 400,
        strengths: ["instruction-following", "reasoning"],
        locality: "local",
    },
    // ---- Cloud: OpenAI ----
    {
        pattern: "gpt-4o-mini",
        label: "GPT-4o Mini",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "fast"],
        locality: "cloud",
    },
    {
        pattern: "gpt-5-mini",
        label: "GPT-5 Mini",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "fast"],
        locality: "cloud",
    },
    {
        pattern: "gpt-4o",
        label: "GPT-4o",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "multimodal"],
        locality: "cloud",
    },
    {
        pattern: "gpt-4.1",
        label: "GPT-4.1",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context"],
        locality: "cloud",
    },
    {
        pattern: "gpt-5",
        label: "GPT-5",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 6000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        locality: "cloud",
    },
    // ---- Cloud: Anthropic ----
    {
        pattern: "claude-3-5-haiku",
        label: "Claude 3.5 Haiku",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "code", "fast"],
        locality: "cloud",
    },
    {
        pattern: "claude-3-5-sonnet",
        label: "Claude 3.5 Sonnet",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context"],
        locality: "cloud",
    },
    {
        pattern: "claude-3-7-sonnet",
        label: "Claude 3.7 Sonnet",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        locality: "cloud",
    },
    {
        pattern: "claude-sonnet-4",
        label: "Claude Sonnet 4",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        locality: "cloud",
    },
    {
        pattern: "claude-opus-4",
        label: "Claude Opus 4",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 6000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        locality: "cloud",
    },
    // ---- Cloud: Google ----
    {
        pattern: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "fast", "long-context"],
        locality: "cloud",
    },
    {
        pattern: "gemini-2.0-pro",
        label: "Gemini 2.0 Pro",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "multimodal"],
        locality: "cloud",
    },
    {
        pattern: "gemini-1.5-pro",
        label: "Gemini 1.5 Pro",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 2000000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "long-context", "multimodal"],
        locality: "cloud",
    },
    // ---- Cloud: Groq (fast inference) ----
    {
        pattern: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B (Groq)",
        tier: 4, parameterSize: "frontier", parametersBillions: 70,
        contextWindow: 32768, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "fast"],
        locality: "cloud",
    },
    {
        pattern: "llama-3.1-8b-instant",
        label: "Llama 3.1 8B (Groq)",
        tier: 3, parameterSize: "medium", parametersBillions: 8,
        contextWindow: 8192, estimatedVramMb: 0, maxOutputTokens: 2048,
        adaptivePromptBudget: 600,
        strengths: ["instruction-following", "fast"],
        locality: "cloud",
    },
    // ---- Cloud: DeepSeek ----
    {
        pattern: "deepseek-chat",
        label: "DeepSeek Chat",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 64000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code"],
        locality: "cloud",
    },
    {
        pattern: "deepseek-reasoner",
        label: "DeepSeek Reasoner",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 64000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["reasoning", "code", "agentic"],
        locality: "cloud",
    },
    // ---- Cloud: Mistral ----
    {
        pattern: "mistral-large",
        label: "Mistral Large",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "multilingual"],
        locality: "cloud",
    },
    {
        pattern: "mistral-small",
        label: "Mistral Small",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 32000, estimatedVramMb: 0, maxOutputTokens: 2048,
        adaptivePromptBudget: 1000,
        strengths: ["instruction-following", "fast", "multilingual"],
        locality: "cloud",
    },
];

// ---------------------------------------------------------------------------
// Role → Tier Requirements
// ---------------------------------------------------------------------------

const ROLE_REQUIREMENTS: RoleTierRequirements[] = [
    { role: "classification",   minimumTier: 1, idealTier: 2 },
    { role: "chat",             minimumTier: 2, idealTier: 3 },
    { role: "summarization",    minimumTier: 2, idealTier: 3 },
    { role: "tool-selection",   minimumTier: 3, idealTier: 4 },
    { role: "code-generation",  minimumTier: 3, idealTier: 4 },
    { role: "memory-indexing",  minimumTier: 1, idealTier: 2 },
];

// ---------------------------------------------------------------------------
// Profile Resolution
// ---------------------------------------------------------------------------

/**
 * Look up a capability profile for a model name.
 * Matches by exact string first, then prefix, then falls back to a
 * heuristic that parses parameter count from the name.
 */
export function resolveProfile(modelName: string): ModelCapabilityProfile {
    const lower = modelName.toLowerCase();

    // Exact match
    for (const profile of KNOWN_PROFILES) {
        if (lower === profile.pattern.toLowerCase()) {
            return profile;
        }
    }

    // Prefix / contains match
    for (const profile of KNOWN_PROFILES) {
        if (lower.startsWith(profile.pattern.toLowerCase()) || lower.includes(profile.pattern.toLowerCase())) {
            return profile;
        }
    }

    // Heuristic: parse parameter count from name like ":1b", ":3b", ":7b", ":70b"
    return inferProfileFromName(modelName);
}

function inferProfileFromName(modelName: string): ModelCapabilityProfile {
    const paramMatch = modelName.match(/:?(\d+(?:\.\d+)?)\s*[bB]/);
    const billions = paramMatch ? parseFloat(paramMatch[1]) : 0;

    let tier: CapabilityTier;
    let parameterSize: ParameterSize;
    let contextWindow: number;
    let estimatedVramMb: number;
    let maxOutputTokens: number;
    let adaptivePromptBudget: number;

    if (billions > 0 && billions <= 2) {
        tier = 1; parameterSize = "tiny";
        contextWindow = 2048; estimatedVramMb = Math.round(billions * 800);
        maxOutputTokens = 256; adaptivePromptBudget = 200;
    } else if (billions > 2 && billions <= 5) {
        tier = 2; parameterSize = "small";
        contextWindow = 4096; estimatedVramMb = Math.round(billions * 700);
        maxOutputTokens = 512; adaptivePromptBudget = 400;
    } else if (billions > 5 && billions <= 15) {
        tier = 3; parameterSize = "medium";
        contextWindow = 8192; estimatedVramMb = Math.round(billions * 650);
        maxOutputTokens = 1024; adaptivePromptBudget = 600;
    } else if (billions > 15) {
        tier = 4; parameterSize = "large";
        contextWindow = 32000; estimatedVramMb = Math.round(billions * 600);
        maxOutputTokens = 4096; adaptivePromptBudget = 2000;
    } else {
        // Unknown size — assume cloud T3 as a safe middle ground
        tier = 3; parameterSize = "large";
        contextWindow = 32000; estimatedVramMb = 0;
        maxOutputTokens = 2048; adaptivePromptBudget = 1000;
    }

    return {
        pattern: modelName,
        label: modelName,
        tier,
        parameterSize,
        parametersBillions: billions,
        contextWindow,
        estimatedVramMb,
        maxOutputTokens,
        adaptivePromptBudget,
        strengths: ["instruction-following"],
        locality: estimatedVramMb > 0 ? "local" : "cloud",
    };
}

// ---------------------------------------------------------------------------
// Model Router
// ---------------------------------------------------------------------------

export function getRoleRequirements(role: TaskRole): RoleTierRequirements {
    return ROLE_REQUIREMENTS.find((r) => r.role === role) ?? { role, minimumTier: 2, idealTier: 3 };
}

/**
 * Select the best model for a given task role from the available inventory.
 *
 * Strategy:
 *  1. Prefer local models that meet the ideal tier (saves cost + latency).
 *  2. Fall back to cloud models that meet the ideal tier.
 *  3. Accept local models that meet the minimum tier (degraded).
 *  4. Accept cloud models that meet the minimum tier (degraded).
 *  5. If nothing meets minimum, pick the highest-tier model available and flag degraded.
 */
export function selectModelForRole(
    role: TaskRole,
    available: AvailableModel[],
): ModelRouterSelection | null {
    if (available.length === 0) return null;

    const requirements = getRoleRequirements(role);

    // Build scored list
    const scored = available
        .map((entry) => ({
            ...entry,
            profile: resolveProfile(entry.model),
        }))
        .sort((a, b) => {
            // Local preferred over cloud when tiers are equal
            if (a.profile.tier === b.profile.tier) {
                if (a.profile.locality === "local" && b.profile.locality !== "local") return -1;
                if (a.profile.locality !== "local" && b.profile.locality === "local") return 1;
            }
            return b.profile.tier - a.profile.tier; // higher tier first
        });

    // 1. Local that meets ideal
    const idealLocal = scored.find(
        (m) => m.profile.locality === "local" && m.profile.tier >= requirements.idealTier,
    );
    if (idealLocal) {
        return {
            providerId: idealLocal.providerId,
            model: idealLocal.model,
            profile: idealLocal.profile,
            degraded: false,
            reason: `Local model meets ideal T${requirements.idealTier} for ${role}`,
        };
    }

    // 2. Cloud that meets ideal
    const idealCloud = scored.find(
        (m) => m.profile.locality === "cloud" && m.profile.tier >= requirements.idealTier,
    );
    if (idealCloud) {
        return {
            providerId: idealCloud.providerId,
            model: idealCloud.model,
            profile: idealCloud.profile,
            degraded: false,
            reason: `Cloud model meets ideal T${requirements.idealTier} for ${role}`,
        };
    }

    // 3. Local that meets minimum (degraded)
    const minLocal = scored.find(
        (m) => m.profile.locality === "local" && m.profile.tier >= requirements.minimumTier,
    );
    if (minLocal) {
        return {
            providerId: minLocal.providerId,
            model: minLocal.model,
            profile: minLocal.profile,
            degraded: true,
            reason: `Local model meets minimum T${requirements.minimumTier} for ${role} (below ideal T${requirements.idealTier})`,
        };
    }

    // 4. Cloud that meets minimum (degraded)
    const minCloud = scored.find(
        (m) => m.profile.locality === "cloud" && m.profile.tier >= requirements.minimumTier,
    );
    if (minCloud) {
        return {
            providerId: minCloud.providerId,
            model: minCloud.model,
            profile: minCloud.profile,
            degraded: true,
            reason: `Cloud model meets minimum T${requirements.minimumTier} for ${role} (below ideal T${requirements.idealTier})`,
        };
    }

    // 5. Best available — fully degraded
    const best = scored[0];
    return {
        providerId: best.providerId,
        model: best.model,
        profile: best.profile,
        degraded: true,
        reason: `Best available T${best.profile.tier} for ${role} (minimum T${requirements.minimumTier} not met — degraded)`,
    };
}

// ---------------------------------------------------------------------------
// Adaptive Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Compute prompt parameters adapted to the selected model's capability.
 * Smaller models get tighter context, shorter prompts, less history.
 */
export function buildAdaptiveParams(profile: ModelCapabilityProfile): AdaptivePromptParams {
    switch (profile.tier) {
        case 1:
            return {
                systemPromptBudgetChars: 400,
                conversationWindow: 6,
                numCtx: 2048,
                numPredict: 256,
                temperature: 0.2,
            };
        case 2:
            return {
                systemPromptBudgetChars: 800,
                conversationWindow: 12,
                numCtx: 4096,
                numPredict: 512,
                temperature: 0.3,
            };
        case 3:
            return {
                systemPromptBudgetChars: 2000,
                conversationWindow: 20,
                numCtx: 8192,
                numPredict: 1024,
                temperature: 0.3,
            };
        case 4:
            return {
                systemPromptBudgetChars: 4000,
                conversationWindow: 30,
                numCtx: 32000,
                numPredict: 4096,
                temperature: 0.3,
            };
        case 5:
            return {
                systemPromptBudgetChars: 8000,
                conversationWindow: 50,
                numCtx: 64000,
                numPredict: 8192,
                temperature: 0.3,
            };
    }
}

// ---------------------------------------------------------------------------
// Adaptive System Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_FULL = [
    "You are PRISM, an autonomous agent runtime with governed tool execution.",
    "You can run shell commands, read/write files, make HTTP requests, query Neo4j, and execute multi-step workflows.",
    "You manage email, calendar, notes, and task tools through governed adapters.",
    "Every tool invocation is validated against contracts and policy before execution.",
    "Use concise, actionable responses. Only reference capabilities you actually have.",
    "If you don't know something, say so — do not hallucinate.",
].join("\n");

const SYSTEM_PROMPT_COMPACT = [
    "You are PRISM, an agent runtime with shell, file, HTTP, and workflow tools.",
    "Respond concisely. Do not invent capabilities. Say when you don't know.",
].join("\n");

const SYSTEM_PROMPT_MINIMAL =
    "You are PRISM, a task assistant. Answer concisely.";

/**
 * Produce a system prompt appropriate for the model's capability tier.
 * Appends runtime context (mode, approvals, etc.) within the budget.
 */
export function buildAdaptiveSystemPrompt(
    profile: ModelCapabilityProfile,
    runtimeContext?: {
        mode?: string;
        environment?: string;
        pendingApprovals?: number;
        sessionCount?: number;
    },
): string {
    let base: string;
    if (profile.tier >= 4) {
        base = SYSTEM_PROMPT_FULL;
    } else if (profile.tier >= 2) {
        base = SYSTEM_PROMPT_COMPACT;
    } else {
        base = SYSTEM_PROMPT_MINIMAL;
    }

    if (runtimeContext && profile.tier >= 2) {
        const ctx: string[] = [];
        if (runtimeContext.mode) ctx.push(`Runtime mode: ${runtimeContext.mode}`);
        if (runtimeContext.environment) ctx.push(`Env: ${runtimeContext.environment}`);
        if (runtimeContext.pendingApprovals !== undefined) ctx.push(`Pending approvals: ${runtimeContext.pendingApprovals}`);
        if (ctx.length > 0) base += "\n" + ctx.join(". ") + ".";
    }

    return base;
}

// ---------------------------------------------------------------------------
// Hardware Profile (Ollama /api/ps)
// ---------------------------------------------------------------------------

/**
 * Fetch currently loaded models from Ollama to determine VRAM usage.
 * Non-critical — returns empty snapshot on failure.
 */
export async function fetchHardwareSnapshot(ollamaBaseUrl: string, totalVramMb: number = 4096): Promise<HardwareSnapshot> {
    try {
        const response = await fetch(`${ollamaBaseUrl}/api/ps`, {
            method: "GET",
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            return { totalVramMb, loadedModels: [], estimatedFreeVramMb: totalVramMb };
        }
        const payload = await response.json() as {
            models?: Array<{ name?: string; size?: number; size_vram?: number }>;
        };
        const loadedModels = (payload.models ?? []).map((m) => ({
            name: m.name ?? "unknown",
            sizeBytes: m.size ?? 0,
            vramBytes: m.size_vram ?? 0,
        }));
        const usedVramMb = loadedModels.reduce((sum, m) => sum + m.vramBytes / (1024 * 1024), 0);
        return {
            totalVramMb,
            loadedModels,
            estimatedFreeVramMb: Math.max(0, totalVramMb - usedVramMb),
        };
    } catch {
        return { totalVramMb, loadedModels: [], estimatedFreeVramMb: totalVramMb };
    }
}

// ---------------------------------------------------------------------------
// All task roles (exported for iteration)
// ---------------------------------------------------------------------------

export const ALL_TASK_ROLES: TaskRole[] = [
    "classification", "chat", "summarization",
    "tool-selection", "code-generation", "memory-indexing",
];

/**
 * Tier label for display.
 */
export function tierLabel(tier: CapabilityTier): string {
    switch (tier) {
        case 1: return "T1 Minimal";
        case 2: return "T2 Basic";
        case 3: return "T3 Standard";
        case 4: return "T4 Advanced";
        case 5: return "T5 Frontier";
    }
}

/**
 * Return all known profiles (for dashboard display).
 */
export function getKnownProfiles(): readonly ModelCapabilityProfile[] {
    return KNOWN_PROFILES;
}
