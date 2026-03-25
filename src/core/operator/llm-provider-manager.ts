import type { ProviderSecretStore } from "./provider-secret-store.js";
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
} from "./model-capability-matrix.js";
import type {
    TaskRole,
    AvailableModel,
    ModelRouterSelection,
    AdaptivePromptParams,
    ModelCapabilityProfile,
    ModelModality,
    ModalityDetectionInput,
} from "./model-capability-matrix.js";

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

export type { TaskRole, ModelRouterSelection, AdaptivePromptParams, ModelCapabilityProfile, ModelModality };

export type PrismLlmProviderId =
    | "openai" | "anthropic" | "ollama" | "custom"
    | "google" | "mistral" | "cohere" | "groq" | "together"
    | "deepseek" | "perplexity" | "fireworks" | "openrouter" | "lmstudio";

export const ALL_PROVIDER_IDS: PrismLlmProviderId[] = [
    "openai", "anthropic", "google", "mistral", "cohere", "groq",
    "together", "deepseek", "perplexity", "fireworks", "openrouter",
    "ollama", "lmstudio", "custom",
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
    }>;
    systemPrompt: string;
    tools?: LlmToolDefinition[];
    tool_choice?: "auto" | "none" | "required";
    stream?: boolean;
}

interface LlmGenerationOutput {
    providerId: PrismLlmProviderId;
    model: string;
    content: string;
    toolCalls?: LlmToolCall[];
    stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop";
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
    "claude-3-5-sonnet-latest",
    "claude-3-7-sonnet-latest",
    "claude-3-5-haiku-latest",
];

const GOOGLE_DEFAULT_MODELS = ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro"];
const MISTRAL_DEFAULT_MODELS = ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"];
const COHERE_DEFAULT_MODELS = ["command-r-plus", "command-r", "command-light"];
const GROQ_DEFAULT_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"];
const TOGETHER_DEFAULT_MODELS = ["meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1"];
const DEEPSEEK_DEFAULT_MODELS = ["deepseek-chat", "deepseek-reasoner"];
const PERPLEXITY_DEFAULT_MODELS = ["sonar-pro", "sonar"];
const FIREWORKS_DEFAULT_MODELS = ["accounts/fireworks/models/llama-v3p1-70b-instruct", "accounts/fireworks/models/mixtral-8x7b-instruct"];
const OPENROUTER_DEFAULT_MODELS = ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "meta-llama/llama-3.1-70b-instruct"];

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

    constructor(
        private readonly env: NodeJS.ProcessEnv = process.env,
        settings: PersistedProviderSettings[] = [],
        private readonly secretStore?: ProviderSecretStore,
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
    }

    async getCatalog(selection?: Partial<LlmSelection>): Promise<LlmProviderCatalog> {
        const [ollamaModels, lmStudioModels] = await Promise.all([
            this.fetchOllamaModels(this.getResolvedSettings("ollama")),
            this.fetchLmStudioModels(this.getResolvedSettings("lmstudio")),
        ]);
        const providers: LlmProviderSnapshot[] = ALL_PROVIDER_IDS.map((id) => {
            if (id === "ollama") return this.snapshotFor(id, ollamaModels);
            if (id === "lmstudio") return this.snapshotFor(id, lmStudioModels);
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

        return {
            ...catalog,
            activeProviderId: this.activeProviderId,
            activeModel: this.activeModel,
        };
    }

    async generate(input: LlmGenerationInput, selection?: Partial<LlmSelection>): Promise<LlmGenerationOutput | null> {
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

        if (catalog.activeProviderId === "anthropic") {
            return this.generateWithAnthropic(settings, catalog.activeModel, input);
        }

        if (catalog.activeProviderId === "ollama") {
            return this.generateWithOllama(settings, catalog.activeModel, input, adaptiveParams);
        }

        // All other providers use OpenAI-compatible API
        return this.generateWithOpenAiCompatible(settings, catalog.activeModel, input);
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

    getFullModelMatrix(): { known: readonly ModelCapabilityProfile[]; runtime: readonly ModelCapabilityProfile[] } {
        return {
            known: getKnownProfiles(),
            runtime: getRuntimeProfiles(),
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
        known: string[];
        unknown: string[];
        suggested: ModelCapabilityProfile[];
    }> {
        const snapshot = this.snapshotFor(providerId as PrismLlmProviderId);
        const catalogModels = snapshot.models;
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

        return { known, unknown, suggested };
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

    private async fetchLmStudioModels(settings: ProviderSettings): Promise<string[]> {
        try {
            const response = await fetch(`${settings.baseUrl}/v1/models`, {
                method: "GET",
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

    async testProvider(providerId: string): Promise<{ ok: boolean; message: string; models: string[] }> {
        const resolved = this.resolveProvider(providerId);
        if (!resolved) {
            return { ok: false, message: "Unknown provider.", models: [] };
        }
        const settings = this.getResolvedSettings(resolved);
        if (!settings.baseUrl?.trim()) {
            return { ok: false, message: "Base URL not configured.", models: [] };
        }
        try {
            if (resolved === "ollama") {
                const response = await fetch(`${settings.baseUrl}/api/tags`, { method: "GET" });
                if (!response.ok) {
                    return { ok: false, message: `Ollama returned ${response.status}.`, models: [] };
                }
                const payload = await response.json() as { models?: Array<{ name?: string }> };
                const models = (payload.models ?? []).map((m) => m.name?.trim() ?? "").filter(Boolean);
                const final = models.length > 0 ? models : settings.defaultModels;
                return { ok: true, message: `Connected to Ollama. ${final.length} model(s) found.`, models: final };
            }
            if (resolved === "lmstudio") {
                const response = await fetch(`${settings.baseUrl}/v1/models`, { method: "GET", headers: { Accept: "application/json" } });
                if (!response.ok) {
                    return { ok: false, message: `LM Studio returned ${response.status}.`, models: [] };
                }
                const payload = await response.json() as { data?: Array<{ id?: string }> };
                const models = (payload.data ?? []).map((m) => m.id?.trim() ?? "").filter(Boolean);
                const final = models.length > 0 ? models : settings.defaultModels;
                return { ok: true, message: `Connected to LM Studio. ${final.length} model(s) found.`, models: final };
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
                    return { ok: true, message: `Connected to Anthropic. ${final.length} model(s) found.`, models: final };
                }
                // Fall back to a minimal chat probe
                const probeResp = await fetch(`${settings.baseUrl}/messages`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-api-key": settings.apiKey ?? "", "anthropic-version": "2023-06-01" },
                    body: JSON.stringify({ model: "claude-3-5-haiku-latest", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
                });
                return probeResp.ok || probeResp.status === 400
                    ? { ok: true, message: "Connected to Anthropic.", models: settings.defaultModels }
                    : { ok: false, message: `Anthropic returned ${probeResp.status}.`, models: [] };
            }
            // OpenAI-compatible: fetch model list
            const authHeader = settings.apiKeyHeader === "Authorization"
                ? { Authorization: `Bearer ${settings.apiKey ?? ""}` }
                : { [settings.apiKeyHeader ?? "Authorization"]: settings.apiKey ?? "" };
            const response = await fetch(`${settings.baseUrl}/models`, {
                method: "GET",
                headers: { ...authHeader, Accept: "application/json" },
            });
            if (!response.ok) {
                return { ok: false, message: `Provider returned ${response.status}.`, models: [] };
            }
            const payload = await response.json() as { data?: Array<{ id?: string }> };
            const models = (payload.data ?? []).map((m) => m.id?.trim() ?? "").filter(Boolean);
            const final = models.length > 0 ? models : settings.defaultModels;
            return { ok: true, message: `Provider connected. ${final.length} model(s) found.`, models: final };
        } catch (error) {
            return { ok: false, message: String(error), models: [] };
        }
    }

    private async generateWithOpenAiCompatible(
        settings: ProviderSettings,
        model: string,
        input: LlmGenerationInput,
    ): Promise<LlmGenerationOutput> {
        const authHeader = settings.apiKeyHeader === "Authorization"
            ? { Authorization: `Bearer ${settings.apiKey}` }
            : { [settings.apiKeyHeader ?? "Authorization"]: settings.apiKey ?? "" };

        const messages: any[] = [
            { role: "system", content: input.systemPrompt },
        ];

        for (const entry of input.conversation) {
            if (entry.role === "tool") {
                messages.push({
                    role: "tool",
                    tool_call_id: entry.tool_call_id,
                    content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content),
                });
            } else if (entry.role === "assistant" && entry.tool_calls?.length) {
                messages.push({
                    role: "assistant",
                    content: typeof entry.content === "string" ? (entry.content || null) : null,
                    tool_calls: entry.tool_calls.map((tc) => ({
                        id: tc.id,
                        type: "function",
                        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                    })),
                });
            } else {
                messages.push({ role: entry.role, content: entry.content });
            }
        }

        messages.push({ role: "user", content: input.message });

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

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
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
        };

        const choice = payload.choices?.[0];
        const content = choice?.message?.content?.trim() ?? "";
        const rawToolCalls = choice?.message?.tool_calls;
        const finishReason = choice?.finish_reason;

        const toolCalls: LlmToolCall[] | undefined = rawToolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: safeJsonParse(tc.function.arguments),
        }));

        const stopReason = finishReason === "tool_calls" || finishReason === "function_call"
            ? "tool_use" as const
            : finishReason === "length" ? "max_tokens" as const
                : finishReason === "stop" ? "end_turn" as const
                    : "end_turn" as const;

        if (!content && !toolCalls?.length) {
            throw new Error("Provider returned an empty response.");
        }

        return { providerId: settings.id, model, content, toolCalls, stopReason };
    }

    private async generateWithAnthropic(
        settings: ProviderSettings,
        model: string,
        input: LlmGenerationInput,
    ): Promise<LlmGenerationOutput> {
        const messages: any[] = [];

        for (const entry of input.conversation) {
            if (entry.role === "tool") {
                // Anthropic uses tool_result blocks as user messages
                messages.push({
                    role: "user",
                    content: [{
                        type: "tool_result",
                        tool_use_id: entry.tool_call_id,
                        content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content),
                    }],
                });
            } else if (entry.role === "assistant" && entry.tool_calls?.length) {
                const contentBlocks: any[] = [];
                if (typeof entry.content === "string" && entry.content) {
                    contentBlocks.push({ type: "text", text: entry.content });
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
                messages.push({ role, content: entry.content });
            }
        }

        messages.push({ role: "user", content: input.message });

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

        return {
            providerId: settings.id,
            model,
            content: textContent,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            stopReason,
        };
    }

    private async generateWithOllama(
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

        messages.push({ role: "user", content: input.message });

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

        return {
            providerId: settings.id,
            model,
            content,
            toolCalls: toolCalls?.length ? toolCalls : undefined,
            stopReason: toolCalls?.length ? "tool_use" : "end_turn",
        };
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
