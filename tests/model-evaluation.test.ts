import { describe, it } from "mocha";
import * as assert from "assert";
import {
    EVAL_TASKS,
    getEvalTask,
    runSpectrumEvaluation,
    type GenerateFn,
} from "../src/core/operator/model-evaluation.js";
import type { AvailableModel } from "../src/core/operator/model-capability-matrix.js";

const available: AvailableModel[] = [
    { providerId: "ollama", model: "llama3.1:8b", locality: "local" },
    { providerId: "openai", model: "gpt-4o-mini", locality: "cloud" },
    { providerId: "openai", model: "gpt-4o", locality: "cloud" },
    { providerId: "openai", model: "o1", locality: "cloud" },
];

describe("Model Evaluation — fixed tasks", () => {
    it("exposes stable canonical tasks", () => {
        assert.ok(EVAL_TASKS.length >= 3);
        assert.ok(getEvalTask("jeans"));
        assert.ok(getEvalTask("car"));
        assert.ok(getEvalTask("rental"));
        assert.strictEqual(getEvalTask("nope"), null);
    });
});

describe("Model Evaluation — spectrum run", () => {
    const goodGenerate: GenerateFn = async (prompt, sel) => ({
        content:
            "- Look on major retailers for jeans\n- Filter by size and $ budget\n- Compare price and returns\n- Best next step: shortlist 3",
        tokensUsed: { input: 120, output: 90, costUsd: sel.model === "o1" ? 0.05 : sel.model.includes("mini") ? 0.001 : 0 },
    });

    it("runs one representative per band and captures telemetry", async () => {
        const run = await runSpectrumEvaluation(getEvalTask("jeans")!, available, goodGenerate);
        assert.ok(run.results.length > 0);
        for (const r of run.results) {
            assert.strictEqual(r.ok, true);
            assert.ok(r.latencyMs >= 0);
            assert.ok(r.score > 0 && r.score <= 100);
        }
        assert.ok(run.bestValue);
        assert.ok(run.bestQuality);
        assert.ok(run.cheapest);
        assert.strictEqual(run.taskId, "jeans");
        assert.strictEqual(run.catalogModelCount, available.length);
    });

    it("uses provider-reported cost when present (not estimated)", async () => {
        const run = await runSpectrumEvaluation(getEvalTask("jeans")!, available, goodGenerate);
        const paid = run.results.find((r) => r.model === "gpt-4o-mini");
        assert.ok(paid);
        assert.strictEqual(paid!.costEstimated, false);
        assert.ok(paid!.costUsd > 0);
    });

    it("marks a model that returns nothing as failed with score 0", async () => {
        const flaky: GenerateFn = async (_p, sel) =>
            sel.model === "o1" ? null : { content: "- a\n- b\n- c jeans $\n- d", tokensUsed: { input: 10, output: 10, costUsd: 0.0001 } };
        const run = await runSpectrumEvaluation(getEvalTask("jeans")!, available, flaky);
        const failed = run.results.find((r) => r.model === "o1");
        if (failed) {
            assert.strictEqual(failed.ok, false);
            assert.strictEqual(failed.score, 0);
        }
    });

    it("scores higher value for a cheaper equally-good model", async () => {
        const run = await runSpectrumEvaluation(getEvalTask("jeans")!, available, goodGenerate);
        const free = run.results.find((r) => r.costUsd === 0);
        const pricey = run.results.find((r) => r.model === "o1");
        if (free && pricey && free.ok && pricey.ok) {
            assert.ok(free.valuePerCent >= pricey.valuePerCent);
        }
    });
});
