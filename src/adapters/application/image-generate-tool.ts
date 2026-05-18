// ─────────────────────────────────────────────────────────────────────────────
// ImageGenerateTool — v0.20.3
//
// Built-in tool that generates images via whichever provider in the
// model-capability matrix declares an `image-generation` modality and is
// currently configured (API key present). Saves the resulting bytes into the
// workspace and returns the saved path.
//
// Design notes:
//   - Provider-agnostic dispatch switch (openai / openrouter / gemini today).
//     Adding local providers (ComfyUI, SD-via-Ollama-compatible) later is
//     mechanical: one new case branch + a matrix entry. See v0.20.4 backlog.
//   - Tier 2 (network + disk write + cloud cost). Per-character override
//     remains available via existing tier-config mechanism.
//   - When no image-capable provider is configured, returns a structured
//     `{ ok:false, reason:"no_image_capable_model", advisory:"…" }` shape so
//     the orchestrator can surface a precise advisory to the operator. A
//     dedicated inline composer notice is deferred to v0.20.4.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import type { LlmProviderManager, PrismLlmProviderId } from "../../core/operator/llm-provider-manager.js";
import type { ProviderSecretStore } from "../../core/operator/provider-secret-store.js";
import { workspacePath } from "../../core/config/workspace-resolver.js";

const IMAGE_GEN_MODALITY = "image-generation";

// Allow tests to inject a mock fetch without monkey-patching globalThis.
type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
    ok: boolean;
    status: number;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
}>;

export interface ImageGenerateToolDeps {
    providerManager: LlmProviderManager;
    secretStore: ProviderSecretStore;
    /** Override fetch for tests. Defaults to global `fetch`. */
    fetchImpl?: FetchLike;
    /** Override workspace root for tests. */
    workspaceRootOverride?: string;
}

interface RoutedImageProvider {
    providerId: string;
    model: string;
}

export class ImageGenerateTool implements Tool {
    readonly name = "image_generate";
    readonly contract = {
        version: "1.0.0",
        args: {
            prompt: { type: "string", required: true },
            savePath: { type: "string" },
            size: { type: "string" },
            n: { type: "number" },
        },
    } as const;

    private readonly providerManager: LlmProviderManager;
    private readonly secretStore: ProviderSecretStore;
    private readonly fetchImpl: FetchLike;
    private readonly workspaceRootOverride?: string;

    constructor(deps: ImageGenerateToolDeps) {
        this.providerManager = deps.providerManager;
        this.secretStore = deps.secretStore;
        // Use globalThis.fetch as default (Node 18+ / browsers).
        this.fetchImpl = deps.fetchImpl ?? ((globalThis as unknown as { fetch: FetchLike }).fetch);
        this.workspaceRootOverride = deps.workspaceRootOverride;
    }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const prompt = String(request.args.prompt ?? "").trim();
        if (!prompt) {
            return {
                ok: false,
                output: { error: "prompt is required", reason: "invalid_args" },
            };
        }
        const size = this.normalizeSize(String(request.args.size ?? "1024x1024"));
        const n = Math.max(1, Math.min(4, Number(request.args.n ?? 1) || 1));
        const savePath = request.args.savePath != null ? String(request.args.savePath) : undefined;

        // ── Route via the model-capability matrix ──
        let routed: RoutedImageProvider | null;
        try {
            routed = await this.resolveImageProvider();
        } catch (err) {
            return {
                ok: false,
                output: {
                    reason: "routing_failed",
                    error: String(err),
                    advisory: "Could not query the model-capability matrix for an image-generation model.",
                },
            };
        }
        if (!routed) {
            return {
                ok: false,
                output: {
                    reason: "no_image_capable_model",
                    advisory: "No image-generation provider is configured. Add an OpenAI (gpt-image-1), OpenRouter, or Gemini Imagen API key in Settings → Providers, then retry.",
                },
            };
        }

        // ── Resolve baseUrl + API key from catalog + secret store ──
        let baseUrl = "";
        try {
            const catalog = await this.providerManager.getCatalog();
            const provider = catalog.providers.find((p) => p.id === routed!.providerId);
            baseUrl = provider?.baseUrl ?? "";
        } catch {
            baseUrl = "";
        }
        const apiKey = this.secretStore.getApiKey(routed.providerId as PrismLlmProviderId) ?? "";

        // ── Provider-agnostic dispatch (see header note for extension policy) ──
        let b64: string;
        try {
            b64 = await this.dispatchImageRequest({
                providerId: routed.providerId,
                model: routed.model,
                baseUrl,
                apiKey,
                prompt,
                size,
                n,
            });
        } catch (err) {
            return {
                ok: false,
                output: {
                    reason: "provider_request_failed",
                    error: String(err),
                    provider: routed.providerId,
                    model: routed.model,
                },
            };
        }

        // ── Persist to workspace ──
        let savedPath: string;
        try {
            savedPath = await this.writeImageToWorkspace(b64, savePath);
        } catch (err) {
            return {
                ok: false,
                output: {
                    reason: "write_failed",
                    error: String(err),
                    provider: routed.providerId,
                    model: routed.model,
                },
            };
        }

        return {
            ok: true,
            output: {
                saved_path: savedPath,
                provider: routed.providerId,
                model: routed.model,
                prompt,
                size,
                n,
            },
            sideEffects: [
                { type: "network", description: `image generation: ${routed.providerId}/${routed.model}` },
                { type: "file", description: `wrote image: ${savedPath}`, mutating: true, reversible: true },
            ],
        };
    }

    private async resolveImageProvider(): Promise<RoutedImageProvider | null> {
        const routing = await this.providerManager.suggestRoutingForAllModalities();
        const sel = routing[IMAGE_GEN_MODALITY];
        if (!sel) return null;
        return { providerId: sel.providerId, model: sel.model };
    }

    private normalizeSize(raw: string): string {
        const allowed = new Set([
            "256x256", "512x512", "1024x1024", "1024x1792", "1792x1024",
        ]);
        return allowed.has(raw) ? raw : "1024x1024";
    }

    private async dispatchImageRequest(opts: {
        providerId: string;
        model: string;
        baseUrl: string;
        apiKey: string;
        prompt: string;
        size: string;
        n: number;
    }): Promise<string> {
        // OpenAI / OpenRouter both accept the OpenAI Images API shape.
        if (opts.providerId === "openai" || opts.providerId === "openrouter") {
            if (!opts.apiKey) {
                throw new Error(`Provider ${opts.providerId} has no API key configured`);
            }
            const url = `${trimTrailingSlash(opts.baseUrl)}/images/generations`;
            const body = JSON.stringify({
                model: opts.model,
                prompt: opts.prompt,
                size: opts.size,
                n: opts.n,
                response_format: "b64_json",
            });
            const resp = await this.fetchImpl(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${opts.apiKey}`,
                },
                body,
            });
            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 500)}`);
            }
            const payload = (await resp.json()) as {
                data?: Array<{ b64_json?: string; url?: string }>;
            };
            const first = payload.data?.[0];
            if (first?.b64_json) return first.b64_json;
            // Some providers return URL-only — minimal v0.20.3 path requires b64.
            // (URL → fetch → b64 is a v0.20.4 enhancement.)
            throw new Error("Provider returned no b64_json image data");
        }

        if (opts.providerId === "gemini") {
            if (!opts.apiKey) {
                throw new Error("Provider gemini has no API key configured");
            }
            const url = `${trimTrailingSlash(opts.baseUrl)}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
            const body = JSON.stringify({
                contents: [{ parts: [{ text: opts.prompt }] }],
                generationConfig: { responseModalities: ["IMAGE"] },
            });
            const resp = await this.fetchImpl(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
            });
            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 500)}`);
            }
            const payload = (await resp.json()) as {
                candidates?: Array<{
                    content?: { parts?: Array<{ inlineData?: { data?: string } }> };
                }>;
            };
            const inline = payload.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
            if (inline) return inline;
            throw new Error("Gemini returned no inline image data");
        }

        // v0.20.4 backlog: local-comfyui, local-sd, automatic1111, etc.
        throw new Error(`No image-generation dispatch implemented for provider: ${opts.providerId}`);
    }

    private async writeImageToWorkspace(b64: string, requestedPath?: string): Promise<string> {
        const buf = Buffer.from(b64, "base64");
        const root = this.workspaceRootOverride ?? workspacePath("images");
        await fs.mkdir(root, { recursive: true });

        let target: string;
        if (requestedPath && requestedPath.length > 0) {
            // Path-traversal-safe: resolve against workspace root and require containment.
            const candidate = path.resolve(root, requestedPath);
            const rootResolved = path.resolve(root);
            if (!candidate.startsWith(rootResolved + path.sep) && candidate !== rootResolved) {
                throw new Error("savePath escapes the workspace images directory");
            }
            target = candidate;
            await fs.mkdir(path.dirname(target), { recursive: true });
        } else {
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            target = path.join(root, `prism-image-${stamp}.png`);
        }
        await fs.writeFile(target, buf);
        return target;
    }
}

function trimTrailingSlash(u: string): string {
    return u.endsWith("/") ? u.slice(0, -1) : u;
}
