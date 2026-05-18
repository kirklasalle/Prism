/**
 * v0.20.3 — ImageGenerateTool tests.
 *
 * Covers:
 *   - Success path: routing returns an image-capable model, fetch is mocked
 *     to return a base64 PNG, tool writes the bytes into the workspace
 *     override directory and returns `{ ok: true, saved_path, ... }`.
 *   - Negative path: routing returns null → tool returns the structured
 *     `{ ok:false, reason:"no_image_capable_model", advisory:"..." }` shape
 *     so the orchestrator can surface a clear advisory to the operator.
 *   - Negative path: requested savePath escapes the workspace → rejected
 *     with `reason:"write_failed"`.
 */

import assert from "node:assert";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ImageGenerateTool } from "../src/adapters/application/image-generate-tool.js";
import type { LlmProviderManager } from "../src/core/operator/llm-provider-manager.js";
import type { ProviderSecretStore } from "../src/core/operator/provider-secret-store.js";

// 1×1 transparent PNG (valid signature) — enough to exercise the disk write.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface FetchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

function makeMockFetch(opts: {
    expectUrlIncludes?: string;
    payload: unknown;
    status?: number;
    capture?: { url?: string; init?: FetchInit; bodyJson?: unknown };
}) {
    return async (url: string, init?: FetchInit) => {
        if (opts.capture) {
            opts.capture.url = url;
            opts.capture.init = init;
            try { opts.capture.bodyJson = init?.body ? JSON.parse(init.body) : undefined; }
            catch { /* keep raw */ }
        }
        if (opts.expectUrlIncludes && !url.includes(opts.expectUrlIncludes)) {
            throw new Error(`Unexpected URL ${url} — expected to include ${opts.expectUrlIncludes}`);
        }
        const status = opts.status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => JSON.stringify(opts.payload),
            json: async () => opts.payload,
        };
    };
}

function makeFakeProviderManager(routing: Record<string, { providerId: string; model: string; tier: number; degraded: boolean; reason: string } | null>): LlmProviderManager {
    return {
        async suggestRoutingForAllModalities() { return routing; },
        async getCatalog() {
            return {
                providers: [
                    { id: "openai", baseUrl: "https://api.openai.com/v1", enabled: true, models: ["gpt-image-1"] },
                    { id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", enabled: true, models: ["openai/gpt-image-1"] },
                ],
            };
        },
    } as unknown as LlmProviderManager;
}

function makeFakeSecretStore(keys: Record<string, string>): ProviderSecretStore {
    return {
        hasApiKey(p: string) { return Boolean(keys[p]); },
        getApiKey(p: string) { return keys[p] ?? null; },
        setApiKey() { /* no-op */ },
        clearApiKey() { /* no-op */ },
        listSlots() { return []; },
    } as unknown as ProviderSecretStore;
}

export async function testImageGenerateTool(): Promise<void> {
    // ── Success: routing → openai → mocked fetch returns b64 → file written ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-imggen-ok-"));
        const capture: { url?: string; init?: FetchInit; bodyJson?: unknown } = {};
        const tool = new ImageGenerateTool({
            providerManager: makeFakeProviderManager({
                "image-generation": { providerId: "openai", model: "gpt-image-1", tier: 5, degraded: false, reason: "ok" },
            }),
            secretStore: makeFakeSecretStore({ openai: "sk-test-key" }),
            workspaceRootOverride: wsDir,
            fetchImpl: makeMockFetch({
                expectUrlIncludes: "/images/generations",
                payload: { data: [{ b64_json: PNG_B64 }] },
                capture,
            }),
        });

        const result = await tool.execute({
            operation: "execute",
            args: { prompt: "a friendly otter logo", size: "1024x1024" },
            risk: "medium",
            mutatesState: true,
        });

        assert.strictEqual(result.ok, true, "tool should succeed when routing + fetch succeed");
        const out = result.output as { saved_path: string; provider: string; model: string };
        assert.strictEqual(out.provider, "openai");
        assert.strictEqual(out.model, "gpt-image-1");
        assert.ok(out.saved_path.length > 0);
        assert.ok(existsSync(out.saved_path), "image file should be written to workspace");
        const bytes = readFileSync(out.saved_path);
        assert.ok(bytes.slice(0, 8).equals(PNG_HEADER), "written file should have a valid PNG signature");

        // Verify the fetch was called with the OpenAI Images shape.
        assert.ok(capture.url?.includes("/images/generations"));
        assert.strictEqual(capture.init?.method, "POST");
        assert.strictEqual(capture.init?.headers?.["Authorization"], "Bearer sk-test-key");
        const body = capture.bodyJson as { model?: string; prompt?: string; response_format?: string };
        assert.strictEqual(body.model, "gpt-image-1");
        assert.strictEqual(body.prompt, "a friendly otter logo");
        assert.strictEqual(body.response_format, "b64_json");
    }

    // ── Negative: no image-capable model configured → structured advisory ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-imggen-none-"));
        const tool = new ImageGenerateTool({
            providerManager: makeFakeProviderManager({ "image-generation": null }),
            secretStore: makeFakeSecretStore({}),
            workspaceRootOverride: wsDir,
            fetchImpl: makeMockFetch({ payload: {} }),
        });

        const result = await tool.execute({
            operation: "execute",
            args: { prompt: "x" },
            risk: "medium",
            mutatesState: true,
        });

        assert.strictEqual(result.ok, false);
        const out = result.output as { reason: string; advisory: string };
        assert.strictEqual(out.reason, "no_image_capable_model");
        assert.ok(out.advisory.length > 0, "advisory should be a human-readable string");
        assert.ok(out.advisory.toLowerCase().includes("settings"), "advisory should point the user to Settings");
    }

    // ── Negative: empty prompt → invalid_args ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-imggen-empty-"));
        const tool = new ImageGenerateTool({
            providerManager: makeFakeProviderManager({
                "image-generation": { providerId: "openai", model: "gpt-image-1", tier: 5, degraded: false, reason: "ok" },
            }),
            secretStore: makeFakeSecretStore({ openai: "sk-test-key" }),
            workspaceRootOverride: wsDir,
            fetchImpl: makeMockFetch({ payload: {} }),
        });

        const result = await tool.execute({
            operation: "execute",
            args: { prompt: "   " },
            risk: "medium",
            mutatesState: true,
        });

        assert.strictEqual(result.ok, false);
        assert.strictEqual((result.output as { reason: string }).reason, "invalid_args");
    }

    // ── Negative: savePath escaping the workspace is rejected ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-imggen-escape-"));
        const tool = new ImageGenerateTool({
            providerManager: makeFakeProviderManager({
                "image-generation": { providerId: "openai", model: "gpt-image-1", tier: 5, degraded: false, reason: "ok" },
            }),
            secretStore: makeFakeSecretStore({ openai: "sk-test-key" }),
            workspaceRootOverride: wsDir,
            fetchImpl: makeMockFetch({ payload: { data: [{ b64_json: PNG_B64 }] } }),
        });

        const result = await tool.execute({
            operation: "execute",
            args: { prompt: "a", savePath: "../../escaped.png" },
            risk: "medium",
            mutatesState: true,
        });

        assert.strictEqual(result.ok, false);
        assert.strictEqual((result.output as { reason: string }).reason, "write_failed");
    }
}
