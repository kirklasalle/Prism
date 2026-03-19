import { createVerify } from "crypto";
import type { PluginPackManifest } from "./plugin-pack-validator.js";
import {
    DEFAULT_BUSINESS_TRUST_POLICY,
    type BusinessTrustPolicy,
    type TrustLevel,
    trustLevelWeight,
} from "./business-trust-policy.js";

export interface TrustValidationContext {
    executionProfile: "individual" | "business";
    policy?: Partial<BusinessTrustPolicy>;
    publicKeyPem?: string;
    nowIso?: string;
}

export interface TrustValidationResult {
    allowed: boolean;
    decision: "allow" | "deny" | "require_approval";
    tier: "tier1_autonomous" | "tier2_conditional" | "tier3_approval";
    reasons: string[];
    reasonCodes: string[];
    warnings: string[];
    evidence: {
        effectiveTrustLevel: TrustLevel;
        profile: "individual" | "business";
        hasSignature: boolean;
        signatureVerified: boolean;
        repositoryHost?: string;
        reviewStatus?: string;
        unmitigatedHighIssues: number;
        unmitigatedCriticalIssues: number;
    };
}

const REASON = {
    TRUST_LEVEL_BELOW_MIN: "TRUST_LEVEL_BELOW_MIN",
    AUTHOR_EMAIL_MISSING: "AUTHOR_EMAIL_MISSING",
    REVIEW_STATUS_MISSING: "REVIEW_STATUS_MISSING",
    REVIEW_STATUS_NOT_ALLOWED: "REVIEW_STATUS_NOT_ALLOWED",
    SIGNATURE_REQUIRED: "SIGNATURE_REQUIRED",
    SIGNATURE_ALGORITHM_INVALID: "SIGNATURE_ALGORITHM_INVALID",
    PUBLIC_KEY_MISSING: "PUBLIC_KEY_MISSING",
    SIGNATURE_VERIFICATION_FAILED: "SIGNATURE_VERIFICATION_FAILED",
    REPOSITORY_REQUIRED: "REPOSITORY_REQUIRED",
    REPOSITORY_PROTOCOL_NOT_HTTPS: "REPOSITORY_PROTOCOL_NOT_HTTPS",
    REPOSITORY_HOST_NOT_ALLOWED: "REPOSITORY_HOST_NOT_ALLOWED",
    RELEASE_DATE_IN_FUTURE: "RELEASE_DATE_IN_FUTURE",
    UNMITIGATED_CRITICAL_ISSUES: "UNMITIGATED_CRITICAL_ISSUES",
    UNMITIGATED_HIGH_ISSUES: "UNMITIGATED_HIGH_ISSUES",
} as const;

export class BusinessTrustValidator {
    validate(manifest: PluginPackManifest, context: TrustValidationContext): TrustValidationResult {
        const effectivePolicy: BusinessTrustPolicy = {
            ...DEFAULT_BUSINESS_TRUST_POLICY,
            ...(context.policy ?? {}),
        };

        const reasons: string[] = [];
        const reasonCodes: string[] = [];
        const warnings: string[] = [];
        const profile = context.executionProfile;
        const now = context.nowIso ? new Date(context.nowIso) : new Date();

        const effectiveTrustLevel = this.getEffectiveTrustLevel(manifest);
        const repositoryHost = this.getRepositoryHost(manifest.repository?.url);

        const knownIssues = manifest.security?.known_issues ?? [];
        const unmitigatedHighIssues = knownIssues.filter(
            (issue) => issue.severity === "high" && !issue.mitigated
        ).length;
        const unmitigatedCriticalIssues = knownIssues.filter(
            (issue) => issue.severity === "critical" && !issue.mitigated
        ).length;

        let signatureVerified = false;

        if (profile === "individual") {
            if (trustLevelWeight(effectiveTrustLevel) < trustLevelWeight(effectivePolicy.minimumTrustLevel)) {
                warnings.push(
                    `Trust level ${effectiveTrustLevel} is below business threshold ${effectivePolicy.minimumTrustLevel}; allowed in individual profile.`
                );
            }

            return {
                allowed: true,
                decision: "allow",
                tier: "tier1_autonomous",
                reasons: ["Trust validation passed for individual profile (advisory mode)."],
                reasonCodes: [],
                warnings,
                evidence: {
                    effectiveTrustLevel,
                    profile,
                    hasSignature: !!manifest.security?.signature,
                    signatureVerified,
                    repositoryHost,
                    reviewStatus: manifest.security?.review_status,
                    unmitigatedHighIssues,
                    unmitigatedCriticalIssues,
                },
            };
        }

        if (trustLevelWeight(effectiveTrustLevel) < trustLevelWeight(effectivePolicy.minimumTrustLevel)) {
            reasonCodes.push(REASON.TRUST_LEVEL_BELOW_MIN);
            reasons.push(
                `Business profile requires minimum trust level ${effectivePolicy.minimumTrustLevel}, found ${effectiveTrustLevel}.`
            );
        }

        if (effectivePolicy.requireAuthorEmail && !manifest.author?.email) {
            reasonCodes.push(REASON.AUTHOR_EMAIL_MISSING);
            reasons.push("Business profile requires author.email for provenance traceability.");
        }

        if (effectivePolicy.requireSecurityReview) {
            const status = manifest.security?.review_status;
            if (!status) {
                reasonCodes.push(REASON.REVIEW_STATUS_MISSING);
                reasons.push("Business profile requires security.review_status.");
            } else if (!effectivePolicy.allowedReviewStatuses.includes(status as any)) {
                reasonCodes.push(REASON.REVIEW_STATUS_NOT_ALLOWED);
                reasons.push(
                    `security.review_status=${status} is not allowed for business profile.`
                );
            }
        }

        if (!manifest.repository?.url) {
            reasonCodes.push(REASON.REPOSITORY_REQUIRED);
            reasons.push("Business profile requires repository.url for provenance tracking.");
        } else {
            if (effectivePolicy.requireHttpsRepository && !manifest.repository.url.startsWith("https://")) {
                reasonCodes.push(REASON.REPOSITORY_PROTOCOL_NOT_HTTPS);
                reasons.push("Business profile requires HTTPS repository URLs.");
            }

            if (repositoryHost && !effectivePolicy.allowedRepositoryHosts.includes(repositoryHost)) {
                reasonCodes.push(REASON.REPOSITORY_HOST_NOT_ALLOWED);
                reasons.push(`Repository host ${repositoryHost} is not in business allow-list.`);
            }
        }

        if (effectivePolicy.failOnFutureReleaseDate && manifest.metadata?.released) {
            const releasedDate = new Date(manifest.metadata.released);
            if (!Number.isNaN(releasedDate.getTime()) && releasedDate > now) {
                reasonCodes.push(REASON.RELEASE_DATE_IN_FUTURE);
                reasons.push("metadata.released cannot be in the future for business profile.");
            }
        }

        if (unmitigatedCriticalIssues > effectivePolicy.maxUnmitigatedCriticalIssues) {
            reasonCodes.push(REASON.UNMITIGATED_CRITICAL_ISSUES);
            reasons.push(
                `Unmitigated critical issues (${unmitigatedCriticalIssues}) exceed policy maximum (${effectivePolicy.maxUnmitigatedCriticalIssues}).`
            );
        }

        if (unmitigatedHighIssues > effectivePolicy.maxUnmitigatedHighIssues) {
            reasonCodes.push(REASON.UNMITIGATED_HIGH_ISSUES);
            reasons.push(
                `Unmitigated high issues (${unmitigatedHighIssues}) exceed policy maximum (${effectivePolicy.maxUnmitigatedHighIssues}).`
            );
        }

        const signature = manifest.security?.signature;
        const algorithm = manifest.security?.signature_algorithm;

        if (effectivePolicy.requireSignature) {
            if (!signature || !algorithm) {
                reasonCodes.push(REASON.SIGNATURE_REQUIRED);
                reasons.push("Business profile requires security.signature and security.signature_algorithm.");
            } else {
                if (!effectivePolicy.allowedSignatureAlgorithms.includes(algorithm as any)) {
                    reasonCodes.push(REASON.SIGNATURE_ALGORITHM_INVALID);
                    reasons.push(`Signature algorithm ${algorithm} is not allowed by policy.`);
                } else if (!context.publicKeyPem) {
                    reasonCodes.push(REASON.PUBLIC_KEY_MISSING);
                    reasons.push("Public key is required to verify signature in business profile.");
                } else {
                    signatureVerified = this.verifyManifestSignature(manifest, context.publicKeyPem);
                    if (!signatureVerified) {
                        reasonCodes.push(REASON.SIGNATURE_VERIFICATION_FAILED);
                        reasons.push("Manifest signature verification failed.");
                    }
                }
            }
        }

        const hasFailure = reasonCodes.length > 0;

        return {
            allowed: !hasFailure,
            decision: hasFailure ? "deny" : "allow",
            tier: "tier3_approval",
            reasons: hasFailure
                ? reasons
                : ["Business trust/provenance validation passed."],
            reasonCodes,
            warnings,
            evidence: {
                effectiveTrustLevel,
                profile,
                hasSignature: !!signature,
                signatureVerified,
                repositoryHost,
                reviewStatus: manifest.security?.review_status,
                unmitigatedHighIssues,
                unmitigatedCriticalIssues,
            },
        };
    }

    buildSignablePayload(manifest: PluginPackManifest): string {
        return JSON.stringify(
            {
                manifest_version: manifest.manifest_version,
                pack_name: manifest.pack_name,
                pack_version: manifest.pack_version,
                author: manifest.author?.name,
                adapters: manifest.adapters.map((adapter) => ({
                    adapter_id: adapter.adapter_id,
                    adapter_type: adapter.adapter_type,
                    entry_file: adapter.entry_file,
                    capabilities: [...adapter.capabilities].sort(),
                    trust_level: adapter.trust_level ?? "untrusted",
                })),
                compatibility: manifest.compatibility,
                repository: manifest.repository?.url,
                released: manifest.metadata?.released,
            },
            null,
            0
        );
    }

    private verifyManifestSignature(manifest: PluginPackManifest, publicKeyPem: string): boolean {
        const signature = manifest.security?.signature;
        if (!signature) {
            return false;
        }

        try {
            const verifier = createVerify("RSA-SHA256");
            verifier.update(this.buildSignablePayload(manifest));
            verifier.end();
            return verifier.verify(publicKeyPem, Buffer.from(signature, "base64"));
        } catch {
            return false;
        }
    }

    private getEffectiveTrustLevel(manifest: PluginPackManifest): TrustLevel {
        if (!manifest.adapters || manifest.adapters.length === 0) {
            return "untrusted";
        }

        const levels = manifest.adapters.map((adapter) => (adapter.trust_level ?? "untrusted") as TrustLevel);
        return levels.reduce((lowest, next) =>
            trustLevelWeight(next) < trustLevelWeight(lowest) ? next : lowest
            , levels[0]);
    }

    private getRepositoryHost(repositoryUrl?: string): string | undefined {
        if (!repositoryUrl) {
            return undefined;
        }

        try {
            const parsed = new URL(repositoryUrl);
            return parsed.hostname.toLowerCase();
        } catch {
            return undefined;
        }
    }
}
