import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    resolveProfile,
    getKnownProfiles,
    getDeprecationStatus,
    getActiveProfiles,
    getDeprecatedProfiles,
    resolvePromptStrategy,
    getModelFamily,
    getKinshipScore,
    validateSRTriad,
} from "../src/core/operator/model-capability-matrix.js";

describe("Model Capability Matrix — August 2026 Frontier Updates", () => {
    describe("Google Gemini Additions", () => {
        it("resolves Gemini 3.7 Flash as Tier 5 frontier workhorse", () => {
            const p = resolveProfile("gemini-3.7-flash");
            assert.equal(p.tier, 5);
            assert.equal(p.contextWindow, 2000000);
            assert.equal(p.maxOutputTokens, 32768);
            assert.ok(p.strengths.includes("agentic"));
            assert.ok(p.strengths.includes("fast"));
            assert.ok(p.strengths.includes("code"));
            assert.equal(p.locality, "cloud");
        });

        it("resolves Gemini 3.6 Flash as Tier 4", () => {
            const p = resolveProfile("gemini-3.6-flash");
            assert.equal(p.tier, 4);
            assert.equal(p.contextWindow, 2000000);
        });

        it("resolves Gemini Omni 1.1 Flash with video generation modality", () => {
            const p = resolveProfile("gemini-omni-1.1-flash");
            assert.equal(p.tier, 4);
            assert.ok(p.modalities.includes("video-generation"));
            assert.ok(p.modalities.includes("video-understanding"));
        });

        it("resolves Gemini 3.5 Transcribe with STT modality", () => {
            const p = resolveProfile("gemini-3.5-transcribe");
            assert.equal(p.tier, 2);
            assert.ok(p.modalities.includes("stt"));
        });
    });

    describe("OpenAI GPT-5.6 Family Additions", () => {
        it("resolves GPT-5.6 Sol as Tier 5 frontier flagship", () => {
            const p = resolveProfile("gpt-5.6-sol");
            assert.equal(p.tier, 5);
            assert.equal(p.contextWindow, 256000);
            assert.equal(p.maxOutputTokens, 32768);
            assert.ok(p.strengths.includes("agentic"));
            assert.ok(p.strengths.includes("reasoning"));
        });

        it("resolves GPT-5.6 Terra as Tier 4 balanced", () => {
            const p = resolveProfile("gpt-5.6-terra");
            assert.equal(p.tier, 4);
            assert.equal(p.contextWindow, 256000);
        });

        it("resolves GPT-5.6 Luna as Tier 3 cost-effective", () => {
            const p = resolveProfile("gpt-5.6-luna");
            assert.equal(p.tier, 3);
            assert.equal(p.contextWindow, 128000);
            assert.ok(p.strengths.includes("fast"));
        });

        it("resolves o3-pro with proper deprecation status", () => {
            const p = resolveProfile("o3-pro");
            assert.equal(p.tier, 5);
            assert.equal(p.deprecated, true);
            assert.equal(p.successor, "gpt-5.6-sol");
        });
    });

    describe("Anthropic Claude 5-Series & Deprecations", () => {
        it("resolves Claude Fable 5 as Tier 5", () => {
            const p = resolveProfile("claude-fable-5");
            assert.equal(p.tier, 5);
            assert.equal(p.contextWindow, 1000000);
            assert.equal(p.maxOutputTokens, 128000);
        });

        it("resolves Claude Opus 5 as Tier 5", () => {
            const p = resolveProfile("claude-opus-5");
            assert.equal(p.tier, 5);
            assert.equal(p.contextWindow, 1000000);
        });

        it("resolves Claude Sonnet 5 as Tier 4", () => {
            const p = resolveProfile("claude-sonnet-5");
            assert.equal(p.tier, 4);
            assert.equal(p.contextWindow, 1000000);
        });

        it("resolves Claude Mythos 5 with benchmark note", () => {
            const p = resolveProfile("claude-mythos-5");
            assert.equal(p.tier, 5);
            assert.equal(p.contextWindow, 1000000);
        });

        it("marks Claude 4-series as deprecated with Claude 5 successor", () => {
            const opus4 = resolveProfile("claude-opus-4-8");
            assert.equal(opus4.deprecated, true);
            assert.equal(opus4.successor, "claude-opus-5");
            assert.equal(getDeprecationStatus(opus4), "deprecated");

            const sonnet4 = resolveProfile("claude-sonnet-4-6");
            assert.equal(sonnet4.deprecated, true);
            assert.equal(sonnet4.successor, "claude-sonnet-5");
        });
    });

    describe("xAI Grok Additions", () => {
        it("resolves Grok 4.6 as Tier 5 flagship", () => {
            const p = resolveProfile("grok-4.6");
            assert.equal(p.tier, 5);
            assert.equal(p.contextWindow, 500000);
            assert.equal(p.maxOutputTokens, 32768);
            assert.ok(p.strengths.includes("agentic"));
        });

        it("resolves Grok 4.3 as Tier 4 with 1M context", () => {
            const p = resolveProfile("grok-4.3");
            assert.equal(p.tier, 4);
            assert.equal(p.contextWindow, 1000000);
        });

        it("resolves Grok 4.1 Fast as Tier 3 with 2M context", () => {
            const p = resolveProfile("grok-4.1-fast");
            assert.equal(p.tier, 3);
            assert.equal(p.contextWindow, 2000000);
            assert.ok(p.strengths.includes("fast"));
        });

        it("resolves Grok prompt strategy properly", () => {
            const strategy = resolvePromptStrategy("grok-4.6");
            assert.equal(strategy.label, "xAI Grok");
            assert.equal(strategy.structureFormat, "markdown");
            assert.equal(strategy.chainOfThoughtMode, "explicit");
        });
    });

    describe("Meta, DeepSeek, Mistral, Qwen, Cohere Frontier Additions", () => {
        it("resolves Llama 4 Scout with 10M context", () => {
            const p = resolveProfile("llama-4-scout");
            assert.equal(p.tier, 4);
            assert.equal(p.contextWindow, 10000000);
        });

        it("resolves DeepSeek V4 Pro as Tier 5", () => {
            const p = resolveProfile("deepseek-v4-pro");
            assert.equal(p.tier, 5);
            assert.equal(p.contextWindow, 1000000);
            assert.equal(p.maxOutputTokens, 32768);
        });

        it("resolves Mistral Large 3 as Tier 5", () => {
            const p = resolveProfile("mistral-large-3");
            assert.equal(p.tier, 5);
            assert.equal(p.contextWindow, 262144);
        });

        it("resolves Qwen 3.8 Max as Tier 5", () => {
            const p = resolveProfile("qwen3.8-max");
            assert.equal(p.tier, 5);
            assert.equal(p.contextWindow, 262144);
        });

        it("resolves Command A+ as Tier 4 MoE", () => {
            const p = resolveProfile("command-a-plus");
            assert.equal(p.tier, 4);
            assert.equal(p.contextWindow, 256000);
        });
    });

    describe("Model Families & Kinship Scoring", () => {
        it("identifies model families correctly", () => {
            assert.equal(getModelFamily("gpt-5.6-sol"), "gpt");
            assert.equal(getModelFamily("claude-fable-5"), "claude");
            assert.equal(getModelFamily("gemini-3.7-flash"), "gemini");
            assert.equal(getModelFamily("grok-4.6"), "grok");
            assert.equal(getModelFamily("llama-4-scout"), "llama");
            assert.equal(getModelFamily("deepseek-v4-pro"), "deepseek");
            assert.equal(getModelFamily("mistral-large-3"), "mistral");
            assert.equal(getModelFamily("qwen3.8-max"), "qwen");
            assert.equal(getModelFamily("command-a-plus"), "cohere");
            assert.equal(getModelFamily("muse-glimmer"), "muse");
        });

        it("calculates kinship scores accurately", () => {
            assert.equal(getKinshipScore("gpt-5.6-sol", "gpt-5.6-terra"), 1.0);
            assert.equal(getKinshipScore("grok-4.6", "grok-4.3"), 1.0);
            assert.equal(getKinshipScore("llama-4-scout", "muse-glimmer"), 0.75);
            assert.equal(getKinshipScore("gpt-5.6-sol", "claude-opus-5"), 0.0);
            assert.equal(getKinshipScore("gemini-3.7-flash", "grok-4.6"), 0.0);
        });

        it("validates Spectrum Refraction triad between different families", () => {
            const result = validateSRTriad(
                { providerId: "google", model: "gemini-3.7-flash" },
                { providerId: "anthropic", model: "claude-sonnet-5" }
            );
            assert.equal(result.valid, true);
            assert.equal(result.isolationLevel, "full");
        });
    });
});
