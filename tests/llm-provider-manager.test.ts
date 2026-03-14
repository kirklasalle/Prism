import assert from "node:assert";
import { LlmProviderManager } from "../src/core/operator/llm-provider-manager.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";

export async function testLlmProviderManager(): Promise<void> {
    const manager = new LlmProviderManager({
        PRISM_OLLAMA_MODELS: "llama3.1:8b,mistral:7b",
        PRISM_LLM_PROVIDER: "ollama",
    });

    const catalog = await manager.getCatalog();
    assert.strictEqual(catalog.activeProviderId, "ollama");
    assert.ok(catalog.activeModel);

    const anthropic = catalog.providers.find((provider) => provider.id === "anthropic");
    assert.ok(anthropic);
    assert.strictEqual(anthropic!.enabled, false);
    assert.strictEqual(anthropic!.hasApiKey, false);

    const switched = await manager.setActiveSelection("ollama", "mistral:7b");
    assert.strictEqual(switched.activeProviderId, "ollama");
    assert.strictEqual(switched.activeModel, "mistral:7b");

    await assert.rejects(
        () => manager.setActiveSelection("ollama", "missing-model"),
        /Model is not available/i,
    );

    const explicitOpenAi = await manager.getCatalog({ providerId: "openai", model: null });
    assert.strictEqual(explicitOpenAi.activeProviderId, "openai");
    const openAiSnapshot = explicitOpenAi.providers.find((provider) => provider.id === "openai");
    assert.ok(openAiSnapshot);
    assert.strictEqual(openAiSnapshot!.enabled, false);
    assert.match(openAiSnapshot!.reason ?? "", /API key is missing/i);

    const secretStore = new InMemoryProviderSecretStore();
    secretStore.setApiKey("openai", "sk-test-openai");
    const persisted = new LlmProviderManager(
        {
            PRISM_OLLAMA_MODELS: "llama3.1:8b",
            PRISM_OPENAI_MODELS: "gpt-4.1,gpt-5-mini",
        },
        [{
            providerId: "openai",
            baseUrl: "https://api.openai.com/v1",
            apiKeyHeader: "Authorization",
            models: ["gpt-4.1", "gpt-5-mini"],
            defaultModel: "gpt-5-mini",
            updatedAt: new Date().toISOString(),
            source: "test",
        }],
        secretStore,
    );

    const persistedCatalog = await persisted.getCatalog({ providerId: "openai", model: null });
    assert.strictEqual(persistedCatalog.activeProviderId, "openai");
    assert.strictEqual(persistedCatalog.activeModel, "gpt-5-mini");
    const persistedSnapshot = persistedCatalog.providers.find((provider) => provider.id === "openai");
    assert.ok(persistedSnapshot);
    assert.strictEqual(persistedSnapshot!.enabled, true);
    assert.strictEqual(persistedSnapshot!.hasApiKey, true);
    assert.strictEqual(persistedSnapshot!.settingsSource, "persisted");

    console.log("✓ LlmProviderManager tests passed");
}
