/**
 * v0.20.4 — Media tools tests (video / audio / transcribe).
 *
 * Mirrors tests/image-generate-tool.test.ts. Each tool gets:
 *   - One success path with a mocked provider response.
 *   - One negative path where routing returns null → structured advisory.
 *
 * AudioGenerateTool also covers the kind=music + kind=sfx routing paths so we
 * verify the modality fallback chain and the structured `no_music_capable_model`
 * / `no_sfx_capable_model` reasons surface to the operator.
 */

import assert from "node:assert";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VideoGenerateTool, AudioGenerateTool, AudioTranscribeTool } from "../src/adapters/application/media-tools.js";
import type { LlmProviderManager } from "../src/core/operator/llm-provider-manager.js";
import type { ProviderSecretStore } from "../src/core/operator/provider-secret-store.js";

interface FetchInit { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }

interface Capture { url?: string; init?: FetchInit; bodyJson?: unknown; bodyBytes?: Uint8Array }

function jsonFetch(opts: { payload: unknown; status?: number; capture?: Capture }) {
    return async (url: string, init?: FetchInit) => {
        if (opts.capture) {
            opts.capture.url = url;
            opts.capture.init = init;
            if (typeof init?.body === "string") {
                try { opts.capture.bodyJson = JSON.parse(init.body); } catch { /* keep raw */ }
            } else if (init?.body) {
                opts.capture.bodyBytes = init.body as Uint8Array;
            }
        }
        const status = opts.status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => JSON.stringify(opts.payload),
            json: async () => opts.payload,
            arrayBuffer: async () => new ArrayBuffer(0),
        };
    };
}

function bytesFetch(opts: { bytes: Uint8Array; status?: number; capture?: Capture }) {
    return async (url: string, init?: FetchInit) => {
        if (opts.capture) {
            opts.capture.url = url;
            opts.capture.init = init;
            if (typeof init?.body === "string") {
                try { opts.capture.bodyJson = JSON.parse(init.body); } catch { /* keep raw */ }
            }
        }
        const status = opts.status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => "",
            json: async () => ({}),
            arrayBuffer: async (): Promise<ArrayBuffer> => opts.bytes.buffer.slice(opts.bytes.byteOffset, opts.bytes.byteOffset + opts.bytes.byteLength) as ArrayBuffer,
        };
    };
}

function fakeProviderManager(routing: Record<string, { providerId: string; model: string; tier: number; degraded: boolean; reason: string } | null>): LlmProviderManager {
    return {
        async suggestRoutingForAllModalities() { return routing; },
        async getCatalog() {
            return {
                providers: [
                    { id: "openai", baseUrl: "https://api.openai.com/v1", enabled: true, models: ["sora-2", "tts-1", "whisper-1"] },
                    { id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", enabled: true, models: ["openai/tts-1"] },
                    { id: "gemini", baseUrl: "https://generativelanguage.googleapis.com", enabled: true, models: ["gemini-2.0-pro"] },
                ],
            };
        },
    } as unknown as LlmProviderManager;
}

function fakeSecretStore(keys: Record<string, string>): ProviderSecretStore {
    return {
        hasApiKey(p: string) { return Boolean(keys[p]); },
        getApiKey(p: string) { return keys[p] ?? null; },
        setApiKey() { /* no-op */ },
        clearApiKey() { /* no-op */ },
        listSlots() { return []; },
    } as unknown as ProviderSecretStore;
}

// Minimal MP4 ftyp box header — verifies the bytes the tool wrote came from the
// mocked fetch and weren't corrupted.
const MP4_HEADER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const FAKE_MP4 = Buffer.concat([MP4_HEADER, Buffer.from("isom\0\0\0\0", "binary")]);
const FAKE_MP4_B64 = FAKE_MP4.toString("base64");

// Minimal MP3 frame header bytes (just for shape — content doesn't need to be
// playable for this test, only round-trip-correct).
const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x00, 0x00, 0x00, 0x00]);

export async function testVideoGenerateTool(): Promise<void> {
    // ── Success: openai sora returns inline b64 mp4 → bytes written ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-vidgen-ok-"));
        const capture: Capture = {};
        const tool = new VideoGenerateTool({
            providerManager: fakeProviderManager({
                "video-generation": { providerId: "openai", model: "sora-2", tier: 5, degraded: false, reason: "ok" },
            }),
            secretStore: fakeSecretStore({ openai: "sk-test-key" }),
            workspaceRootOverride: wsDir,
            fetchImpl: jsonFetch({ payload: { data: [{ b64_json: FAKE_MP4_B64 }] }, capture }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { prompt: "a sunrise over mountains", seconds: 5 },
            risk: "medium",
            mutatesState: true,
        });
        assert.strictEqual(result.ok, true);
        const out = result.output as { saved_path: string; provider: string; model: string };
        assert.strictEqual(out.provider, "openai");
        assert.ok(existsSync(out.saved_path));
        const written = readFileSync(out.saved_path);
        assert.ok(written.slice(0, 8).equals(MP4_HEADER), "written video should preserve mp4 header");
        assert.ok(capture.url?.includes("/videos/generations"));
        assert.strictEqual(capture.init?.headers?.["Authorization"], "Bearer sk-test-key");
    }

    // ── Pending: openai returns a job id → ok:true with pending:true ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-vidgen-pending-"));
        const tool = new VideoGenerateTool({
            providerManager: fakeProviderManager({
                "video-generation": { providerId: "openai", model: "sora-2", tier: 5, degraded: false, reason: "ok" },
            }),
            secretStore: fakeSecretStore({ openai: "sk-test-key" }),
            workspaceRootOverride: wsDir,
            fetchImpl: jsonFetch({ payload: { id: "vid_abc123", status: "queued" } }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { prompt: "stylized teapot rotating" },
            risk: "medium",
            mutatesState: true,
        });
        assert.strictEqual(result.ok, true);
        const out = result.output as { pending: boolean; job_id: string; status: string };
        assert.strictEqual(out.pending, true);
        assert.strictEqual(out.job_id, "vid_abc123");
        assert.strictEqual(out.status, "queued");
    }

    // ── Negative: no video-capable provider configured ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-vidgen-none-"));
        const tool = new VideoGenerateTool({
            providerManager: fakeProviderManager({ "video-generation": null }),
            secretStore: fakeSecretStore({}),
            workspaceRootOverride: wsDir,
            fetchImpl: jsonFetch({ payload: {} }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { prompt: "x" },
            risk: "medium",
            mutatesState: true,
        });
        assert.strictEqual(result.ok, false);
        const out = result.output as { reason: string; advisory: string };
        assert.strictEqual(out.reason, "no_video_capable_model");
        assert.ok(out.advisory.toLowerCase().includes("settings"));
    }
}

export async function testAudioGenerateTool(): Promise<void> {
    // ── Success: TTS via openai → binary mp3 written ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-audiogen-tts-"));
        const capture: Capture = {};
        const tool = new AudioGenerateTool({
            providerManager: fakeProviderManager({
                tts: { providerId: "openai", model: "tts-1", tier: 4, degraded: false, reason: "ok" },
            }),
            secretStore: fakeSecretStore({ openai: "sk-test-key" }),
            workspaceRootOverride: wsDir,
            fetchImpl: bytesFetch({ bytes: FAKE_MP3, capture }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { text: "Hello, world.", voice: "alloy" },
            risk: "medium",
            mutatesState: true,
        });
        assert.strictEqual(result.ok, true);
        const out = result.output as { saved_path: string; provider: string; model: string; kind: string };
        assert.strictEqual(out.kind, "speech");
        assert.ok(existsSync(out.saved_path));
        const written = readFileSync(out.saved_path);
        assert.ok(written.equals(FAKE_MP3), "written tts file should equal the mocked bytes");
        assert.ok(capture.url?.includes("/audio/speech"));
        const body = capture.bodyJson as { model?: string; voice?: string; input?: string };
        assert.strictEqual(body.model, "tts-1");
        assert.strictEqual(body.voice, "alloy");
        assert.strictEqual(body.input, "Hello, world.");
    }

    // ── Music kind: routing prefers music-generation, falls through to a
    //     suitable model — here we explicitly route gemini to music-generation.
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-audiogen-music-"));
        const capture: Capture = {};
        const tool = new AudioGenerateTool({
            providerManager: fakeProviderManager({
                "music-generation": { providerId: "gemini", model: "gemini-music", tier: 4, degraded: false, reason: "ok" },
            }),
            secretStore: fakeSecretStore({ gemini: "g-test-key" }),
            workspaceRootOverride: wsDir,
            fetchImpl: jsonFetch({
                payload: {
                    candidates: [{ content: { parts: [{ inlineData: { data: FAKE_MP3.toString("base64") } }] } }],
                },
                capture,
            }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { text: "lofi piano riff in C minor", kind: "music" },
            risk: "medium",
            mutatesState: true,
        });
        assert.strictEqual(result.ok, true, JSON.stringify(result.output));
        const out = result.output as { saved_path: string; kind: string };
        assert.strictEqual(out.kind, "music");
        assert.ok(out.saved_path.includes("prism-music-"), "music file should use the music name prefix");
        const body = capture.bodyJson as { contents?: Array<{ parts?: Array<{ text?: string }> }> };
        assert.ok(body.contents?.[0]?.parts?.[0]?.text?.toLowerCase().includes("music"));
    }

    // ── SFX kind, no provider available → structured no_sfx_capable_model ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-audiogen-sfx-none-"));
        const tool = new AudioGenerateTool({
            providerManager: fakeProviderManager({
                "sound-effects": null, "music-generation": null, "voice-output": null, tts: null,
            }),
            secretStore: fakeSecretStore({}),
            workspaceRootOverride: wsDir,
            fetchImpl: jsonFetch({ payload: {} }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { text: "thunderclap", kind: "sfx" },
            risk: "medium",
            mutatesState: true,
        });
        assert.strictEqual(result.ok, false);
        const out = result.output as { reason: string; advisory: string };
        assert.strictEqual(out.reason, "no_sfx_capable_model");
        assert.ok(out.advisory.toLowerCase().includes("settings"));
    }

    // ── Negative: TTS routing null + no fallback ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-audiogen-none-"));
        const tool = new AudioGenerateTool({
            providerManager: fakeProviderManager({ tts: null, "voice-output": null }),
            secretStore: fakeSecretStore({}),
            workspaceRootOverride: wsDir,
            fetchImpl: jsonFetch({ payload: {} }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { text: "hi" },
            risk: "medium",
            mutatesState: true,
        });
        assert.strictEqual(result.ok, false);
        assert.strictEqual((result.output as { reason: string }).reason, "no_tts_capable_model");
    }
}

export async function testAudioTranscribeTool(): Promise<void> {
    // ── Success: openai whisper → returns text ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-stt-ok-"));
        const audioFile = join(wsDir, "sample.mp3");
        writeFileSync(audioFile, FAKE_MP3);
        const capture: Capture = {};
        const tool = new AudioTranscribeTool({
            providerManager: fakeProviderManager({
                stt: { providerId: "openai", model: "whisper-1", tier: 4, degraded: false, reason: "ok" },
            }),
            secretStore: fakeSecretStore({ openai: "sk-test-key" }),
            workspaceRootOverride: wsDir,
            fetchImpl: jsonFetch({ payload: { text: "Hello, world." }, capture }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { audioPath: audioFile },
            risk: "medium",
            mutatesState: false,
        });
        assert.strictEqual(result.ok, true, JSON.stringify(result.output));
        const out = result.output as { text: string; provider: string; model: string };
        assert.strictEqual(out.text, "Hello, world.");
        assert.strictEqual(out.provider, "openai");
        assert.ok(capture.url?.includes("/audio/transcriptions"));
        assert.ok(capture.init?.headers?.["Content-Type"]?.startsWith("multipart/form-data; boundary="));
        assert.strictEqual(capture.init?.headers?.["Authorization"], "Bearer sk-test-key");
    }

    // ── Negative: no STT-capable provider ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-stt-none-"));
        const audioFile = join(wsDir, "sample.mp3");
        writeFileSync(audioFile, FAKE_MP3);
        const tool = new AudioTranscribeTool({
            providerManager: fakeProviderManager({ stt: null, "voice-input": null }),
            secretStore: fakeSecretStore({}),
            workspaceRootOverride: wsDir,
            fetchImpl: jsonFetch({ payload: {} }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { audioPath: audioFile },
            risk: "medium",
            mutatesState: false,
        });
        assert.strictEqual(result.ok, false);
        const out = result.output as { reason: string; advisory: string };
        assert.strictEqual(out.reason, "no_stt_capable_model");
        assert.ok(out.advisory.toLowerCase().includes("settings"));
    }

    // ── Negative: audio path outside workspace ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-stt-escape-"));
        const tool = new AudioTranscribeTool({
            providerManager: fakeProviderManager({
                stt: { providerId: "openai", model: "whisper-1", tier: 4, degraded: false, reason: "ok" },
            }),
            secretStore: fakeSecretStore({ openai: "sk-test-key" }),
            workspaceRootOverride: wsDir,
            fetchImpl: jsonFetch({ payload: { text: "should not reach" } }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { audioPath: join(tmpdir(), "outside.mp3") },
            risk: "medium",
            mutatesState: false,
        });
        assert.strictEqual(result.ok, false);
        assert.strictEqual((result.output as { reason: string }).reason, "read_failed");
    }

    // ── Negative: empty audioPath ──
    {
        const wsDir = mkdtempSync(join(tmpdir(), "prism-stt-empty-"));
        const tool = new AudioTranscribeTool({
            providerManager: fakeProviderManager({
                stt: { providerId: "openai", model: "whisper-1", tier: 4, degraded: false, reason: "ok" },
            }),
            secretStore: fakeSecretStore({ openai: "sk-test-key" }),
            workspaceRootOverride: wsDir,
            fetchImpl: jsonFetch({ payload: {} }),
        });
        const result = await tool.execute({
            operation: "execute",
            args: { audioPath: "   " },
            risk: "medium",
            mutatesState: false,
        });
        assert.strictEqual(result.ok, false);
        assert.strictEqual((result.output as { reason: string }).reason, "invalid_args");
    }
}
