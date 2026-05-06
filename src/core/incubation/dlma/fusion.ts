// Bayesian-style fusion of two lens scores. Given per-lens scored matches,
// merge by id, weight by current arbitration weights, and compute a confidence
// metric capturing inter-lens agreement.

import type { LensScore, FusedMatch, ArbitrationWeights, ConsequenceProfile } from "./types.js";

export interface FusionInputs {
    semantic: LensScore[];
    causal: LensScore[];
    weights: ArbitrationWeights;
    consequenceLookup: (operation: string) => ConsequenceProfile;
}

export function fuseLenses(inputs: FusionInputs, limit: number = 10): FusedMatch[] {
    const { semantic, causal, weights, consequenceLookup } = inputs;
    const wSem = clampUnit(weights.semantic);
    const wCau = clampUnit(weights.causal);
    const totalW = wSem + wCau || 1;
    const wSemNorm = wSem / totalW;
    const wCauNorm = wCau / totalW;

    const byId = new Map<string, { sem?: LensScore; cau?: LensScore }>();
    for (const s of semantic) {
        const cur = byId.get(s.id) ?? {};
        cur.sem = s;
        byId.set(s.id, cur);
    }
    for (const c of causal) {
        const cur = byId.get(c.id) ?? {};
        cur.cau = c;
        byId.set(c.id, cur);
    }

    const fused: FusedMatch[] = [];
    for (const [, pair] of byId) {
        const semScore = pair.sem?.score ?? 0;
        const cauScore = pair.cau?.score ?? 0;
        const fusedScore = wSemNorm * semScore + wCauNorm * cauScore;
        const confidence = computeConfidence(semScore, cauScore, wSemNorm, wCauNorm);
        const sample = pair.sem ?? pair.cau!;
        const consequence = consequenceLookup(sample.operation);
        fused.push({
            id: sample.id,
            operation: sample.operation,
            layer: sample.layer,
            timestamp: sample.timestamp,
            semanticScore: semScore,
            causalScore: cauScore,
            fusedScore,
            confidence,
            consequence,
            explanation: explain(semScore, cauScore, wSemNorm, wCauNorm, consequence),
        });
    }

    return fused
        .sort((a, b) => b.fusedScore - a.fusedScore)
        .slice(0, Math.max(1, limit));
}

function computeConfidence(
    sem: number,
    cau: number,
    wSem: number,
    wCau: number,
): number {
    // Variance proxy: how far each lens is from the fused mean.
    const fused = wSem * sem + wCau * cau;
    const varSem = (sem - fused) ** 2;
    const varCau = (cau - fused) ** 2;
    const totalVar = wSem * wSem * varSem + wCau * wCau * varCau;
    // Confidence = 1 - sqrt(totalVar) clamped to [0,1]
    const confidence = 1 - Math.sqrt(totalVar);
    return Math.max(0, Math.min(1, confidence));
}

function explain(
    sem: number,
    cau: number,
    wSem: number,
    wCau: number,
    consequence: ConsequenceProfile,
): string {
    const dominant = sem * wSem >= cau * wCau ? "semantic" : "causal";
    return `dominant=${dominant} semantic=${sem.toFixed(2)} causal=${cau.toFixed(2)} `
        + `weights=[${wSem.toFixed(2)},${wCau.toFixed(2)}] trust=${consequence.trust.toFixed(2)}`;
}

function clampUnit(x: number): number {
    if (!isFinite(x) || x < 0) return 0;
    if (x > 1) return 1;
    return x;
}
