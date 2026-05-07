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
    matchesVersionConstraint,
    registerModelProfile,
    removeModelProfile,
    getDeprecationStatus,
    getDeprecationWarning,
    getActiveProfiles,
    getDeprecatedProfiles,
    resolvePromptStrategy,
    PROVIDER_PROMPT_STRATEGIES,
} from "../src/core/operator/model-capability-matrix.js";
import type {
    AvailableModel,
    TaskRole,
    ModelCapabilityProfile,
    DeprecationStatus,
    ProviderPromptStrategy,
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
        assert.ok(prompt.length < 300);
        assert.ok(prompt.includes("PRISM"));
    });

    it("returns compact prompt for T2 models", () => {
        const profile = resolveProfile("llama3.2:3b");
        const prompt = buildAdaptiveSystemPrompt(profile);
        assert.ok(prompt.includes("agent runtime"));
        assert.ok(prompt.includes("GOVERNANCE"));
        assert.ok(prompt.length < 600);
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

// ---------------------------------------------------------------------------
// matchesVersionConstraint
// ---------------------------------------------------------------------------

describe("matchesVersionConstraint", () => {
    it("matches exact version", () => {
        assert.equal(matchesVersionConstraint("20241022", "=20241022"), true);
        assert.equal(matchesVersionConstraint("20241022", "20241022"), true);
    });

    it("rejects non-matching exact version", () => {
        assert.equal(matchesVersionConstraint("20241022", "=20240101"), false);
    });

    it("matches >= constraint", () => {
        assert.equal(matchesVersionConstraint("20241022", ">=202401"), true);
        assert.equal(matchesVersionConstraint("20240101", ">=202401"), true);
        assert.equal(matchesVersionConstraint("20231201", ">=202401"), false);
    });

    it("matches < constraint", () => {
        assert.equal(matchesVersionConstraint("20231201", "<202401"), true);
        assert.equal(matchesVersionConstraint("20240101", "<202401"), false);
    });

    it("matches compound constraints (comma-separated)", () => {
        assert.equal(matchesVersionConstraint("20240601", ">=202401,<202501"), true);
        assert.equal(matchesVersionConstraint("20250601", ">=202401,<202501"), false);
    });

    it("returns false for empty/invalid constraint", () => {
        assert.equal(matchesVersionConstraint("20241022", ""), false);
        assert.equal(matchesVersionConstraint("20241022", "invalid"), false);
    });
});

// ---------------------------------------------------------------------------
// Version-aware profile resolution
// ---------------------------------------------------------------------------

describe("version-aware resolveProfile", () => {
    it("prefers longer pattern match over shorter", () => {
        // gpt-4o-mini should match the "gpt-4o-mini" pattern, not "gpt-4o"
        const p = resolveProfile("gpt-4o-mini");
        assert.equal(p.tier, 3); // gpt-4o-mini is T3, gpt-4o is T4
    });

    it("resolves versioned model with version constraint when registered", () => {
        // Register two profiles with version constraints
        registerModelProfile({
            pattern: "test-versioned-model",
            label: "Test Versioned Model (Old)",
            tier: 3,
            parameterSize: "large",
            parametersBillions: 0,
            contextWindow: 32000,
            estimatedVramMb: 0,
            maxOutputTokens: 4096,
            adaptivePromptBudget: 2000,
            strengths: ["instruction-following"],
            modalities: ["text"],
            locality: "cloud",
            versionConstraint: "<202407",
        });
        registerModelProfile({
            pattern: "test-versioned-model-new",
            label: "Test Versioned Model (New)",
            tier: 4,
            parameterSize: "frontier",
            parametersBillions: 0,
            contextWindow: 128000,
            estimatedVramMb: 0,
            maxOutputTokens: 8192,
            adaptivePromptBudget: 4000,
            strengths: ["instruction-following", "reasoning"],
            modalities: ["text", "code"],
            locality: "cloud",
            versionConstraint: ">=202407",
        });

        // Exact match still works
        const pExact = resolveProfile("test-versioned-model");
        assert.equal(pExact.tier, 3);

        // Clean up
        removeModelProfile("test-versioned-model");
        removeModelProfile("test-versioned-model-new");
    });

    it("profiles include optional versionConstraint field", () => {
        const profiles = getKnownProfiles();
        // Built-in profiles may or may not have versionConstraint
        // but the field should be accessible without error
        for (const p of profiles) {
            if (p.versionConstraint) {
                assert.equal(typeof p.versionConstraint, "string");
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Deprecation lifecycle
// ---------------------------------------------------------------------------

describe("getDeprecationStatus", () => {
    const baseProfile: ModelCapabilityProfile = {
        pattern: "test-deprecated-model",
        label: "Test Deprecated",
        tier: 3,
        parameterSize: "large",
        parametersBillions: 0,
        contextWindow: 32000,
        estimatedVramMb: 0,
        maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following"],
        modalities: ["text"],
        locality: "cloud",
    };

    it("returns 'active' for non-deprecated profiles", () => {
        assert.equal(getDeprecationStatus(baseProfile), "active");
    });

    it("returns 'deprecated' when deprecated flag is set", () => {
        const deprecated = { ...baseProfile, deprecated: true, deprecatedAt: "2025-01-01" };
        assert.equal(getDeprecationStatus(deprecated), "deprecated");
    });

    it("returns 'sunset' when sunsetDate is in the past", () => {
        const sunset = { ...baseProfile, deprecated: true, sunsetDate: "2024-01-01" };
        assert.equal(getDeprecationStatus(sunset, new Date("2025-06-01")), "sunset");
    });

    it("returns 'deprecated' when sunsetDate is in the future", () => {
        const deprecated = { ...baseProfile, deprecated: true, sunsetDate: "2099-12-31" };
        assert.equal(getDeprecationStatus(deprecated), "deprecated");
    });
});

describe("getDeprecationWarning", () => {
    const baseProfile: ModelCapabilityProfile = {
        pattern: "test-warn-model",
        label: "Test Warn",
        tier: 3,
        parameterSize: "large",
        parametersBillions: 0,
        contextWindow: 32000,
        estimatedVramMb: 0,
        maxOutputTokens: 4096,
        adaptivePromptBudget: 2000,
        strengths: ["instruction-following"],
        modalities: ["text"],
        locality: "cloud",
    };

    it("returns empty string for active profiles", () => {
        assert.equal(getDeprecationWarning(baseProfile), "");
    });

    it("includes successor info in warning when available", () => {
        const dep = { ...baseProfile, deprecated: true, successor: "test-new-model" };
        const warning = getDeprecationWarning(dep);
        assert.ok(warning.length > 0);
        assert.ok(warning.includes("test-new-model"));
    });
});

describe("getActiveProfiles / getDeprecatedProfiles", () => {
    const profiles: ModelCapabilityProfile[] = [
        {
            pattern: "active-model",
            label: "Active",
            tier: 3,
            parameterSize: "large",
            parametersBillions: 0,
            contextWindow: 32000,
            estimatedVramMb: 0,
            maxOutputTokens: 4096,
            adaptivePromptBudget: 2000,
            strengths: [],
            modalities: ["text"],
            locality: "cloud",
        },
        {
            pattern: "deprecated-model",
            label: "Deprecated",
            tier: 3,
            parameterSize: "large",
            parametersBillions: 0,
            contextWindow: 32000,
            estimatedVramMb: 0,
            maxOutputTokens: 4096,
            adaptivePromptBudget: 2000,
            strengths: [],
            modalities: ["text"],
            locality: "cloud",
            deprecated: true,
        },
    ];

    it("getActiveProfiles filters to only active models", () => {
        const active = getActiveProfiles(profiles);
        assert.equal(active.length, 1);
        assert.equal(active[0].pattern, "active-model");
    });

    it("getDeprecatedProfiles filters to only deprecated models", () => {
        const deprecated = getDeprecatedProfiles(profiles);
        assert.equal(deprecated.length, 1);
        assert.equal(deprecated[0].pattern, "deprecated-model");
    });
});

describe("selectModelForRole de-prioritizes deprecated models", () => {
    it("prefers active model over deprecated model at same tier", () => {
        const available: AvailableModel[] = [
            { providerId: "a", model: "deprecated-old", locality: "cloud" },
            { providerId: "b", model: "active-new", locality: "cloud" },
        ];
        registerModelProfile({
            pattern: "deprecated-old",
            label: "Deprecated Old",
            tier: 4,
            parameterSize: "large",
            parametersBillions: 0,
            contextWindow: 32000,
            estimatedVramMb: 0,
            maxOutputTokens: 4096,
            adaptivePromptBudget: 2000,
            strengths: ["reasoning", "instruction-following"],
            modalities: ["text"],
            locality: "cloud",
            deprecated: true,
        });
        registerModelProfile({
            pattern: "active-new",
            label: "Active New",
            tier: 4,
            parameterSize: "large",
            parametersBillions: 0,
            contextWindow: 32000,
            estimatedVramMb: 0,
            maxOutputTokens: 4096,
            adaptivePromptBudget: 2000,
            strengths: ["reasoning", "instruction-following"],
            modalities: ["text"],
            locality: "cloud",
        });

        const result = selectModelForRole("chat" as TaskRole, available);
        assert.ok(result);
        assert.equal(result!.model, "active-new");

        removeModelProfile("deprecated-old");
        removeModelProfile("active-new");
    });
});

// ---------------------------------------------------------------------------
// Provider prompt strategies
// ---------------------------------------------------------------------------

describe("resolvePromptStrategy", () => {
    it("resolves OpenAI reasoning models (o-series)", () => {
        const s = resolvePromptStrategy("o3-mini");
        assert.equal(s.label, "OpenAI Reasoning");
        assert.equal(s.structureFormat, "markdown");
        assert.equal(s.chainOfThoughtMode, "avoid");
    });

    it("resolves standard OpenAI GPT models", () => {
        const s = resolvePromptStrategy("gpt-4o");
        assert.equal(s.label, "OpenAI GPT");
        assert.equal(s.structureFormat, "markdown");
    });

    it("resolves Anthropic Claude models", () => {
        const s = resolvePromptStrategy("claude-3-5-sonnet-20241022");
        assert.equal(s.label, "Anthropic Claude");
        assert.equal(s.structureFormat, "xml");
    });

    it("resolves Google Gemini models", () => {
        const s = resolvePromptStrategy("gemini-2.0-flash");
        assert.equal(s.label, "Google Gemini");
        assert.equal(s.structureFormat, "xml");
    });

    it("resolves DeepSeek Reasoner models", () => {
        const s = resolvePromptStrategy("deepseek-reasoner");
        assert.equal(s.chainOfThoughtMode, "avoid");
    });

    it("resolves Mistral models", () => {
        const s = resolvePromptStrategy("mistral-large-latest");
        assert.equal(s.label, "Mistral");
        assert.equal(s.structureFormat, "markdown");
    });

    it("falls back to local/open-source for unknown models", () => {
        const s = resolvePromptStrategy("some-random-local-model:7b");
        assert.equal(s.label, "Local / Open-Source");
        assert.equal(s.structureFormat, "minimal");
    });
});

describe("PROVIDER_PROMPT_STRATEGIES registry", () => {
    it("has at least 8 strategy entries", () => {
        assert.ok(PROVIDER_PROMPT_STRATEGIES.length >= 8);
    });

    it("each strategy has required fields", () => {
        for (const s of PROVIDER_PROMPT_STRATEGIES) {
            assert.ok(typeof s.providerPattern === "string" && s.providerPattern.length > 0, `${s.label} providerPattern should be non-empty string`);
            assert.ok(typeof s.label === "string" && s.label.length > 0);
            assert.ok(["xml", "markdown", "mixed", "minimal"].includes(s.structureFormat));
            assert.ok(["explicit", "avoid", "implicit"].includes(s.chainOfThoughtMode));
            assert.ok(typeof s.temperatureDefault === "number");
            assert.ok(["inline", "conversation", "xml-tagged", "none"].includes(s.fewShotStyle));
        }
    });

    it("last strategy has a catch-all pattern", () => {
        const last = PROVIDER_PROMPT_STRATEGIES[PROVIDER_PROMPT_STRATEGIES.length - 1];
        const re = new RegExp(last.providerPattern, "i");
        // The fallback should match anything
        assert.ok(re.test("anything-random"));
        assert.ok(re.test("totally-unknown-model"));
    });
});

describe("buildAdaptiveParams with strategy temperature override", () => {
    it("applies provider-specific temperature from strategy", () => {
        // o3-mini is T5 tier, default temp 0.3, but OpenAI Reasoning strategy has temperatureDefault = 1
        const profile = resolveProfile("o3-mini");
        const params = buildAdaptiveParams(profile);
        const strategy = resolvePromptStrategy("o3-mini");
        assert.equal(params.temperature, strategy.temperatureDefault);
    });

    it("applies strategy temperature even for lower-tier models", () => {
        const profile = resolveProfile("gemma3:1b");
        const paramsDefault = buildAdaptiveParams(profile);
        // local fallback strategy should apply its temperatureDefault
        const strategy = resolvePromptStrategy("gemma3:1b");
        assert.equal(paramsDefault.temperature, strategy.temperatureDefault);
    });
});
