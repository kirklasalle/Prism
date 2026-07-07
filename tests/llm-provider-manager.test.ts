import assert from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

    const ollamaSnapshot = catalog.providers.find((provider) => provider.id === "ollama");
    const availableModel = ollamaSnapshot?.models?.[0];
    assert.ok(availableModel, "Ollama should have at least one model");

    const switched = await manager.setActiveSelection("ollama", availableModel!);
    assert.strictEqual(switched.activeProviderId, "ollama");
    assert.strictEqual(switched.activeModel, availableModel);

    await assert.rejects(() => manager.setActiveSelection("ollama", "missing-model"), /Model is not available/i);

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
        [
            {
                providerId: "openai",
                baseUrl: "https://api.openai.com/v1",
                apiKeyHeader: "Authorization",
                models: ["gpt-4.1", "gpt-5-mini"],
                defaultModel: "gpt-5-mini",
                updatedAt: new Date().toISOString(),
                source: "test",
            },
        ],
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

    // ── Continuous Cryptographic Directive Enforcement Tests ─────────────────
    const padPath = "Permanent_Active_Directives.txt";
    if (existsSync(padPath)) {
        const originalContent = readFileSync(padPath, "utf8");
        // Instantiate a mock activity bus to capture events
        const events: any[] = [];
        const mockBus = {
            emit: (ev: any) => events.push(ev),
        } as any;
        const testManager = new LlmProviderManager(
            { PRISM_LLM_PROVIDER: "ollama", PRISM_OLLAMA_MODELS: "llama3.1:8b" },
            [],
            undefined,
            undefined,
            undefined,
            mockBus,
        );

        try {
            // Overwrite with tampered content
            writeFileSync(padPath, "TAMPERED DIRECTIVES CONTENT");

            // We expect generate to throw an integrity violation error
            const input = {
                message: "Test prompt",
                conversation: [],
                systemPrompt: "Test system prompt",
            };
            await assert.rejects(
                () => testManager.generate(input),
                /PAD integrity check failed/i,
                "Generation should fail when PAD is tampered",
            );

            // Assert that the activity bus emitted the security violation event
            assert.strictEqual(events.length, 1, "Should emit exactly 1 event");
            assert.strictEqual(events[0].layer, "governance");
            assert.strictEqual(events[0].operation, "directive_integrity_violated");
            assert.strictEqual(events[0].status, "failed");
            assert.ok(events[0].details.error.includes("PAD integrity check failed"));
        } finally {
            // Restore original content
            writeFileSync(padPath, originalContent);
        }
    }

    console.log("✓ LlmProviderManager tests passed");
}
