/**
 * SR Cross-Session Recommender (Phase C)
 *
 * Ranks historical hemisphere configurations by a blended score:
 *
 *     score = 0.6 * observedUtility
 *           + 0.2 * (1 / (1 + estimatedCostUsd))
 *           + 0.2 * succeededRatio
 *
 * Uses `sr-memory-store.ts` as the source of truth.
 */

import { listSRRecords, type SRGenerationRecord } from "./sr-memory-store.js";

export interface HemisphereRecommendation {
    /** Stable signature: providerId::model::profileId for each hemisphere joined by '|'. */
    signature: string;
    hemispheres: SRGenerationRecord["hemispheres"];
    score: number;
    samples: number;
    avgUtility: number | null;
    avgCostUsd: number;
    succeededRatio: number;
}

function signatureFor(rec: SRGenerationRecord): string {
    return rec.hemispheres
        .map(h => `${h.providerId}::${h.model}::${h.profileId ?? ""}`)
        .sort()
        .join("|");
}

/**
 * Rank historical configurations for a given role (or all). Returns top-k.
 */
export function recommendHemisphereConfigs(opts: { role?: string; k?: number } = {}): HemisphereRecommendation[] {
    const k = opts.k && opts.k > 0 ? opts.k : 5;
    const records = listSRRecords({ role: opts.role });
    if (records.length === 0) return [];

    const groups = new Map<string, SRGenerationRecord[]>();
    for (const r of records) {
        const sig = signatureFor(r);
        const arr = groups.get(sig) ?? [];
        arr.push(r);
        groups.set(sig, arr);
    }

    const recs: HemisphereRecommendation[] = [];
    for (const [signature, group] of groups) {
        const samples = group.length;
        const utilSamples = group.filter(g => typeof g.observedUtility === "number");
        const avgUtility = utilSamples.length === 0
            ? null
            : utilSamples.reduce((s, g) => s + (g.observedUtility ?? 0), 0) / utilSamples.length;
        const avgCostUsd = group.reduce((s, g) => s + g.estimatedCostUsd, 0) / samples;
        const succeededRatio = group.reduce((s, g) => {
            return s + (g.totalHemispheres === 0 ? 0 : g.succeededHemispheres / g.totalHemispheres);
        }, 0) / samples;

        // Blend: missing utility defaults to neutral 0.5 to avoid penalizing un-rated configs.
        const utilityComponent = avgUtility ?? 0.5;
        const costComponent = 1 / (1 + Math.max(0, avgCostUsd));
        const score = 0.6 * utilityComponent + 0.2 * costComponent + 0.2 * succeededRatio;

        recs.push({
            signature,
            hemispheres: group[group.length - 1]!.hemispheres, // most recent realization
            score,
            samples,
            avgUtility,
            avgCostUsd,
            succeededRatio,
        });
    }

    recs.sort((a, b) => b.score - a.score);
    return recs.slice(0, k);
}
