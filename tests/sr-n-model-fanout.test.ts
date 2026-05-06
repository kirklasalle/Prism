/**
 * Tests for Phase A (SR N-Model Fan-Out) + Phase B (Hemisphere Profiles).
 *
 * Backward-compat gate: legacy leftModel/rightModel must round-trip through
 * normalizeSRConfig() to produce the same two hemispheres consumed by the
 * existing generateSR() path.
 */

import {
    normalizeSRConfig,
    SR_MAX_HEMISPHERES,
    type SpectrumRefractionConfig,
    type HemisphereSpec,
} from "../src/core/operator/model-capability-matrix.js";
import {
    SR_HEMISPHERE_PROFILES,
    resolveHemisphereProfile,
    listHemisphereProfileIds,
} from "../src/core/operator/sr-hemisphere-profiles.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testSRNModelFanout(): Promise<void> {
    // ── Backward compat: legacy left/right normalizes to two hemispheres ──
    const legacy: SpectrumRefractionConfig = {
        enabled: true,
        leftModel: { providerId: "openai", model: "gpt-4o" },
        rightModel: { providerId: "anthropic", model: "claude-3.5-sonnet" },
        leftSlot: "primary",
        rightSlot: "secondary",
        leftTimeoutMs: 30_000,
    };
    const norm1 = normalizeSRConfig(legacy);
    assert(norm1.errors.length === 0, "legacy normalization should not error: " + norm1.errors.join(","));
    assert(norm1.hemispheres.length === 2, "legacy => 2 hemispheres");
    assert(norm1.hemispheres[0]!.id === "logic" && norm1.hemispheres[0]!.role === "logic", "first is logic");
    assert(norm1.hemispheres[1]!.id === "creative" && norm1.hemispheres[1]!.role === "creative", "second is creative");
    assert(norm1.hemispheres[0]!.slot === "primary", "left slot preserved");
    assert(norm1.hemispheres[0]!.timeoutMs === 30_000, "left timeout preserved");

    // ── New form: hemispheres[] supersedes ──
    const arr: HemisphereSpec[] = [
        { id: "h1", providerId: "openai", model: "gpt-4o", role: "logic", profileId: "code-review" },
        { id: "h2", providerId: "anthropic", model: "claude-3.5-sonnet", role: "logic", profileId: "legal-analysis" },
        { id: "h3", providerId: "google", model: "gemini-2.0-pro", role: "creative" },
    ];
    const newCfg: SpectrumRefractionConfig = { enabled: true, leftModel: null, rightModel: null, hemispheres: arr };
    const norm2 = normalizeSRConfig(newCfg);
    assert(norm2.errors.length === 0, "new form normalization should not error: " + norm2.errors.join(","));
    assert(norm2.hemispheres.length === 3, "3 hemispheres");

    // ── Mixing both forms is rejected ──
    const mixed: SpectrumRefractionConfig = {
        enabled: true,
        leftModel: { providerId: "openai", model: "gpt-4o" },
        rightModel: null,
        hemispheres: arr,
    };
    const norm3 = normalizeSRConfig(mixed);
    assert(norm3.errors.length > 0, "mixed forms must error");

    // ── Cap enforced ──
    const tooMany = Array.from({ length: SR_MAX_HEMISPHERES + 1 }, (_, i) => ({
        id: `h${i}`,
        providerId: "p",
        model: `m${i}`,
        role: "custom" as const,
    }));
    const norm4 = normalizeSRConfig({ enabled: true, leftModel: null, rightModel: null, hemispheres: tooMany });
    assert(norm4.errors.some(e => e.includes("SR_MAX_HEMISPHERES")), "cap must trigger error");

    // ── Duplicate ids rejected ──
    const dup: HemisphereSpec[] = [
        { id: "x", providerId: "a", model: "m1", role: "logic" },
        { id: "x", providerId: "b", model: "m2", role: "logic" },
    ];
    const norm5 = normalizeSRConfig({ enabled: true, leftModel: null, rightModel: null, hemispheres: dup });
    assert(norm5.errors.some(e => e.toLowerCase().includes("duplicate")), "duplicate id must error");

    // ── Instance-isolation: same provider+model rejected ──
    const same: HemisphereSpec[] = [
        { id: "a", providerId: "openai", model: "gpt-4o", role: "logic" },
        { id: "b", providerId: "openai", model: "gpt-4o", role: "creative" },
    ];
    const norm6 = normalizeSRConfig({ enabled: true, leftModel: null, rightModel: null, hemispheres: same });
    assert(norm6.errors.some(e => e.toLowerCase().includes("isolation")), "isolation violation must error");

    // ── Phase B: profile registry sanity ──
    const ids = listHemisphereProfileIds();
    assert(ids.includes("legal-analysis"), "legal-analysis profile present");
    assert(ids.includes("code-review"), "code-review profile present");
    assert(ids.includes("creative-writing"), "creative-writing profile present");
    assert(ids.includes("research-synthesis"), "research-synthesis profile present");
    assert(ids.includes("reasoning-deep"), "reasoning-deep profile present");
    assert(ids.includes("summarization"), "summarization profile present");

    const codeReview = resolveHemisphereProfile("code-review");
    assert(codeReview !== null, "code-review resolves");
    assert(codeReview!.systemPrompt.toLowerCase().includes("code"), "code-review prompt mentions code");
    assert(resolveHemisphereProfile("nonexistent-xyz") === null, "unknown profile returns null");
    assert(SR_HEMISPHERE_PROFILES["logic"]!.role === "logic", "logic profile role");

    console.log("  ✓ SR N-Model Fan-Out + Hemisphere Profiles");
}
