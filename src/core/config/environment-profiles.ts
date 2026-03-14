export type PrismEnvironmentProfile = "dev" | "staging" | "prod";

export interface PerformanceSloProfile {
    policyP95Ms: number;
    retrievalP95Ms: number;
    eventDeliveryP95Ms: number;
    telemetryOverheadP95Ms: number;
    persistenceOverheadP95Ms: number;
    approvalPathwayP99Ms: number;
}

export const performanceSloProfiles: Record<PrismEnvironmentProfile, PerformanceSloProfile> = {
    dev: {
        policyP95Ms: 50,
        retrievalP95Ms: 80,
        eventDeliveryP95Ms: 300,
        telemetryOverheadP95Ms: 30,
        persistenceOverheadP95Ms: 50,
        approvalPathwayP99Ms: 2_000,
    },
    staging: {
        policyP95Ms: 30,
        retrievalP95Ms: 50,
        eventDeliveryP95Ms: 200,
        telemetryOverheadP95Ms: 20,
        persistenceOverheadP95Ms: 30,
        approvalPathwayP99Ms: 1_500,
    },
    prod: {
        policyP95Ms: 25,
        retrievalP95Ms: 40,
        eventDeliveryP95Ms: 150,
        telemetryOverheadP95Ms: 15,
        persistenceOverheadP95Ms: 25,
        approvalPathwayP99Ms: 1_200,
    },
};

export function resolveEnvironmentProfile(rawProfile?: string): PrismEnvironmentProfile {
    const normalized = (rawProfile ?? "").trim().toLowerCase();
    if (normalized === "prod" || normalized === "production") {
        return "prod";
    }
    if (normalized === "stage" || normalized === "staging") {
        return "staging";
    }
    return "dev";
}

export function getPerformanceSloProfile(
    profile: PrismEnvironmentProfile,
    overrides: Partial<PerformanceSloProfile> = {},
): PerformanceSloProfile {
    return {
        ...performanceSloProfiles[profile],
        ...overrides,
    };
}