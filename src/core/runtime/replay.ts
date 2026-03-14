import type { ActivityEvent } from "../activity/types.js";

export interface ReplayNormalizationOptions {
    includeSessionId?: boolean;
    includeDetails?: boolean;
    includeSideEffects?: boolean;
    includeAuthority?: boolean;
}

export interface ReplayComparableEvent {
    layer: ActivityEvent["layer"];
    operation: string;
    status: ActivityEvent["status"];
    sessionId?: string;
    details?: unknown;
    sideEffects?: unknown;
    authorityTier?: ActivityEvent["authorityTier"];
    policyDecision?: ActivityEvent["policyDecision"];
}

export interface ReplayParityResult {
    matches: boolean;
    firstMismatchIndex: number;
    expectedLength: number;
    actualLength: number;
}

const DEFAULT_NORMALIZATION: Required<ReplayNormalizationOptions> = {
    includeSessionId: false,
    includeDetails: true,
    includeSideEffects: true,
    includeAuthority: true,
};

export function normalizeReplayEvent(
    event: ActivityEvent,
    options: ReplayNormalizationOptions = {},
): ReplayComparableEvent {
    const resolved = { ...DEFAULT_NORMALIZATION, ...options };
    const normalized: ReplayComparableEvent = {
        layer: event.layer,
        operation: sanitizeDynamicTokens(event.operation),
        status: event.status,
    };

    if (resolved.includeSessionId) {
        normalized.sessionId = event.sessionId;
    }

    if (resolved.includeDetails) {
        normalized.details = stableNormalize(event.details);
    }

    if (resolved.includeSideEffects) {
        normalized.sideEffects = stableNormalize(event.sideEffects ?? []);
    }

    if (resolved.includeAuthority) {
        normalized.authorityTier = event.authorityTier;
        normalized.policyDecision = event.policyDecision;
    }

    return normalized;
}

export function buildReplaySignature(
    events: readonly ActivityEvent[],
    options: ReplayNormalizationOptions = {},
): ReplayComparableEvent[] {
    return events.map((event) => normalizeReplayEvent(event, options));
}

export function compareReplayParity(
    expected: readonly ReplayComparableEvent[],
    actual: readonly ReplayComparableEvent[],
): ReplayParityResult {
    const len = Math.min(expected.length, actual.length);
    for (let index = 0; index < len; index++) {
        if (JSON.stringify(expected[index]) !== JSON.stringify(actual[index])) {
            return {
                matches: false,
                firstMismatchIndex: index,
                expectedLength: expected.length,
                actualLength: actual.length,
            };
        }
    }

    if (expected.length !== actual.length) {
        return {
            matches: false,
            firstMismatchIndex: len,
            expectedLength: expected.length,
            actualLength: actual.length,
        };
    }

    return {
        matches: true,
        firstMismatchIndex: -1,
        expectedLength: expected.length,
        actualLength: actual.length,
    };
}

function stableNormalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => stableNormalize(item));
    }

    if (typeof value === "string") {
        return sanitizeDynamicTokens(value);
    }

    if (value && typeof value === "object") {
        const objectValue = value as Record<string, unknown>;
        const sortedEntries = Object.entries(objectValue)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, nested]) => [key, stableNormalize(nested)]);
        return Object.fromEntries(sortedEntries);
    }

    return value;
}

function sanitizeDynamicTokens(value: string): string {
    const withoutUuids = value.replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        "<id>",
    );

    return withoutUuids.replace(/\bworkflow-[a-z0-9]+\b/gi, "workflow-<id>");
}