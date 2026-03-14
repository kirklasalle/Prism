export interface RetrievalAlertPolicy {
    driftScoreThreshold: number;
    volumeTrendChangeThreshold: number;
    volumeSpikeMultiplier: number;
    recentMinUtility: number;
    recentMinNovelty: number;
    coverageDropThreshold: number;
    cohortMinHitRate: number;
    cohortMinUtility: number;
    cohortMaxP95LatencyMs: number;
    trendUtilityDropThreshold: number;
    trendHitRateDropThreshold: number;
    trendP95LatencyIncreaseMs: number;
}

export type RetrievalAlertProfile = "dev" | "staging" | "prod";

export const defaultRetrievalAlertPolicy: RetrievalAlertPolicy = {
    driftScoreThreshold: 0.15,
    volumeTrendChangeThreshold: 0.15,
    volumeSpikeMultiplier: 2.0,
    recentMinUtility: 0.35,
    recentMinNovelty: 0.20,
    coverageDropThreshold: -0.15,
    cohortMinHitRate: 0.40,
    cohortMinUtility: 0.30,
    cohortMaxP95LatencyMs: 250,
    trendUtilityDropThreshold: -0.15,
    trendHitRateDropThreshold: -0.20,
    trendP95LatencyIncreaseMs: 100,
};

export const retrievalAlertPolicyProfiles: Record<RetrievalAlertProfile, RetrievalAlertPolicy> = {
    dev: {
        ...defaultRetrievalAlertPolicy,
        driftScoreThreshold: 0.20,
        recentMinUtility: 0.30,
        cohortMaxP95LatencyMs: 300,
        trendP95LatencyIncreaseMs: 120,
    },
    staging: {
        ...defaultRetrievalAlertPolicy,
    },
    prod: {
        ...defaultRetrievalAlertPolicy,
        driftScoreThreshold: 0.12,
        recentMinUtility: 0.40,
        recentMinNovelty: 0.25,
        coverageDropThreshold: -0.10,
        cohortMinHitRate: 0.50,
        cohortMinUtility: 0.40,
        cohortMaxP95LatencyMs: 200,
        trendUtilityDropThreshold: -0.10,
        trendHitRateDropThreshold: -0.15,
        trendP95LatencyIncreaseMs: 80,
    },
};

export function withRetrievalAlertPolicy(
    overrides: Partial<RetrievalAlertPolicy> = {},
): RetrievalAlertPolicy {
    return {
        ...defaultRetrievalAlertPolicy,
        ...overrides,
    };
}

export function resolveRetrievalAlertProfile(rawProfile?: string): RetrievalAlertProfile {
    const normalized = (rawProfile ?? "").trim().toLowerCase();
    if (normalized === "prod" || normalized === "production") {
        return "prod";
    }
    if (normalized === "stage" || normalized === "staging") {
        return "staging";
    }
    return "dev";
}

export function withRetrievalAlertPolicyProfile(
    profile: RetrievalAlertProfile,
    overrides: Partial<RetrievalAlertPolicy> = {},
): RetrievalAlertPolicy {
    return {
        ...retrievalAlertPolicyProfiles[profile],
        ...overrides,
    };
}
