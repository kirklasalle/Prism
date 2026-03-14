import type { ProviderSecretStore } from "./provider-secret-store.js";

export type PrismLlmProviderId = "openai" | "anthropic" | "ollama" | "custom";

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
    conversation: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    systemPrompt: string;
}

interface LlmGenerationOutput {
    providerId: PrismLlmProviderId;
    model: string;
    content: string;
}

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
        const ollamaModels = await this.fetchOllamaModels(this.getResolvedSettings("ollama"));
        const providers: LlmProviderSnapshot[] = [
            this.snapshotFor("openai"),
            this.snapshotFor("anthropic"),
            this.snapshotFor("ollama", ollamaModels),
            this.snapshotFor("custom"),
        ];

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
        if (catalog.activeProviderId === "openai" || catalog.activeProviderId === "custom") {
            const content = await this.generateWithOpenAiCompatible(settings, catalog.activeModel, input);
            return { providerId: settings.id, model: catalog.activeModel, content };
        }

        if (catalog.activeProviderId === "anthropic") {
            const content = await this.generateWithAnthropic(settings, catalog.activeModel, input);
            return { providerId: settings.id, model: catalog.activeModel, content };
        }

        if (catalog.activeProviderId === "ollama") {
            const content = await this.generateWithOllama(settings, catalog.activeModel, input);
            return { providerId: settings.id, model: catalog.activeModel, content };
        }

        return null;
    }

    resolveProvider(providerId: string): PrismLlmProviderId | null {
        if (providerId === "openai" || providerId === "anthropic" || providerId === "ollama" || providerId === "custom") {
            return providerId;
        }
        return null;
    }

    private findFirstEnabledProvider(): PrismLlmProviderId | null {
        const ordered: PrismLlmProviderId[] = ["ollama", "openai", "anthropic", "custom"];
        for (const id of ordered) {
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

    private async generateWithOpenAiCompatible(
        settings: ProviderSettings,
        model: string,
        input: LlmGenerationInput,
    ): Promise<string> {
        const authHeader = settings.apiKeyHeader === "Authorization"
            ? { Authorization: `Bearer ${settings.apiKey}` }
            : { [settings.apiKeyHeader ?? "Authorization"]: settings.apiKey ?? "" };

        const response = await fetch(`${settings.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...authHeader,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: input.systemPrompt },
                    ...input.conversation.map((entry) => ({ role: entry.role, content: entry.content })),
                    { role: "user", content: input.message },
                ],
                temperature: 0.3,
            }),
        });

        if (!response.ok) {
            throw new Error(`Provider request failed (${response.status})`);
        }

        const payload = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };

        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content) {
            throw new Error("Provider returned an empty response.");
        }
        return content;
    }

    private async generateWithAnthropic(
        settings: ProviderSettings,
        model: string,
        input: LlmGenerationInput,
    ): Promise<string> {
        const response = await fetch(`${settings.baseUrl}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": settings.apiKey ?? "",
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model,
                max_tokens: 512,
                system: input.systemPrompt,
                messages: [
                    ...input.conversation.map((entry) => ({ role: entry.role === "assistant" ? "assistant" : "user", content: entry.content })),
                    { role: "user", content: input.message },
                ],
            }),
        });

        if (!response.ok) {
            throw new Error(`Provider request failed (${response.status})`);
        }

        const payload = await response.json() as {
            content?: Array<{ type?: string; text?: string }>;
        };

        const text = (payload.content ?? [])
            .filter((entry) => entry.type === "text")
            .map((entry) => entry.text?.trim() ?? "")
            .join("\n")
            .trim();

        if (!text) {
            throw new Error("Provider returned an empty response.");
        }

        return text;
    }

    private async generateWithOllama(
        settings: ProviderSettings,
        model: string,
        input: LlmGenerationInput,
    ): Promise<string> {
        const prompt = [
            input.systemPrompt,
            ...input.conversation.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`),
            `USER: ${input.message}`,
            "ASSISTANT:",
        ].join("\n\n");

        const response = await fetch(`${settings.baseUrl}/api/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                prompt,
                stream: false,
                options: {
                    temperature: 0.3,
                },
            }),
        });

        if (!response.ok) {
            throw new Error(`Provider request failed (${response.status})`);
        }

        const payload = await response.json() as { response?: string };
        const content = payload.response?.trim();
        if (!content) {
            throw new Error("Provider returned an empty response.");
        }
        return content;
    }
}
