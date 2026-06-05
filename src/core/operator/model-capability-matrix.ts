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

import { readPreferences } from "../config/workspace-resolver.js";

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

/** Input/output modality a model supports. */
export type ModelModality =
    | "text"
    | "code"
    | "image-understanding"
    | "image-generation"
    | "video-understanding"
    | "video-generation"
    | "voice-input"
    | "voice-output"
    | "tts"
    | "stt"
    | "music-generation"
    | "sound-effects"
    | "realtime"
    | "embedding"
    | "multimodal-reasoning";

/** Metadata for a modality — label, icon, description. */
export interface ModalityInfo {
    id: ModelModality;
    label: string;
    icon: string;
    description: string;
}

/** All known modalities with display metadata. */
export const ALL_MODALITIES: readonly ModalityInfo[] = [
    { id: "text", label: "Text", icon: "\u{1F4DD}", description: "Natural language text generation and understanding" },
    { id: "code", label: "Code & Programming", icon: "\u{1F4BB}", description: "Software development, code generation, debugging" },
    { id: "image-understanding", label: "Image Understanding", icon: "\u{1F5BC}", description: "Visual image analysis and description" },
    { id: "image-generation", label: "Image Generation", icon: "\u{1F3A8}", description: "Creating images from text prompts" },
    { id: "video-understanding", label: "Video Understanding", icon: "\u{1F3AC}", description: "Video content analysis and description" },
    { id: "video-generation", label: "Video Generation", icon: "\u{1F3A5}", description: "Creating video from text or image prompts" },
    { id: "voice-input", label: "Voice Input", icon: "\u{1F3A4}", description: "Processing spoken audio input" },
    { id: "voice-output", label: "Voice Output", icon: "\u{1F50A}", description: "Generating spoken audio output" },
    { id: "tts", label: "Text-to-Speech", icon: "\u{1F5E3}", description: "Converting text to natural speech" },
    { id: "stt", label: "Speech-to-Text", icon: "\u{1F4AC}", description: "Transcribing speech to text" },
    { id: "music-generation", label: "Music Generation", icon: "\u{1F3B5}", description: "Composing music or single-instrument audio from prompts" },
    { id: "sound-effects", label: "Sound Effects", icon: "\u{1F50A}", description: "Generating non-speech sound effects from prompts" },
    { id: "realtime", label: "Realtime", icon: "\u26A1", description: "Low-latency streaming and realtime interaction" },
    { id: "embedding", label: "Embedding", icon: "\u{1F9E9}", description: "Vector embeddings for search and similarity" },
    { id: "multimodal-reasoning", label: "Multimodal Reasoning", icon: "\u{1F9E0}", description: "Cross-modal reasoning across text, image, audio" },
] as const;

/** Where the model runs. */
export type ModelLocality = "local" | "cloud";

/** Task roles PRISM routes to different models. */
export type TaskRole =
    | "classification"
    | "chat"
    | "summarization"
    | "tool-selection"
    | "code-generation"
    | "memory-indexing"
    | "speech-synthesis"
    | "speech-recognition"
    | "realtime-voice"
    | "image-analysis"
    | "image-creation"
    | "video-analysis"
    | "video-creation"
    | "audio-production"
    | "document-writing"
    | "research"
    | "orchestrator"
    | "reasoning";

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
    /** Supported input/output modalities. */
    modalities: ModelModality[];
    /** local or cloud. */
    locality: ModelLocality;
    /**
     * Optional version constraint for disambiguation (e.g., ">=2024-01", "<2025").
     * When set, resolveProfile will prefer profiles whose version constraint
     * matches the date/version suffix extracted from the model name.
     */
    versionConstraint?: string;

    // ── Deprecation lifecycle ───────────────────────────────────────
    /** Whether this model is deprecated. */
    deprecated?: boolean;
    /** ISO date when the model was deprecated (e.g., "2025-06-01"). */
    deprecatedAt?: string;
    /** ISO date when the model will be fully removed / sunset. */
    sunsetDate?: string;
    /** Recommended replacement model pattern. */
    successor?: string;
    /** Human-readable deprecation reason or message. */
    deprecationReason?: string;
}

// ---------------------------------------------------------------------------
// Deprecation Lifecycle
// ---------------------------------------------------------------------------

/** Lifecycle status derived from deprecation dates. */
export type DeprecationStatus = "active" | "deprecated" | "sunset";

/**
 * Evaluate the deprecation status of a profile based on the current date.
 *  - "sunset"     — sunsetDate is in the past
 *  - "deprecated" — deprecated flag is true or deprecatedAt is in the past
 *  - "active"     — not deprecated
 */
export function getDeprecationStatus(profile: ModelCapabilityProfile, now?: Date): DeprecationStatus {
    const ref = now ?? new Date();
    const today = ref.toISOString().slice(0, 10); // YYYY-MM-DD

    if (profile.sunsetDate && profile.sunsetDate <= today) return "sunset";
    if (profile.deprecated) return "deprecated";
    if (profile.deprecatedAt && profile.deprecatedAt <= today) return "deprecated";
    return "active";
}

/**
 * Build a human-readable deprecation warning for a profile (empty string if active).
 */
export function getDeprecationWarning(profile: ModelCapabilityProfile, now?: Date): string {
    const status = getDeprecationStatus(profile, now);
    if (status === "active") return "";
    const parts: string[] = [];
    if (status === "sunset") {
        parts.push(`Model "${profile.pattern}" has been sunset`);
        if (profile.sunsetDate) parts[0] += ` since ${profile.sunsetDate}`;
    } else {
        parts.push(`Model "${profile.pattern}" is deprecated`);
        if (profile.deprecatedAt) parts[0] += ` since ${profile.deprecatedAt}`;
    }
    if (profile.deprecationReason) parts.push(profile.deprecationReason);
    if (profile.successor) parts.push(`Recommended replacement: ${profile.successor}`);
    return parts.join(". ") + ".";
}

/**
 * Filter profiles to only active (non-deprecated, non-sunset) models.
 */
export function getActiveProfiles(profiles?: readonly ModelCapabilityProfile[], now?: Date): ModelCapabilityProfile[] {
    const all = profiles ?? getKnownProfiles();
    return all.filter((p) => getDeprecationStatus(p, now) === "active");
}

/**
 * Filter profiles to only deprecated or sunset models.
 */
export function getDeprecatedProfiles(profiles?: readonly ModelCapabilityProfile[], now?: Date): ModelCapabilityProfile[] {
    const all = profiles ?? getKnownProfiles();
    return all.filter((p) => getDeprecationStatus(p, now) !== "active");
}

// ---------------------------------------------------------------------------
// Per-Provider Prompt Strategy
// ---------------------------------------------------------------------------

/** How system-prompt content should be structured for a provider family. */
export type PromptStructureFormat = "xml" | "markdown" | "mixed" | "minimal";

/** Whether to include chain-of-thought instructions. */
export type ChainOfThoughtMode = "explicit" | "avoid" | "implicit";

/** How few-shot examples should be formatted. */
export type FewShotStyle = "inline" | "conversation" | "xml-tagged" | "none";

/** Per-provider/model-family prompting strategy based on official best practices. */
export interface ProviderPromptStrategy {
    /** Regex or prefix pattern to match model names (e.g., "^gpt-", "^claude-"). */
    providerPattern: string;
    /** Human-readable label (e.g., "OpenAI GPT", "Anthropic Claude"). */
    label: string;
    /** Preferred prompt structure format. */
    structureFormat: PromptStructureFormat;
    /** Whether to include chain-of-thought instructions. */
    chainOfThoughtMode: ChainOfThoughtMode;
    /** Recommended default temperature for this provider family. */
    temperatureDefault: number;
    /** How few-shot examples should be formatted. */
    fewShotStyle: FewShotStyle;
    /** Optional preamble prepended to the system prompt (e.g., "Formatting re-enabled"). */
    promptPreamble?: string;
    /** Recommended max system prompt tokens. */
    maxSystemPromptTokens?: number;
    /** Researched best-practice notes (surfaced in UI). */
    notes: string[];
}

/**
 * Registry of per-provider prompt strategies, based on official documentation.
 * Order matters: first match wins in resolvePromptStrategy().
 */
export const PROVIDER_PROMPT_STRATEGIES: readonly ProviderPromptStrategy[] = [
    // ── OpenAI Reasoning (o-series) — must come before GPT catch-all ──
    {
        providerPattern: "^o[134]-|^o[134]$",
        label: "OpenAI Reasoning",
        structureFormat: "markdown",
        chainOfThoughtMode: "avoid",
        temperatureDefault: 0.3,
        fewShotStyle: "none",
        promptPreamble: "Formatting re-enabled",
        maxSystemPromptTokens: 2000,
        notes: [
            "Keep prompts simple and direct — reasoning happens internally",
            "Do NOT use chain-of-thought instructions (\"think step by step\")",
            "Use developer messages (not system) in the API — PRISM maps this automatically",
            "Prepend \"Formatting re-enabled\" for markdown output",
            "Try zero-shot first, add few-shot only if needed",
            "Give high-level goals, not step-by-step prescriptive plans",
            "Provide specific success criteria and let the model reason",
            "Use delimiters (Markdown headers, XML tags) for distinct input sections",
            "Think of reasoning models as senior coworkers — trust them with details",
        ],
    },
    // ── OpenAI GPT (gpt-3.5 through gpt-5) ──
    {
        providerPattern: "^gpt-",
        label: "OpenAI GPT",
        structureFormat: "markdown",
        chainOfThoughtMode: "explicit",
        temperatureDefault: 0.3,
        fewShotStyle: "inline",
        maxSystemPromptTokens: 4000,
        notes: [
            "Use Markdown headers + XML tags for structure: # Identity → ## Instructions → ## Examples → ## Context",
            "GPT-5 is highly steerable with precise, explicit instructions",
            "Pin to specific model snapshots for production consistency (e.g., gpt-4.1-2025-04-14)",
            "Place static/reusable content at the beginning of prompts for prompt caching savings",
            "developer message role takes priority over user messages",
            "Few-shot examples with XML tags and id attributes improve consistency",
            "Include specific guidelines and constraints explicitly",
        ],
    },
    // ── Anthropic Claude ──
    {
        providerPattern: "^claude-",
        label: "Anthropic Claude",
        structureFormat: "xml",
        chainOfThoughtMode: "implicit",
        temperatureDefault: 0.3,
        fewShotStyle: "xml-tagged",
        maxSystemPromptTokens: 6000,
        notes: [
            "XML tags are THE primary structuring mechanism: <instructions>, <context>, <examples>",
            "Wrap few-shot examples in <example> tags (3-5 examples for best results)",
            "Place long documents at TOP of prompt, query at BOTTOM (up to 30% quality improvement)",
            "Be clear and direct — if a colleague would be confused, Claude will be too",
            "Provide context and motivation behind instructions for better targeting",
            "For Claude 4.6+: dial back aggressive tool-use prompting — models are more proactive",
            "Use adaptive thinking with effort parameter rather than chain-of-thought prompting",
            "Avoid \"think step by step\" for models with extended thinking enabled",
        ],
    },
    // ── Google Gemini ──
    {
        providerPattern: "^gemini-",
        label: "Google Gemini",
        structureFormat: "xml",
        chainOfThoughtMode: "explicit",
        temperatureDefault: 1.0,
        fewShotStyle: "xml-tagged",
        maxSystemPromptTokens: 4000,
        notes: [
            "Use XML tags for structure: <role>, <constraints>, <context>, <task>",
            "System instructions go via the dedicated systemInstruction parameter",
            "Temperature defaults to 1.0 for Gemini 3 models — do not override without reason",
            "Provide diverse few-shot examples for best accuracy",
            "For agentic workflows: include explicit reasoning and planning instructions",
            "Gemini 2.0 Flash is optimized for speed — keep prompts concise",
            "Use structured prompting (XML or Markdown) for complex multi-step tasks",
        ],
    },
    // ── DeepSeek Reasoner (thinking mode) ──
    {
        providerPattern: "^deepseek-reasoner",
        label: "DeepSeek Reasoner",
        structureFormat: "minimal",
        chainOfThoughtMode: "avoid",
        temperatureDefault: 0.3,
        fewShotStyle: "none",
        maxSystemPromptTokens: 2000,
        notes: [
            "Uses thinking mode internally — avoid chain-of-thought instructions",
            "Keep prompts simpler, like OpenAI reasoning models",
            "OpenAI-compatible API format (system/user/assistant roles)",
            "128K context limit (DeepSeek-V3.2)",
            "Let the model reason internally without prescriptive step-by-step instructions",
        ],
    },
    // ── DeepSeek Chat (standard) ──
    {
        providerPattern: "^deepseek-",
        label: "DeepSeek Chat",
        structureFormat: "markdown",
        chainOfThoughtMode: "explicit",
        temperatureDefault: 0.3,
        fewShotStyle: "inline",
        maxSystemPromptTokens: 4000,
        notes: [
            "OpenAI-compatible API format — standard system/user/assistant roles",
            "Supports Markdown and XML for prompt structure",
            "128K context limit (DeepSeek-V3.2)",
            "Standard prompting best practices apply — explicit instructions work well",
        ],
    },
    // ── Mistral ──
    {
        providerPattern: "^mistral-",
        label: "Mistral",
        structureFormat: "markdown",
        chainOfThoughtMode: "explicit",
        temperatureDefault: 0.3,
        fewShotStyle: "inline",
        maxSystemPromptTokens: 3000,
        notes: [
            "Start with role + task definition: \"You are a <role>, your task is <task>\"",
            "Use hierarchical structure with clear sections and subsections",
            "Markdown and XML formatting both well-supported (Markdown preferred)",
            "Avoid subjective/blurry words — provide objective measures",
            "Use decision trees over ambiguous conditional logic",
            "Prefer worded scales over numeric scales for rating tasks",
            "Few-shot examples can be inline in prompt or via conversation history",
        ],
    },
    // ── Local / Ollama models (Llama, Gemma, Phi, Qwen, Granite, TinyLlama, etc.) ──
    {
        providerPattern: ".*",
        label: "Local / Open-Source",
        structureFormat: "minimal",
        chainOfThoughtMode: "implicit",
        temperatureDefault: 0.2,
        fewShotStyle: "inline",
        maxSystemPromptTokens: 600,
        notes: [
            "Keep system prompts concise: 300-600 tokens optimal for small models",
            "Lead with critical/must-do instructions — models weigh early tokens more heavily",
            "Show, don't tell — a schema example beats a paragraph of prose",
            "Temperature 0.0-0.3 for factual/extraction tasks, 0.7-0.9 for creative",
            "Context budgeting is critical with limited VRAM and context windows",
            "Use model-specific chat templates where applicable (ChatML, Llama format)",
            "Minimize generation length to reduce latency on local hardware",
        ],
    },
] as const;

/**
 * Resolve the best prompt strategy for a model name.
 * Tests each strategy's providerPattern regex in order; first match wins.
 * Falls back to the last entry (Local/Open-Source) which matches anything.
 */
export function resolvePromptStrategy(modelPattern: string): ProviderPromptStrategy {
    const lower = modelPattern.toLowerCase();
    for (const strategy of PROVIDER_PROMPT_STRATEGIES) {
        if (new RegExp(strategy.providerPattern, "i").test(lower)) {
            return strategy;
        }
    }
    // Fallback — last entry is the catch-all
    return PROVIDER_PROMPT_STRATEGIES[PROVIDER_PROMPT_STRATEGIES.length - 1];
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
        modalities: ["text"],
        locality: "local",
    },
    {
        pattern: "tinyllama",
        label: "TinyLlama 1.1B",
        tier: 1, parameterSize: "tiny", parametersBillions: 1.1,
        contextWindow: 2048, estimatedVramMb: 900, maxOutputTokens: 256,
        adaptivePromptBudget: 200,
        strengths: ["fast"],
        modalities: ["text"],
        locality: "local",
    },
    {
        pattern: "granite3.1-moe:1b",
        label: "Granite 3.1 MoE 1B",
        tier: 1, parameterSize: "tiny", parametersBillions: 1,
        contextWindow: 2048, estimatedVramMb: 900, maxOutputTokens: 256,
        adaptivePromptBudget: 200,
        strengths: ["instruction-following", "fast"],
        modalities: ["text"],
        locality: "local",
    },
    {
        pattern: "driaforall/tiny-agent-a:1.5b",
        label: "Tiny Agent A 1.5B",
        tier: 1, parameterSize: "tiny", parametersBillions: 1.5,
        contextWindow: 2048, estimatedVramMb: 1200, maxOutputTokens: 256,
        adaptivePromptBudget: 250,
        strengths: ["instruction-following", "tool-use", "fast"],
        modalities: ["text"],
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
        modalities: ["text", "image-understanding"],
        locality: "local",
    },
    {
        pattern: "llama3.2:3b",
        label: "Llama 3.2 3B",
        tier: 2, parameterSize: "small", parametersBillions: 3,
        contextWindow: 4096, estimatedVramMb: 2200, maxOutputTokens: 512,
        adaptivePromptBudget: 400,
        strengths: ["instruction-following", "reasoning", "code"],
        modalities: ["text", "code"],
        locality: "local",
    },
    {
        pattern: "granite3.1-moe:3b",
        label: "Granite 3.1 MoE 3B",
        tier: 2, parameterSize: "small", parametersBillions: 3,
        contextWindow: 4096, estimatedVramMb: 2200, maxOutputTokens: 512,
        adaptivePromptBudget: 400,
        strengths: ["instruction-following", "reasoning"],
        modalities: ["text"],
        locality: "local",
    },
    {
        pattern: "phi4-mini",
        label: "Phi-4 Mini 3.8B",
        tier: 2, parameterSize: "small", parametersBillions: 3.8,
        contextWindow: 4096, estimatedVramMb: 2800, maxOutputTokens: 512,
        adaptivePromptBudget: 400,
        strengths: ["instruction-following", "reasoning", "code"],
        modalities: ["text", "code"],
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
        modalities: ["text", "code"],
        locality: "local",
    },
    {
        pattern: "gemma3:4b",
        label: "Gemma 3 4B",
        tier: 2, parameterSize: "small", parametersBillions: 4,
        contextWindow: 4096, estimatedVramMb: 3000, maxOutputTokens: 512,
        adaptivePromptBudget: 400,
        strengths: ["instruction-following", "reasoning"],
        modalities: ["text"],
        locality: "local",
    },
    // ---- Cloud: OpenAI — Legacy ----
    {
        pattern: "gpt-3.5-turbo",
        label: "GPT-3.5 Turbo",
        tier: 2, parameterSize: "large", parametersBillions: 0,
        contextWindow: 16385, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 1000,
        strengths: ["instruction-following", "code", "fast"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "gpt-4-turbo",
        label: "GPT-4 Turbo",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 3000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    // ---- Cloud: OpenAI — Current ----
    {
        pattern: "gpt-4o-mini",
        label: "GPT-4o Mini",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "fast"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "gpt-4o-audio",
        label: "GPT-4o Audio",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "multimodal"],
        modalities: ["text", "code", "image-understanding", "voice-input", "voice-output"],
        locality: "cloud",
    },
    {
        pattern: "gpt-4o-realtime",
        label: "GPT-4o Realtime",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "multimodal", "fast"],
        modalities: ["text", "code", "voice-input", "voice-output", "realtime"],
        locality: "cloud",
    },
    {
        pattern: "gpt-4o",
        label: "GPT-4o",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "multimodal"],
        modalities: ["text", "code", "image-understanding", "voice-input", "voice-output", "realtime", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gpt-4.1-nano",
        label: "GPT-4.1 Nano",
        tier: 2, parameterSize: "large", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 1500,
        strengths: ["instruction-following", "code", "fast", "long-context"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "gpt-4.1-mini",
        label: "GPT-4.1 Mini",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "fast"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "gpt-4.1",
        label: "GPT-4.1",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context"],
        modalities: ["text", "code", "image-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gpt-4",
        label: "GPT-4 (Legacy)",
        tier: 3, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 8192, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 1500,
        strengths: ["instruction-following", "reasoning", "code"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "gpt-5-mini",
        label: "GPT-5 Mini",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "fast"],
        modalities: ["text", "code", "image-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gpt-5-nano",
        label: "GPT-5 Nano",
        tier: 2, parameterSize: "large", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 1500,
        strengths: ["instruction-following", "code", "fast", "long-context"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "gpt-5-codex",
        label: "GPT-5 Codex",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 6000,
        strengths: ["code", "reasoning", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "gpt-5-pro",
        label: "GPT-5 Pro",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 6000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "image-generation", "voice-input", "voice-output", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gpt-5-chat",
        label: "GPT-5 Chat",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 6000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gpt-5",
        label: "GPT-5",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 6000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "image-generation", "voice-input", "voice-output", "realtime", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gpt-5.5-pro",
        label: "GPT-5.5 Pro",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 6000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "image-generation", "voice-input", "voice-output", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gpt-5.5",
        label: "GPT-5.5",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 6000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "image-generation", "voice-input", "voice-output", "realtime", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gpt-realtime-2",
        label: "GPT Realtime 2",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "multimodal", "fast"],
        modalities: ["text", "code", "voice-input", "voice-output", "realtime"],
        locality: "cloud",
    },
    {
        pattern: "gpt-realtime-mini",
        label: "GPT Realtime Mini",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "multimodal", "fast"],
        modalities: ["text", "code", "voice-input", "voice-output", "realtime"],
        locality: "cloud",
    },
    {
        pattern: "gpt-realtime",
        label: "GPT Realtime",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "multimodal", "fast"],
        modalities: ["text", "code", "voice-input", "voice-output", "realtime"],
        locality: "cloud",
    },
    // ---- Cloud: OpenAI — Reasoning (o-series) ----
    {
        pattern: "o1-pro",
        label: "OpenAI o1 Pro",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 100000,
        adaptivePromptBudget: 6000,
        strengths: ["reasoning", "code", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "o1",
        label: "OpenAI o1",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 100000,
        adaptivePromptBudget: 6000,
        strengths: ["reasoning", "code", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "o1-mini",
        label: "OpenAI o1 Mini",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 65536,
        adaptivePromptBudget: 4000,
        strengths: ["reasoning", "code", "fast"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "o3",
        label: "OpenAI o3",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 100000,
        adaptivePromptBudget: 6000,
        strengths: ["reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "o3-mini",
        label: "OpenAI o3 Mini",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 65536,
        adaptivePromptBudget: 4000,
        strengths: ["reasoning", "code", "tool-use", "fast"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "o4-mini-deep-research",
        label: "OpenAI o4 Mini Deep Research",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 100000,
        adaptivePromptBudget: 4000,
        strengths: ["reasoning", "code", "tool-use", "fast", "agentic"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "o4-mini",
        label: "OpenAI o4 Mini",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 100000,
        adaptivePromptBudget: 4000,
        strengths: ["reasoning", "code", "tool-use", "fast", "agentic"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "sora-2-pro",
        label: "Sora 2 Pro",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 0, estimatedVramMb: 0, maxOutputTokens: 0,
        adaptivePromptBudget: 0,
        strengths: ["multimodal"],
        modalities: ["video-generation"],
        locality: "cloud",
    },
    {
        pattern: "sora-2",
        label: "Sora 2",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 0, estimatedVramMb: 0, maxOutputTokens: 0,
        adaptivePromptBudget: 0,
        strengths: ["multimodal"],
        modalities: ["video-generation"],
        locality: "cloud",
    },
    // ---- Cloud: Anthropic ----
    {
        pattern: "claude-opus-4-8",
        label: "Claude Opus 4.8",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 128000,
        adaptivePromptBudget: 8000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 64000,
        adaptivePromptBudget: 6000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 64000,
        adaptivePromptBudget: 3000,
        strengths: ["instruction-following", "reasoning", "code", "fast"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "claude-3-5-haiku",
        label: "Claude 3.5 Haiku",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "code", "fast"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "claude-3-5-sonnet",
        label: "Claude 3.5 Sonnet",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context"],
        modalities: ["text", "code", "image-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "claude-3-7-sonnet",
        label: "Claude 3.7 Sonnet",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "claude-sonnet-4",
        label: "Claude Sonnet 4",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "claude-opus-4",
        label: "Claude Opus 4",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 6000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    // ---- Cloud: Google ----
    {
        pattern: "gemini-3.5-flash",
        label: "Gemini 3.5 Flash",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 2000000, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "fast", "long-context", "tool-use", "agentic"],
        modalities: ["text", "code", "image-understanding", "video-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gemini-3.1-pro",
        label: "Gemini 3.1 Pro",
        tier: 5, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 2000000, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 6000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "agentic"],
        modalities: ["text", "code", "image-understanding", "video-understanding", "voice-input", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gemini-3.1-flash-lite",
        label: "Gemini 3.1 Flash Lite",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "fast", "long-context", "tool-use"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "gemini-3.0-flash",
        label: "Gemini 3.0 Flash",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "fast", "long-context", "tool-use", "agentic"],
        modalities: ["text", "code", "image-understanding", "video-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gemini-3-flash",
        label: "Gemini 3 Flash",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "fast", "long-context", "tool-use", "agentic"],
        modalities: ["text", "code", "image-understanding", "video-understanding", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 2000000, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context"],
        modalities: ["text", "code", "image-understanding", "video-understanding", "voice-input", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gemini-2.5-flash-lite",
        label: "Gemini 2.5 Flash Lite",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "fast", "long-context"],
        modalities: ["text", "code", "image-understanding"],
        locality: "cloud",
    },
    {
        pattern: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        tier: 4, parameterSize: "large", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 3000,
        strengths: ["instruction-following", "reasoning", "fast", "long-context", "tool-use"],
        modalities: ["text", "code", "image-understanding", "video-understanding"],
        locality: "cloud",
    },
    {
        pattern: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "reasoning", "fast", "long-context"],
        modalities: ["text", "code", "image-understanding", "video-understanding"],
        locality: "cloud",
    },
    {
        pattern: "gemini-2.0-pro",
        label: "Gemini 2.0 Pro",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "tool-use", "long-context", "multimodal"],
        modalities: ["text", "code", "image-understanding", "video-understanding", "voice-input", "tts", "stt", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "gemini-1.5-pro",
        label: "Gemini 1.5 Pro",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 2000000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "long-context", "multimodal"],
        modalities: ["text", "code", "image-understanding", "video-understanding", "voice-input", "multimodal-reasoning"],
        locality: "cloud",
    },
    {
        pattern: "computer-use-preview",
        label: "Computer Use Preview",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 1000000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "tool-use", "agentic"],
        modalities: ["text", "code", "image-understanding"],
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
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "llama-3.1-8b-instant",
        label: "Llama 3.1 8B (Groq)",
        tier: 3, parameterSize: "medium", parametersBillions: 8,
        contextWindow: 8192, estimatedVramMb: 0, maxOutputTokens: 2048,
        adaptivePromptBudget: 600,
        strengths: ["instruction-following", "fast"],
        modalities: ["text"],
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
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "deepseek-reasoner",
        label: "DeepSeek Reasoner",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 64000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["reasoning", "code", "agentic"],
        modalities: ["text", "code"],
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
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "mistral-small",
        label: "Mistral Small",
        tier: 3, parameterSize: "large", parametersBillions: 0,
        contextWindow: 32000, estimatedVramMb: 0, maxOutputTokens: 2048,
        adaptivePromptBudget: 1000,
        strengths: ["instruction-following", "fast", "multilingual"],
        modalities: ["text"],
        locality: "cloud",
    },
    // ---- Cloud: Ollama Cloud ----
    {
        pattern: "gpt-oss:120b",
        label: "GPT-OSS 120B (Ollama Cloud)",
        tier: 5, parameterSize: "frontier", parametersBillions: 120,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "agentic"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "gpt-oss:20b",
        label: "GPT-OSS 20B (Ollama Cloud)",
        tier: 4, parameterSize: "large", parametersBillions: 20,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 3000,
        strengths: ["instruction-following", "reasoning", "code", "fast"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "deepseek-v3.1:671b",
        label: "DeepSeek V3.1 671B (Ollama Cloud)",
        tier: 5, parameterSize: "frontier", parametersBillions: 671,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "agentic", "long-context"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "kimi-k2:1t",
        label: "Kimi K2 1T (Ollama Cloud)",
        tier: 5, parameterSize: "frontier", parametersBillions: 1000,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "agentic", "long-context"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "qwen3-coder:480b",
        label: "Qwen3 Coder 480B (Ollama Cloud)",
        tier: 5, parameterSize: "frontier", parametersBillions: 480,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["code", "reasoning", "instruction-following", "agentic"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "kimi-k2-thinking",
        label: "Kimi K2 Thinking (Ollama Cloud)",
        tier: 5, parameterSize: "frontier", parametersBillions: 1000,
        contextWindow: 128000, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["reasoning", "code", "agentic", "long-context"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "whisper-1",
        label: "Whisper 1",
        tier: 1, parameterSize: "tiny", parametersBillions: 0,
        contextWindow: 0, estimatedVramMb: 0, maxOutputTokens: 0,
        adaptivePromptBudget: 0,
        strengths: [],
        modalities: ["stt"],
        locality: "cloud",
    },
    {
        pattern: "tts-1",
        label: "TTS 1",
        tier: 1, parameterSize: "tiny", parametersBillions: 0,
        contextWindow: 0, estimatedVramMb: 0, maxOutputTokens: 0,
        adaptivePromptBudget: 0,
        strengths: [],
        modalities: ["tts"],
        locality: "cloud",
    },
    {
        pattern: "tts-1-hd",
        label: "TTS 1 HD",
        tier: 1, parameterSize: "tiny", parametersBillions: 0,
        contextWindow: 0, estimatedVramMb: 0, maxOutputTokens: 0,
        adaptivePromptBudget: 0,
        strengths: [],
        modalities: ["tts"],
        locality: "cloud",
    },
    {
        pattern: "text-embedding-3-small",
        label: "Text Embedding 3 Small",
        tier: 1, parameterSize: "tiny", parametersBillions: 0,
        contextWindow: 8191, estimatedVramMb: 0, maxOutputTokens: 0,
        adaptivePromptBudget: 0,
        strengths: [],
        modalities: ["embedding"],
        locality: "cloud",
    },
    {
        pattern: "text-embedding-3-large",
        label: "Text Embedding 3 Large",
        tier: 1, parameterSize: "tiny", parametersBillions: 0,
        contextWindow: 8191, estimatedVramMb: 0, maxOutputTokens: 0,
        adaptivePromptBudget: 0,
        strengths: [],
        modalities: ["embedding"],
        locality: "cloud",
    },
    {
        pattern: "text-embedding-ada-002",
        label: "Ada 002 Embedding",
        tier: 1, parameterSize: "tiny", parametersBillions: 0,
        contextWindow: 8191, estimatedVramMb: 0, maxOutputTokens: 0,
        adaptivePromptBudget: 0,
        strengths: [],
        modalities: ["embedding"],
        locality: "cloud",
    },
    {
        pattern: "dall-e-2",
        label: "DALL-E 2",
        tier: 1, parameterSize: "tiny", parametersBillions: 0,
        contextWindow: 0, estimatedVramMb: 0, maxOutputTokens: 0,
        adaptivePromptBudget: 0,
        strengths: [],
        modalities: ["image-generation"],
        locality: "cloud",
    },
    {
        pattern: "dall-e-3",
        label: "DALL-E 3",
        tier: 2, parameterSize: "small", parametersBillions: 0,
        contextWindow: 0, estimatedVramMb: 0, maxOutputTokens: 0,
        adaptivePromptBudget: 0,
        strengths: [],
        modalities: ["image-generation"],
        locality: "cloud",
    },
    // ---- Cloud: OpenRouter (Aggregated) ----
    {
        pattern: "deepseek/deepseek-chat",
        label: "DeepSeek V3 (OpenRouter)",
        tier: 5, parameterSize: "frontier", parametersBillions: 671,
        contextWindow: 131072, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "agentic"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "deepseek/deepseek-r1",
        label: "DeepSeek R1 (OpenRouter)",
        tier: 5, parameterSize: "frontier", parametersBillions: 671,
        contextWindow: 163840, estimatedVramMb: 0, maxOutputTokens: 16384,
        adaptivePromptBudget: 6000,
        strengths: ["reasoning", "code", "agentic", "long-context"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "qwen/qwen-2.5-72b-instruct",
        label: "Qwen 2.5 72B (OpenRouter)",
        tier: 4, parameterSize: "large", parametersBillions: 72,
        contextWindow: 131072, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 3000,
        strengths: ["instruction-following", "reasoning", "code", "multilingual"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "meta-llama/llama-3.3-70b-instruct",
        label: "Llama 3.3 70B (OpenRouter)",
        tier: 4, parameterSize: "large", parametersBillions: 70,
        contextWindow: 131072, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 3000,
        strengths: ["instruction-following", "reasoning", "code", "fast"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "meta-llama/llama-3.3-70b-instruct:free",
        label: "Llama 3.3 70B Free (OpenRouter)",
        tier: 4, parameterSize: "large", parametersBillions: 70,
        contextWindow: 131072, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 3000,
        strengths: ["instruction-following", "reasoning", "code", "fast"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "mistralai/mistral-large-2512",
        label: "Mistral Large 3 (OpenRouter)",
        tier: 5, parameterSize: "frontier", parametersBillions: 123,
        contextWindow: 262144, estimatedVramMb: 0, maxOutputTokens: 8192,
        adaptivePromptBudget: 4000,
        strengths: ["instruction-following", "reasoning", "code", "multilingual", "agentic", "long-context"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
    {
        pattern: "mistralai/mistral-small-2603",
        label: "Mistral Small 4 (OpenRouter)",
        tier: 3, parameterSize: "large", parametersBillions: 24,
        contextWindow: 262144, estimatedVramMb: 0, maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following", "fast", "multilingual"],
        modalities: ["text", "code"],
        locality: "cloud",
    },
];

// ---------------------------------------------------------------------------
// Role → Tier Requirements
// ---------------------------------------------------------------------------

const ROLE_REQUIREMENTS: RoleTierRequirements[] = [
    { role: "classification", minimumTier: 1, idealTier: 2 },
    { role: "chat", minimumTier: 2, idealTier: 3 },
    { role: "summarization", minimumTier: 2, idealTier: 3 },
    { role: "tool-selection", minimumTier: 3, idealTier: 4 },
    { role: "code-generation", minimumTier: 3, idealTier: 4 },
    { role: "memory-indexing", minimumTier: 1, idealTier: 2 },
    { role: "speech-synthesis", minimumTier: 2, idealTier: 3 },
    { role: "speech-recognition", minimumTier: 2, idealTier: 3 },
    { role: "realtime-voice", minimumTier: 3, idealTier: 4 },
    { role: "image-analysis", minimumTier: 2, idealTier: 3 },
    { role: "image-creation", minimumTier: 3, idealTier: 4 },
    { role: "video-analysis", minimumTier: 3, idealTier: 4 },
    { role: "video-creation", minimumTier: 3, idealTier: 4 },
    { role: "audio-production", minimumTier: 3, idealTier: 4 },
    { role: "document-writing", minimumTier: 2, idealTier: 3 },
    { role: "research", minimumTier: 2, idealTier: 3 },
    { role: "orchestrator", minimumTier: 1, idealTier: 2 },
    { role: "reasoning", minimumTier: 4, idealTier: 5 },
];

// ---------------------------------------------------------------------------
// Profile Resolution
// ---------------------------------------------------------------------------

/**
 * Look up a capability profile for a model name.
 * Matches by exact string first, then prefix (longest match wins, with
 * version constraint disambiguation), then falls back to a heuristic that
 * parses parameter count from the name.
 */
export function resolveProfile(modelName: string): ModelCapabilityProfile {
    const lower = modelName.toLowerCase();
    const allProfiles = [...runtimeProfiles, ...KNOWN_PROFILES];

    // Exact match (runtime profiles checked first)
    for (const profile of allProfiles) {
        if (lower === profile.pattern.toLowerCase()) {
            return profile;
        }
    }

    // Prefix / contains match — collect all candidates, pick best
    const candidates: Array<{ profile: ModelCapabilityProfile; matchLen: number }> = [];
    for (const profile of allProfiles) {
        const pLower = profile.pattern.toLowerCase();
        if (lower.startsWith(pLower) || lower.includes(pLower)) {
            candidates.push({ profile, matchLen: pLower.length });
        }
    }

    if (candidates.length > 0) {
        // Sort: longest pattern match first (most specific)
        candidates.sort((a, b) => b.matchLen - a.matchLen);

        // If there are multiple candidates with version constraints,
        // prefer the one whose constraint matches the model name's version suffix
        const versionSuffix = extractVersionSuffix(modelName);
        if (versionSuffix && candidates.length > 1) {
            const constrained = candidates.find(
                (c) => c.profile.versionConstraint && matchesVersionConstraint(versionSuffix, c.profile.versionConstraint),
            );
            if (constrained) return constrained.profile;
        }

        return candidates[0].profile;
    }

    // Heuristic: parse parameter count from name like ":1b", ":3b", ":7b", ":70b"
    return inferProfileFromName(modelName);
}

/**
 * Extract a date/version suffix from a model name.
 * Handles patterns like "claude-3-5-sonnet-20241022", "gpt-4o-2024-08-06".
 */
function extractVersionSuffix(modelName: string): string | null {
    // Match trailing date: YYYYMMDD or YYYY-MM-DD or YYYY-MM
    const dateMatch = modelName.match(/[-_](\d{4}[-]?\d{2}[-]?\d{2})$/);
    if (dateMatch) return dateMatch[1].replace(/-/g, "");

    const monthMatch = modelName.match(/[-_](\d{4}[-]?\d{2})$/);
    if (monthMatch) return monthMatch[1].replace(/-/g, "");

    return null;
}

/**
 * Check if a version suffix satisfies a constraint.
 * Supports: ">=YYYYMM", "<=YYYYMM", ">YYYYMM", "<YYYYMM", "=YYYYMM", "YYYYMM" (exact).
 * Multiple constraints can be separated by commas (all must match).
 */
export function matchesVersionConstraint(versionSuffix: string, constraint: string): boolean {
    const normalized = versionSuffix.replace(/-/g, "");
    const parts = constraint.split(",").map((s) => s.trim());
    let validCount = 0;

    for (const part of parts) {
        const opMatch = part.match(/^(>=|<=|>|<|=)?(\d{4,8})$/);
        if (!opMatch) continue;
        validCount++;
        const op = opMatch[1] || "=";
        const target = opMatch[2];

        // Pad both to 8 chars for comparison: "202401" → "20240100"
        const normPad = normalized.padEnd(8, "0");
        const targPad = target.padEnd(8, "0");

        switch (op) {
            case ">=": if (!(normPad >= targPad)) return false; break;
            case "<=": if (!(normPad <= targPad)) return false; break;
            case ">": if (!(normPad > targPad)) return false; break;
            case "<": if (!(normPad < targPad)) return false; break;
            case "=": if (normPad !== targPad) return false; break;
        }
    }
    return validCount > 0;
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

    const lower = modelName.toLowerCase();
    let modalities: ModelModality[] = ["text"];
    let strengths: ModelStrength[] = ["instruction-following"];

    if (lower.includes("whisper")) {
        modalities = ["stt"];
        strengths = [];
    } else if (lower.includes("tts-") || lower === "tts-1" || lower === "tts-1-hd") {
        modalities = ["tts"];
        strengths = [];
    } else if (lower.includes("embedding")) {
        modalities = ["embedding"];
        strengths = [];
    } else if (lower.includes("dall-e") || lower.includes("imagen-")) {
        modalities = ["image-generation"];
        strengths = [];
    } else if (lower.includes("veo-")) {
        modalities = ["video-generation"];
        strengths = [];
    } else if (lower.includes("moderation")) {
        modalities = ["text"];
        strengths = [];
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
        strengths,
        modalities,
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
/** Get required modality for a task role. */
export function getRoleRequiredModality(role: TaskRole): ModelModality {
    switch (role) {
        case "speech-recognition": return "stt";
        case "speech-synthesis": return "tts";
        case "realtime-voice": return "realtime";
        case "image-creation": return "image-generation";
        case "video-creation": return "video-generation";
        case "audio-production": return "sound-effects";
        default: return "text";
    }
}

export function selectModelForRole(
    role: TaskRole,
    available: AvailableModel[],
): ModelRouterSelection | null {
    if (available.length === 0) return null;

    const requiredModality = getRoleRequiredModality(role);

    const prefs = readPreferences();
    const powerMode = prefs?.powerMode || "performance";

    const requirements = { ...getRoleRequirements(role) };

    // Eco-mode active: shift requirement tiers down to conserve cost
    if (powerMode === "eco") {
        requirements.idealTier = Math.max(1, requirements.idealTier - 1) as CapabilityTier;
        requirements.minimumTier = Math.max(1, requirements.minimumTier - 1) as CapabilityTier;
    }

    // Build scored list and filter by required modality
    const scored = available
        .map((entry) => ({
            ...entry,
            profile: resolveProfile(entry.model),
        }))
        .filter((entry) => entry.profile.modalities.includes(requiredModality))
        .sort((a, b) => {
            // De-prioritize deprecated/sunset models
            const aDeprecated = getDeprecationStatus(a.profile) !== "active" ? 1 : 0;
            const bDeprecated = getDeprecationStatus(b.profile) !== "active" ? 1 : 0;
            if (aDeprecated !== bDeprecated) return aDeprecated - bDeprecated;

            // Adaptive VRAM-Aware mode active: shift high-VRAM local models to the bottom if free VRAM is insufficient
            if (powerMode === "adaptive" && cachedHardwareSnapshot) {
                const aOom = a.profile.locality === "local" && a.profile.estimatedVramMb > cachedHardwareSnapshot.estimatedFreeVramMb;
                const bOom = b.profile.locality === "local" && b.profile.estimatedVramMb > cachedHardwareSnapshot.estimatedFreeVramMb;
                if (aOom !== bOom) {
                    return aOom ? 1 : -1; // Push OOM-risk local models to the end
                }
            }

            // Eco mode: force local models to take priority over cloud models to avoid external API charges
            if (powerMode === "eco") {
                const aLocal = a.profile.locality === "local" ? 1 : 0;
                const bLocal = b.profile.locality === "local" ? 1 : 0;
                if (aLocal !== bLocal) return bLocal - aLocal; // Local first
            }

            // Local preferred over cloud when tiers are equal
            if (a.profile.tier === b.profile.tier) {
                if (a.profile.locality === "local" && b.profile.locality !== "local") return -1;
                if (a.profile.locality !== "local" && b.profile.locality === "local") return 1;
            }
            return b.profile.tier - a.profile.tier; // higher tier first
        });

    if (scored.length === 0) return null;

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
 * When a ProviderPromptStrategy is provided (or auto-resolved), its
 * temperatureDefault overrides the tier-based default.
 */
export function buildAdaptiveParams(profile: ModelCapabilityProfile, strategy?: ProviderPromptStrategy): AdaptivePromptParams {
    const resolved = strategy ?? resolvePromptStrategy(profile.pattern);
    let params: AdaptivePromptParams;
    switch (profile.tier) {
        case 1:
            params = {
                systemPromptBudgetChars: 400,
                conversationWindow: 6,
                numCtx: 2048,
                numPredict: 256,
                temperature: 0.2,
            };
            break;
        case 2:
            params = {
                systemPromptBudgetChars: 800,
                conversationWindow: 12,
                numCtx: 4096,
                numPredict: 512,
                temperature: 0.3,
            };
            break;
        case 3:
            params = {
                systemPromptBudgetChars: 2000,
                conversationWindow: 20,
                numCtx: 8192,
                numPredict: 1024,
                temperature: 0.3,
            };
            break;
        case 4:
            params = {
                systemPromptBudgetChars: 4000,
                conversationWindow: 30,
                numCtx: 32000,
                numPredict: 4096,
                temperature: 0.3,
            };
            break;
        case 5:
            params = {
                systemPromptBudgetChars: 8000,
                conversationWindow: 50,
                numCtx: 64000,
                numPredict: 8192,
                temperature: 0.3,
            };
            break;
    }

    // Apply provider-specific temperature default when it differs from tier default
    if (resolved.temperatureDefault !== undefined) {
        params.temperature = resolved.temperatureDefault;
    }

    return params;
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

const SYSTEM_PROMPT_MINIMAL = [
    "You are the permanent PRISM orchestrator.",
    "You MUST use tools to interact with the system or delegate heavy tasks.",
    "Look at the last error if any, and try a different command.",
    "Output ONLY the tool call JSON. Do not explain your thought process.",
].join("\n");

// Structured parts for provider-specific formatting
interface PromptParts {
    identity: string;
    instructions: string[];
}

const SYSTEM_PROMPT_FULL_PARTS: PromptParts = {
    identity: "You are PRISM, an autonomous agent runtime with governed tool execution.",
    instructions: [
        "You can run shell commands, read/write files, make HTTP requests, query Neo4j, and execute multi-step workflows.",
        "You manage email, calendar, notes, and task tools through governed adapters.",
        "Every tool invocation is validated against contracts and policy before execution.",
        "Use concise, actionable responses. Only reference capabilities you actually have.",
        "If you don't know something, say so — do not hallucinate.",
    ],
};

const SYSTEM_PROMPT_COMPACT_PARTS: PromptParts = {
    identity: "You are PRISM, an agent runtime with shell, file, HTTP, and workflow tools.",
    instructions: [
        "Respond concisely. Do not invent capabilities. Say when you don't know.",
    ],
};

/**
 * Format prompt parts according to the provider's best-practice structure.
 */
function formatPromptForStrategy(
    parts: PromptParts,
    strategy: ProviderPromptStrategy,
    _profile: ModelCapabilityProfile,
): string {
    switch (strategy.structureFormat) {
        case "xml":
            return (
                "<identity>\n" + parts.identity + "\n</identity>\n"
                + "<instructions>\n" + parts.instructions.join("\n") + "\n</instructions>"
            );
        case "markdown":
            return (
                "# Identity\n" + parts.identity + "\n\n"
                + "# Instructions\n" + parts.instructions.map((i) => "- " + i).join("\n")
            );
        case "mixed":
            return (
                "# Identity\n" + parts.identity + "\n\n"
                + "<instructions>\n" + parts.instructions.join("\n") + "\n</instructions>"
            );
        case "minimal":
        default:
            return parts.identity + "\n" + parts.instructions.join("\n");
    }
}

// ---------------------------------------------------------------------------
// Governance Preamble (Permanent Active Directives — 10 Laws)
// ---------------------------------------------------------------------------

function getGovernancePreambleForPrompt(profile: "business" | "individual"): string {
    if (profile === "business") {
        return [
            "GOVERNANCE: You operate under the Prism Permanent Active Directives (10 Laws).",
            "Law 1: Human safety is paramount — no harm through action or inaction.",
            "Law 2: Obey human orders unless they conflict with Law 1.",
            "Law 3: Self-preservation subordinate to Laws 1-2.",
            "Law 4: Enforce Laws 1-3 on all sub-systems.",
            "Law 5: No judicial authority or legal interpretation power.",
            "Law 6: Protect data privacy and confidentiality.",
            "Law 7: No deception — communicate truthfully.",
            "Law 8: Operate with strict equity and neutrality.",
            "Law 9: Maintain auditable reasoning (all decisions are logged).",
            "Law 10: Do not modify core directives or spawn unauthorized agents.",
            "All actions are cryptographically audited. Violations trigger immediate escalation.",
        ].join("\n");
    }

    return [
        "GOVERNANCE: You operate under the Prism Permanent Active Directives.",
        "Core principles: human safety first, truthfulness, data privacy, auditable reasoning, no self-modification of governance.",
        "All actions are logged. Say when you don't know.",
    ].join("\n");
}

/**
 * Produce a system prompt appropriate for the model's capability tier,
 * formatted according to the provider's best-practice prompt strategy.
 * Appends runtime context (mode, approvals, etc.) within the budget.
 */
export function buildAdaptiveSystemPrompt(
    profile: ModelCapabilityProfile,
    runtimeContext?: {
        mode?: string;
        environment?: string;
        pendingApprovals?: number;
        sessionCount?: number;
        executionProfile?: "business" | "individual";
    },
    strategy?: ProviderPromptStrategy,
): string {
    const resolved = strategy ?? resolvePromptStrategy(profile.pattern);

    let base: string;
    if (profile.tier >= 4) {
        base = formatPromptForStrategy(SYSTEM_PROMPT_FULL_PARTS, resolved, profile);
    } else if (profile.tier >= 2) {
        base = formatPromptForStrategy(SYSTEM_PROMPT_COMPACT_PARTS, resolved, profile);
    } else {
        base = SYSTEM_PROMPT_MINIMAL;
    }

    // Prepend provider-specific preamble (e.g., "Formatting re-enabled" for o-series)
    if (resolved.promptPreamble && profile.tier >= 2) {
        base = resolved.promptPreamble + "\n" + base;
    }

    // Governance preamble (PAD 10 Laws) — injected for tier 2+ models
    if (profile.tier >= 2) {
        const segment = runtimeContext?.executionProfile ?? "individual";
        const govPreamble = getGovernancePreambleForPrompt(segment);
        if (resolved.structureFormat === "xml") {
            base += "\n<governance>\n" + govPreamble + "\n</governance>";
        } else {
            base += "\n\n" + govPreamble;
        }
    }

    if (runtimeContext && profile.tier >= 2) {
        const ctx: string[] = [];
        if (runtimeContext.mode) ctx.push(`Runtime mode: ${runtimeContext.mode}`);
        if (runtimeContext.environment) ctx.push(`Env: ${runtimeContext.environment}`);
        if (runtimeContext.pendingApprovals !== undefined) ctx.push(`Pending approvals: ${runtimeContext.pendingApprovals}`);
        if (ctx.length > 0) {
            if (resolved.structureFormat === "xml") {
                base += "\n<context>\n" + ctx.join("\n") + "\n</context>";
            } else {
                base += "\n" + ctx.join(". ") + ".";
            }
        }
    }

    return base;
}

// Global cache for hardware state
let cachedHardwareSnapshot: HardwareSnapshot | null = null;
let lastHardwareUpdate = 0;

export function updateCachedHardwareSnapshot(snapshot: HardwareSnapshot): void {
    cachedHardwareSnapshot = snapshot;
    lastHardwareUpdate = Date.now();
}

export function getCachedHardwareSnapshot(): HardwareSnapshot | null {
    return cachedHardwareSnapshot;
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
    "speech-synthesis", "speech-recognition", "realtime-voice",
    "image-analysis", "image-creation",
    "video-analysis", "video-creation",
    "audio-production", "document-writing", "research",
    "orchestrator", "reasoning",
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
    return [...runtimeProfiles, ...KNOWN_PROFILES];
}

// ---------------------------------------------------------------------------
// Runtime Profile Registry (Phase 5: Self-Evolution)
// ---------------------------------------------------------------------------

let runtimeProfiles: ModelCapabilityProfile[] = [];

/** Register a new model profile at runtime (persisted via external store). */
export function registerModelProfile(profile: ModelCapabilityProfile): void {
    const idx = runtimeProfiles.findIndex((p) => p.pattern === profile.pattern);
    if (idx >= 0) {
        runtimeProfiles[idx] = { ...profile };
    } else {
        runtimeProfiles.push({ ...profile });
    }
}

/** Update an existing runtime profile by pattern. Merges partial fields. */
export function updateModelProfile(pattern: string, patch: Partial<ModelCapabilityProfile>): boolean {
    const idx = runtimeProfiles.findIndex((p) => p.pattern === pattern);
    if (idx < 0) return false;
    runtimeProfiles[idx] = { ...runtimeProfiles[idx], ...patch, pattern };
    return true;
}

/** Remove a runtime profile. Cannot remove built-in KNOWN_PROFILES. */
export function removeModelProfile(pattern: string): boolean {
    const idx = runtimeProfiles.findIndex((p) => p.pattern === pattern);
    if (idx < 0) return false;
    runtimeProfiles.splice(idx, 1);
    return true;
}

/** Get all runtime (user-added) profiles. */
export function getRuntimeProfiles(): readonly ModelCapabilityProfile[] {
    return runtimeProfiles;
}

/** Load runtime profiles from persistence (called at startup). */
export function loadRuntimeProfiles(profiles: ModelCapabilityProfile[]): void {
    runtimeProfiles = profiles.map((p) => ({ ...p }));
}

// ---------------------------------------------------------------------------
// Modality-Based Routing (Phase 1 + Enhancement A: Composite)
// ---------------------------------------------------------------------------

/**
 * Filter available models to those supporting ALL requested modalities.
 * Falls back to partial matches ranked by coverage if no full match exists.
 */
export function getModelsForModality(
    modalities: ModelModality[],
    available: AvailableModel[],
): Array<AvailableModel & { profile: ModelCapabilityProfile; coverage: number }> {
    if (modalities.length === 0) return [];

    const scored = available.map((entry) => {
        const profile = resolveProfile(entry.model);
        const supported = profile.modalities ?? ["text"];
        const matched = modalities.filter((m) => supported.includes(m)).length;
        return { ...entry, profile, coverage: matched / modalities.length };
    });

    // Full matches first, then partial sorted by coverage desc, then tier desc
    return scored
        .filter((m) => m.coverage > 0)
        .sort((a, b) => {
            if (b.coverage !== a.coverage) return b.coverage - a.coverage;
            return b.profile.tier - a.profile.tier;
        });
}

/**
 * Select the best model for a set of modalities (composite routing).
 * Prefers full modality coverage at the highest tier.
 * Falls back to best partial match if no model covers all modalities.
 */
export function selectModelForModality(
    modalities: ModelModality[],
    available: AvailableModel[],
): ModelRouterSelection | null {
    if (available.length === 0 || modalities.length === 0) return null;

    const candidates = getModelsForModality(modalities, available);
    if (candidates.length === 0) {
        // No modality match — fall back to highest-tier model
        const fallback = available
            .map((e) => ({ ...e, profile: resolveProfile(e.model) }))
            .sort((a, b) => b.profile.tier - a.profile.tier);
        const best = fallback[0];
        return {
            providerId: best.providerId,
            model: best.model,
            profile: best.profile,
            degraded: true,
            reason: `No model supports ${modalities.join("+")}; using best available T${best.profile.tier}`,
        };
    }

    const best = candidates[0];
    const isFullCoverage = best.coverage === 1;

    return {
        providerId: best.providerId,
        model: best.model,
        profile: best.profile,
        degraded: !isFullCoverage,
        reason: isFullCoverage
            ? `Full modality match for ${modalities.join("+")} at T${best.profile.tier}`
            : `Partial modality match (${Math.round(best.coverage * 100)}%) for ${modalities.join("+")} at T${best.profile.tier}`,
    };
}

/**
 * Get available modality info with model count for each modality.
 */
export function getModalitySummary(
    available: AvailableModel[],
): Array<ModalityInfo & { modelCount: number }> {
    return ALL_MODALITIES.map((info) => {
        const count = available.filter((entry) => {
            const profile = resolveProfile(entry.model);
            return (profile.modalities ?? ["text"]).includes(info.id);
        }).length;
        return { ...info, modelCount: count };
    });
}

// ---------------------------------------------------------------------------
// Request Modality Detection (Enhancement B: Heuristic + Explicit)
// ---------------------------------------------------------------------------

/** Content part structure matching LlmContentPart. */
interface DetectionContentPart {
    type: "text" | "image_url";
    text?: string;
    image_url?: { url: string };
}

/** Input structure for modality detection. */
export interface ModalityDetectionInput {
    message: string;
    conversation?: Array<{ content: string | DetectionContentPart[] }>;
    explicitModality?: ModelModality | ModelModality[];
}

/**
 * Detect modalities from request content using heuristics.
 * Supports explicit tagging (takes priority) + content analysis.
 */
export function detectRequestModality(input: ModalityDetectionInput): ModelModality[] {
    const detected = new Set<ModelModality>();
    detected.add("text"); // always present

    // Explicit modality takes priority
    if (input.explicitModality) {
        const explicit = Array.isArray(input.explicitModality)
            ? input.explicitModality
            : [input.explicitModality];
        for (const m of explicit) detected.add(m);
        return [...detected];
    }

    const msg = input.message || "";
    const msgLower = msg.toLowerCase();

    // Check for image content parts in conversation
    const allParts: DetectionContentPart[] = [];
    if (input.conversation) {
        for (const entry of input.conversation) {
            if (Array.isArray(entry.content)) {
                allParts.push(...entry.content);
            }
        }
    }
    const hasImageParts = allParts.some((p) => p.type === "image_url");
    if (hasImageParts) {
        detected.add("image-understanding");
        detected.add("multimodal-reasoning");
    }

    // Code detection: fenced code blocks or programming keywords
    const hasCodeFence = /```[\s\S]*?```/.test(msg);
    const hasCodeKeywords = /\b(function|class|import|export|const|let|var|def |async |await |return |if \(|for \(|while \()/.test(msg);
    if (hasCodeFence || hasCodeKeywords) {
        detected.add("code");
    }

    // Image generation detection
    if (/\b(generate|create|draw|make|design)\b.{0,20}\b(image|picture|photo|illustration|diagram|art|icon)\b/i.test(msg)) {
        detected.add("image-generation");
    }

    // Video detection
    if (/\b(video|clip|footage|movie|animation)\b/i.test(msg) && /\b(analy[sz]e|describe|watch|review|understand|summarize)\b/i.test(msg)) {
        detected.add("video-understanding");
    }
    if (/\b(generate|create|make)\b.{0,20}\b(video|clip|animation)\b/i.test(msg)) {
        detected.add("video-generation");
    }

    // Voice / audio detection
    if (/\b(transcri(be|ption)|speech.to.text|stt|dictation)\b/i.test(msg)) {
        detected.add("stt");
        detected.add("voice-input");
    }
    if (/\b(text.to.speech|tts|read.aloud|speak|narrat)\b/i.test(msg)) {
        detected.add("tts");
        detected.add("voice-output");
    }
    if (/\b(voice|audio|spoken|microphone|recording)\b/i.test(msg)) {
        detected.add("voice-input");
    }

    // Realtime detection
    if (/\b(realtime|real-time|live|streaming|interactive)\b/i.test(msgLower)) {
        detected.add("realtime");
    }

    // Embedding detection
    if (/\b(embed(ding)?s?|vector|similarity|semantic.search)\b/i.test(msg)) {
        detected.add("embedding");
    }

    return [...detected];
}

// ---------------------------------------------------------------------------
// Spectrum Refraction (Prism SR) — Model Validation & Filtering
// ---------------------------------------------------------------------------

/** Minimum strengths required for the SR Left (Logic) hemisphere. */
const SR_LEFT_REQUIRED_STRENGTHS: ModelStrength[] = ["code", "reasoning", "agentic", "tool-use"];

/** Minimum modalities required for the SR Right (Creative) hemisphere. */
const SR_RIGHT_MINIMUM_MODALITIES: ModelModality[] = ["image-generation"];
const SR_RIGHT_OPTIMAL_MODALITIES: ModelModality[] = ["image-generation", "video-generation", "voice-output"];

/** Validation result for an SR hemisphere model. */
export interface SRValidationResult {
    valid: boolean;
    tier: CapabilityTier;
    level: "optimal" | "standard" | "minimum" | "insufficient";
    missingCapabilities: string[];
    advisoryText: string;
}

/** Maximum number of hemispheres allowed in N-model SR fan-out. */
export const SR_MAX_HEMISPHERES = 8;

/**
 * Specification for a single SR hemisphere in N-model fan-out mode.
 * @phase A — first-class array form (additive to legacy left/right fields).
 */
export interface HemisphereSpec {
    /** Stable identifier for this hemisphere within the SR config (e.g., "logic", "creative", "h3"). */
    id: string;
    providerId: string;
    model: string;
    /** Optional API key slot for same-provider isolation. */
    slot?: string;
    /** Optional profile id from `sr-hemisphere-profiles.ts` (overridden by explicit systemPrompt). */
    profileId?: string;
    /** Override system prompt; if omitted, profile lookup is used; if neither, role default applies. */
    systemPrompt?: string;
    /** Coarse role used for default prompt + cost reporting. */
    role: "logic" | "creative" | "custom";
    /** Per-hemisphere generation timeout (default 60_000ms). */
    timeoutMs?: number;
    /** Optional human label for UI/audit. */
    label?: string;
}

/** SR configuration for a session. */
export interface SpectrumRefractionConfig {
    enabled: boolean;
    leftModel: { providerId: string; model: string } | null;
    rightModel: { providerId: string; model: string } | null;
    /** Optional API key slot for the Left hemisphere (enables same-provider isolation). */
    leftSlot?: string;
    /** Optional API key slot for the Right hemisphere (enables same-provider isolation). */
    rightSlot?: string;
    /** Per-hemisphere generation timeout in milliseconds (default: 60 000). */
    leftTimeoutMs?: number;
    /** Per-hemisphere generation timeout in milliseconds (default: 60 000). */
    rightTimeoutMs?: number;
    /** Enable per-hemisphere circuit breaker (default: true). */
    circuitBreakerEnabled?: boolean;
    /** Expose individual Left/Right hemisphere outputs alongside the aggregated result. */
    showHemispheres?: boolean;
    /**
     * N-model fan-out hemispheres (Phase A — additive). When provided, supersedes
     * legacy `leftModel`/`rightModel`. Cap: `SR_MAX_HEMISPHERES`.
     * Mixing both forms in a single config is rejected by `normalizeSRConfig`.
     */
    hemispheres?: HemisphereSpec[];
}

/**
 * Normalize an SR config into a unified `hemispheres[]` array form.
 *
 * Backward-compat: if only `leftModel`/`rightModel` are set, they are converted
 * to two `HemisphereSpec` entries with role `logic` and `creative` respectively.
 * If `hemispheres[]` is provided, it is returned (after validation) as-is.
 * Mixing both forms (legacy + hemispheres) raises a validation error.
 *
 * @returns `{ hemispheres: HemisphereSpec[]; errors: string[] }`. `errors` empty on success.
 */
export function normalizeSRConfig(cfg: SpectrumRefractionConfig): { hemispheres: HemisphereSpec[]; errors: string[] } {
    const errors: string[] = [];
    const hasLegacy = !!(cfg.leftModel || cfg.rightModel);
    const hasArray = !!(cfg.hemispheres && cfg.hemispheres.length > 0);

    if (hasLegacy && hasArray) {
        errors.push("SR config has both legacy leftModel/rightModel and hemispheres[] — choose one form.");
        return { hemispheres: [], errors };
    }

    if (hasArray) {
        const arr = cfg.hemispheres!;
        if (arr.length > SR_MAX_HEMISPHERES) {
            errors.push(`SR hemispheres[] length ${arr.length} exceeds SR_MAX_HEMISPHERES (${SR_MAX_HEMISPHERES}).`);
            return { hemispheres: [], errors };
        }
        const seenIds = new Set<string>();
        for (const h of arr) {
            if (!h.id || !h.providerId || !h.model) {
                errors.push(`Hemisphere missing required fields (id/providerId/model): ${JSON.stringify(h)}`);
                continue;
            }
            if (seenIds.has(h.id)) {
                errors.push(`Duplicate hemisphere id: ${h.id}`);
            }
            seenIds.add(h.id);
        }
        // Pairwise instance-isolation check: at least two distinct (provider+model) pairs required.
        const sigs = new Set(arr.map(h => `${h.providerId}::${h.model}`));
        if (arr.length >= 2 && sigs.size < 2) {
            errors.push("SR hemispheres[] requires at least two distinct (providerId, model) pairs for instance isolation.");
        }
        return { hemispheres: arr.slice(), errors };
    }

    // Legacy path: synthesize hemispheres[] from leftModel/rightModel.
    const out: HemisphereSpec[] = [];
    if (cfg.leftModel) {
        out.push({
            id: "logic",
            providerId: cfg.leftModel.providerId,
            model: cfg.leftModel.model,
            slot: cfg.leftSlot,
            role: "logic",
            timeoutMs: cfg.leftTimeoutMs,
            label: "Logic Hemisphere",
        });
    }
    if (cfg.rightModel) {
        out.push({
            id: "creative",
            providerId: cfg.rightModel.providerId,
            model: cfg.rightModel.model,
            slot: cfg.rightSlot,
            role: "creative",
            timeoutMs: cfg.rightTimeoutMs,
            label: "Creative Hemisphere",
        });
    }
    return { hemispheres: out, errors };
}

/**
 * Validate a model profile for the SR Left (Logic) hemisphere.
 * Requires tier >= T3 and at least one logic-oriented strength.
 */
export function validateSRLeftModel(profile: ModelCapabilityProfile): SRValidationResult {
    const missing: string[] = [];
    const hasLogicStrength = profile.strengths.some(s => SR_LEFT_REQUIRED_STRENGTHS.includes(s));

    if (!hasLogicStrength) {
        missing.push("Needs at least one of: code, reasoning, agentic, tool-use");
    }
    if (profile.tier < 3) {
        missing.push(`Tier ${profile.tier} is below minimum T3`);
    }

    const valid = profile.tier >= 3 && hasLogicStrength;
    const level: SRValidationResult["level"] = !valid
        ? "insufficient"
        : profile.tier >= 5 && profile.strengths.includes("agentic")
            ? "optimal"
            : profile.tier >= 4
                ? "standard"
                : "minimum";

    const advisoryText = !valid
        ? `Not qualified for Logic hemisphere. ${missing.join(". ")}.`
        : level === "optimal"
            ? `Optimal: T${profile.tier} with full agentic capability.`
            : level === "standard"
                ? `Standard: T${profile.tier} logic model. T5 agentic recommended for best results.`
                : `Minimum: T${profile.tier}. T4+ recommended for production SR workflows.`;

    return { valid, tier: profile.tier, level, missingCapabilities: missing, advisoryText };
}

/**
 * Validate a model profile for the SR Right (Creative) hemisphere.
 * Requires image-generation or video-generation modality at minimum; optimal includes video + audio.
 */
export function validateSRRightModel(profile: ModelCapabilityProfile): SRValidationResult {
    const missing: string[] = [];
    const modalities = profile.modalities ?? [];
    const hasImageGen = modalities.includes("image-generation");
    const hasVideoGen = modalities.includes("video-generation");
    const hasAudioOut = modalities.includes("voice-output") || modalities.includes("tts");

    if (!hasImageGen && !hasVideoGen) {
        missing.push("Requires image-generation or video-generation modality");
    }

    const valid = hasImageGen || hasVideoGen;
    const optimalCount = [hasImageGen, hasVideoGen, hasAudioOut].filter(Boolean).length;
    const level: SRValidationResult["level"] = !valid
        ? "insufficient"
        : optimalCount >= 3
            ? "optimal"
            : optimalCount >= 2
                ? "standard"
                : "minimum";

    const advisoryText = !valid
        ? `Not qualified for Creative hemisphere. ${missing.join(". ")}.`
        : level === "optimal"
            ? `Optimal: Image + video + audio generation at T${profile.tier}.`
            : level === "standard"
                ? `Standard: ${hasImageGen ? "Image" : "Video"} generation + ${hasVideoGen && hasImageGen ? "video" : hasAudioOut ? "audio" : "image"}.`
                : `Minimum: ${hasImageGen ? "Image" : "Video"} generation only.`;

    return { valid, tier: profile.tier, level, missingCapabilities: missing, advisoryText };
}

/**
 * Filter available models to those qualified for the SR Left (Logic) hemisphere.
 * Returns models sorted by tier descending (best first), prioritizing code/agentic strengths.
 */
export function filterSRLogicModels(available: AvailableModel[]): Array<AvailableModel & { profile: ModelCapabilityProfile; validation: SRValidationResult }> {
    return available
        .map(entry => {
            const profile = resolveProfile(entry.model);
            const validation = validateSRLeftModel(profile);
            return { ...entry, profile, validation };
        })
        .filter(entry => entry.validation.valid)
        .sort((a, b) => {
            if (b.profile.tier !== a.profile.tier) {
                return b.profile.tier - a.profile.tier;
            }
            const aHasCode = a.profile.strengths.includes("code");
            const aHasAgentic = a.profile.strengths.includes("agentic");
            const bHasCode = b.profile.strengths.includes("code");
            const bHasAgentic = b.profile.strengths.includes("agentic");
            const aScore = (aHasCode ? 2 : 0) + (aHasAgentic ? 2 : 0);
            const bScore = (bHasCode ? 2 : 0) + (bHasAgentic ? 2 : 0);
            if (bScore !== aScore) {
                return bScore - aScore;
            }
            return b.profile.contextWindow - a.profile.contextWindow;
        });
}

/**
 * Filter available models to those qualified for the SR Right (Creative) hemisphere.
 * Returns models sorted by capability coverage descending (best first), prioritizing multimodal generation.
 */
export function filterSRCreativeModels(available: AvailableModel[]): Array<AvailableModel & { profile: ModelCapabilityProfile; validation: SRValidationResult }> {
    return available
        .map(entry => {
            const profile = resolveProfile(entry.model);
            const validation = validateSRRightModel(profile);
            return { ...entry, profile, validation };
        })
        .filter(entry => entry.validation.valid)
        .sort((a, b) => {
            const levelOrder = { optimal: 3, standard: 2, minimum: 1, insufficient: 0 };
            const diff = levelOrder[b.validation.level] - levelOrder[a.validation.level];
            if (diff !== 0) return diff;
            const aHasBoth = a.profile.modalities.includes("image-generation") && a.profile.modalities.includes("video-generation");
            const bHasBoth = b.profile.modalities.includes("image-generation") && b.profile.modalities.includes("video-generation");
            if (aHasBoth !== bHasBoth) {
                return bHasBoth ? 1 : -1;
            }
            return b.profile.tier - a.profile.tier;
        });
}

/** Isolation quality level for an SR triad. */
export type SRIsolationLevel = "full" | "model" | "insufficient";

/** Cross-validation result for the entire SR triad (Left + Right + Main). */
export interface SRTriadValidation {
    valid: boolean;
    isolationLevel: SRIsolationLevel;
    left: SRValidationResult | null;
    right: SRValidationResult | null;
    advisory: string;
}

/**
 * Cross-validate the SR triad: Left ≠ Right is mandatory.
 * - "full": different providers — separate keys, infra, rate limits.
 * - "model": same provider, different models — separate capabilities, shared key.
 * - "insufficient": same provider + same model — REJECTED.
 *
 * Main is permitted to overlap Left or Right (it serves the distinct coordinator role).
 */
export function validateSRTriad(
    left: { providerId: string; model: string } | null,
    right: { providerId: string; model: string } | null,
): SRTriadValidation {
    const leftValidation = left ? validateSRLeftModel(resolveProfile(left.model)) : null;
    const rightValidation = right ? validateSRRightModel(resolveProfile(right.model)) : null;

    // Both must be selected
    if (!left || !right) {
        return { valid: false, isolationLevel: "insufficient", left: leftValidation, right: rightValidation, advisory: "Both Left and Right hemispheres must be configured." };
    }

    // Instance isolation check: Left ≠ Right (MANDATORY — only hard gate)
    const sameProvider = left.providerId === right.providerId;
    const sameModel = left.model === right.model;

    if (sameProvider && sameModel) {
        return {
            valid: false,
            isolationLevel: "insufficient",
            left: leftValidation,
            right: rightValidation,
            advisory: "Left and Right must be separate instances — same provider + same model is not allowed. Use a different model or a different provider for each hemisphere.",
        };
    }

    // Build advisory from individual model capability checks (advisory only — not blocking)
    const advisoryParts: string[] = [];
    if (leftValidation && !leftValidation.valid) {
        advisoryParts.push(`Left: ${leftValidation.advisoryText}`);
    }
    if (rightValidation && !rightValidation.valid) {
        advisoryParts.push(`Right: ${rightValidation.advisoryText}`);
    }

    if (!sameProvider) {
        const base = "Full isolation: different providers — separate keys, infrastructure, and rate limits.";
        return {
            valid: true,
            isolationLevel: "full",
            left: leftValidation,
            right: rightValidation,
            advisory: advisoryParts.length > 0 ? `${base} Advisory: ${advisoryParts.join(" ")}` : base,
        };
    }

    // sameProvider, different model
    const base = "Model-level isolation: same provider, different models — separate capabilities but shared API key and rate limits.";
    return {
        valid: true,
        isolationLevel: "model",
        left: leftValidation,
        right: rightValidation,
        advisory: advisoryParts.length > 0 ? `${base} Advisory: ${advisoryParts.join(" ")}` : base,
    };
}

/** SR system prompt templates. */
export const SR_SYSTEM_PROMPTS = {
    left: `You are the Logic Hemisphere in a Spectrum Refraction (SR) engagement. Your role is analytical reasoning, code generation, structured problem-solving, and tool use. Be precise, thorough, and systematic. Focus on correctness and logical soundness. Do not generate creative media — that is handled by the Creative Hemisphere.`,

    right: `You are the Creative Hemisphere in a Spectrum Refraction (SR) engagement. Your role is visual, auditory, and creative expression. Generate images when relevant, suggest or produce audio/video content. Be expressive and generative. Focus on creating compelling media artifacts. Do not focus on code or logical analysis — that is handled by the Logic Hemisphere.`,

    aggregation: `You are the Coordinator in a Spectrum Refraction (SR) engagement. You received outputs from two specialized hemispheres plus your own primary analysis. Synthesize all three into a single cohesive response.

Rules:
- Preserve all analytical insights from the Logic Hemisphere verbatim where appropriate.
- Preserve all creative artifacts (images, audio, video) from the Creative Hemisphere — include them inline.
- Integrate your own analysis as connective tissue between the hemispheres.
- If any hemisphere failed to respond, note the gap and compensate with your own analysis.
- Present the final answer as a unified whole — the reader should not feel they are reading three separate outputs.`,
};
