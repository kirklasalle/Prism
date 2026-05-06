/**
 * Tests for Phase C: SR Memory + Recommender.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    recordSRGeneration,
    listSRRecords,
    attachUtilityFeedback,
    srMemoryStats,
    clearSRMemory,
    _setSrMemoryPathForTest,
    type SRGenerationRecord,
} from "../src/core/memory/sr-memory-store.js";
import { recommendHemisphereConfigs } from "../src/core/memory/sr-recommender.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

function makeRec(overrides: Partial<SRGenerationRecord> = {}): SRGenerationRecord {
    return {
        ts: new Date().toISOString(),
        role: "code-review",
        hemispheres: [
            { id: "h1", providerId: "openai", model: "gpt-4o", profileId: "code-review", role: "logic" },
            { id: "h2", providerId: "anthropic", model: "claude-3.5-sonnet", profileId: "reasoning-deep", role: "logic" },
        ],
        estimatedCostUsd: 0.05,
        totalMs: 4_500,
        succeededHemispheres: 2,
        totalHemispheres: 2,
        ...overrides,
    };
}

export async function testSrMemoryAndRecommender(): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "prism-srmem-"));
    const path = join(dir, "sr-memory.json");
    _setSrMemoryPathForTest(path);
    try {
        clearSRMemory();
        assert(srMemoryStats().total === 0, "starts empty");

        // Two configs, one clearly better.
        const tsA = "2026-05-01T00:00:00.000Z";
        const tsB = "2026-05-01T00:00:01.000Z";
        recordSRGeneration(makeRec({ ts: tsA, estimatedCostUsd: 0.01, totalHemispheres: 2, succeededHemispheres: 2 }));
        recordSRGeneration(makeRec({
            ts: tsB,
            estimatedCostUsd: 0.50,
            totalHemispheres: 2,
            succeededHemispheres: 1,
            hemispheres: [
                { id: "x", providerId: "p1", model: "m1", role: "logic" },
                { id: "y", providerId: "p2", model: "m2", role: "creative" },
            ],
        }));

        assert(listSRRecords().length === 2, "two records persisted");

        // Rate the cheap one favorably, expensive one poorly.
        assert(attachUtilityFeedback(tsA, 0.9), "feedback attaches to tsA");
        assert(attachUtilityFeedback(tsB, 0.2), "feedback attaches to tsB");

        const stats = srMemoryStats();
        assert(stats.withFeedback === 2, "both have feedback");
        assert(stats.avgUtility !== null && stats.avgUtility > 0.5, "average utility computed");

        const recs = recommendHemisphereConfigs({ role: "code-review", k: 5 });
        assert(recs.length === 2, "two distinct configurations");
        // Best should be the high-utility, low-cost one (signature contains gpt-4o).
        assert(recs[0]!.signature.includes("gpt-4o"), `top rec should include gpt-4o, got ${recs[0]!.signature}`);
        assert(recs[0]!.score > recs[1]!.score, "scores sorted descending");

        // Filter by role unknown returns empty.
        assert(recommendHemisphereConfigs({ role: "nonexistent" }).length === 0, "unknown role returns no recs");

        // Cap and order: pump in a third, top-k=1 returns just one.
        recordSRGeneration(makeRec({ ts: "2026-05-01T00:00:02.000Z", estimatedCostUsd: 0.005 }));
        const top1 = recommendHemisphereConfigs({ role: "code-review", k: 1 });
        assert(top1.length === 1, "top-1");

        clearSRMemory();
        assert(srMemoryStats().total === 0, "cleared");

        console.log("  ✓ SR Memory + Recommender");
    } finally {
        _setSrMemoryPathForTest(null);
        rmSync(dir, { recursive: true, force: true });
    }
}
