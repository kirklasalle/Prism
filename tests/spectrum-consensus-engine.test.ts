import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { SpectrumConsensusEngine } from "../src/core/operator/spectrum-consensus-engine.js";

describe("Spectrum Refraction 2.0 — Consensus & Discrepancy Engine", () => {
    let engine: SpectrumConsensusEngine;

    beforeEach(() => {
        engine = new SpectrumConsensusEngine();
    });

    it("calculates semantic similarity correctly", () => {
        const text1 = "The quick brown fox jumps over the lazy dog";
        const text2 = "The fast brown fox leaps over a lazy hound";
        const sim = engine.computeSimilarity(text1, text2);
        assert.ok(sim > 0.3 && sim < 1.0);

        const identical = engine.computeSimilarity("exact match words", "exact match words");
        assert.equal(identical, 1.0);

        const disjoint = engine.computeSimilarity("apple banana orange", "quantum mechanics gravity");
        assert.equal(disjoint, 0.0);
    });

    it("synthesizes harmonious tri-model responses with high consensus", () => {
        const input = {
            leftHemisphere: {
                modelId: "claude-3-7-sonnet",
                providerId: "anthropic",
                content: "To build a secure web application, implement strict CSP headers and validate authentication tokens.",
                latencyMs: 320,
            },
            rightHemisphere: {
                modelId: "gpt-4o",
                providerId: "openai",
                content: "Security requires configuring strong CSP headers and rigorously validating auth tokens on every request.",
                latencyMs: 290,
            },
            mainCoordinator: {
                modelId: "gemini-2-5-pro",
                providerId: "google",
                content: "Comprehensive web security entails robust CSP header configurations and verified authentication tokens.",
                latencyMs: 340,
            },
        };

        const result = engine.synthesize(input);

        assert.ok(result.consensusScore >= 0.5);
        assert.equal(result.isolatedHemispheresCount, 3);
        assert.equal(result.totalLatencyMs, 340);
        assert.ok(result.synthesizedContent.includes("CSP header"));
        assert.ok(result.auditProof.startsWith("SPECTRUM-SYNTH-"));
    });

    it("detects divergence and triggers bias cancellation", () => {
        const input = {
            leftHemisphere: {
                modelId: "claude-3-7-sonnet",
                providerId: "anthropic",
                content: "The optimal strategy is deterministic functional programming and immutable data stores.",
                latencyMs: 250,
            },
            rightHemisphere: {
                modelId: "gpt-4o",
                providerId: "openai",
                content: "Dynamic micro-frameworks and rapid prototype iteration provide maximum organizational agility.",
                latencyMs: 260,
            },
            mainCoordinator: {
                modelId: "gemini-2-5-pro",
                providerId: "google",
                content: "A balanced architecture leverages functional core principles with agile service boundaries.",
                latencyMs: 310,
            },
        };

        const result = engine.synthesize(input);

        assert.ok(result.discrepancies.length > 0);
        assert.equal(result.biasCancellationApplied, true);
        assert.equal(result.discrepancies[0].topic, "Analytical vs Creative Synthesis Divergence");
    });

    it("evaluates offline SLM survival route properly", () => {
        const offlineRoute = engine.evaluateSurvivalRoute(false);
        assert.equal(offlineRoute.mode, "offline_survival");
        assert.equal(offlineRoute.activeProvider, "ollama");
        assert.equal(offlineRoute.airGapped, true);

        const onlineRoute = engine.evaluateSurvivalRoute(true);
        assert.equal(onlineRoute.mode, "cloud_spectrum");
        assert.equal(onlineRoute.airGapped, false);
    });
});
