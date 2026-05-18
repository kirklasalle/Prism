// ─────────────────────────────────────────────────────────────────────────────
// Media Tools — v0.20.4 (companion to image-generate-tool.ts)
//
// Tools for the remaining media modalities so the chat orchestrator can route
// any media request through the model-capability matrix:
//
//   - video_generate     → text→video.  Modality:  video-generation
//   - audio_generate     → text→speech (TTS). Modality: tts | voice-output
//   - audio_transcribe   → speech→text (STT). Modality: stt | voice-input
//
// Design notes (mirrors image-generate-tool.ts):
//   - Each tool routes via `LlmProviderManager.suggestRoutingForAllModalities()`
//     and falls back through related modalities (e.g. tts → voice-output).
//   - Provider-agnostic dispatch switch — adding local providers later (e.g.
//     Whisper.cpp via Ollama-compatible servers, AnimateDiff/ComfyUI for video,
//     Piper/XTTS for TTS) is mechanical: one new case branch + matrix entry.
//   - Tier 2 by default (network + disk write + cloud cost). Per-character
//     override remains available via the existing tier-config mechanism.
//   - No-provider returns structured `{ ok:false, reason, advisory }` so the
//     orchestrator can surface a precise advisory.
//   - Path-traversal-safe writes — savePath must stay within the workspace
//     subdirectory dedicated to that media kind.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Buffer } from "node:buffer";

import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import type { LlmProviderManager } from "../../core/operator/llm-provider-manager.js";
import type { ProviderSecretStore } from "../../core/operator/provider-secret-store.js";
import { workspacePath, resolveWorkspaceRoot } from "../../core/config/workspace-resolver.js";

// Same FetchLike shape used by ImageGenerateTool — kept duplicated to avoid
// cross-tool coupling and keep each tool independently injectable in tests.
type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => Promise<{
    ok: boolean;
    status: number;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
    arrayBuffer: () => Promise<ArrayBuffer>;
}>;

export interface MediaToolDeps {
    providerManager: LlmProviderManager;
    secretStore: ProviderSecretStore;
    fetchImpl?: FetchLike;
    workspaceRootOverride?: string;
}

interface RoutedProvider {
    providerId: string;
    model: string;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function trimTrailingSlash(u: string): string {
    return u.endsWith("/") ? u.slice(0, -1) : u;
}

function defaultFetch(): FetchLike {
    return (globalThis as unknown as { fetch: FetchLike }).fetch;
}

async function resolveProvider(
    manager: LlmProviderManager,
    modalities: string[],
): Promise<RoutedProvider | null> {
    const routing = await manager.suggestRoutingForAllModalities();
    for (const m of modalities) {
        const sel = routing[m];
        if (sel) return { providerId: sel.providerId, model: sel.model };
    }
    return null;
}

async function resolveBaseUrl(manager: LlmProviderManager, providerId: string): Promise<string> {
    try {
        const catalog = await manager.getCatalog();
        const provider = catalog.providers.find((p) => p.id === providerId);
        return provider?.baseUrl ?? "";
    } catch {
        return "";
    }
}

async function writeMediaFile(
    bytes: Uint8Array,
    rootDir: string,
    requestedSavePath: string | undefined,
    defaultFilename: string,
): Promise<string> {
    await fs.mkdir(rootDir, { recursive: true });
    let target: string;
    if (requestedSavePath && requestedSavePath.length > 0) {
        const candidate = path.resolve(rootDir, requestedSavePath);
        const rootResolved = path.resolve(rootDir);
        if (!candidate.startsWith(rootResolved + path.sep) && candidate !== rootResolved) {
            throw new Error("savePath escapes the dedicated media directory");
        }
        target = candidate;
        await fs.mkdir(path.dirname(target), { recursive: true });
    } else {
        target = path.join(rootDir, defaultFilename);
    }
    await fs.writeFile(target, bytes);
    return target;
}

function timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function readFileSafe(filePath: string, workspaceRoot: string): Promise<Buffer> {
    // Path-traversal-safe read — only allow files inside the workspace root.
    const candidate = path.resolve(filePath);
    const root = path.resolve(workspaceRoot);
    if (!candidate.startsWith(root + path.sep) && candidate !== root) {
        return Promise.reject(new Error(`audio path must be inside the workspace: ${workspaceRoot}`));
    }
    return fs.readFile(candidate);
}

// ─────────────────────────────────────────────────────────────────────────────
// VideoGenerateTool
// ─────────────────────────────────────────────────────────────────────────────

export class VideoGenerateTool implements Tool {
    readonly name = "video_generate";
    readonly contract = {
        version: "1.0.0",
        args: {
            prompt: { type: "string", required: true },
            savePath: { type: "string" },
            seconds: { type: "number" },
            size: { type: "string" },
        },
    } as const;

    private readonly providerManager: LlmProviderManager;
    private readonly secretStore: ProviderSecretStore;
    private readonly fetchImpl: FetchLike;
    private readonly workspaceRootOverride?: string;

    constructor(deps: MediaToolDeps) {
        this.providerManager = deps.providerManager;
        this.secretStore = deps.secretStore;
        this.fetchImpl = deps.fetchImpl ?? defaultFetch();
        this.workspaceRootOverride = deps.workspaceRootOverride;
    }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const prompt = String(request.args.prompt ?? "").trim();
        if (!prompt) {
            return { ok: false, output: { reason: "invalid_args", error: "prompt is required" } };
        }
        const savePath = request.args.savePath != null ? String(request.args.savePath) : undefined;
        const seconds = Math.max(1, Math.min(60, Number(request.args.seconds ?? 5) || 5));
        const size = String(request.args.size ?? "1024x1024");

        let routed: RoutedProvider | null;
        try {
            routed = await resolveProvider(this.providerManager, ["video-generation"]);
        } catch (err) {
            return {
                ok: false,
                output: { reason: "routing_failed", error: String(err), advisory: "Could not query the model-capability matrix for a video-generation model." },
            };
        }
        if (!routed) {
            return {
                ok: false,
                output: {
                    reason: "no_video_capable_model",
                    advisory: "No video-generation provider is configured. Add an OpenAI (sora-2), Google (veo-3), or compatible provider in Settings → Providers, then retry.",
                },
            };
        }

        const baseUrl = await resolveBaseUrl(this.providerManager, routed.providerId);
        const apiKey = this.secretStore.getApiKey(routed.providerId as never) ?? "";

        try {
            const dispatched = await this.dispatch({ providerId: routed.providerId, model: routed.model, baseUrl, apiKey, prompt, seconds, size });
            // Pending job (e.g. OpenAI Sora returns an async job_id). Surface as
            // a successful structured result rather than blocking — operator can
            // poll later in v0.20.5.
            if (dispatched.kind === "pending") {
                return {
                    ok: true,
                    output: {
                        pending: true,
                        provider: routed.providerId,
                        model: routed.model,
                        job_id: dispatched.jobId,
                        status: dispatched.status ?? "queued",
                        advisory: "Video generation job submitted. The provider will produce the video asynchronously; check the job_id for completion.",
                        prompt,
                    },
                    sideEffects: [{ type: "network", description: `video generation job: ${routed.providerId}/${routed.model}` }],
                };
            }
            const root = this.workspaceRootOverride ?? workspacePath("videos");
            const saved = await writeMediaFile(dispatched.bytes, root, savePath, `prism-video-${timestamp()}.${dispatched.ext}`);
            return {
                ok: true,
                output: { saved_path: saved, provider: routed.providerId, model: routed.model, prompt, seconds, size },
                sideEffects: [
                    { type: "network", description: `video generation: ${routed.providerId}/${routed.model}` },
                    { type: "file", description: `wrote video: ${saved}`, mutating: true, reversible: true },
                ],
            };
        } catch (err) {
            return {
                ok: false,
                output: { reason: "provider_request_failed", error: String(err), provider: routed.providerId, model: routed.model },
            };
        }
    }

    private async dispatch(opts: { providerId: string; model: string; baseUrl: string; apiKey: string; prompt: string; seconds: number; size: string }): Promise<
        | { kind: "bytes"; bytes: Uint8Array; ext: string }
        | { kind: "pending"; jobId: string; status?: string }
    > {
        if (opts.providerId === "openai" || opts.providerId === "openrouter") {
            if (!opts.apiKey) throw new Error(`Provider ${opts.providerId} has no API key configured`);
            // OpenAI Sora video API shape (best-effort; returns either inline
            // b64, a downloadable URL, or a job id).
            const url = `${trimTrailingSlash(opts.baseUrl)}/videos/generations`;
            const resp = await this.fetchImpl(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
                body: JSON.stringify({ model: opts.model, prompt: opts.prompt, seconds: opts.seconds, size: opts.size }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
            const payload = (await resp.json()) as {
                data?: Array<{ b64_json?: string; url?: string }>;
                id?: string; status?: string; url?: string; b64_json?: string;
            };
            const first = payload.data?.[0];
            if (first?.b64_json) return { kind: "bytes", bytes: Buffer.from(first.b64_json, "base64"), ext: "mp4" };
            if (payload.b64_json) return { kind: "bytes", bytes: Buffer.from(payload.b64_json, "base64"), ext: "mp4" };
            if (first?.url || payload.url) {
                const dl = await this.fetchImpl(String(first?.url ?? payload.url));
                if (!dl.ok) throw new Error(`Failed to download video bytes: HTTP ${dl.status}`);
                return { kind: "bytes", bytes: new Uint8Array(await dl.arrayBuffer()), ext: "mp4" };
            }
            if (payload.id) return { kind: "pending", jobId: payload.id, status: payload.status };
            throw new Error("Provider returned no video data and no job id");
        }
        if (opts.providerId === "gemini") {
            if (!opts.apiKey) throw new Error("Provider gemini has no API key configured");
            const url = `${trimTrailingSlash(opts.baseUrl)}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
            const resp = await this.fetchImpl(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: opts.prompt }] }],
                    generationConfig: { responseModalities: ["VIDEO"] },
                }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
            const payload = (await resp.json()) as {
                candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
                name?: string; done?: boolean;
            };
            const inline = payload.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
            if (inline?.data) {
                const ext = inline.mimeType?.split("/")[1]?.split(";")[0] || "mp4";
                return { kind: "bytes", bytes: Buffer.from(inline.data, "base64"), ext };
            }
            if (payload.name) return { kind: "pending", jobId: payload.name, status: payload.done ? "done" : "queued" };
            throw new Error("Gemini returned no video data");
        }
        // v0.20.5 backlog: ComfyUI/AnimateDiff, RunwayML, etc.
        throw new Error(`No video-generation dispatch implemented for provider: ${opts.providerId}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AudioGenerateTool (TTS)
// ─────────────────────────────────────────────────────────────────────────────

export class AudioGenerateTool implements Tool {
    readonly name = "audio_generate";
    readonly contract = {
        version: "1.0.0",
        args: {
            text: { type: "string", required: true },
            // "speech" (default) → TTS. "music" → text→music (single instrument or composition).
            // "sfx" → non-speech sound effect. "auto" → infer from text/voice.
            kind: { type: "string" },
            savePath: { type: "string" },
            voice: { type: "string" },
            format: { type: "string" },
            duration: { type: "number" },
        },
    } as const;

    private readonly providerManager: LlmProviderManager;
    private readonly secretStore: ProviderSecretStore;
    private readonly fetchImpl: FetchLike;
    private readonly workspaceRootOverride?: string;

    constructor(deps: MediaToolDeps) {
        this.providerManager = deps.providerManager;
        this.secretStore = deps.secretStore;
        this.fetchImpl = deps.fetchImpl ?? defaultFetch();
        this.workspaceRootOverride = deps.workspaceRootOverride;
    }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const text = String(request.args.text ?? "").trim();
        if (!text) {
            return { ok: false, output: { reason: "invalid_args", error: "text is required" } };
        }
        const savePath = request.args.savePath != null ? String(request.args.savePath) : undefined;
        const voice = String(request.args.voice ?? "alloy");
        const format = this.normalizeFormat(String(request.args.format ?? "mp3"));
        const kindRaw = String(request.args.kind ?? "speech").toLowerCase();
        const kind: "speech" | "music" | "sfx" = kindRaw === "music" || kindRaw === "song" || kindRaw === "instrument"
            ? "music"
            : (kindRaw === "sfx" || kindRaw === "sound" || kindRaw === "sound-effect" || kindRaw === "sound_effect")
                ? "sfx"
                : "speech";
        const duration = Math.max(1, Math.min(300, Number(request.args.duration ?? 0) || 0));

        // Route by kind. Each kind has a primary modality and a graceful fallback
        // chain so a TTS-only deployment still answers structurally.
        const modalityOrder: string[] = kind === "music"
            ? ["music-generation", "sound-effects", "voice-output"]
            : kind === "sfx"
                ? ["sound-effects", "music-generation", "voice-output"]
                : ["tts", "voice-output"];

        let routed: RoutedProvider | null;
        try {
            routed = await resolveProvider(this.providerManager, modalityOrder);
        } catch (err) {
            return {
                ok: false,
                output: { reason: "routing_failed", error: String(err), advisory: `Could not query the model-capability matrix for a ${kind}-capable model.` },
            };
        }
        if (!routed) {
            const advisory = kind === "music"
                ? "No music-generation provider is configured. Add a music model (e.g. Suno, Udio, Stable Audio, MusicGen) in Settings → Providers, then retry."
                : kind === "sfx"
                    ? "No sound-effects provider is configured. Add an SFX-capable provider (e.g. ElevenLabs Sound Effects, Stable Audio) in Settings → Providers, then retry."
                    : "No text-to-speech provider is configured. Add an OpenAI (gpt-4o-mini-tts / tts-1), Google Gemini (with audio output), or compatible TTS provider in Settings → Providers, then retry.";
            const reason = kind === "music" ? "no_music_capable_model" : kind === "sfx" ? "no_sfx_capable_model" : "no_tts_capable_model";
            return { ok: false, output: { reason, advisory } };
        }

        const baseUrl = await resolveBaseUrl(this.providerManager, routed.providerId);
        const apiKey = this.secretStore.getApiKey(routed.providerId as never) ?? "";

        try {
            const bytes = await this.dispatch({ providerId: routed.providerId, model: routed.model, baseUrl, apiKey, text, voice, format, kind, duration });
            const root = this.workspaceRootOverride ?? workspacePath("audio");
            const subPrefix = kind === "music" ? "prism-music" : kind === "sfx" ? "prism-sfx" : "prism-audio";
            const saved = await writeMediaFile(bytes, root, savePath, `${subPrefix}-${timestamp()}.${format}`);
            return {
                ok: true,
                output: { saved_path: saved, provider: routed.providerId, model: routed.model, kind, voice: kind === "speech" ? voice : undefined, format, characters: text.length, duration: duration || undefined },
                sideEffects: [
                    { type: "network", description: `${kind === "speech" ? "tts" : kind}: ${routed.providerId}/${routed.model}` },
                    { type: "file", description: `wrote audio: ${saved}`, mutating: true, reversible: true },
                ],
            };
        } catch (err) {
            return {
                ok: false,
                output: { reason: "provider_request_failed", error: String(err), provider: routed.providerId, model: routed.model, kind },
            };
        }
    }

    private normalizeFormat(raw: string): string {
        const allowed = new Set(["mp3", "wav", "ogg", "flac", "opus", "aac"]);
        return allowed.has(raw) ? raw : "mp3";
    }

    private async dispatch(opts: { providerId: string; model: string; baseUrl: string; apiKey: string; text: string; voice: string; format: string; kind: "speech" | "music" | "sfx"; duration: number }): Promise<Uint8Array> {
        if (opts.providerId === "openai" || opts.providerId === "openrouter") {
            if (!opts.apiKey) throw new Error(`Provider ${opts.providerId} has no API key configured`);
            // OpenAI returns audio bytes directly (not JSON). Same endpoint covers
            // speech today; music/sfx via OpenAI flows through the same call when
            // a music-capable model is selected (e.g. future gpt-4o-audio variants).
            const url = `${trimTrailingSlash(opts.baseUrl)}/audio/speech`;
            const body: Record<string, unknown> = { model: opts.model, input: opts.text, response_format: opts.format };
            if (opts.kind === "speech") body.voice = opts.voice;
            if (opts.duration > 0) body.duration = opts.duration;
            const resp = await this.fetchImpl(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
                body: JSON.stringify(body),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
            return new Uint8Array(await resp.arrayBuffer());
        }
        if (opts.providerId === "gemini") {
            if (!opts.apiKey) throw new Error("Provider gemini has no API key configured");
            const url = `${trimTrailingSlash(opts.baseUrl)}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
            const promptText = opts.kind === "music"
                ? `Generate music: ${opts.text}`
                : opts.kind === "sfx"
                    ? `Generate a sound effect: ${opts.text}`
                    : opts.text;
            const resp = await this.fetchImpl(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: promptText }] }],
                    generationConfig: { responseModalities: ["AUDIO"] },
                }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
            const payload = (await resp.json()) as {
                candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
            };
            const inline = payload.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
            if (inline) return Buffer.from(inline, "base64");
            throw new Error("Gemini returned no inline audio data");
        }
        // v0.20.5 backlog: Suno, Udio, MusicGen, Stable Audio, ElevenLabs SFX,
        // Piper / XTTS / local TTS servers.
        throw new Error(`No audio dispatch implemented for provider ${opts.providerId} (kind=${opts.kind})`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AudioTranscribeTool (STT)
// ─────────────────────────────────────────────────────────────────────────────

export class AudioTranscribeTool implements Tool {
    readonly name = "audio_transcribe";
    readonly contract = {
        version: "1.0.0",
        args: {
            audioPath: { type: "string", required: true },
            language: { type: "string" },
            prompt: { type: "string" },
        },
    } as const;

    private readonly providerManager: LlmProviderManager;
    private readonly secretStore: ProviderSecretStore;
    private readonly fetchImpl: FetchLike;
    private readonly workspaceRootOverride?: string;

    constructor(deps: MediaToolDeps) {
        this.providerManager = deps.providerManager;
        this.secretStore = deps.secretStore;
        this.fetchImpl = deps.fetchImpl ?? defaultFetch();
        this.workspaceRootOverride = deps.workspaceRootOverride;
    }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const audioPath = String(request.args.audioPath ?? "").trim();
        if (!audioPath) {
            return { ok: false, output: { reason: "invalid_args", error: "audioPath is required" } };
        }
        const language = request.args.language != null ? String(request.args.language) : undefined;
        const prompt = request.args.prompt != null ? String(request.args.prompt) : undefined;

        let routed: RoutedProvider | null;
        try {
            routed = await resolveProvider(this.providerManager, ["stt", "voice-input"]);
        } catch (err) {
            return {
                ok: false,
                output: { reason: "routing_failed", error: String(err), advisory: "Could not query the model-capability matrix for an STT model." },
            };
        }
        if (!routed) {
            return {
                ok: false,
                output: {
                    reason: "no_stt_capable_model",
                    advisory: "No speech-to-text provider is configured. Add an OpenAI (whisper-1 / gpt-4o-transcribe) or compatible STT provider in Settings → Providers, then retry.",
                },
            };
        }

        const baseUrl = await resolveBaseUrl(this.providerManager, routed.providerId);
        const apiKey = this.secretStore.getApiKey(routed.providerId as never) ?? "";

        // Read the audio file from disk (path-traversal-safe inside workspace).
        const root = this.workspaceRootOverride ?? resolveWorkspaceRoot();
        let audioBytes: Buffer;
        try {
            audioBytes = await readFileSafe(audioPath, root);
        } catch (err) {
            return { ok: false, output: { reason: "read_failed", error: String(err), audioPath } };
        }

        try {
            const text = await this.dispatch({
                providerId: routed.providerId,
                model: routed.model,
                baseUrl,
                apiKey,
                audioBytes,
                fileName: path.basename(audioPath),
                language,
                prompt,
            });
            return {
                ok: true,
                output: { text, provider: routed.providerId, model: routed.model, sourcePath: audioPath, characters: text.length },
                sideEffects: [{ type: "network", description: `stt: ${routed.providerId}/${routed.model}` }],
            };
        } catch (err) {
            return {
                ok: false,
                output: { reason: "provider_request_failed", error: String(err), provider: routed.providerId, model: routed.model },
            };
        }
    }

    private async dispatch(opts: { providerId: string; model: string; baseUrl: string; apiKey: string; audioBytes: Buffer; fileName: string; language?: string; prompt?: string }): Promise<string> {
        if (opts.providerId === "openai" || opts.providerId === "openrouter") {
            if (!opts.apiKey) throw new Error(`Provider ${opts.providerId} has no API key configured`);
            const url = `${trimTrailingSlash(opts.baseUrl)}/audio/transcriptions`;
            // Build a multipart body manually (no FormData ergonomics needed for Node fetch shim parity).
            const boundary = `----PrismFormBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
            const parts: Array<Buffer | string> = [];
            const pushField = (name: string, value: string) => {
                parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
            };
            pushField("model", opts.model);
            if (opts.language) pushField("language", opts.language);
            if (opts.prompt) pushField("prompt", opts.prompt);
            pushField("response_format", "json");
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${opts.fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
            parts.push(opts.audioBytes);
            parts.push(`\r\n--${boundary}--\r\n`);
            const body = Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "utf8") : p)));
            const resp = await this.fetchImpl(url, {
                method: "POST",
                headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, Authorization: `Bearer ${opts.apiKey}` },
                body,
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
            const payload = (await resp.json()) as { text?: string };
            if (typeof payload.text === "string") return payload.text;
            throw new Error("Provider returned no transcription text");
        }
        if (opts.providerId === "gemini") {
            if (!opts.apiKey) throw new Error("Provider gemini has no API key configured");
            const url = `${trimTrailingSlash(opts.baseUrl)}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
            const resp = await this.fetchImpl(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: opts.prompt ?? "Transcribe this audio." },
                            { inlineData: { mimeType: "audio/mpeg", data: opts.audioBytes.toString("base64") } },
                        ],
                    }],
                }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
            const payload = (await resp.json()) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            };
            const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
            if (text && text.length) return text;
            throw new Error("Gemini returned no transcription text");
        }
        // v0.20.5 backlog: local Whisper.cpp servers, Vosk, Deepgram.
        throw new Error(`No STT dispatch implemented for provider: ${opts.providerId}`);
    }
}
