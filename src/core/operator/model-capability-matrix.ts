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
    { id: "text",                  label: "Text",                  icon: "\u{1F4DD}", description: "Natural language text generation and understanding" },
    { id: "code",                  label: "Code & Programming",    icon: "\u{1F4BB}", description: "Software development, code generation, debugging" },
    { id: "image-understanding",   label: "Image Understanding",   icon: "\u{1F5BC}", description: "Visual image analysis and description" },
    { id: "image-generation",      label: "Image Generation",      icon: "\u{1F3A8}", description: "Creating images from text prompts" },
    { id: "video-understanding",   label: "Video Understanding",   icon: "\u{1F3AC}", description: "Video content analysis and description" },
    { id: "video-generation",      label: "Video Generation",      icon: "\u{1F3A5}", description: "Creating video from text or image prompts" },
    { id: "voice-input",           label: "Voice Input",           icon: "\u{1F3A4}", description: "Processing spoken audio input" },
    { id: "voice-output",          label: "Voice Output",          icon: "\u{1F50A}", description: "Generating spoken audio output" },
    { id: "tts",                   label: "Text-to-Speech",        icon: "\u{1F5E3}", description: "Converting text to natural speech" },
    { id: "stt",                   label: "Speech-to-Text",        icon: "\u{1F4AC}", description: "Transcribing speech to text" },
    { id: "realtime",              label: "Realtime",              icon: "\u26A1",     description: "Low-latency streaming and realtime interaction" },
    { id: "embedding",             label: "Embedding",             icon: "\u{1F9E9}", description: "Vector embeddings for search and similarity" },
    { id: "multimodal-reasoning",  label: "Multimodal Reasoning",  icon: "\u{1F9E0}", description: "Cross-modal reasoning across text, image, audio" },
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
    | "research";

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
        pattern: "o4-mini",
        label: "OpenAI o4 Mini",
        tier: 4, parameterSize: "frontier", parametersBillions: 0,
        contextWindow: 200000, estimatedVramMb: 0, maxOutputTokens: 100000,
        adaptivePromptBudget: 4000,
        strengths: ["reasoning", "code", "tool-use", "fast", "agentic"],
        modalities: ["text", "code", "image-understanding"],
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
];

// ---------------------------------------------------------------------------
// Role → Tier Requirements
// ---------------------------------------------------------------------------

const ROLE_REQUIREMENTS: RoleTierRequirements[] = [
    { role: "classification",      minimumTier: 1, idealTier: 2 },
    { role: "chat",                minimumTier: 2, idealTier: 3 },
    { role: "summarization",       minimumTier: 2, idealTier: 3 },
    { role: "tool-selection",      minimumTier: 3, idealTier: 4 },
    { role: "code-generation",     minimumTier: 3, idealTier: 4 },
    { role: "memory-indexing",     minimumTier: 1, idealTier: 2 },
    { role: "speech-synthesis",    minimumTier: 2, idealTier: 3 },
    { role: "speech-recognition",  minimumTier: 2, idealTier: 3 },
    { role: "realtime-voice",      minimumTier: 3, idealTier: 4 },
    { role: "image-analysis",      minimumTier: 2, idealTier: 3 },
    { role: "image-creation",      minimumTier: 3, idealTier: 4 },
    { role: "video-analysis",      minimumTier: 3, idealTier: 4 },
    { role: "video-creation",      minimumTier: 3, idealTier: 4 },
    { role: "audio-production",    minimumTier: 3, idealTier: 4 },
    { role: "document-writing",    minimumTier: 2, idealTier: 3 },
    { role: "research",            minimumTier: 2, idealTier: 3 },
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
    const allProfiles = [...runtimeProfiles, ...KNOWN_PROFILES];

    // Exact match (runtime profiles checked first)
    for (const profile of allProfiles) {
        if (lower === profile.pattern.toLowerCase()) {
            return profile;
        }
    }

    // Prefix / contains match
    for (const profile of allProfiles) {
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
        modalities: ["text"],
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
    "speech-synthesis", "speech-recognition", "realtime-voice",
    "image-analysis", "image-creation",
    "video-analysis", "video-creation",
    "audio-production", "document-writing", "research",
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
