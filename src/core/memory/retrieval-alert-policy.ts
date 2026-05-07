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

// ── Phase: Profile-specific alert tuning from incident trends ────────────────

export interface IncidentTrendSignal {
    profile: "individual" | "business" | "unknown";
    windowDays: number;
    /** Daily averages, cf. IncidentTrendStore.getReport(). */
    dailyAverage: {
        policyDenies: number;
        approvalTimeouts: number;
        retrievalAlerts: number;
        incidents: number;
    };
}

export interface PolicyTuningResult {
    /** The base policy that the tuning was applied to. */
    base: RetrievalAlertPolicy;
    /** The tuned policy. Identical to `base` when no signals warrant change. */
    tuned: RetrievalAlertPolicy;
    /** Human-readable rationale entries describing the adjustments. */
    rationale: string[];
}

/**
 * Tune a base policy based on incident trend signals. The returned policy is
 * always at least as strict as the base — we tighten thresholds in response
 * to elevated denial / timeout / alert rates and never relax them.
 *
 * The function is deterministic and stateless (idempotent given the same
 * signals), and the static profile policy remains the floor — adjustments
 * are bounded multiplicative deltas.
 */
export function tuneFromIncidentTrends(
    base: RetrievalAlertPolicy,
    signals: IncidentTrendSignal,
): PolicyTuningResult {
    const tuned: RetrievalAlertPolicy = { ...base };
    const rationale: string[] = [];

    const denials = signals.dailyAverage.policyDenies;
    const timeouts = signals.dailyAverage.approvalTimeouts;
    const alerts = signals.dailyAverage.retrievalAlerts;
    const incidents = signals.dailyAverage.incidents;

    // Elevated policy denials → raise the utility floor (require higher quality).
    if (denials >= 5) {
        const next = Math.min(0.6, base.recentMinUtility + 0.05);
        if (next > tuned.recentMinUtility) {
            tuned.recentMinUtility = next;
            rationale.push(
                `policy.deny rate ${denials.toFixed(2)}/day ≥ 5 → raise recentMinUtility to ${next.toFixed(2)}`,
            );
        }
    }

    // Approval timeouts → lower latency tolerances (we want to flag earlier).
    if (timeouts >= 3) {
        const next = Math.max(80, base.cohortMaxP95LatencyMs - 25);
        if (next < tuned.cohortMaxP95LatencyMs) {
            tuned.cohortMaxP95LatencyMs = next;
            rationale.push(
                `approval.timeout rate ${timeouts.toFixed(2)}/day ≥ 3 → lower cohortMaxP95LatencyMs to ${next}ms`,
            );
        }
        const trendNext = Math.max(40, base.trendP95LatencyIncreaseMs - 20);
        if (trendNext < tuned.trendP95LatencyIncreaseMs) {
            tuned.trendP95LatencyIncreaseMs = trendNext;
            rationale.push(
                `approval.timeout rate ${timeouts.toFixed(2)}/day ≥ 3 → lower trendP95LatencyIncreaseMs to ${trendNext}ms`,
            );
        }
    }

    // High retrieval alert volume → tighten drift threshold.
    if (alerts >= 4) {
        const next = Math.max(0.05, base.driftScoreThreshold - 0.03);
        if (next < tuned.driftScoreThreshold) {
            tuned.driftScoreThreshold = next;
            rationale.push(
                `retrieval.alert rate ${alerts.toFixed(2)}/day ≥ 4 → tighten driftScoreThreshold to ${next.toFixed(2)}`,
            );
        }
    }

    // Captured incident bundles → tighten cohort hit-rate floor.
    if (incidents >= 1) {
        const next = Math.min(0.7, base.cohortMinHitRate + 0.05);
        if (next > tuned.cohortMinHitRate) {
            tuned.cohortMinHitRate = next;
            rationale.push(
                `incident.* rate ${incidents.toFixed(2)}/day ≥ 1 → raise cohortMinHitRate to ${next.toFixed(2)}`,
            );
        }
    }

    if (rationale.length === 0) {
        rationale.push(`No tuning applied — incident trend signals below thresholds (profile=${signals.profile}, window=${signals.windowDays}d).`);
    }

    return { base, tuned, rationale };
}

