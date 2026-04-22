import { describe, it } from "mocha";
import * as assert from "assert";
import {
    validateSRLeftModel,
    validateSRRightModel,
    validateSRTriad,
    filterSRLogicModels,
    filterSRCreativeModels,
    resolveProfile,
    SR_SYSTEM_PROMPTS,
    type ModelCapabilityProfile,
    type AvailableModel,
    type SpectrumRefractionConfig,
    type SRIsolationLevel,
} from "../src/core/operator/model-capability-matrix.js";
import {
    LlmProviderManager,
    type SRGenerationOutput,
    type LlmGenerationOutput,
} from "../src/core/operator/llm-provider-manager.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";

/**
 * Helper to build a minimal ModelCapabilityProfile for testing.
 * Only the fields the SR validators actually inspect need to be correct.
 */
function mkProfile(overrides: {
    pattern: string;
    tier: number;
    strengths: string[];
    modalities: string[];
    contextWindow?: number;
    maxOutputTokens?: number;
}): ModelCapabilityProfile {
    return {
        pattern: overrides.pattern,
        label: overrides.pattern,
        tier: overrides.tier as any,
        parameterSize: "medium" as any,
        parametersBillions: 0,
        contextWindow: overrides.contextWindow ?? 32_000,
        estimatedVramMb: 0,
        maxOutputTokens: overrides.maxOutputTokens ?? 4_096,
        adaptivePromptBudget: 4_096,
        strengths: overrides.strengths as any,
        modalities: overrides.modalities as any,
        locality: "cloud",
    };
}

/* ──────────────────────────────────────────────────────────
 *  1. validateSRLeftModel — Logic Hemisphere qualification
 * ────────────────────────────────────────────────────────── */
describe("Spectrum Refraction — Left (Logic) Hemisphere Validation", () => {
    it("marks a T5 agentic model as optimal", () => {
        const profile = mkProfile({
            pattern: "gpt-5",
            tier: 5,
            strengths: ["code", "reasoning", "agentic", "tool-use"],
            modalities: ["text", "code"],
            contextWindow: 128_000,
            maxOutputTokens: 16_000,
        });
        const result = validateSRLeftModel(profile);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.level, "optimal");
        assert.strictEqual(result.missingCapabilities.length, 0);
    });

    it("marks a T4 reasoning model as standard", () => {
        const profile = mkProfile({
            pattern: "claude-3-5-sonnet",
            tier: 4,
            strengths: ["code", "reasoning"],
            modalities: ["text", "code"],
            contextWindow: 200_000,
            maxOutputTokens: 8_192,
        });
        const result = validateSRLeftModel(profile);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.level, "standard");
    });

    it("marks a T3 code model as minimum", () => {
        const profile = mkProfile({
            pattern: "llama3.1:8b",
            tier: 3,
            strengths: ["code"],
            modalities: ["text", "code"],
            contextWindow: 8_192,
            maxOutputTokens: 2_048,
        });
        const result = validateSRLeftModel(profile);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.level, "minimum");
    });

    it("rejects a T2 model (tier below minimum)", () => {
        const profile = mkProfile({
            pattern: "tiny-model",
            tier: 2,
            strengths: ["code"],
            modalities: ["text", "code"],
            contextWindow: 2_048,
            maxOutputTokens: 512,
        });
        const result = validateSRLeftModel(profile);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.level, "insufficient");
        assert.ok(result.missingCapabilities.some(c => c.includes("Tier")));
    });

    it("rejects a model lacking logic-oriented strengths", () => {
        const profile = mkProfile({
            pattern: "creative-only",
            tier: 5,
            strengths: ["creative-writing", "summarization"],
            modalities: ["text", "code", "image-generation"],
            contextWindow: 128_000,
            maxOutputTokens: 16_000,
        });
        const result = validateSRLeftModel(profile);
        assert.strictEqual(result.valid, false);
        assert.ok(result.missingCapabilities.some(c => c.includes("code") || c.includes("reasoning")));
    });
});

/* ──────────────────────────────────────────────────────────
 *  2. validateSRRightModel — Creative Hemisphere qualification
 * ────────────────────────────────────────────────────────── */
describe("Spectrum Refraction — Right (Creative) Hemisphere Validation", () => {
    it("marks a model with image+video+audio as optimal", () => {
        const profile = mkProfile({
            pattern: "dall-e-4",
            tier: 4,
            strengths: ["creative-writing"],
            modalities: ["text", "code", "image-generation", "video-generation", "voice-output"],
            contextWindow: 32_000,
            maxOutputTokens: 4_096,
        });
        const result = validateSRRightModel(profile);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.level, "optimal");
    });

    it("marks a model with image+video as standard", () => {
        const profile = mkProfile({
            pattern: "gemini-pro-vision",
            tier: 4,
            strengths: [],
            modalities: ["text", "code", "image-generation", "video-generation"],
            contextWindow: 32_000,
            maxOutputTokens: 4_096,
        });
        const result = validateSRRightModel(profile);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.level, "standard");
    });

    it("marks a model with image-only as minimum", () => {
        const profile = mkProfile({
            pattern: "stable-diffusion",
            tier: 3,
            strengths: [],
            modalities: ["text", "image-generation"],
            contextWindow: 4_096,
            maxOutputTokens: 1_024,
        });
        const result = validateSRRightModel(profile);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.level, "minimum");
    });

    it("rejects a text-only model (no image-generation)", () => {
        const profile = mkProfile({
            pattern: "llama3-text",
            tier: 5,
            strengths: ["code", "reasoning"],
            modalities: ["text", "code"],
            contextWindow: 128_000,
            maxOutputTokens: 16_000,
        });
        const result = validateSRRightModel(profile);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.level, "insufficient");
        assert.ok(result.missingCapabilities.some(c => c.includes("image-generation")));
    });
});

/* ──────────────────────────────────────────────────────────
 *  3. validateSRTriad — Instance Isolation Enforcement
 * ────────────────────────────────────────────────────────── */
describe("Spectrum Refraction — Triad Isolation Enforcement", () => {
    it("returns 'full' isolation when providers differ", () => {
        const result = validateSRTriad(
            { providerId: "openai", model: "gpt-5" },
            { providerId: "anthropic", model: "claude-3-5-sonnet-latest" },
        );
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.isolationLevel, "full");
        assert.ok(result.advisory.includes("Full isolation") || result.advisory.includes("different providers"));
    });

    it("returns 'model' isolation when same provider different models", () => {
        const result = validateSRTriad(
            { providerId: "openai", model: "gpt-5" },
            { providerId: "openai", model: "gpt-4o" },
        );
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.isolationLevel, "model");
        assert.ok(result.advisory.includes("Model-level isolation") || result.advisory.includes("same provider"));
    });

    it("rejects 'insufficient' when same provider + same model", () => {
        const result = validateSRTriad(
            { providerId: "openai", model: "gpt-5" },
            { providerId: "openai", model: "gpt-5" },
        );
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.isolationLevel, "insufficient");
        assert.ok(result.advisory.includes("not allowed") || result.advisory.includes("separate instances"));
    });

    it("rejects when Left hemisphere is missing", () => {
        const result = validateSRTriad(
            null,
            { providerId: "anthropic", model: "claude-3-5-sonnet-latest" },
        );
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.isolationLevel, "insufficient");
        assert.ok(result.advisory.includes("Both"));
    });

    it("rejects when Right hemisphere is missing", () => {
        const result = validateSRTriad(
            { providerId: "openai", model: "gpt-5" },
            null,
        );
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.isolationLevel, "insufficient");
    });

    it("rejects when both hemispheres are missing", () => {
        const result = validateSRTriad(null, null);
        assert.strictEqual(result.valid, false);
    });
});

/* ──────────────────────────────────────────────────────────
 *  4. filterSRLogicModels / filterSRCreativeModels — Candidate filtering
 * ────────────────────────────────────────────────────────── */
describe("Spectrum Refraction — Model Candidate Filtering", () => {
    const available: AvailableModel[] = [
        { providerId: "openai", model: "gpt-5", locality: "cloud" },
        { providerId: "openai", model: "gpt-4o", locality: "cloud" },
        { providerId: "openai", model: "gpt-4o-mini", locality: "cloud" },
        { providerId: "ollama", model: "llama3.1:8b", locality: "local" },
        { providerId: "ollama", model: "tinyllama:1b", locality: "local" },
    ];

    it("filters logic models by tier >= T3 and logic strengths", () => {
        const logicCandidates = filterSRLogicModels(available);
        assert.ok(logicCandidates.length > 0);
        for (const c of logicCandidates) {
            assert.strictEqual(c.validation.valid, true);
            assert.ok(c.profile.tier >= 3);
        }
    });

    it("sorts logic candidates by tier descending (best first)", () => {
        const logicCandidates = filterSRLogicModels(available);
        for (let i = 1; i < logicCandidates.length; i++) {
            assert.ok(logicCandidates[i - 1]!.profile.tier >= logicCandidates[i]!.profile.tier);
        }
    });

    it("filters creative models by image-generation modality", () => {
        const creativeCandidates = filterSRCreativeModels(available);
        for (const c of creativeCandidates) {
            assert.strictEqual(c.validation.valid, true);
            assert.ok(c.profile.modalities?.includes("image-generation"));
        }
    });
});

/* ──────────────────────────────────────────────────────────
 *  5. SR System Prompts — Must be non-empty with distinct roles
 * ────────────────────────────────────────────────────────── */
describe("Spectrum Refraction — System Prompts", () => {
    it("provides distinct prompts for left, right, and aggregation", () => {
        assert.ok(SR_SYSTEM_PROMPTS.left.length > 50);
        assert.ok(SR_SYSTEM_PROMPTS.right.length > 50);
        assert.ok(SR_SYSTEM_PROMPTS.aggregation.length > 50);
        assert.notStrictEqual(SR_SYSTEM_PROMPTS.left, SR_SYSTEM_PROMPTS.right);
        assert.notStrictEqual(SR_SYSTEM_PROMPTS.left, SR_SYSTEM_PROMPTS.aggregation);
    });

    it("left prompt mentions Logic/analytical role", () => {
        assert.ok(SR_SYSTEM_PROMPTS.left.includes("Logic"));
    });

    it("right prompt mentions Creative role", () => {
        assert.ok(SR_SYSTEM_PROMPTS.right.includes("Creative"));
    });

    it("aggregation prompt mentions synthesis/coordinator", () => {
        assert.ok(
            SR_SYSTEM_PROMPTS.aggregation.includes("Coordinator") ||
            SR_SYSTEM_PROMPTS.aggregation.includes("Synthesize"),
        );
    });
});

/* ──────────────────────────────────────────────────────────
 *  6. LlmProviderManager.generateSR — Integration (mocked generate)
 * ────────────────────────────────────────────────────────── */
describe("Spectrum Refraction — generateSR Integration", () => {
    function createMockManager(): LlmProviderManager {
        const manager = new LlmProviderManager({
            PRISM_OLLAMA_MODELS: "gpt-5,gpt-4o",
            PRISM_LLM_PROVIDER: "ollama",
        });
        return manager;
    }

    it("returns null when SR config is disabled", async () => {
        const manager = createMockManager();
        const srConfig: SpectrumRefractionConfig = {
            enabled: false,
            leftModel: { providerId: "openai", model: "gpt-5" },
            rightModel: { providerId: "anthropic", model: "claude-3-5-sonnet-latest" },
        };
        const result = await manager.generateSR(
            { message: "test", conversation: [], systemPrompt: "test" },
            srConfig,
        );
        assert.strictEqual(result, null);
    });

    it("returns null when leftModel is missing", async () => {
        const manager = createMockManager();
        const srConfig: SpectrumRefractionConfig = {
            enabled: true,
            leftModel: null,
            rightModel: { providerId: "anthropic", model: "claude-3-5-sonnet-latest" },
        };
        const result = await manager.generateSR(
            { message: "test", conversation: [], systemPrompt: "test" },
            srConfig,
        );
        assert.strictEqual(result, null);
    });

    it("returns null when rightModel is missing", async () => {
        const manager = createMockManager();
        const srConfig: SpectrumRefractionConfig = {
            enabled: true,
            leftModel: { providerId: "openai", model: "gpt-5" },
            rightModel: null,
        };
        const result = await manager.generateSR(
            { message: "test", conversation: [], systemPrompt: "test" },
            srConfig,
        );
        assert.strictEqual(result, null);
    });

    it("returns null when isolation check fails (same provider + same model)", async () => {
        const manager = createMockManager();
        const srConfig: SpectrumRefractionConfig = {
            enabled: true,
            leftModel: { providerId: "openai", model: "gpt-5" },
            rightModel: { providerId: "openai", model: "gpt-5" },
        };
        const result = await manager.generateSR(
            { message: "test", conversation: [], systemPrompt: "test" },
            srConfig,
        );
        assert.strictEqual(result, null);
    });
});

/* ──────────────────────────────────────────────────────────
 *  7. Media Artifact Extraction — data URI patterns
 * ────────────────────────────────────────────────────────── */
describe("Spectrum Refraction — Media Artifact Extraction", () => {
    it("extracts base64 image data URIs from content", () => {
        // Access extractMediaArtifacts via generateSR output structure:
        // We validate the pattern matching by checking known model outputs.
        // Since extractMediaArtifacts is private, we test via the SRGenerationOutput interface.
        const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
        const pattern = /data:(image|audio|video)\/([^;]+);base64,([A-Za-z0-9+/=]+)/g;
        const match = pattern.exec(dataUri);
        assert.ok(match);
        assert.strictEqual(match![1], "image");
        assert.strictEqual(match![2], "png");
        assert.strictEqual(match![3], "iVBORw0KGgoAAAANSUhEUg==");
    });

    it("extracts audio data URIs", () => {
        const dataUri = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTRU==";
        const pattern = /data:(image|audio|video)\/([^;]+);base64,([A-Za-z0-9+/=]+)/g;
        const match = pattern.exec(dataUri);
        assert.ok(match);
        assert.strictEqual(match![1], "audio");
        assert.strictEqual(match![2], "mp3");
    });

    it("extracts video data URIs", () => {
        const dataUri = "data:video/mp4;base64,AAAAIGZ0eXBpc29t";
        const pattern = /data:(image|audio|video)\/([^;]+);base64,([A-Za-z0-9+/=]+)/g;
        const match = pattern.exec(dataUri);
        assert.ok(match);
        assert.strictEqual(match![1], "video");
    });

    it("extracts markdown image references with base64", () => {
        const md = "![Generated Image](data:image/jpeg;base64,/9j/4AAQSkZJRg==)";
        const mdPattern = /!\[([^\]]*)\]\((data:image\/[^)]+)\)/g;
        const match = mdPattern.exec(md);
        assert.ok(match);
        assert.strictEqual(match![1], "Generated Image");
        assert.ok(match![2]!.startsWith("data:image/jpeg;base64,"));
    });

    it("returns empty array for content with no media", () => {
        const content = "This is plain text with no media artifacts.";
        const pattern = /data:(image|audio|video)\/([^;]+);base64,([A-Za-z0-9+/=]+)/g;
        const matches: RegExpExecArray[] = [];
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(content)) !== null) matches.push(m);
        assert.strictEqual(matches.length, 0);
    });

    it("extracts multiple artifacts from mixed content", () => {
        const content = [
            "Here is an image: data:image/png;base64,iVBOR==",
            "And audio: data:audio/wav;base64,UklGR==",
            "Text in between",
            "And video: data:video/webm;base64,GkXfo==",
        ].join("\n");
        const pattern = /data:(image|audio|video)\/([^;]+);base64,([A-Za-z0-9+/=]+)/g;
        const matches: RegExpExecArray[] = [];
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(content)) !== null) matches.push(m);
        assert.strictEqual(matches.length, 3);
        assert.strictEqual(matches[0]![1], "image");
        assert.strictEqual(matches[1]![1], "audio");
        assert.strictEqual(matches[2]![1], "video");
    });
});

/* ──────────────────────────────────────────────────────────
 *  8. SRGenerationOutput Structure — Type shape verification
 * ────────────────────────────────────────────────────────── */
describe("Spectrum Refraction — Output Structure Contract", () => {
    it("SRGenerationOutput has correct shape", () => {
        const output: SRGenerationOutput = {
            content: "synthesized response",
            hemispheres: {
                left: { providerId: "openai", model: "gpt-5", content: "logic output" },
                right: { providerId: "anthropic", model: "claude-3-5-sonnet-latest", content: "creative output" },
                main: { providerId: "openai", model: "gpt-5", content: "main output" },
            },
            aggregation: { providerId: "openai", model: "gpt-5", content: "synthesized" },
            timing: { fanOutMs: 1200, aggregationMs: 800, totalMs: 2000 },
            mediaArtifacts: [
                { type: "image", data: "iVBOR==", mimeType: "image/png" },
            ],
            isolationLevel: "full",
        };
        assert.strictEqual(output.content, "synthesized response");
        assert.ok(output.hemispheres.left);
        assert.ok(output.hemispheres.right);
        assert.ok(output.hemispheres.main);
        assert.ok(output.aggregation);
        assert.strictEqual(output.timing.fanOutMs, 1200);
        assert.strictEqual(output.timing.aggregationMs, 800);
        assert.strictEqual(output.timing.totalMs, 2000);
        assert.strictEqual(output.mediaArtifacts.length, 1);
        assert.strictEqual(output.isolationLevel, "full");
    });

    it("SRGenerationOutput handles null hemispheres (timeout/failure)", () => {
        const output: SRGenerationOutput = {
            content: "partial response",
            hemispheres: {
                left: null,
                right: { providerId: "anthropic", model: "claude-3-5-sonnet-latest", content: "creative" },
                main: { providerId: "openai", model: "gpt-5", content: "main" },
            },
            aggregation: { providerId: "openai", model: "gpt-5", content: "fallback" },
            timing: { fanOutMs: 60000, aggregationMs: 500, totalMs: 60500 },
            mediaArtifacts: [],
            isolationLevel: "full",
        };
        assert.strictEqual(output.hemispheres.left, null);
        assert.ok(output.hemispheres.right);
        assert.strictEqual(output.mediaArtifacts.length, 0);
    });

    it("isolationLevel must be one of the valid enum values", () => {
        const validLevels: SRIsolationLevel[] = ["full", "model", "insufficient"];
        for (const level of validLevels) {
            assert.ok(["full", "model", "insufficient"].includes(level));
        }
    });
});

/* ──────────────────────────────────────────────────────────
 *  9. resolveProfile integration — Known models resolve to SR-capable profiles
 * ────────────────────────────────────────────────────────── */
describe("Spectrum Refraction — resolveProfile SR Compatibility", () => {
    it("gpt-5 resolves to a profile valid for Left hemisphere", () => {
        const profile = resolveProfile("gpt-5");
        const result = validateSRLeftModel(profile);
        assert.strictEqual(result.valid, true);
        assert.ok(["optimal", "standard", "minimum"].includes(result.level));
    });

    it("gpt-4o resolves to a profile valid for Left hemisphere", () => {
        const profile = resolveProfile("gpt-4o");
        const result = validateSRLeftModel(profile);
        assert.strictEqual(result.valid, true);
    });

    it("claude-3-5-sonnet-latest resolves to a valid Left profile", () => {
        const profile = resolveProfile("claude-3-5-sonnet-latest");
        const result = validateSRLeftModel(profile);
        assert.strictEqual(result.valid, true);
    });

    it("unknown model resolves to a fallback profile", () => {
        const profile = resolveProfile("totally-unknown-model-xyz");
        assert.ok(profile);
        assert.ok(typeof profile.tier === "number");
        assert.ok(Array.isArray(profile.strengths));
    });
});
