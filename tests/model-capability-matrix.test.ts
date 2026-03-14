import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    resolveProfile,
    selectModelForRole,
    buildAdaptiveParams,
    buildAdaptiveSystemPrompt,
    getRoleRequirements,
    tierLabel,
    getKnownProfiles,
    ALL_TASK_ROLES,
} from "../src/core/operator/model-capability-matrix.js";
import type {
    AvailableModel,
    TaskRole,
    ModelCapabilityProfile,
} from "../src/core/operator/model-capability-matrix.js";

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

describe("resolveProfile", () => {
    it("returns exact match for known Ollama models", () => {
        const p = resolveProfile("gemma3:1b");
        assert.equal(p.tier, 1);
        assert.equal(p.parametersBillions, 1);
        assert.equal(p.locality, "local");
    });

    it("returns exact match for cloud models", () => {
        const p = resolveProfile("gpt-4o");
        assert.equal(p.tier, 4);
        assert.equal(p.locality, "cloud");
        assert.ok(p.strengths.includes("reasoning"));
    });

    it("matches by prefix for versioned model names", () => {
        const p = resolveProfile("claude-3-5-sonnet-20241022");
        assert.equal(p.tier, 4);
        assert.equal(p.locality, "cloud");
    });

    it("infers profile from :NB pattern for unknown models", () => {
        const p = resolveProfile("some-new-model:7b");
        assert.equal(p.tier, 3);
        assert.equal(p.parametersBillions, 7);
        assert.equal(p.parameterSize, "medium");
    });

    it("infers tiny profile for unknown :1.5b models", () => {
        const p = resolveProfile("custom:1.5b");
        assert.equal(p.tier, 1);
        assert.equal(p.parametersBillions, 1.5);
    });

    it("returns cloud T3 default for completely unknown models", () => {
        const p = resolveProfile("mystery-model");
        assert.equal(p.tier, 3);
        assert.equal(p.locality, "cloud");
    });

    it("matches tinyllama without tag", () => {
        const p = resolveProfile("tinyllama:latest");
        assert.equal(p.tier, 1);
        assert.equal(p.parametersBillions, 1.1);
    });

    it("matches driaforall/tiny-agent-a:1.5b", () => {
        const p = resolveProfile("driaforall/tiny-agent-a:1.5b");
        assert.equal(p.tier, 1);
        assert.ok(p.strengths.includes("tool-use"));
    });
});

// ---------------------------------------------------------------------------
// selectModelForRole
// ---------------------------------------------------------------------------

describe("selectModelForRole", () => {
    const localModels: AvailableModel[] = [
        { providerId: "ollama", model: "gemma3:1b", locality: "local" },
        { providerId: "ollama", model: "llama3.2:3b", locality: "local" },
    ];

    const cloudModels: AvailableModel[] = [
        { providerId: "openai", model: "gpt-4o", locality: "cloud" },
        { providerId: "anthropic", model: "claude-3-5-sonnet", locality: "cloud" },
    ];

    const mixedModels: AvailableModel[] = [...localModels, ...cloudModels];

    it("selects T1 local model for classification when only local available", () => {
        const result = selectModelForRole("classification", localModels);
        assert.ok(result);
        assert.equal(result.model, "llama3.2:3b"); // T2 meets ideal T2
        assert.equal(result.degraded, false);
    });

    it("returns null for empty model list", () => {
        const result = selectModelForRole("chat", []);
        assert.equal(result, null);
    });

    it("prefers local model when it meets ideal tier", () => {
        const models: AvailableModel[] = [
            { providerId: "ollama", model: "llama3.1:8b", locality: "local" },
            { providerId: "openai", model: "gpt-4o", locality: "cloud" },
        ];
        // For chat: idealTier=3. llama3.1:8b is T3 local, gpt-4o is T4 cloud
        const result = selectModelForRole("chat", models);
        assert.ok(result);
        assert.equal(result.model, "llama3.1:8b");
        assert.equal(result.degraded, false);
    });

    it("falls back to cloud when no local meets ideal", () => {
        const result = selectModelForRole("tool-selection", localModels);
        // tool-selection idealTier=4 — no local T4 available, so falls back
        // No cloud either, so it degrades to best local
        assert.ok(result);
        assert.equal(result.degraded, true);
    });

    it("selects cloud for tool-selection in mixed pool", () => {
        const result = selectModelForRole("tool-selection", mixedModels);
        assert.ok(result);
        // gpt-4o or claude-3-5-sonnet both T4, meets ideal
        assert.equal(result.profile.tier, 4);
        assert.equal(result.degraded, false);
    });

    it("reports degraded when only T1 available for code-generation", () => {
        const tinyOnly: AvailableModel[] = [
            { providerId: "ollama", model: "gemma3:1b", locality: "local" },
        ];
        const result = selectModelForRole("code-generation", tinyOnly);
        assert.ok(result);
        assert.equal(result.degraded, true);
        assert.ok(result.reason.includes("degraded") || result.reason.includes("not met") || result.reason.includes("below ideal"));
    });
});

// ---------------------------------------------------------------------------
// buildAdaptiveParams
// ---------------------------------------------------------------------------

describe("buildAdaptiveParams", () => {
    it("returns tight params for T1 models", () => {
        const profile = resolveProfile("gemma3:1b");
        const params = buildAdaptiveParams(profile);
        assert.equal(params.numCtx, 2048);
        assert.equal(params.numPredict, 256);
        assert.equal(params.conversationWindow, 6);
    });

    it("returns generous params for T4 models", () => {
        const profile = resolveProfile("gpt-4o");
        const params = buildAdaptiveParams(profile);
        assert.equal(params.numCtx, 32000);
        assert.equal(params.conversationWindow, 30);
    });

    it("returns maximum params for T5 models", () => {
        const profile = resolveProfile("gpt-5");
        const params = buildAdaptiveParams(profile);
        assert.equal(params.numCtx, 64000);
        assert.equal(params.numPredict, 8192);
        assert.equal(params.conversationWindow, 50);
    });
});

// ---------------------------------------------------------------------------
// buildAdaptiveSystemPrompt
// ---------------------------------------------------------------------------

describe("buildAdaptiveSystemPrompt", () => {
    it("returns minimal prompt for T1 models", () => {
        const profile = resolveProfile("gemma3:1b");
        const prompt = buildAdaptiveSystemPrompt(profile);
        assert.ok(prompt.length < 100);
        assert.ok(prompt.includes("PRISM"));
    });

    it("returns compact prompt for T2 models", () => {
        const profile = resolveProfile("llama3.2:3b");
        const prompt = buildAdaptiveSystemPrompt(profile);
        assert.ok(prompt.includes("agent runtime"));
        assert.ok(prompt.length < 300);
    });

    it("returns full prompt for T4+ models", () => {
        const profile = resolveProfile("gpt-4o");
        const prompt = buildAdaptiveSystemPrompt(profile);
        assert.ok(prompt.includes("autonomous agent runtime"));
        assert.ok(prompt.includes("governed"));
    });

    it("appends runtime context for T2+ models", () => {
        const profile = resolveProfile("gpt-4o");
        const prompt = buildAdaptiveSystemPrompt(profile, { mode: "autonomous", pendingApprovals: 3 });
        assert.ok(prompt.includes("autonomous"));
        assert.ok(prompt.includes("Pending approvals: 3"));
    });

    it("does NOT append runtime context for T1 models", () => {
        const profile = resolveProfile("gemma3:1b");
        const prompt = buildAdaptiveSystemPrompt(profile, { mode: "autonomous" });
        assert.ok(!prompt.includes("autonomous"));
    });
});

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

describe("utility exports", () => {
    it("tierLabel returns correct labels", () => {
        assert.equal(tierLabel(1), "T1 Minimal");
        assert.equal(tierLabel(5), "T5 Frontier");
    });

    it("getRoleRequirements returns correct requirements", () => {
        const r = getRoleRequirements("tool-selection");
        assert.equal(r.minimumTier, 3);
        assert.equal(r.idealTier, 4);
    });

    it("ALL_TASK_ROLES has all roles", () => {
        assert.ok(ALL_TASK_ROLES.length >= 6);
        assert.ok(ALL_TASK_ROLES.includes("classification"));
        assert.ok(ALL_TASK_ROLES.includes("code-generation"));
    });

    it("getKnownProfiles returns non-empty array", () => {
        const profiles = getKnownProfiles();
        assert.ok(profiles.length >= 20);
    });
});
