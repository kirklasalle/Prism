import type { ProviderSecretStore } from "./provider-secret-store.js";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join as pathJoin } from "node:path";

// ── LLM Trace Logger ─────────────────────────────────────────────────────────
const LLM_TRACE_DIR = pathJoin(process.cwd(), "logs");
const LLM_TRACE_FILE = pathJoin(LLM_TRACE_DIR, "llm-trace.log");
function llmTraceLog(label: string, data: unknown): void {
    try {
        if (!existsSync(LLM_TRACE_DIR)) mkdirSync(LLM_TRACE_DIR, { recursive: true });
        const ts = new Date().toISOString();
        const serialized = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        appendFileSync(LLM_TRACE_FILE, `\n[${ts}] [${label}]\n${serialized}\n`, "utf-8");
    } catch { /* never break LLM calls for logging */ }
}
import {
    resolveProfile,
    selectModelForRole,
    selectModelForModality,
    getModalitySummary,
    detectRequestModality,
    buildAdaptiveParams,
    buildAdaptiveSystemPrompt,
    getRoleRequirements,
    getKnownProfiles,
    registerModelProfile,
    updateModelProfile,
    removeModelProfile,
    getRuntimeProfiles,
    loadRuntimeProfiles,
    ALL_TASK_ROLES,
    ALL_MODALITIES,
    getDeprecationStatus,
    getActiveProfiles,
    getDeprecatedProfiles,
    resolvePromptStrategy,
    PROVIDER_PROMPT_STRATEGIES,
    validateSRLeftModel,
    validateSRRightModel,
    filterSRLogicModels,
    filterSRCreativeModels,
    validateSRTriad,
    SR_SYSTEM_PROMPTS,
} from "./model-capability-matrix.js";
import type {
    TaskRole,
    AvailableModel,
    ModelRouterSelection,
    AdaptivePromptParams,
    ModelCapabilityProfile,
    ModelModality,
    ModalityDetectionInput,
    DeprecationStatus,
    ProviderPromptStrategy,
    SpectrumRefractionConfig,
    SRValidationResult,
    SRTriadValidation,
    SRIsolationLevel,
} from "./model-capability-matrix.js";
import { computeCostUsd } from "./usage-pricing-catalog.js";
import type { ActivityBus } from "../activity/bus.js";
import type { UsageMeteringService } from "./usage-metering-service.js";


export type RoutingStrategy = "single" | "multi" | "modality";

export interface RoutingOverrideEntry {
    providerId: string;
    model: string;
}

export interface RoutingConfig {
    strategy: RoutingStrategy;
    roleOverrides: Record<string, RoutingOverrideEntry | null>;
    agentOverrides: Record<string, RoutingOverrideEntry | null>;
    modalityOverrides: Record<string, RoutingOverrideEntry | null>;
    preferredModality: string | null;
}

export type { TaskRole, ModelRouterSelection, AdaptivePromptParams, ModelCapabilityProfile, ModelModality, SpectrumRefractionConfig, SRValidationResult, SRTriadValidation, SRIsolationLevel };

/** Output from a Spectrum Refraction generation pass. */
export interface SRGenerationOutput {
    /** Final aggregated content. */
    content: string;
    /** Tool calls emitted during synthesis. */
    toolCalls?: LlmToolCall[];
    /** Stop reason from synthesis. */
    stopReason?: string;
    /** Thought signature or chain of thought. */
    thoughtSignature?: string;
    /** Individual hemisphere outputs for transparency. */
    hemispheres: {
        left: LlmGenerationOutput | null;
        right: LlmGenerationOutput | null;
        main: LlmGenerationOutput | null;
    };
    /** The aggregation pass output. */
    aggregation: LlmGenerationOutput | null;
    /** Timing breakdown in ms. */
    timing: {
        fanOutMs: number;
        aggregationMs: number;
        totalMs: number;
    };
    /** Media artifacts extracted from the Creative hemisphere. */
    mediaArtifacts: Array<{ type: "image" | "audio" | "video"; data: string; mimeType?: string }>;
    /** Isolation quality of this SR generation. */
    isolationLevel: SRIsolationLevel;
}

/** Cost estimate for a single SR generation pass. */
export interface SRCostEstimate {
    leftEstimatedCostUsd: number;
    rightEstimatedCostUsd: number;
    mainFanOutEstimatedCostUsd: number;
    aggregationEstimatedCostUsd: number;
    totalEstimatedCostUsd: number;
    currency: "USD";
    avgInputTokens: number;
    avgOutputTokens: number;
    advisory?: string;
}

export type PrismLlmProviderId =
    | "openai" | "anthropic" | "ollama" | "ollama-cloud" | "custom"
    | "google" | "mistral" | "cohere" | "groq" | "together"
    | "deepseek" | "perplexity" | "fireworks" | "openrouter" | "lmstudio" | "llamacpp" | "bitnetcpp";

export const ALL_PROVIDER_IDS: PrismLlmProviderId[] = [
    "openai", "anthropic", "google", "mistral", "cohere", "groq",
    "together", "deepseek", "perplexity", "fireworks", "openrouter",
    "llamacpp", "bitnetcpp", "ollama", "ollama-cloud", "lmstudio", "custom",
];

export interface PersistedProviderSettings {
    providerId: PrismLlmProviderId;
    baseUrl: string | null;
    apiKeyHeader: string | null;
    models: string[];
    defaultModel: string | null;
    updatedAt: string;
    source: string;
}

export interface LlmProviderSnapshot {
    id: PrismLlmProviderId;
    label: string;
    kind: "remote" | "local";
    enabled: boolean;
    reason?: string;
    requiresApiKey: boolean;
    hasApiKey: boolean;
    models: string[];
    baseUrl: string;
    apiKeyHeader: string | null;
    defaultModel: string | null;
    settingsSource: "environment" | "persisted";
}

export interface LlmProviderCatalog {
    activeProviderId: PrismLlmProviderId | null;
    activeModel: string | null;
    providers: LlmProviderSnapshot[];
}

export interface LlmSelection {
    providerId: string | null;
    model: string | null;
}

interface ProviderSettings {
    id: PrismLlmProviderId;
    label: string;
    kind: "remote" | "local";
    baseUrl: string;
    apiKey?: string;
    apiKeyHeader?: string;
    defaultModels: string[];
    defaultModel: string | null;
    requiresApiKey: boolean;
    settingsSource: "environment" | "persisted";
}

interface LlmGenerationInput {
    message: string;
    conversation: Array<{
        role: "user" | "assistant" | "system" | "tool";
        content: string | LlmContentPart[];
        tool_call_id?: string;
        tool_calls?: LlmToolCall[];
        thoughtSignature?: string;
    }>;
    systemPrompt: string;
    tools?: LlmToolDefinition[];
    tool_choice?: "auto" | "none" | "required";
    stream?: boolean;
}

export interface LlmGenerationOutput {
    providerId: PrismLlmProviderId;
    model: string;
    content: string;
    toolCalls?: LlmToolCall[];
    stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop";
    tokensUsed?: { input: number; output: number; costUsd: number };
    thoughtSignature?: string;
}

export interface LlmToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, LlmToolParameterSchema>;
        required?: string[];
    };
}

export interface LlmToolParameterSchema {
    type: string;
    description?: string;
    enum?: string[];
    items?: LlmToolParameterSchema;
}

export interface LlmToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    thought_signature?: string;
    thoughtSignature?: string;
    /** Gemini OpenAI-compat: preserves the raw extra_content block for verbatim echo */
    extra_content?: { google?: { thought_signature?: string } };
}

export interface LlmContentPart {
    type: "text" | "image_url";
    text?: string;
    image_url?: { url: string; detail?: "auto" | "low" | "high" };
}

export type LlmStreamChunk =
    | { type: "text_delta"; text: string }
    | { type: "tool_call_start"; id: string; name: string }
    | { type: "tool_call_delta"; id: string; arguments: string }
    | { type: "done"; stopReason: string };

const OPENAI_DEFAULT_MODELS = [
    "gpt-4.1",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-5-mini",
    "gpt-5",
];

const ANTHROPIC_DEFAULT_MODELS = [
    "claude-sonnet-4-5-20251022",
    "claude-haiku-4-5-20251022",
    "claude-opus-4-5-20251101",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
];

const GOOGLE_DEFAULT_MODELS = ["gemini-3.0-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro"];
const MISTRAL_DEFAULT_MODELS = ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"];
const COHERE_DEFAULT_MODELS = ["command-r-plus", "command-r", "command-light"];
const GROQ_DEFAULT_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"];
const TOGETHER_DEFAULT_MODELS = ["meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1"];
const DEEPSEEK_DEFAULT_MODELS = ["deepseek-chat", "deepseek-reasoner"];
const PERPLEXITY_DEFAULT_MODELS = ["sonar-pro", "sonar"];
const FIREWORKS_DEFAULT_MODELS = ["accounts/fireworks/models/llama-v3p1-70b-instruct", "accounts/fireworks/models/mixtral-8x7b-instruct"];
const OPENROUTER_DEFAULT_MODELS = ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "meta-llama/llama-3.1-70b-instruct"];

const OLLAMA_CLOUD_DEFAULT_MODELS = [
    "gpt-oss:120b",
    "gpt-oss:20b",
    "deepseek-v3.1:671b",
    "kimi-k2:1t",
    "qwen3-coder:480b",
    "kimi-k2-thinking",
];

function parseModelList(raw: string | undefined, fallback: string[]): string[] {
    if (!raw?.trim()) {
        return [...fallback];
    }
    return raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function trimSlash(value: string): string {
    return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeOptionalUrl(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimSlash(trimmed) : null;
}

function normalizeModels(models: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const model of models) {
        const trimmed = model.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        normalized.push(trimmed);
    }
    return normalized;
}

import { LlamaCppSupervisor } from "./llama-cpp-supervisor.js";

export class LlmProviderManager {
    private readonly defaults: Record<PrismLlmProviderId, ProviderSettings>;
    private readonly persistedSettings = new Map<PrismLlmProviderId, PersistedProviderSettings>();
    private activeProviderId: PrismLlmProviderId | null;
    private activeModel: string | null;
    private routingConfig: RoutingConfig = {
        strategy: "single",
        roleOverrides: {},
        agentOverrides: {},
        modalityOverrides: {},
        preferredModality: null,
    };

    private usageMetering: UsageMeteringService | null = null;

    public setUsageMetering(usageMetering?: UsageMeteringService): void {
        this.usageMetering = usageMetering ?? null;
        if (usageMetering) {
            const caps = usageMetering.getCaps();
            if (caps.sessionCap === null && caps.dailyCap === null && caps.monthlyCap === null) {
                console.warn(`[PRISM][budget] WARNING: PRISM is running with NO active API spending caps. Run the setup wizard or set caps in settings to enable safety limits.`);
            }
        }
    }



    /** Short-lived TTL cache for network-discovered model lists (the expensive part of getCatalog). */
    private discoveredModelsCache: {
        ollama: string[];
        "ollama-cloud": string[];
        lmstudio: string[];
        llamacpp: string[];
        bitnetcpp: string[];
        expiresAt: number;
    } | null = null;
    private static readonly CATALOG_CACHE_TTL_MS = 5_000;

    /** Circuit breaker state: key = `${hemisphereRole}:${providerId}` */
    private readonly srCircuitBreaker = new Map<string, { failures: number; openUntil: number }>();
    private static readonly SR_CB_FAILURE_THRESHOLD = 3;
    private static readonly SR_CB_OPEN_DURATION_MS = 30_000;

    /** SOTA Skills Engine: dynamic tool filtering modifier */
    private temporaryToolFilter: string[] | null = null;

    public setTemporaryToolFilter(allowedToolNames: string[] | null): void {
        this.temporaryToolFilter = allowedToolNames;
    }

    public clearTemporaryToolFilter(): void {
        this.setTemporaryToolFilter(null);
    }

    constructor(
        private readonly env: NodeJS.ProcessEnv = process.env,
        settings: PersistedProviderSettings[] = [],
        private readonly secretStore?: ProviderSecretStore,
        private readonly llamaSupervisor?: LlamaCppSupervisor,
        private readonly bitnetSupervisor?: LlamaCppSupervisor,
        private readonly activityBus?: ActivityBus,
    ) {
        const customBaseUrl = this.env.PRISM_CUSTOM_PROVIDER_URL?.trim() ?? "";

        this.defaults = {
            openai: {
                id: "openai",
                label: "OpenAI",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1"),
                apiKey: this.env.OPENAI_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_OPENAI_MODELS, OPENAI_DEFAULT_MODELS),
                defaultModel: this.env.PRISM_LLM_PROVIDER === "openai"
                    ? this.env.PRISM_LLM_MODEL?.trim() || OPENAI_DEFAULT_MODELS[0] || null
                    : OPENAI_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            anthropic: {
                id: "anthropic",
                label: "Anthropic",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com/v1"),
                apiKey: this.env.ANTHROPIC_API_KEY?.trim(),
                apiKeyHeader: "x-api-key",
                defaultModels: parseModelList(this.env.PRISM_ANTHROPIC_MODELS, ANTHROPIC_DEFAULT_MODELS),
                defaultModel: this.env.PRISM_LLM_PROVIDER === "anthropic"
                    ? this.env.PRISM_LLM_MODEL?.trim() || ANTHROPIC_DEFAULT_MODELS[0] || null
                    : ANTHROPIC_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            ollama: {
                id: "ollama",
                label: "Ollama (Local)",
                kind: "local",
                baseUrl: trimSlash(this.env.PRISM_OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434"),
                defaultModels: parseModelList(this.env.PRISM_OLLAMA_MODELS, []),
                defaultModel: this.env.PRISM_LLM_PROVIDER === "ollama"
                    ? this.env.PRISM_LLM_MODEL?.trim() || null
                    : null,
                requiresApiKey: false,
            } as ProviderSettings,
            "ollama-cloud": {
                id: "ollama-cloud",
                label: "Ollama Cloud",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_OLLAMA_CLOUD_BASE_URL?.trim() || "https://ollama.com"),
                apiKey: this.env.OLLAMA_API_KEY?.trim() || this.env.PRISM_OLLAMA_CLOUD_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_OLLAMA_CLOUD_MODELS, OLLAMA_CLOUD_DEFAULT_MODELS),
                defaultModel: this.env.PRISM_LLM_PROVIDER === "ollama-cloud"
                    ? this.env.PRISM_LLM_MODEL?.trim() || OLLAMA_CLOUD_DEFAULT_MODELS[0] || null
                    : OLLAMA_CLOUD_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            custom: {
                id: "custom",
                label: this.env.PRISM_CUSTOM_PROVIDER_NAME?.trim() || "Custom Provider",
                kind: "remote",
                baseUrl: trimSlash(customBaseUrl),
                apiKey: this.env.PRISM_CUSTOM_PROVIDER_API_KEY?.trim(),
                apiKeyHeader: this.env.PRISM_CUSTOM_PROVIDER_API_KEY_HEADER?.trim() || "Authorization",
                defaultModels: parseModelList(this.env.PRISM_CUSTOM_MODELS, []),
                defaultModel: this.env.PRISM_LLM_PROVIDER === "custom"
                    ? this.env.PRISM_LLM_MODEL?.trim() || null
                    : null,
                requiresApiKey: Boolean(customBaseUrl),
                settingsSource: "environment",
            },
            google: {
                id: "google",
                label: "Google AI (Gemini)",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_GOOGLE_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta/openai"),
                apiKey: this.env.GOOGLE_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_GOOGLE_MODELS, GOOGLE_DEFAULT_MODELS),
                defaultModel: GOOGLE_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            mistral: {
                id: "mistral",
                label: "Mistral AI",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_MISTRAL_BASE_URL?.trim() || "https://api.mistral.ai/v1"),
                apiKey: this.env.MISTRAL_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_MISTRAL_MODELS, MISTRAL_DEFAULT_MODELS),
                defaultModel: MISTRAL_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            cohere: {
                id: "cohere",
                label: "Cohere",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_COHERE_BASE_URL?.trim() || "https://api.cohere.com/compatibility/v1"),
                apiKey: this.env.COHERE_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_COHERE_MODELS, COHERE_DEFAULT_MODELS),
                defaultModel: COHERE_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            groq: {
                id: "groq",
                label: "Groq",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1"),
                apiKey: this.env.GROQ_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_GROQ_MODELS, GROQ_DEFAULT_MODELS),
                defaultModel: GROQ_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            together: {
                id: "together",
                label: "Together AI",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_TOGETHER_BASE_URL?.trim() || "https://api.together.xyz/v1"),
                apiKey: this.env.TOGETHER_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_TOGETHER_MODELS, TOGETHER_DEFAULT_MODELS),
                defaultModel: TOGETHER_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            deepseek: {
                id: "deepseek",
                label: "DeepSeek",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1"),
                apiKey: this.env.DEEPSEEK_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_DEEPSEEK_MODELS, DEEPSEEK_DEFAULT_MODELS),
                defaultModel: DEEPSEEK_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            perplexity: {
                id: "perplexity",
                label: "Perplexity",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_PERPLEXITY_BASE_URL?.trim() || "https://api.perplexity.ai"),
                apiKey: this.env.PERPLEXITY_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_PERPLEXITY_MODELS, PERPLEXITY_DEFAULT_MODELS),
                defaultModel: PERPLEXITY_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            fireworks: {
                id: "fireworks",
                label: "Fireworks AI",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_FIREWORKS_BASE_URL?.trim() || "https://api.fireworks.ai/inference/v1"),
                apiKey: this.env.FIREWORKS_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_FIREWORKS_MODELS, FIREWORKS_DEFAULT_MODELS),
                defaultModel: FIREWORKS_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            openrouter: {
                id: "openrouter",
                label: "OpenRouter",
                kind: "remote",
                baseUrl: trimSlash(this.env.PRISM_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1"),
                apiKey: this.env.OPENROUTER_API_KEY?.trim(),
                apiKeyHeader: "Authorization",
                defaultModels: parseModelList(this.env.PRISM_OPENROUTER_MODELS, OPENROUTER_DEFAULT_MODELS),
                defaultModel: OPENROUTER_DEFAULT_MODELS[0] || null,
                requiresApiKey: true,
                settingsSource: "environment",
            },
            lmstudio: {
                id: "lmstudio",
                label: "LM Studio (Local)",
                kind: "local",
                baseUrl: trimSlash(this.env.PRISM_LMSTUDIO_BASE_URL?.trim() || "http://127.0.0.1:1234"),
                defaultModels: parseModelList(this.env.PRISM_LMSTUDIO_MODELS, []),
                defaultModel: null,
                requiresApiKey: false,
            } as ProviderSettings,
            llamacpp: {
                id: "llamacpp",
                label: "Llama.cpp (Local)",
                kind: "local",
                baseUrl: trimSlash(this.env.PRISM_LLAMACPP_BASE_URL?.trim() || "http://127.0.0.1:8080/v1"),
                defaultModels: parseModelList(this.env.PRISM_LLAMACPP_MODELS, []),
                defaultModel: null,
                requiresApiKey: false,
            } as ProviderSettings,
            bitnetcpp: {
                id: "bitnetcpp",
                label: "BitNet.cpp (Local)",
                kind: "local",
                baseUrl: trimSlash(this.env.PRISM_BITNET_BASE_URL?.trim() || "http://127.0.0.1:8082/v1"),
                defaultModels: parseModelList(this.env.PRISM_BITNET_MODELS, []),
                defaultModel: null,
                requiresApiKey: false,
            } as ProviderSettings,
        };

        this.setPersistedProviderSettings(settings);

        const configuredProvider = (this.env.PRISM_LLM_PROVIDER ?? "").trim().toLowerCase();
        const selected = this.resolveProvider(configuredProvider) ?? this.findFirstEnabledProvider();
        this.activeProviderId = selected;
        this.activeModel = null;

        if (selected) {
            const defaults = this.getResolvedSettings(selected).defaultModels;
            this.activeModel = defaults.length > 0
                ? (this.env.PRISM_LLM_MODEL?.trim() || defaults[0] || null)
                : (this.env.PRISM_LLM_MODEL?.trim() || null);
        }
    }

    setPersistedProviderSettings(settings: PersistedProviderSettings[]): void {
        this.persistedSettings.clear();
        for (const settingsEntry of settings) {
            this.persistedSettings.set(settingsEntry.providerId, {
                ...settingsEntry,
                baseUrl: normalizeOptionalUrl(settingsEntry.baseUrl),
                apiKeyHeader: settingsEntry.apiKeyHeader?.trim() || null,
                models: normalizeModels(settingsEntry.models),
                defaultModel: settingsEntry.defaultModel?.trim() || null,
            });
        }
        // Note: discoveredModelsCache is intentionally NOT cleared here.
        // Network-discovered model lists (probe results) are unaffected by settings changes.
        // Provider snapshots are always rebuilt from current settings + cached discovered models.
    }

    async getCatalog(selection?: Partial<LlmSelection>): Promise<LlmProviderCatalog> {
        // Cache only the network-discovered model lists (expensive network probes).
        // Provider snapshots are always rebuilt from current settings so that settings
        // changes (saveProviderSettings) are reflected immediately without re-probing.
        let discovered: NonNullable<typeof this.discoveredModelsCache>;
        if (this.discoveredModelsCache && Date.now() < this.discoveredModelsCache.expiresAt) {
            discovered = this.discoveredModelsCache;
        } else {
            const [ollamaModels, ollamaCloudModels, lmStudioModels, llamacppRunning, bitnetRunning] = await Promise.all([
                this.fetchOllamaModels(this.getResolvedSettings("ollama")),
                this.fetchOllamaCloudModels(this.getResolvedSettings("ollama-cloud")),
                this.fetchLmStudioModels(this.getResolvedSettings("lmstudio")),
                this.llamaSupervisor
                    ? Promise.resolve(this.llamaSupervisor.getSnapshot().filter(s => s.status === "ready").map(s => s.modelAlias!))
                    : this.fetchLmStudioModels(this.getResolvedSettings("llamacpp")),
                this.bitnetSupervisor
                    ? Promise.resolve(this.bitnetSupervisor.getSnapshot().filter(s => s.status === "ready").map(s => s.modelAlias!))
                    : Promise.resolve([] as string[]),
            ]);

            // Merge discovered local GGUF models with running models (deduplicated)
            const llamacppDiscovered = this.llamaSupervisor?.discoverLocalModels() ?? [];
            const llamacppModels = [...new Set([...llamacppRunning, ...llamacppDiscovered])];
            const bitnetDiscovered = this.bitnetSupervisor?.discoverLocalModels() ?? [];
            const bitnetcppModels = [...new Set([...bitnetRunning, ...bitnetDiscovered])];

            discovered = {
                ollama: ollamaModels,
                "ollama-cloud": ollamaCloudModels,
                lmstudio: lmStudioModels,
                llamacpp: llamacppModels,
                bitnetcpp: bitnetcppModels,
                expiresAt: Date.now() + LlmProviderManager.CATALOG_CACHE_TTL_MS,
            };
            this.discoveredModelsCache = discovered;
        }

        // Always rebuild snapshots from current settings + cached discovered models.
        // This ensures settings changes are reflected immediately.
        const providers = ALL_PROVIDER_IDS.map((id) => {
            if (id === "ollama") return this.snapshotFor(id, discovered.ollama);
            if (id === "ollama-cloud") return this.snapshotFor(id, discovered["ollama-cloud"]);
            if (id === "lmstudio") return this.snapshotFor(id, discovered.lmstudio);
            if (id === "llamacpp") return this.snapshotFor(id, discovered.llamacpp);
            if (id === "bitnetcpp") return this.snapshotFor(id, discovered.bitnetcpp);
            return this.snapshotFor(id);
        });

        let effectiveProviderId: PrismLlmProviderId | null = this.activeProviderId;
        let effectiveModel: string | null = this.activeModel;

        const preferredProviderId = selection?.providerId ? this.resolveProvider(selection.providerId) : null;
        if (preferredProviderId) {
            effectiveProviderId = preferredProviderId;
            effectiveModel = selection?.model?.trim() || null;
        } else if (selection?.providerId === null) {
            effectiveProviderId = null;
            effectiveModel = null;
        }

        if (effectiveProviderId) {
            const active = providers.find((provider) => provider.id === effectiveProviderId);
            if (!selection?.providerId && !active?.enabled) {
                effectiveProviderId = providers.find((provider) => provider.enabled)?.id ?? null;
                effectiveModel = null;
            }
            if (effectiveProviderId) {
                const selectedProvider = providers.find((provider) => provider.id === effectiveProviderId);
                if (selectedProvider) {
                    if (!effectiveModel || !selectedProvider.models.includes(effectiveModel)) {
                        effectiveModel = selectedProvider.defaultModel && selectedProvider.models.includes(selectedProvider.defaultModel)
                            ? selectedProvider.defaultModel
                            : selectedProvider.models[0] ?? null;
                    }
                }
            }
        }

        if (!selection) {
            this.activeProviderId = effectiveProviderId;
            this.activeModel = effectiveModel;
        }

        return {
            activeProviderId: effectiveProviderId,
            activeModel: effectiveModel,
            providers,
        };
    }

    async setActiveSelection(providerId: string, model?: string): Promise<LlmProviderCatalog> {
        const resolved = this.resolveProvider(providerId);
        if (!resolved) {
            throw new Error(`Unknown provider: ${providerId}`);
        }

        const catalog = await this.getCatalog();
        const provider = catalog.providers.find((entry) => entry.id === resolved);
        if (!provider || !provider.enabled) {
            throw new Error(`Provider is not available: ${providerId}`);
        }

        if (model && !provider.models.includes(model)) {
            throw new Error(`Model is not available for ${provider.label}: ${model}`);
        }

        this.activeProviderId = resolved;
        this.activeModel = model?.trim() || provider.models[0] || null;
        this.discoveredModelsCache = null; // Invalidate discovered-models cache on selection change

        return {
            ...catalog,
            activeProviderId: this.activeProviderId,
            activeModel: this.activeModel,
        };
    }

    /**
     * Retry a provider call with truncated exponential backoff.
     * Retries only on thrown errors (transient network/timeout failures),
     * not on null returns (misconfiguration / model-not-loaded).
     *
     * Delays: 500 ms → 1 s → 2 s (3 retries, capped at 4 s per attempt).
     */
    private async withExponentialRetry<T>(
        fn: () => Promise<T>,
        maxRetries = 3,
        baseDelayMs = 500,
    ): Promise<T> {
        let lastError: unknown;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                if (attempt < maxRetries) {
                    const delay = Math.min(baseDelayMs * Math.pow(2, attempt), 4000);
                    await new Promise<void>((res) => setTimeout(res, delay));
                }
            }
        }
        throw lastError;
    }

    async generate(input: LlmGenerationInput, selection?: Partial<LlmSelection>): Promise<LlmGenerationOutput | null> {
        if (this.temporaryToolFilter && input.tools) {
            input = {
                ...input,
                tools: input.tools.filter(t => this.temporaryToolFilter!.includes(t.name))
            };
        }

        // Check budget caps (SOTA Centralized Active Kill-Switch / Hard Ceiling)
        if (this.usageMetering) {
            const capCheck = this.usageMetering.checkCap();
            if (!capCheck.allowed) {
                const errMsg = `Centralized API budget ceiling breached: reached ${capCheck.capType} spend cap. Model generation halted.`;
                this.activityBus?.emit({
                    sessionId: "llm-provider-manager",
                    layer: "llm",
                    operation: "llm.budget_limit_breached",
                    status: "failed",
                    details: {
                        capType: capCheck.capType,
                        remainingUsd: capCheck.remainingUsd,
                        error: errMsg
                    }
                });
                throw new Error(errMsg);
            }
        }


        const catalog = await this.getCatalog(selection);
        if (!catalog.activeProviderId || !catalog.activeModel) {
            return null;
        }

        const provider = catalog.providers.find((entry) => entry.id === catalog.activeProviderId);
        if (!provider?.enabled) {
            return null;
        }

        const settings = this.getResolvedSettings(catalog.activeProviderId);
        const profile = resolveProfile(catalog.activeModel);
        const adaptiveParams = buildAdaptiveParams(profile);

        try {
            if (catalog.activeProviderId === "anthropic") {
                return await this.withExponentialRetry(() =>
                    this.generateWithAnthropic(settings, catalog.activeModel!, input));
            }

            if (catalog.activeProviderId === "ollama") {
                return await this.withExponentialRetry(() =>
                    this.generateWithOllama(settings, catalog.activeModel!, input, adaptiveParams));
            }

            if (catalog.activeProviderId === "ollama-cloud") {
                return await this.withExponentialRetry(() =>
                    this.generateWithOllamaCloud(settings, catalog.activeModel!, input, adaptiveParams));
            }

            // Apply dynamic port routing if managed by supervisor
            if (catalog.activeProviderId === "llamacpp" && this.llamaSupervisor) {
                let dynamicPort = this.llamaSupervisor.getPortForAlias(catalog.activeModel);
                if (!dynamicPort && process.env.PRISM_BASE_MODE === "true") {
                    const modelPath = this.llamaSupervisor.getModelPath(catalog.activeModel);
                    if (modelPath) {
                        console.log(`[PRISM][SSSR] Dynamic on-demand loading of local GGUF model: ${catalog.activeModel}`);
                        await this.llamaSupervisor.loadModel(modelPath, catalog.activeModel, { ctxSize: 2048 });
                        dynamicPort = this.llamaSupervisor.getPortForAlias(catalog.activeModel);
                    }
                }
                if (!dynamicPort) return null; // Model not fully loaded
                settings.baseUrl = `http://127.0.0.1:${dynamicPort}/v1`;
            }

            // All other providers use OpenAI-compatible API
            return await this.withExponentialRetry(() =>
                this.generateWithOpenAiCompatible(settings, catalog.activeModel!, input));
        } catch (error) {
            const failedProvider = catalog.activeProviderId;
            const isRemote = provider.kind === "remote";
            if (isRemote) {
                console.warn(`[PRISM][llm] Generation failed for cloud provider "${failedProvider}". Attempting automatic local fallback...`);
                let fallbackProvider: PrismLlmProviderId | null = null;
                let fallbackModel: string | null = null;

                // 1. Check llamacpp first (which manages GGUF slots)
                const llamacppSnapshot = this.snapshotFor("llamacpp");
                if (llamacppSnapshot.enabled && llamacppSnapshot.models.length > 0) {
                    fallbackProvider = "llamacpp";
                    fallbackModel = llamacppSnapshot.defaultModel || llamacppSnapshot.models[0];
                }

                // 2. Check ollama second
                if (!fallbackProvider) {
                    const ollamaSnapshot = this.snapshotFor("ollama");
                    if (ollamaSnapshot.enabled && ollamaSnapshot.models.length > 0) {
                        fallbackProvider = "ollama";
                        fallbackModel = ollamaSnapshot.defaultModel || ollamaSnapshot.models[0];
                    }
                }

                // 3. Check lmstudio third
                if (!fallbackProvider) {
                    const lmstudioSnapshot = this.snapshotFor("lmstudio");
                    if (lmstudioSnapshot.enabled && lmstudioSnapshot.models.length > 0) {
                        fallbackProvider = "lmstudio";
                        fallbackModel = lmstudioSnapshot.defaultModel || lmstudioSnapshot.models[0];
                    }
                }

                if (fallbackProvider && fallbackModel) {
                    console.log(`[PRISM][llm] Dynamic fallback triggered. Routing request to local provider "${fallbackProvider}" with model "${fallbackModel}".`);
                    this.activityBus?.emit({
                        sessionId: selection?.providerId ?? "llm",
                        layer: "llm",
                        operation: "llm.provider_fallback",
                        status: "succeeded",
                        details: {
                            failedProvider,
                            failedModel: catalog.activeModel,
                            fallbackProvider,
                            fallbackModel,
                            error: String(error),
                        },
                    });

                    // Recurse with local selection
                    return this.generate(input, { providerId: fallbackProvider, model: fallbackModel });
                }
            }
            throw error;
        }
    }

    /**
     * Route a request to the best available model for a given task role.
     *
     * Builds the available-model inventory from the current catalog,
     * selects the best model for the role, applies adaptive prompt
     * parameters, and generates.
     */
    async generateForRole(
        role: TaskRole,
        input: LlmGenerationInput,
        agentId?: string,
    ): Promise<(LlmGenerationOutput & { routing: ModelRouterSelection; adaptiveParams: AdaptivePromptParams }) | null> {
        const catalog = await this.getCatalog();
        const availableModels: AvailableModel[] = [];

        for (const provider of catalog.providers) {
            if (!provider.enabled) continue;
            for (const model of provider.models) {
                availableModels.push({
                    providerId: provider.id,
                    model,
                    locality: provider.kind === "local" ? "local" : "cloud",
                });
            }
        }

        let routing: ModelRouterSelection | null = null;

        // Check routing overrides (agent-level first, then role-level)
        if (this.routingConfig.strategy === "multi") {
            const agentOverride = agentId ? this.routingConfig.agentOverrides[agentId] : null;
            const roleOverride = this.routingConfig.roleOverrides[role] ?? null;
            const override = agentOverride ?? roleOverride;
            if (override) {
                const profile = resolveProfile(override.model);
                const req = getRoleRequirements(role);
                routing = {
                    providerId: override.providerId,
                    model: override.model,
                    profile,
                    degraded: profile.tier < req.minimumTier,
                    reason: `Manual override (${override.providerId}/${override.model})`,
                };
            }
        }

        // Modality-based routing: detect modality from input and route accordingly
        if (!routing && this.routingConfig.strategy === "modality") {
            const modalityInput = {
                message: input.message,
                conversation: input.conversation as Array<{ content: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> }>,
            };
            routing = this.resolveModelForModalityRequest(
                modalityInput,
                availableModels,
            );
        }

        if (!routing) {
            routing = selectModelForRole(role, availableModels);
        }
        if (!routing) return null;

        const adaptiveParams = buildAdaptiveParams(routing.profile);

        // Build adaptive system prompt (replaces the static one from input)
        const adaptiveSystemPrompt = buildAdaptiveSystemPrompt(routing.profile);

        // Trim conversation to the adaptive window size
        const trimmedConversation = input.conversation.slice(-adaptiveParams.conversationWindow);

        const adaptedInput: LlmGenerationInput = {
            message: input.message,
            conversation: trimmedConversation,
            systemPrompt: adaptiveSystemPrompt,
            tools: input.tools,
            tool_choice: input.tool_choice,
            stream: input.stream,
        };

        const result = await this.generate(adaptedInput, {
            providerId: routing.providerId,
            model: routing.model,
        });

        if (!result) return null;

        return { ...result, routing, adaptiveParams };
    }

    // ── Spectrum Refraction (Prism SR) ─────────────────────────────────

    /**
     * Validate SR model selections against the capability matrix.
     */
    validateSRModels(leftModel: string | null, rightModel: string | null): {
        left: SRValidationResult | null;
        right: SRValidationResult | null;
    } {
        return {
            left: leftModel ? validateSRLeftModel(resolveProfile(leftModel)) : null,
            right: rightModel ? validateSRRightModel(resolveProfile(rightModel)) : null,
        };
    }

    /**
     * Cross-validate the SR triad including instance isolation enforcement.
     * Returns the full triad validation with isolation level classification.
     */
    validateSRTriadConfig(
        leftProviderId: string | null,
        leftModel: string | null,
        rightProviderId: string | null,
        rightModel: string | null,
    ): SRTriadValidation {
        const left = (leftProviderId && leftModel) ? { providerId: leftProviderId, model: leftModel } : null;
        const right = (rightProviderId && rightModel) ? { providerId: rightProviderId, model: rightModel } : null;
        return validateSRTriad(left, right);
    }

    /**
     * Get available models filtered for SR Left and Right hemispheres.
     */
    async getSRModelCandidates(): Promise<{
        left: Array<{ providerId: string; model: string; tier: number; level: string; advisory: string }>;
        right: Array<{ providerId: string; model: string; tier: number; level: string; advisory: string }>;
    }> {
        const catalog = await this.getCatalog();
        const available: AvailableModel[] = [];
        for (const provider of catalog.providers) {
            if (!provider.enabled) continue;
            for (const model of provider.models) {
                available.push({
                    providerId: provider.id,
                    model,
                    locality: provider.kind === "local" ? "local" : "cloud",
                });
            }
        }

        const leftCandidates = filterSRLogicModels(available).map(c => ({
            providerId: c.providerId,
            model: c.model,
            tier: c.profile.tier,
            level: c.validation.level,
            advisory: c.validation.advisoryText,
        }));

        const rightCandidates = filterSRCreativeModels(available).map(c => ({
            providerId: c.providerId,
            model: c.model,
            tier: c.profile.tier,
            level: c.validation.level,
            advisory: c.validation.advisoryText,
        }));

        return { left: leftCandidates, right: rightCandidates };
    }

    /**
     * Spectrum Refraction generation — fan-out to three models, then aggregate.
     *
     * 1. Fan-out: Left (logic), Right (creative), Main (direct) — in parallel
     * 2. Aggregation: Main model synthesizes all three outputs
     *
     * D4c enhancements: per-hemisphere timeouts, circuit breaker, SR audit trail.
     */
    async generateSR(
        input: LlmGenerationInput,
        srConfig: SpectrumRefractionConfig,
        mainSelection?: Partial<LlmSelection>,
    ): Promise<SRGenerationOutput | null> {
        if (this.temporaryToolFilter && input.tools) {
            input = {
                ...input,
                tools: input.tools.filter(t => this.temporaryToolFilter!.includes(t.name))
            };
        }

        if (!srConfig.enabled || !srConfig.leftModel || !srConfig.rightModel) return null;

        // ── Pre-flight guard: enforce instance isolation ──
        const triadCheck = validateSRTriad(srConfig.leftModel, srConfig.rightModel);
        if (!triadCheck.valid) {
            console.error(`[SR] Pre-flight isolation check FAILED: ${triadCheck.advisory}`);
            return null;
        }

        const totalStart = Date.now();
        const leftProviderId = srConfig.leftModel.providerId;
        const rightProviderId = srConfig.rightModel.providerId;
        const sessionIdForAudit = mainSelection?.providerId ?? "sr";

        // ── Emit audit: fan-out start ──
        this.activityBus?.emit({
            sessionId: sessionIdForAudit,
            layer: "llm",
            operation: "sr.fanout_start",
            status: "started",
            details: {
                leftProvider: leftProviderId,
                leftModel: srConfig.leftModel.model,
                leftSlot: srConfig.leftSlot ?? null,
                rightProvider: rightProviderId,
                rightModel: srConfig.rightModel.model,
                rightSlot: srConfig.rightSlot ?? null,
                isolationLevel: triadCheck.isolationLevel,
                circuitBreakerEnabled: srConfig.circuitBreakerEnabled !== false,
            },
        });

        // ── Circuit breaker: check per-hemisphere state ──
        const cbEnabled = srConfig.circuitBreakerEnabled !== false;
        const leftCbKey = `left:${leftProviderId}`;
        const rightCbKey = `right:${rightProviderId}`;
        const now = Date.now();
        const leftCbOpen = cbEnabled && this.isCBOpen(leftCbKey, now);
        const rightCbOpen = cbEnabled && this.isCBOpen(rightCbKey, now);

        if (leftCbOpen) {
            console.warn(`[SR] Left hemisphere circuit breaker OPEN for provider: ${leftProviderId}`);
            this.activityBus?.emit({
                sessionId: sessionIdForAudit,
                layer: "llm",
                operation: "sr.circuit_breaker_triggered",
                status: "failed",
                details: { hemisphere: "left", providerId: leftProviderId },
            });
        }
        if (rightCbOpen) {
            console.warn(`[SR] Right hemisphere circuit breaker OPEN for provider: ${rightProviderId}`);
            this.activityBus?.emit({
                sessionId: sessionIdForAudit,
                layer: "llm",
                operation: "sr.circuit_breaker_triggered",
                status: "failed",
                details: { hemisphere: "right", providerId: rightProviderId },
            });
        }

        const leftTimeoutMs = srConfig.leftTimeoutMs ?? 60_000;
        const rightTimeoutMs = srConfig.rightTimeoutMs ?? 60_000;

        // Build hemisphere-specific inputs
        const leftInput: LlmGenerationInput = {
            message: input.message,
            conversation: input.conversation,
            systemPrompt: SR_SYSTEM_PROMPTS.left,
            tools: input.tools,
            tool_choice: input.tool_choice,
        };

        const rightInput: LlmGenerationInput = {
            message: input.message,
            conversation: input.conversation,
            systemPrompt: SR_SYSTEM_PROMPTS.right,
        };

        const mainInput: LlmGenerationInput = {
            message: input.message,
            conversation: input.conversation,
            systemPrompt: input.systemPrompt,
            tools: input.tools,
            tool_choice: input.tool_choice,
        };

        // Fan-out: three parallel generations (circuit-broken hemispheres skip)
        const fanOutStart = Date.now();

        const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> =>
            Promise.race([
                promise,
                new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
            ]);

        const leftGen = leftCbOpen
            ? Promise.resolve(null)
            : withTimeout(
                this.generate(leftInput, { providerId: leftProviderId, model: srConfig.leftModel.model }),
                leftTimeoutMs,
            ).then(result => {
                if (cbEnabled) this.recordCBOutcome(leftCbKey, result !== null);
                return result;
            });

        const rightGen = rightCbOpen
            ? Promise.resolve(null)
            : withTimeout(
                this.generate(rightInput, { providerId: rightProviderId, model: srConfig.rightModel.model }),
                rightTimeoutMs,
            ).then(result => {
                if (cbEnabled) this.recordCBOutcome(rightCbKey, result !== null);
                return result;
            });

        const mainGen = withTimeout(this.generate(mainInput, mainSelection), 60_000);

        const [leftResult, rightResult, mainResult] = await Promise.all([leftGen, rightGen, mainGen]);

        const fanOutMs = Date.now() - fanOutStart;

        // ── Emit audit: fan-out complete ──
        this.activityBus?.emit({
            sessionId: sessionIdForAudit,
            layer: "llm",
            operation: "sr.fanout_complete",
            status: "succeeded",
            details: {
                fanOutMs,
                leftSuccess: leftResult !== null,
                rightSuccess: rightResult !== null,
                mainSuccess: mainResult !== null,
                leftCircuitOpen: leftCbOpen,
                rightCircuitOpen: rightCbOpen,
            },
        });

        // Build advisory notes for timed-out or circuit-broken hemispheres
        const leftTimedOut = !leftCbOpen && leftResult === null;
        const rightTimedOut = !rightCbOpen && rightResult === null;
        const leftAdvisory = leftCbOpen
            ? `(Logic Hemisphere skipped — circuit breaker open for provider: ${leftProviderId})`
            : leftTimedOut
                ? `(Logic Hemisphere timed out after ${leftTimeoutMs}ms)`
                : null;
        const rightAdvisory = rightCbOpen
            ? `(Creative Hemisphere skipped — circuit breaker open for provider: ${rightProviderId})`
            : rightTimedOut
                ? `(Creative Hemisphere timed out after ${rightTimeoutMs}ms)`
                : null;

        const leftOutput = leftResult?.content ?? leftAdvisory ?? "(Logic Hemisphere did not respond)";
        const rightOutput = rightResult?.content ?? rightAdvisory ?? "(Creative Hemisphere did not respond)";
        const mainOutput = mainResult?.content ?? "(Primary analysis did not respond)";

        const leftModelLabel = srConfig.leftModel.model;
        const rightModelLabel = srConfig.rightModel.model;
        const mainModelLabel = mainSelection?.model ?? "main";

        const aggregationMessage = [
            `<user-prompt>${input.message}</user-prompt>`,
            "",
            `<logic-hemisphere model="${leftModelLabel}" provider="${leftProviderId}" isolation="${triadCheck.isolationLevel}">`,
            leftOutput,
            `</logic-hemisphere>`,
            "",
            `<creative-hemisphere model="${rightModelLabel}" provider="${rightProviderId}">`,
            rightOutput,
            `</creative-hemisphere>`,
            "",
            `<primary-analysis model="${mainModelLabel}">`,
            mainOutput,
            `</primary-analysis>`,
            "",
            "Synthesize these three perspectives into a single cohesive response following your system instructions.",
        ].join("\n");

        const aggregationInput: LlmGenerationInput = {
            message: aggregationMessage,
            conversation: input.conversation,
            systemPrompt: SR_SYSTEM_PROMPTS.aggregation,
            tools: input.tools,
            tool_choice: input.tool_choice,
        };

        // Aggregation pass — main model synthesizes
        const aggStart = Date.now();
        const aggregationResult = await this.generate(aggregationInput, mainSelection);
        const aggregationMs = Date.now() - aggStart;

        // Extract media artifacts from creative hemisphere output
        const mediaArtifacts = this.extractMediaArtifacts(rightResult?.content ?? "");

        const totalMs = Date.now() - totalStart;

        // ── Emit audit: generation complete ──
        this.activityBus?.emit({
            sessionId: sessionIdForAudit,
            layer: "llm",
            operation: "sr.generation_complete",
            status: "succeeded",
            details: {
                totalMs,
                fanOutMs,
                aggregationMs,
                isolationLevel: triadCheck.isolationLevel,
                leftTimedOut,
                rightTimedOut,
                leftCircuitOpen: leftCbOpen,
                rightCircuitOpen: rightCbOpen,
            },
        });

        return {
            content: aggregationResult?.content ?? mainOutput,
            toolCalls: aggregationResult?.toolCalls,
            stopReason: aggregationResult?.stopReason,
            thoughtSignature: aggregationResult?.thoughtSignature,
            hemispheres: {
                left: leftResult,
                right: rightResult,
                main: mainResult,
            },
            aggregation: aggregationResult,
            timing: { fanOutMs, aggregationMs, totalMs },
            mediaArtifacts,
            isolationLevel: triadCheck.isolationLevel,
        };
    }

    /** Check if the circuit breaker is currently open for a given key. */
    private isCBOpen(key: string, now: number): boolean {
        const state = this.srCircuitBreaker.get(key);
        if (!state) return false;
        if (state.openUntil > 0 && now < state.openUntil) return true;
        // Reset expired open state
        if (state.openUntil > 0 && now >= state.openUntil) {
            state.failures = 0;
            state.openUntil = 0;
        }
        return false;
    }

    /** Record the outcome of a hemisphere call and update circuit breaker state. */
    private recordCBOutcome(key: string, success: boolean): void {
        let state = this.srCircuitBreaker.get(key);
        if (!state) {
            state = { failures: 0, openUntil: 0 };
            this.srCircuitBreaker.set(key, state);
        }
        if (success) {
            state.failures = 0;
            state.openUntil = 0;
        } else {
            state.failures += 1;
            if (state.failures >= LlmProviderManager.SR_CB_FAILURE_THRESHOLD) {
                state.openUntil = Date.now() + LlmProviderManager.SR_CB_OPEN_DURATION_MS;
                console.warn(`[SR] Circuit breaker OPENED for ${key} until ${new Date(state.openUntil).toISOString()}`);
            }
        }
    }

    /** Expose SR circuit breaker state for /api/sr/status. */
    getSRCircuitBreakerState(): Record<string, { failures: number; openUntil: number; open: boolean }> {
        const result: Record<string, { failures: number; openUntil: number; open: boolean }> = {};
        const now = Date.now();
        for (const [key, state] of this.srCircuitBreaker) {
            result[key] = { ...state, open: state.openUntil > 0 && now < state.openUntil };
        }
        return result;
    }

    /**
     * Estimate the per-generation cost of running an SR fan-out.
     * Uses the `computeCostUsd` pricing catalog for each hemisphere + aggregation pass.
     */
    estimateSRCost(
        srConfig: SpectrumRefractionConfig,
        avgInputTokens: number = 2_000,
        avgOutputTokens: number = 1_000,
        mainSelection?: Partial<LlmSelection>,
    ): SRCostEstimate {
        const leftProvider = srConfig.leftModel?.providerId ?? "";
        const leftModel = srConfig.leftModel?.model ?? "";
        const rightProvider = srConfig.rightModel?.providerId ?? "";
        const rightModel = srConfig.rightModel?.model ?? "";
        const mainProvider = mainSelection?.providerId ?? leftProvider;
        const mainModel = mainSelection?.model ?? leftModel;

        // Aggregation input is substantially larger (3 hemisphere outputs + user prompt)
        const aggInputTokens = avgInputTokens + avgOutputTokens * 3;

        const leftCost = computeCostUsd(leftProvider, leftModel, avgInputTokens, avgOutputTokens);
        const rightCost = computeCostUsd(rightProvider, rightModel, avgInputTokens, avgOutputTokens);
        const mainFanOutCost = computeCostUsd(mainProvider, mainModel, avgInputTokens, avgOutputTokens);
        const aggregationCost = computeCostUsd(mainProvider, mainModel, aggInputTokens, avgOutputTokens);

        const totalCost = leftCost + rightCost + mainFanOutCost + aggregationCost;

        const advisory = totalCost === 0
            ? "Pricing unavailable for one or more configured models. Ensure provider models match pricing catalog entries."
            : undefined;

        return {
            leftEstimatedCostUsd: leftCost,
            rightEstimatedCostUsd: rightCost,
            mainFanOutEstimatedCostUsd: mainFanOutCost,
            aggregationEstimatedCostUsd: aggregationCost,
            totalEstimatedCostUsd: totalCost,
            currency: "USD",
            avgInputTokens,
            avgOutputTokens,
            advisory,
        };
    }

    /**
     * Extract base64-encoded media artifacts from creative model output.
     */
    private extractMediaArtifacts(content: string): SRGenerationOutput["mediaArtifacts"] {
        const artifacts: SRGenerationOutput["mediaArtifacts"] = [];

        // Match base64 data URIs (data:image/png;base64,... etc.)
        const dataUriPattern = /data:(image|audio|video)\/([^;]+);base64,([A-Za-z0-9+/=]+)/g;
        let match: RegExpExecArray | null;
        while ((match = dataUriPattern.exec(content)) !== null) {
            const mediaType = match[1] as "image" | "audio" | "video";
            const mimeType = `${match[1]}/${match[2]}`;
            artifacts.push({ type: mediaType, data: match[3]!, mimeType });
        }

        // Match markdown image references that may contain base64
        const mdImagePattern = /!\[([^\]]*)\]\((data:image\/[^)]+)\)/g;
        while ((match = mdImagePattern.exec(content)) !== null) {
            const innerMatch = /data:(image)\/([^;]+);base64,(.+)/.exec(match[2]!);
            if (innerMatch) {
                artifacts.push({
                    type: "image",
                    data: innerMatch[3]!,
                    mimeType: `image/${innerMatch[2]}`,
                });
            }
        }

        return artifacts;
    }

    // ── Routing configuration ──────────────────────────────────────────

    getRoutingConfig(): RoutingConfig {
        return { ...this.routingConfig };
    }

    setRoutingConfig(config: RoutingConfig): void {
        const strategy = config.strategy === "multi" ? "multi" : config.strategy === "modality" ? "modality" : "single";
        this.routingConfig = {
            strategy,
            roleOverrides: { ...config.roleOverrides },
            agentOverrides: { ...config.agentOverrides },
            modalityOverrides: { ...(config.modalityOverrides || {}) },
            preferredModality: config.preferredModality || null,
        };
    }

    /** Set a per-agent model override. Enables multi routing strategy automatically. */
    setAgentModelOverride(agentId: string, providerId: string, model: string): void {
        this.routingConfig.agentOverrides[agentId] = { providerId, model };
        if (this.routingConfig.strategy !== "multi") {
            this.routingConfig.strategy = "multi";
        }
    }

    /** Remove a per-agent model override. */
    clearAgentModelOverride(agentId: string): void {
        delete this.routingConfig.agentOverrides[agentId];
    }

    /** Get the current agent model override for a given agent, or null. */
    getAgentModelOverride(agentId: string): { providerId: string; model: string } | null {
        return this.routingConfig.agentOverrides[agentId] ?? null;
    }

    async suggestRoutingForAllRoles(providerId: string = ""): Promise<Record<string, { providerId: string; model: string; tier: number; degraded: boolean; reason: string } | null>> {
        const catalog = await this.getCatalog();
        const availableModels: AvailableModel[] = [];
        for (const provider of catalog.providers) {
            if (!provider.enabled) continue;
            if (providerId && providerId !== "" && provider.id !== providerId) continue;
            for (const model of provider.models) {
                availableModels.push({
                    providerId: provider.id,
                    model,
                    locality: provider.kind === "local" ? "local" : "cloud",
                });
            }
        }
        const result: Record<string, { providerId: string; model: string; tier: number; degraded: boolean; reason: string } | null> = {};
        for (const role of ALL_TASK_ROLES) {
            const sel = selectModelForRole(role, availableModels);
            result[role] = sel
                ? { providerId: sel.providerId, model: sel.model, tier: sel.profile.tier, degraded: sel.degraded, reason: sel.reason }
                : null;
        }
        return result;
    }

    async getModelProfiles(): Promise<Record<string, { tier: number; strengths: string[]; locality: string; contextWindow: number; parametersBillions: number; modalities: string[] }>> {
        const catalog = await this.getCatalog();
        const profiles: Record<string, { tier: number; strengths: string[]; locality: string; contextWindow: number; parametersBillions: number; modalities: string[] }> = {};
        for (const provider of catalog.providers) {
            for (const model of provider.models) {
                const profile = resolveProfile(model);
                profiles[model] = {
                    tier: profile.tier,
                    strengths: [...profile.strengths],
                    modalities: [...(profile.modalities ?? ["text"])],
                    locality: profile.locality,
                    contextWindow: profile.contextWindow,
                    parametersBillions: profile.parametersBillions,
                };
            }
        }
        return profiles;
    }

    // ── Modality-Based Routing ─────────────────────────────────────────

    async suggestRoutingForAllModalities(): Promise<Record<string, { providerId: string; model: string; tier: number; degraded: boolean; reason: string } | null>> {
        const catalog = await this.getCatalog();
        const availableModels: AvailableModel[] = [];
        for (const provider of catalog.providers) {
            if (!provider.enabled) continue;
            for (const model of provider.models) {
                availableModels.push({
                    providerId: provider.id,
                    model,
                    locality: provider.kind === "local" ? "local" : "cloud",
                });
            }
        }
        const result: Record<string, { providerId: string; model: string; tier: number; degraded: boolean; reason: string } | null> = {};
        for (const modality of ALL_MODALITIES) {
            const sel = selectModelForModality([modality.id], availableModels);
            result[modality.id] = sel
                ? { providerId: sel.providerId, model: sel.model, tier: sel.profile.tier, degraded: sel.degraded, reason: sel.reason }
                : null;
        }
        return result;
    }

    async getModalitySummary(): Promise<Array<{ id: string; label: string; icon: string; description: string; modelCount: number }>> {
        const catalog = await this.getCatalog();
        const availableModels: AvailableModel[] = [];
        for (const provider of catalog.providers) {
            if (!provider.enabled) continue;
            for (const model of provider.models) {
                availableModels.push({
                    providerId: provider.id,
                    model,
                    locality: provider.kind === "local" ? "local" : "cloud",
                });
            }
        }
        return getModalitySummary(availableModels);
    }

    /**
     * Resolve the best model for a request, auto-detecting modality from content.
     * Used when strategy is "modality".
     */
    resolveModelForModalityRequest(
        input: ModalityDetectionInput,
        available: AvailableModel[],
    ): ModelRouterSelection | null {
        const detectedModalities = detectRequestModality(input) as ModelModality[];

        // Check modality overrides first
        for (const modality of detectedModalities) {
            const override = this.routingConfig.modalityOverrides[modality];
            if (override) {
                const profile = resolveProfile(override.model);
                return {
                    providerId: override.providerId,
                    model: override.model,
                    profile,
                    degraded: false,
                    reason: `Modality override for ${modality} (${override.providerId}/${override.model})`,
                };
            }
        }

        return selectModelForModality(detectedModalities, available);
    }

    // ── Model Matrix Management (Phase 5) ──────────────────────────────

    getFullModelMatrix(): {
        known: readonly ModelCapabilityProfile[];
        runtime: readonly ModelCapabilityProfile[];
        deprecated: readonly ModelCapabilityProfile[];
        promptStrategies: readonly ProviderPromptStrategy[];
    } {
        return {
            known: getKnownProfiles(),
            runtime: getRuntimeProfiles(),
            deprecated: getDeprecatedProfiles(),
            promptStrategies: PROVIDER_PROMPT_STRATEGIES,
        };
    }

    registerModel(profile: ModelCapabilityProfile): void {
        registerModelProfile(profile);
    }

    updateModel(pattern: string, patch: Partial<ModelCapabilityProfile>): boolean {
        return updateModelProfile(pattern, patch);
    }

    removeModel(pattern: string): boolean {
        return removeModelProfile(pattern);
    }

    loadPersistedProfiles(profiles: ModelCapabilityProfile[]): void {
        loadRuntimeProfiles(profiles);
    }

    /** Discover models from a provider by querying its API. */
    async discoverProviderModels(providerId: string): Promise<{
        models: string[];
        known: string[];
        unknown: string[];
        suggested: ModelCapabilityProfile[];
    }> {
        const testResult = await this.testProvider(providerId);
        let catalogModels: string[];
        if (testResult.ok && testResult.models && testResult.models.length > 0) {
            catalogModels = testResult.models;
        } else {
            const snapshot = this.snapshotFor(providerId as PrismLlmProviderId);
            catalogModels = snapshot.models;
        }

        const knownProfiles = getKnownProfiles();

        const known: string[] = [];
        const unknown: string[] = [];
        const suggested: ModelCapabilityProfile[] = [];

        for (const model of catalogModels) {
            const profile = resolveProfile(model);
            // If the resolved profile pattern matches something in known registry, it's known
            const isKnown = knownProfiles.some(
                (kp) => kp.pattern === profile.pattern && kp.label !== model,
            ) || profile.pattern !== model;

            if (isKnown) {
                known.push(model);
            } else {
                unknown.push(model);
                suggested.push({
                    ...profile,
                    pattern: model,
                    label: model,
                    modalities: profile.modalities ?? ["text"],
                });
            }
        }

        // Auto-register suggested profiles so they appear in the matrix
        for (const profile of suggested) {
            registerModelProfile(profile);
        }

        return {
            models: [...catalogModels],
            known,
            unknown,
            suggested,
        };
    }

    resolveProvider(providerId: string): PrismLlmProviderId | null {
        return ALL_PROVIDER_IDS.includes(providerId as PrismLlmProviderId)
            ? (providerId as PrismLlmProviderId)
            : null;
    }

    private findFirstEnabledProvider(): PrismLlmProviderId | null {
        for (const id of ALL_PROVIDER_IDS) {
            const snapshot = this.snapshotFor(id);
            if (snapshot.enabled) {
                return id;
            }
        }
        return null;
    }

    private snapshotFor(providerId: PrismLlmProviderId, overrideModels?: string[]): LlmProviderSnapshot {
        const settings = this.getResolvedSettings(providerId);
        const hasApiKey = this.hasApiKey(settings);
        const hasBaseUrl = Boolean(settings.baseUrl?.trim());
        const models = overrideModels && overrideModels.length > 0
            ? overrideModels
            : settings.defaultModels;
        const defaultModel = settings.defaultModel && models.includes(settings.defaultModel)
            ? settings.defaultModel
            : (models[0] ?? null);

        if (!hasBaseUrl) {
            return {
                id: settings.id,
                label: settings.label,
                kind: settings.kind,
                enabled: false,
                reason: "Provider URL is not configured.",
                requiresApiKey: settings.requiresApiKey,
                hasApiKey,
                models,
                baseUrl: settings.baseUrl,
                apiKeyHeader: settings.apiKeyHeader ?? null,
                defaultModel,
                settingsSource: settings.settingsSource,
            };
        }

        if (settings.requiresApiKey && !hasApiKey) {
            return {
                id: settings.id,
                label: settings.label,
                kind: settings.kind,
                enabled: false,
                reason: "API key is missing.",
                requiresApiKey: true,
                hasApiKey: false,
                models,
                baseUrl: settings.baseUrl,
                apiKeyHeader: settings.apiKeyHeader ?? null,
                defaultModel,
                settingsSource: settings.settingsSource,
            };
        }

        return {
            id: settings.id,
            label: settings.label,
            kind: settings.kind,
            enabled: true,
            requiresApiKey: settings.requiresApiKey,
            hasApiKey,
            models,
            baseUrl: settings.baseUrl,
            apiKeyHeader: settings.apiKeyHeader ?? null,
            defaultModel,
            settingsSource: settings.settingsSource,
        };
    }

    private getResolvedSettings(providerId: PrismLlmProviderId): ProviderSettings {
        const defaults = this.defaults[providerId];
        const persisted = this.persistedSettings.get(providerId);
        const hasPersistedModels = Boolean(persisted?.models.length);
        const baseUrl = normalizeOptionalUrl(persisted?.baseUrl) || defaults.baseUrl;
        const apiKeyHeader = persisted?.apiKeyHeader?.trim() || defaults.apiKeyHeader;
        const defaultModels = hasPersistedModels ? normalizeModels(persisted!.models) : defaults.defaultModels;
        const defaultModel = persisted?.defaultModel?.trim()
            || defaults.defaultModel
            || defaultModels[0]
            || null;
        const apiKey = this.secretStore?.getApiKey(providerId) || defaults.apiKey;
        return {
            ...defaults,
            baseUrl,
            apiKeyHeader,
            apiKey,
            defaultModels,
            defaultModel,
            settingsSource: persisted ? "persisted" : "environment",
        };
    }

    private hasApiKey(settings: ProviderSettings): boolean {
        return !settings.requiresApiKey || Boolean(settings.apiKey?.trim()) || Boolean(this.secretStore?.hasApiKey(settings.id));
    }

    private async fetchOllamaModels(settings: ProviderSettings): Promise<string[]> {
        try {
            const response = await fetch(`${settings.baseUrl}/api/tags`, {
                method: "GET",
                signal: AbortSignal.timeout(500),
                headers: {
                    Accept: "application/json",
                },
            });
            if (!response.ok) {
                return settings.defaultModels;
            }
            const payload = await response.json() as { models?: Array<{ name?: string }> };
            const names = (payload.models ?? [])
                .map((entry) => entry.name?.trim())
                .filter((value): value is string => Boolean(value));
            return names.length > 0 ? names : settings.defaultModels;
        } catch {
            return settings.defaultModels;
        }
    }

    private async fetchOllamaCloudModels(settings: ProviderSettings): Promise<string[]> {
        if (!settings.apiKey?.trim()) return settings.defaultModels;
        try {
            const response = await fetch(`${settings.baseUrl}/api/tags`, {
                method: "GET",
                signal: AbortSignal.timeout(500),
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${settings.apiKey}`,
                },
            });
            if (!response.ok) {
                return settings.defaultModels;
            }
            const payload = await response.json() as { models?: Array<{ name?: string }> };
            const names = (payload.models ?? [])
                .map((entry) => entry.name?.trim())
                .filter((value): value is string => Boolean(value));
            return names.length > 0 ? names : settings.defaultModels;
        } catch {
            return settings.defaultModels;
        }
    }

    private async fetchLmStudioModels(settings: ProviderSettings): Promise<string[]> {
        try {
            const response = await fetch(`${settings.baseUrl}/v1/models`, {
                method: "GET",
                signal: AbortSignal.timeout(500),
                headers: { Accept: "application/json" },
            });
            if (!response.ok) {
                return settings.defaultModels;
            }
            const payload = await response.json() as { data?: Array<{ id?: string }> };
            const ids = (payload.data ?? [])
                .map((entry) => entry.id?.trim())
                .filter((value): value is string => Boolean(value));
            return ids.length > 0 ? ids : settings.defaultModels;
        } catch {
            return settings.defaultModels;
        }
    }

    async testProvider(providerId: string): Promise<{ ok: boolean; message: string; models: string[]; latencyMs?: number }> {
        const resolved = this.resolveProvider(providerId);
        if (!resolved) {
            return { ok: false, message: "Unknown provider.", models: [] };
        }
        const settings = this.getResolvedSettings(resolved);
        if (!settings.baseUrl?.trim()) {
            return { ok: false, message: "Base URL not configured.", models: [] };
        }
        const startTime = Date.now();
        try {
            if (resolved === "ollama") {
                const response = await fetch(`${settings.baseUrl}/api/tags`, { method: "GET" });
                if (!response.ok) {
                    return { ok: false, message: `Ollama returned ${response.status}.`, models: [], latencyMs: Date.now() - startTime };
                }
                const payload = await response.json() as { models?: Array<{ name?: string }> };
                const models = (payload.models ?? []).map((m) => m.name?.trim() ?? "").filter(Boolean);
                const final = models.length > 0 ? models : settings.defaultModels;
                return { ok: true, message: `Connected to Ollama. ${final.length} model(s) found.`, models: final, latencyMs: Date.now() - startTime };
            }
            if (resolved === "ollama-cloud") {
                if (!settings.apiKey?.trim()) {
                    return { ok: false, message: "Ollama Cloud API key is not set.", models: [], latencyMs: Date.now() - startTime };
                }
                const response = await fetch(`${settings.baseUrl}/api/tags`, {
                    method: "GET",
                    headers: { Accept: "application/json", Authorization: `Bearer ${settings.apiKey}` },
                });
                if (!response.ok) {
                    return { ok: false, message: `Ollama Cloud returned ${response.status}.`, models: [], latencyMs: Date.now() - startTime };
                }
                const payload = await response.json() as { models?: Array<{ name?: string }> };
                const models = (payload.models ?? []).map((m) => m.name?.trim() ?? "").filter(Boolean);
                const final = models.length > 0 ? models : settings.defaultModels;
                return { ok: true, message: `Connected to Ollama Cloud. ${final.length} model(s) found.`, models: final, latencyMs: Date.now() - startTime };
            }
            if (resolved === "lmstudio") {
                const response = await fetch(`${settings.baseUrl}/v1/models`, { method: "GET", headers: { Accept: "application/json" } });
                if (!response.ok) {
                    return { ok: false, message: `LM Studio returned ${response.status}.`, models: [], latencyMs: Date.now() - startTime };
                }
                const payload = await response.json() as { data?: Array<{ id?: string }> };
                const models = (payload.data ?? []).map((m) => m.id?.trim() ?? "").filter(Boolean);
                const final = models.length > 0 ? models : settings.defaultModels;
                return { ok: true, message: `Connected to LM Studio. ${final.length} model(s) found.`, models: final, latencyMs: Date.now() - startTime };
            }
            if (resolved === "llamacpp") {
                const response = await fetch(`${settings.baseUrl}/models`, { method: "GET", headers: { Accept: "application/json" } });
                if (!response.ok) {
                    return { ok: false, message: `Llama.cpp returned ${response.status}.`, models: [], latencyMs: Date.now() - startTime };
                }
                const payload = await response.json() as { data?: Array<{ id?: string }> };
                const models = (payload.data ?? []).map((m) => m.id?.trim() ?? "").filter(Boolean);
                const final = models.length > 0 ? models : settings.defaultModels;
                return { ok: true, message: `Connected to Llama.cpp. ${final.length} model(s) found.`, models: final, latencyMs: Date.now() - startTime };
            }
            if (resolved === "anthropic") {
                // Try the model list endpoint first
                const listResp = await fetch(`${settings.baseUrl}/models`, {
                    method: "GET",
                    headers: { "x-api-key": settings.apiKey ?? "", "anthropic-version": "2023-06-01", Accept: "application/json" },
                });
                if (listResp.ok) {
                    const payload = await listResp.json() as { data?: Array<{ id?: string }> };
                    const models = (payload.data ?? []).map((m) => m.id?.trim() ?? "").filter(Boolean);
                    const final = models.length > 0 ? models : settings.defaultModels;
                    return { ok: true, message: `Connected to Anthropic. ${final.length} model(s) found.`, models: final, latencyMs: Date.now() - startTime };
                }
                // Fall back to a minimal chat probe
                const probeResp = await fetch(`${settings.baseUrl}/messages`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-api-key": settings.apiKey ?? "", "anthropic-version": "2023-06-01" },
                    body: JSON.stringify({ model: "claude-3-5-haiku-latest", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
                });
                return probeResp.ok || probeResp.status === 400
                    ? { ok: true, message: "Connected to Anthropic.", models: settings.defaultModels, latencyMs: Date.now() - startTime }
                    : { ok: false, message: `Anthropic returned ${probeResp.status}.`, models: [], latencyMs: Date.now() - startTime };
            }
            // OpenAI-compatible: fetch model list
            const authHeader: Record<string, string> = settings.apiKeyHeader === "Authorization"
                ? { Authorization: `Bearer ${settings.apiKey ?? ""}` }
                : { [settings.apiKeyHeader ?? "Authorization"]: settings.apiKey ?? "" };
            const response = await fetch(`${settings.baseUrl}/models`, {
                method: "GET",
                headers: { ...authHeader, Accept: "application/json" },
            });
            if (!response.ok) {
                return { ok: false, message: `Provider returned ${response.status}.`, models: [], latencyMs: Date.now() - startTime };
            }
            const payload = await response.json() as { data?: Array<{ id?: string }> };
            const models = (payload.data ?? []).map((m) => m.id?.trim() ?? "").filter(Boolean);
            const final = models.length > 0 ? models : settings.defaultModels;
            return { ok: true, message: `Provider connected. ${final.length} model(s) found.`, models: final, latencyMs: Date.now() - startTime };
        } catch (error) {
            return { ok: false, message: String(error), models: [], latencyMs: Date.now() - startTime };
        }
    }

    async testAllProviders(): Promise<Array<{ providerId: string; ok: boolean; message: string; models: string[]; latencyMs?: number }>> {
        const results = await Promise.allSettled(
            ALL_PROVIDER_IDS.map(async (id) => {
                const result = await this.testProvider(id);
                return { providerId: id, ...result };
            }),
        );
        return results.map((r, i) =>
            r.status === "fulfilled"
                ? r.value
                : { providerId: ALL_PROVIDER_IDS[i], ok: false, message: String((r as PromiseRejectedResult).reason), models: [] },
        );
    }

    private async generateWithOpenAiCompatible(
        settings: ProviderSettings,
        model: string,
        input: LlmGenerationInput,
    ): Promise<LlmGenerationOutput> {
        const authHeader: Record<string, string> = settings.apiKeyHeader === "Authorization"
            ? { Authorization: `Bearer ${settings.apiKey}` }
            : { [settings.apiKeyHeader ?? "Authorization"]: settings.apiKey ?? "" };

        const messages: any[] = [
            { role: "system", content: input.systemPrompt },
        ];

        for (const entry of input.conversation) {
            if (entry.role === "tool") {
                let content: any = entry.content;
                // OpenAI-compatible providers vary on whether they support array content in tool role.
                // Anthropic (via shim) and Gemini (via shim) often do. Strict OpenAI expects string.
                if (typeof entry.content !== "string") {
                    if (settings.id === "openai") {
                        // Strict OpenAI: tool content must be a string.
                        content = entry.content.filter(p => p.type === "text").map(p => p.text).join("\n");
                        // Note: If we had images in a tool result for strict OpenAI, 
                        // they are currently dropped here to avoid 400 errors.
                    } else {
                        content = entry.content;
                    }
                }
                messages.push({
                    role: "tool",
                    tool_call_id: entry.tool_call_id,
                    content,
                });
            } else if (entry.role === "assistant" && entry.tool_calls?.length) {
                // ── Gemini thought_signature protocol (OpenAI-compat) ────────
                // Per Google docs: the signature lives at tool_calls[0].extra_content.google.thought_signature
                // We must echo it back in the exact same location.
                // For sequential multi-step, each step's first FC has its own signature.
                const tsSig = entry.thoughtSignature
                    || (entry as any).googleThoughtSignature
                    || (entry.tool_calls?.[0] as any)?.extra_content?.google?.thought_signature
                    || (entry.tool_calls?.[0] as any)?.thought_signature
                    || (entry.tool_calls?.[0] as any)?.thoughtSignature;
                const msg: any = {
                    role: "assistant",
                    content: typeof entry.content === "string" ? (entry.content || null) : null,
                    tool_calls: entry.tool_calls.map((tc, idx) => {
                        // Per docs: only the FIRST tool call in a parallel set gets the signature
                        const tcSig = (tc as any).extra_content?.google?.thought_signature
                            || (tc as any).thought_signature
                            || (tc as any).thoughtSignature
                            || (idx === 0 ? tsSig : undefined);
                        const tcObj: any = {
                            id: tc.id,
                            type: "function",
                            function: {
                                name: tc.name,
                                arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
                            },
                        };
                        // Place signature in the EXACT location Gemini expects: extra_content.google.thought_signature
                        if (tcSig) {
                            tcObj.extra_content = { google: { thought_signature: tcSig } };
                        }
                        return tcObj;
                    }),
                };
                messages.push(msg);
            } else {
                messages.push({ role: entry.role, content: entry.content });
            }
        }

        if (input.message) {
            messages.push({ role: "user", content: input.message });
        }

        const usesLegacyMaxTokens = /^(gpt-3\.5|gpt-4-\d{4}|gpt-4-turbo)/.test(model);
        const payloadBody: any = {
            model,
            messages,
            ...(usesLegacyMaxTokens
                ? { max_tokens: 4096 }
                : { max_completion_tokens: 4096 }),
        };

        // Reasoning models typically restrict temperature overrides to exactly 1.
        if (!model.startsWith("o1") && !model.startsWith("o3") && !model.includes("gpt-5")) {
            payloadBody.temperature = 0.3;
        }

        if (input.tools?.length) {
            payloadBody.tools = input.tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters },
            }));
            payloadBody.tool_choice = input.tool_choice ?? "auto";
        }

        const response = await fetch(`${settings.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...authHeader,
            },
            body: JSON.stringify(payloadBody),
        });

        // ── LLM Trace: log outgoing request ──
        llmTraceLog(`REQUEST → ${settings.id}/${model}`, {
            url: `${settings.baseUrl}/chat/completions`,
            model,
            messageCount: messages.length,
            hasTools: !!payloadBody.tools?.length,
            messages: messages.map((m: any, i: number) => ({
                idx: i,
                role: m.role,
                hasToolCalls: !!m.tool_calls?.length,
                toolCallIds: m.tool_calls?.map((tc: any) => `${tc.function?.name}[${tc.id?.slice(0, 8)}]`),
                hasExtraContent: m.tool_calls?.map((tc: any) => !!tc.extra_content?.google?.thought_signature),
                tool_call_id: m.tool_call_id,
                contentPreview: typeof m.content === "string" ? m.content?.slice(0, 80) : "(non-string)",
            })),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            llmTraceLog(`ERROR ← ${settings.id}/${model} (${response.status})`, errText);
            throw new Error(`Provider request failed (${response.status}): ${errText}`);
        }

        const payload = await response.json() as {
            choices?: Array<{
                message?: {
                    content?: string | null;
                    tool_calls?: Array<{
                        id: string;
                        type: string;
                        function: { name: string; arguments: string };
                    }>;
                };
                finish_reason?: string;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        const choice = payload.choices?.[0];
        const content = choice?.message?.content?.trim() ?? "";
        const rawToolCalls = choice?.message?.tool_calls;
        const finishReason = choice?.finish_reason;

        // ── Extract thought_signature per official Gemini OpenAI-compat docs ──
        // Location: tool_calls[i].extra_content.google.thought_signature
        // For parallel calls, only the FIRST tool_call has the signature.
        const firstTcSig = rawToolCalls && rawToolCalls.length > 0
            ? ((rawToolCalls[0] as any).extra_content?.google?.thought_signature
                || (rawToolCalls[0] as any).thought_signature
                || (rawToolCalls[0] as any).google?.thought_signature)
            : undefined;

        const thoughtSignature = (choice?.message as any)?.extra_content?.google?.thought_signature
            || (choice?.message as any)?.google?.thought_signature
            || (choice?.message as any)?.thought_signature
            || firstTcSig;

        const toolCalls: LlmToolCall[] | undefined = rawToolCalls?.map((tc, idx) => {
            // Per docs: signature is on extra_content.google.thought_signature of each tool call
            const sig = (tc as any).extra_content?.google?.thought_signature
                || (tc as any).thought_signature
                || (tc as any).google?.thought_signature;
            return {
                id: tc.id || randomToolCallId(),
                name: tc.function.name,
                arguments: safeJsonParse(tc.function.arguments),
                thought_signature: sig,
                thoughtSignature: sig,
                // Preserve the raw extra_content so it can be echoed verbatim
                extra_content: sig ? { google: { thought_signature: sig } } : undefined,
            } as LlmToolCall;
        });

        // ── LLM Trace: log response ──
        llmTraceLog(`RESPONSE ← ${settings.id}/${model}`, {
            finishReason,
            contentLength: content.length,
            toolCallCount: toolCalls?.length ?? 0,
            thoughtSignature: thoughtSignature ? `${String(thoughtSignature).slice(0, 40)}...` : null,
            rawToolCallSignatures: rawToolCalls?.map((tc: any, i: number) => ({
                idx: i,
                name: tc.function?.name,
                hasExtraContent: !!tc.extra_content,
                extraContentSig: tc.extra_content?.google?.thought_signature ? `${String(tc.extra_content.google.thought_signature).slice(0, 40)}...` : null,
                directSig: tc.thought_signature ? `${String(tc.thought_signature).slice(0, 40)}...` : null,
            })),
        });

        const stopReason = finishReason === "tool_calls" || finishReason === "function_call"
            ? "tool_use" as const
            : finishReason === "length" ? "max_tokens" as const
                : finishReason === "stop" ? "end_turn" as const
                    : "end_turn" as const;

        if (!content && !toolCalls?.length) {
            throw new Error("Provider returned an empty response.");
        }

        const inputTok = payload.usage?.prompt_tokens ?? 0;
        const outputTok = payload.usage?.completion_tokens ?? 0;
        const costUsd = computeCostUsd(settings.id, model, inputTok, outputTok);
        return {
            providerId: settings.id, model, content, toolCalls, stopReason,
            tokensUsed: { input: inputTok, output: outputTok, costUsd },
            thoughtSignature
        };
    }

    private async generateWithAnthropic(
        settings: ProviderSettings,
        model: string,
        input: LlmGenerationInput,
    ): Promise<LlmGenerationOutput> {
        const messages: any[] = [];

        const mapContentParts = (content: string | LlmContentPart[]) => {
            if (typeof content === "string") return content;
            return content.map(part => {
                if (part.type === "text") return { type: "text", text: part.text };
                if (part.type === "image_url" && part.image_url?.url.startsWith("data:")) {
                    const [header, data] = part.image_url.url.split(",");
                    const media_type = header.match(/:(.*?);/)?.[1] || "image/png";
                    return {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type,
                            data,
                        }
                    };
                }
                return { type: "text", text: JSON.stringify(part) };
            });
        };

        for (const entry of input.conversation) {
            if (entry.role === "tool") {
                // Anthropic uses tool_result blocks as user messages
                messages.push({
                    role: "user",
                    content: [{
                        type: "tool_result",
                        tool_use_id: entry.tool_call_id,
                        content: mapContentParts(entry.content),
                    }],
                });
            } else if (entry.role === "assistant" && entry.tool_calls?.length) {
                const contentBlocks: any[] = [];
                if (entry.content) {
                    const mapped = mapContentParts(entry.content);
                    if (Array.isArray(mapped)) contentBlocks.push(...mapped);
                    else contentBlocks.push({ type: "text", text: mapped });
                }
                for (const tc of entry.tool_calls) {
                    contentBlocks.push({
                        type: "tool_use",
                        id: tc.id,
                        name: tc.name,
                        input: tc.arguments,
                    });
                }
                messages.push({ role: "assistant", content: contentBlocks });
            } else {
                const role = entry.role === "assistant" ? "assistant" : "user";
                messages.push({ role, content: mapContentParts(entry.content) });
            }
        }

        if (input.message) {
            messages.push({ role: "user", content: input.message });
        }

        const body: any = {
            model,
            max_tokens: 4096,
            system: input.systemPrompt,
            messages,
        };

        if (input.tools?.length) {
            body.tools = input.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
            }));
            if (input.tool_choice === "required") {
                body.tool_choice = { type: "any" };
            } else if (input.tool_choice === "none") {
                // Omit tools list to prevent tool use
                delete body.tools;
            } else {
                body.tool_choice = { type: "auto" };
            }
        }

        const response = await fetch(`${settings.baseUrl}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": settings.apiKey ?? "",
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            throw new Error(`Provider request failed (${response.status}): ${errText}`);
        }

        const payload = await response.json() as {
            content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
            stop_reason?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
        };

        const blocks = payload.content ?? [];
        const textContent = blocks
            .filter((b) => b.type === "text")
            .map((b) => b.text?.trim() ?? "")
            .join("\n")
            .trim();

        const toolCalls: LlmToolCall[] = blocks
            .filter((b) => b.type === "tool_use")
            .map((b) => ({
                id: b.id ?? randomToolCallId(),
                name: b.name ?? "",
                arguments: (b.input ?? {}) as Record<string, unknown>,
            }));

        const stopReason = payload.stop_reason === "tool_use"
            ? "tool_use" as const
            : payload.stop_reason === "max_tokens" ? "max_tokens" as const
                : "end_turn" as const;

        if (!textContent && !toolCalls.length) {
            throw new Error("Provider returned an empty response.");
        }

        const inputTokA = payload.usage?.input_tokens ?? 0;
        const outputTokA = payload.usage?.output_tokens ?? 0;
        const costUsdA = computeCostUsd(settings.id, model, inputTokA, outputTokA);
        return {
            providerId: settings.id,
            model,
            content: textContent,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            stopReason,
            tokensUsed: { input: inputTokA, output: outputTokA, costUsd: costUsdA },
        };
    }

    private async generateWithOllama(
        settings: ProviderSettings,
        model: string,
        input: LlmGenerationInput,
        adaptiveParams?: AdaptivePromptParams,
    ): Promise<LlmGenerationOutput> {
        const isBaseMode = process.env.PRISM_BASE_MODE === "true";
        const numCtx = isBaseMode ? Math.min(adaptiveParams?.numCtx ?? 4096, 2048) : (adaptiveParams?.numCtx ?? 4096);
        const numPredict = adaptiveParams?.numPredict ?? 512;
        const temperature = adaptiveParams?.temperature ?? 0.3;

        const messages: any[] = [
            { role: "system", content: input.systemPrompt },
        ];

        for (const entry of input.conversation) {
            if (entry.role === "tool") {
                messages.push({
                    role: "tool",
                    content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content),
                });
            } else if (entry.role === "assistant" && entry.tool_calls?.length) {
                messages.push({
                    role: "assistant",
                    content: typeof entry.content === "string" ? entry.content : "",
                    tool_calls: entry.tool_calls.map((tc) => ({
                        function: { name: tc.name, arguments: tc.arguments },
                    })),
                });
            } else {
                messages.push({ role: entry.role === "system" ? "system" : entry.role, content: entry.content });
            }
        }

        if (input.message) {
            messages.push({ role: "user", content: input.message });
        }

        const body: any = {
            model,
            messages,
            stream: false,
            options: {
                temperature,
                num_ctx: numCtx,
                num_predict: numPredict,
            },
        };

        if (isBaseMode) {
            const isHot = await this.isOllamaModelHot(settings, model);
            if (isHot) {
                body.keep_alive = -1;
            }
        }

        if (input.tools?.length) {
            body.tools = input.tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters },
            }));
        }

        const response = await fetch(`${settings.baseUrl}/api/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            throw new Error(`Provider request failed (${response.status}): ${errText}`);
        }

        const payload = await response.json() as {
            message?: {
                content?: string;
                tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
            };
            prompt_eval_count?: number;
            eval_count?: number;
        };

        const content = payload.message?.content?.trim() ?? "";
        const rawToolCalls = payload.message?.tool_calls;

        const toolCalls: LlmToolCall[] | undefined = rawToolCalls?.map((tc, i) => ({
            id: `ollama_tc_${i}`,
            name: tc.function.name,
            arguments: tc.function.arguments ?? {},
        }));

        if (!content && !toolCalls?.length) {
            throw new Error("Provider returned an empty response.");
        }

        const inputTokO = payload.prompt_eval_count ?? 0;
        const outputTokO = payload.eval_count ?? 0;
        const costUsdO = computeCostUsd(settings.id, model, inputTokO, outputTokO);
        return {
            providerId: settings.id,
            model,
            content,
            toolCalls: toolCalls?.length ? toolCalls : undefined,
            stopReason: toolCalls?.length ? "tool_use" : "end_turn",
            tokensUsed: { input: inputTokO, output: outputTokO, costUsd: costUsdO },
        };
    }

    /**
     * Generate via Ollama Cloud API (https://ollama.com).
     * Uses the same Ollama REST API format but adds Bearer token authentication.
     */
    private async generateWithOllamaCloud(
        settings: ProviderSettings,
        model: string,
        input: LlmGenerationInput,
        adaptiveParams?: AdaptivePromptParams,
    ): Promise<LlmGenerationOutput> {
        const numCtx = adaptiveParams?.numCtx ?? 4096;
        const numPredict = adaptiveParams?.numPredict ?? 512;
        const temperature = adaptiveParams?.temperature ?? 0.3;

        const messages: any[] = [
            { role: "system", content: input.systemPrompt },
        ];

        for (const entry of input.conversation) {
            if (entry.role === "tool") {
                messages.push({
                    role: "tool",
                    content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content),
                });
            } else if (entry.role === "assistant" && entry.tool_calls?.length) {
                messages.push({
                    role: "assistant",
                    content: typeof entry.content === "string" ? entry.content : "",
                    tool_calls: entry.tool_calls.map((tc) => ({
                        function: { name: tc.name, arguments: tc.arguments },
                    })),
                });
            } else {
                messages.push({ role: entry.role === "system" ? "system" : entry.role, content: entry.content });
            }
        }

        if (input.message) {
            messages.push({ role: "user", content: input.message });
        }

        const body: any = {
            model,
            messages,
            stream: false,
            options: {
                temperature,
                num_ctx: numCtx,
                num_predict: numPredict,
            },
        };

        if (input.tools?.length) {
            body.tools = input.tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters },
            }));
        }

        const response = await fetch(`${settings.baseUrl}/api/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${settings.apiKey ?? ""}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            throw new Error(`Provider request failed (${response.status}): ${errText}`);
        }

        const payload = await response.json() as {
            message?: {
                content?: string;
                tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
            };
            prompt_eval_count?: number;
            eval_count?: number;
        };

        const content = payload.message?.content?.trim() ?? "";
        const rawToolCalls = payload.message?.tool_calls;

        const toolCalls: LlmToolCall[] | undefined = rawToolCalls?.map((tc, i) => ({
            id: `ollama_cloud_tc_${i}`,
            name: tc.function.name,
            arguments: tc.function.arguments ?? {},
        }));

        if (!content && !toolCalls?.length) {
            throw new Error("Provider returned an empty response.");
        }

        const inputTokC = payload.prompt_eval_count ?? 0;
        const outputTokC = payload.eval_count ?? 0;
        const costUsdC = computeCostUsd("ollama-cloud", model, inputTokC, outputTokC);
        return {
            providerId: "ollama-cloud",
            model,
            content,
            toolCalls: toolCalls?.length ? toolCalls : undefined,
            stopReason: toolCalls?.length ? "tool_use" : "end_turn",
            tokensUsed: { input: inputTokC, output: outputTokC, costUsd: costUsdC },
        };
    }

    private async isOllamaModelHot(settings: ProviderSettings, modelName: string): Promise<boolean> {
        try {
            const response = await fetch(`${settings.baseUrl}/api/ps`, {
                method: "GET",
                signal: AbortSignal.timeout(500),
                headers: { Accept: "application/json" },
            });
            if (!response.ok) return false;
            const payload = await response.json() as { models?: Array<{ name?: string; size_vram?: number }> };
            const residentModels = payload.models ?? [];
            return residentModels.some(m => m.name?.toLowerCase().includes(modelName.toLowerCase()) && (m.size_vram ?? 0) > 0);
        } catch {
            return false;
        }
    }
}

function safeJsonParse(raw: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

function randomToolCallId(): string {
    return `tc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
