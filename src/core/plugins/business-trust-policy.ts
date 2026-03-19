export type TrustLevel = "untrusted" | "community" | "verified" | "official";

export interface BusinessTrustPolicy {
    minimumTrustLevel: TrustLevel;
    requireSignature: boolean;
    requireSecurityReview: boolean;
    allowedReviewStatuses: Array<"community-reviewed" | "security-reviewed">;
    allowedSignatureAlgorithms: Array<"rsa-2048" | "rsa-4096" | "ecdsa-256" | "ecdsa-384">;
    allowedRepositoryHosts: string[];
    requireHttpsRepository: boolean;
    requireAuthorEmail: boolean;
    maxUnmitigatedHighIssues: number;
    maxUnmitigatedCriticalIssues: number;
    failOnFutureReleaseDate: boolean;
}

export const DEFAULT_BUSINESS_TRUST_POLICY: BusinessTrustPolicy = {
    minimumTrustLevel: "verified",
    requireSignature: true,
    requireSecurityReview: true,
    allowedReviewStatuses: ["community-reviewed", "security-reviewed"],
    allowedSignatureAlgorithms: ["rsa-2048", "rsa-4096", "ecdsa-256", "ecdsa-384"],
    allowedRepositoryHosts: ["github.com", "gitlab.com", "dev.azure.com", "bitbucket.org"],
    requireHttpsRepository: true,
    requireAuthorEmail: true,
    maxUnmitigatedHighIssues: 0,
    maxUnmitigatedCriticalIssues: 0,
    failOnFutureReleaseDate: true,
};

export function trustLevelWeight(level: TrustLevel): number {
    switch (level) {
        case "untrusted":
            return 0;
        case "community":
            return 1;
        case "verified":
            return 2;
        case "official":
            return 3;
        default:
            return 0;
    }
}
