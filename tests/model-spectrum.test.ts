import { describe, it } from "mocha";
import * as assert from "assert";
import {
    deriveBudgetClass,
    computeQualityIndex,
    computeValueScore,
    getBlendedCost,
    enrichProfile,
    estimateTurnCostUsd,
    buildRoleSpectrum,
    selectModelForRoleWithBudget,
    buildBudgetTriad,
    computeSpectrumStats,
    SPEND_BANDS,
    BUDGET_CLASS_ORDER,
} from "../src/core/operator/model-spectrum.js";
import { resolveProfile } from "../src/core/operator/model-capability-matrix.js";
import type { ModelCapabilityProfile, AvailableModel } from "../src/core/operator/model-capability-matrix.js";

function mk(p: Partial<ModelCapabilityProfile>): ModelCapabilityProfile {
    return {
        pattern: p.pattern ?? "test",
        label: p.label ?? "Test",
        tier: p.tier ?? 3,
        parameterSize: "medium",
        parametersBillions: 0,
        contextWindow: p.contextWindow ?? 8192,
        estimatedVramMb: p.estimatedVramMb ?? 0,
        maxOutputTokens: 2048,
        adaptivePromptBudget: 1000,
        strengths: p.strengths ?? [],
        modalities: p.modalities ?? ["text"],
        locality: p.locality ?? "cloud",
        costInputPer1M: p.costInputPer1M,
        costOutputPer1M: p.costOutputPer1M,
    };
}

describe("Model Spectrum — budget class derivation", () => {
    it("maps blended cost to the right class", () => {
        assert.strictEqual(deriveBudgetClass(0), "economy");
        assert.strictEqual(deriveBudgetClass(0.5), "value");
        assert.strictEqual(deriveBudgetClass(3), "balanced");
        assert.strictEqual(deriveBudgetClass(12), "premium");
        assert.strictEqual(deriveBudgetClass(50), "frontier");
    });

    it("exposes five ordered bands cheapest → frontier", () => {
        assert.strictEqual(SPEND_BANDS.length, 5);
        assert.deepStrictEqual([...BUDGET_CLASS_ORDER], ["economy", "value", "balanced", "premium", "frontier"]);
    });
});

describe("Model Spectrum — quality & value", () => {
    it("quality index rises with tier", () => {
        const low = computeQualityIndex(mk({ tier: 1 }));
        const high = computeQualityIndex(mk({ tier: 5, strengths: ["reasoning", "agentic"], contextWindow: 200_000 }));
        assert.ok(high > low);
        assert.ok(high <= 100 && low >= 0);
    });

    it("free capable model scores higher value than an expensive equal-quality one", () => {
        const free = enrichProfile("ollama", mk({ pattern: "llama3", tier: 4, locality: "local" }));
        const paid = mk({ tier: 4, costInputPer1M: 15, costOutputPer1M: 60 });
        paid.qualityIndex = computeQualityIndex(paid);
        const freeVal = free.valueScore ?? 0;
        const paidVal = computeValueScore(paid);
        assert.ok(freeVal > paidVal, `expected free(${freeVal}) > paid(${paidVal})`);
    });
});

describe("Model Spectrum — enrichment distinguishes unknown from free", () => {
    it("local model is free and known", () => {
        const e = enrichProfile("ollama", resolveProfile("llama3.1:8b"));
        assert.strictEqual(e.billingModel, "local-free");
        assert.strictEqual(e.costKnown, true);
        assert.strictEqual(getBlendedCost(e), 0);
    });

    it("unknown cloud model is flagged unknown, not free", () => {
        const e = enrichProfile("acme", mk({ pattern: "totally-unknown-model-xyz", locality: "cloud" }));
        assert.strictEqual(e.billingModel, "unknown");
        assert.strictEqual(e.costKnown, false);
    });

    it("priced model gets per-token billing and a verified date", () => {
        const e = enrichProfile("openai", resolveProfile("gpt-4o"));
        assert.strictEqual(e.billingModel, "per-token");
        assert.ok((e.costOutputPer1M ?? 0) > 0);
        assert.ok(typeof e.pricingVerifiedAt === "string" && e.pricingVerifiedAt.length >= 10);
    });
});

describe("Model Spectrum — role spectrum & budget routing", () => {
    const available: AvailableModel[] = [
        { providerId: "ollama", model: "llama3.1:8b", locality: "local" },
        { providerId: "openai", model: "gpt-4o-mini", locality: "cloud" },
        { providerId: "openai", model: "gpt-4o", locality: "cloud" },
        { providerId: "openai", model: "o1", locality: "cloud" },
        { providerId: "anthropic", model: "claude-3-5-haiku", locality: "cloud" },
    ];

    it("builds a spectrum with a recommended class", () => {
        const spec = buildRoleSpectrum("chat", available);
        assert.ok(Object.keys(spec.picks).length > 0);
        assert.ok(spec.recommended !== null);
    });

    it("frontier spend picks the highest-quality model available", () => {
        const sel = selectModelForRoleWithBudget("reasoning", available, { spendProfile: "frontier" });
        assert.ok(sel);
        assert.ok(sel!.chosen.qualityIndex >= 80);
    });

    it("returns cheaper/premium neighbors around a mid pick", () => {
        const sel = selectModelForRoleWithBudget("chat", available, { spendProfile: "balanced" });
        assert.ok(sel);
        // At least one neighbor should exist given the spread of models.
        assert.ok(sel!.cheaper || sel!.premium);
    });
});

describe("Model Spectrum — SR budget triad", () => {
    const available: AvailableModel[] = [
        { providerId: "openai", model: "gpt-4o-mini", locality: "cloud" },
        { providerId: "anthropic", model: "claude-3-5-haiku", locality: "cloud" },
        { providerId: "ollama", model: "llama3.1:8b", locality: "local" },
    ];

    it("preserves isolation (left ≠ right) when possible", () => {
        const triad = buildBudgetTriad(available, "value");
        if (triad.left && triad.right) {
            const same = triad.left.providerId === triad.right.providerId && triad.left.model === triad.right.model;
            assert.strictEqual(same, false);
            assert.notStrictEqual(triad.isolationLevel, "insufficient");
        }
    });

    it("reports a non-negative per-turn cost estimate", () => {
        const triad = buildBudgetTriad(available, "value");
        assert.ok(triad.estCostPerTurnUsd >= 0);
    });
});

describe("Model Spectrum — coverage stats", () => {
    it("computes pricing coverage percentages and class buckets", () => {
        const stats = computeSpectrumStats([
            { providerId: "openai", model: "gpt-4o", locality: "cloud" },
            { providerId: "ollama", model: "llama3.1:8b", locality: "local" },
        ]);
        assert.strictEqual(stats.total, 2);
        assert.ok(stats.pricingCoveragePct >= 0 && stats.pricingCoveragePct <= 100);
        const sum = Object.values(stats.byBudgetClass).reduce((a, b) => a + b, 0);
        assert.strictEqual(sum, 2);
        assert.ok(typeof stats.verifiedAt === "string");
    });
});

describe("Model Spectrum — turn cost", () => {
    it("estimates zero for free models and positive for priced", () => {
        const free = enrichProfile("ollama", resolveProfile("llama3.1:8b"));
        assert.strictEqual(estimateTurnCostUsd(free), 0);
        const paid = enrichProfile("openai", resolveProfile("gpt-4o"));
        assert.ok(estimateTurnCostUsd(paid) > 0);
    });
});
