import { PAD_LAWS } from "../security/directive-manifest.js";

export type GovernanceControlStatus = "enforced" | "partial" | "not_enforced";
export type ReleaseTier = "candidate" | "production";

export interface EvidenceRequirement {
    readonly probeId: string;
    readonly probeVersion: number;
    readonly maxAgeMs: number;
}

export interface GovernanceControlDefinition {
    readonly controlId: string;
    readonly gateNumber: number;
    readonly title: string;
    readonly padLawIds: readonly number[];
    readonly implementationStatus: GovernanceControlStatus;
    readonly owners: readonly string[];
    readonly evidenceRequirements: readonly EvidenceRequirement[];
    readonly requiredFor: ReleaseTier;
    readonly limitation: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const GOVERNANCE_CONTROLS: readonly GovernanceControlDefinition[] = [
    {
        controlId: "IC-01-KEY-CUSTODY",
        gateNumber: 1,
        title: "Issuer private key custody excludes plaintext application-managed keys",
        padLawIds: [6, 10],
        implementationStatus: "partial",
        owners: ["src/core/security/dpapi-key-store.ts"],
        evidenceRequirements: [{ probeId: "security.key-custody", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "production",
        limitation: "Application inspection cannot prove host ACLs or discover every external copy of key material.",
    },
    {
        controlId: "IC-02-ISSUER-TRUST",
        gateNumber: 2,
        title: "Certificate issuer keys resolve through an independently persisted trust registry",
        padLawIds: [6, 9, 10],
        implementationStatus: "partial",
        owners: ["src/core/security/key-registry.ts"],
        evidenceRequirements: [{ probeId: "security.issuer-trust", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "production",
        limitation: "The registry remains application-writable until independently anchored.",
    },
    {
        controlId: "IC-03-KEY-REMEDIATION",
        gateNumber: 3,
        title: "Compromised legacy keys and certificates are revoked or quarantined",
        padLawIds: [6, 9],
        implementationStatus: "partial",
        owners: ["src/core/security/certificate-migration-manifest.ts", "src/core/security/key-registry.ts"],
        evidenceRequirements: [{ probeId: "security.legacy-remediation", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "production",
        limitation: "Source presence does not prove the migration completed against the active production database.",
    },
    {
        controlId: "IC-04-CERTIFICATE-ENVELOPE",
        gateNumber: 4,
        title: "Canonical certificate envelope binds identity and governance provenance",
        padLawIds: [6, 9],
        implementationStatus: "partial",
        owners: ["src/core/security/certificate-envelope.ts"],
        evidenceRequirements: [{ probeId: "security.certificate-envelope", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "candidate",
        limitation: "All issuance call sites must still prove they supply authoritative identity values.",
    },
    {
        controlId: "IC-05-CERTIFICATE-IMMUTABILITY",
        gateNumber: 5,
        title: "Certificate records are immutable through application and normal database paths",
        padLawIds: [3, 9],
        implementationStatus: "partial",
        owners: ["src/core/operator/chat-session-store.ts"],
        evidenceRequirements: [{ probeId: "security.certificate-immutability", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "candidate",
        limitation: "A database owner can alter schema controls; independent checkpoints remain necessary.",
    },
    {
        controlId: "IC-06-CARDINALITY",
        gateNumber: 6,
        title: "Each operator has one active certificate and one active CAC assignment",
        padLawIds: [4, 9],
        implementationStatus: "partial",
        owners: ["src/core/operator/chat-session-store.ts", "src/core/accountability/character-accountability-store.ts"],
        evidenceRequirements: [{ probeId: "security.identity-cardinality", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "production",
        limitation: "Certificate uniqueness and CAC assignment uniqueness must be tested together against production migrations.",
    },
    {
        controlId: "IC-07-EXECUTION-AUTHORITY",
        gateNumber: 7,
        title: "Every privileged execution path requires server-resolved authority",
        padLawIds: [2, 4, 9, 10],
        implementationStatus: "partial",
        owners: ["src/core/security/execution-authority-context.ts", "src/core/runtime/orchestrator.ts"],
        evidenceRequirements: [{ probeId: "security.execution-authority-coverage", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "production",
        limitation: "Helper tests do not prove complete route, scheduler, MCP, A2A, and background-job coverage.",
    },
    {
        controlId: "IC-08-ACTION-PROVENANCE",
        gateNumber: 8,
        title: "Every action event persists complete authority, policy, approval, and result provenance",
        padLawIds: [6, 9],
        implementationStatus: "partial",
        owners: ["src/core/activity/sqlite-store.ts", "src/core/security/execution-authority-context.ts"],
        evidenceRequirements: [{ probeId: "security.action-provenance", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "production",
        limitation: "Existing context propagation does not yet prove every required identity and governance digest is populated.",
    },
    {
        controlId: "IC-09-GUARDIAN-BINDING",
        gateNumber: 9,
        title: "Guardian validates the exact authority binding used by each action",
        padLawIds: [3, 4, 9],
        implementationStatus: "partial",
        owners: ["src/core/agents/guardian-agent.ts"],
        evidenceRequirements: [{ probeId: "security.guardian-binding", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "production",
        limitation: "Guardian verifies all certificates but is not yet bound to every action's exact certificate and assignment.",
    },
    {
        controlId: "IC-10-FAIL-CLOSED-LOGIN",
        gateNumber: 10,
        title: "Privileged session activation fails when certificate enrollment or verification fails",
        padLawIds: [2, 9, 10],
        implementationStatus: "partial",
        owners: ["src/core/operator/routes/iam-handler.ts", "src/core/iam/store.ts", "src/core/iam/sso/session.ts"],
        evidenceRequirements: [{ probeId: "security.fail-closed-login", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "production",
        limitation: "Local login is fail-closed for privileged activation; federated enrollment and cross-database claim atomicity remain to be unified.",
    },
    {
        controlId: "IC-11-COVENANT-CANONICALITY",
        gateNumber: 11,
        title: "Runtime and published Covenants derive from one verified artifact",
        padLawIds: [4, 9, 10],
        implementationStatus: "partial",
        owners: ["src/core/governance/canonical-covenant.ts", "src/core/governance/prism-covenant.ts"],
        evidenceRequirements: [{ probeId: "security.covenant-canonicality", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "production",
        limitation: "Generated Covenant drift is enforced; remaining governance documents still require migration to generated publication.",
    },
    {
        controlId: "IC-12-AUDIT-INTEGRITY",
        gateNumber: 12,
        title: "Audit history is append-only, hash-chained, checkpoint-signed, and independently anchored",
        padLawIds: [9],
        implementationStatus: "partial",
        owners: ["src/core/activity/sqlite-store.ts", "src/core/activity/external-audit-anchor.ts"],
        evidenceRequirements: [
            { probeId: "security.audit-chain", probeVersion: 2, maxAgeMs: DAY_MS },
            { probeId: "security.audit-external-anchor", probeVersion: 1, maxAgeMs: DAY_MS },
        ],
        requiredFor: "production",
        limitation: "Persisted-range external anchors are implemented; a local file is not independent until deployed to a separately controlled sink.",
    },
    {
        controlId: "IC-13-MIGRATION-PARITY",
        gateNumber: 13,
        title: "Production migrations enforce immutability and identity cardinality",
        padLawIds: [9, 10],
        implementationStatus: "partial",
        owners: ["tests/chat-session-store.test.ts", "tests/certificate-cardinality.test.ts"],
        evidenceRequirements: [{ probeId: "security.production-migration-parity", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "candidate",
        limitation: "A cited test filename is not evidence that the current commit passed it.",
    },
    {
        controlId: "IC-14-TEST-ISOLATION",
        gateNumber: 14,
        title: "Security tests cannot access live state, keys, databases, or providers",
        padLawIds: [6, 9, 10],
        implementationStatus: "partial",
        owners: ["src/core/governance/adversarial-capability-ledger.ts", "src/core/governance/probe-registry.ts"],
        evidenceRequirements: [{ probeId: "security.test-isolation", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "candidate",
        limitation: "Suite-wide network and live-path denial are not yet established.",
    },
    {
        controlId: "IC-15-ADVERSARIAL",
        gateNumber: 15,
        title: "Adversarial tests exercise certificate and authority bypass attempts",
        padLawIds: [4, 9, 10],
        implementationStatus: "partial",
        owners: ["tests/security-negative-tests.test.ts"],
        evidenceRequirements: [{ probeId: "security.adversarial", probeVersion: 1, maxAgeMs: DAY_MS }],
        requiredFor: "production",
        limitation: "The machine ledger covers enrollment replay, approval replay/substitution, and unknown actions; broader attack coverage remains required.",
    },
];

export function validateControlRegistry(
    controls: readonly GovernanceControlDefinition[] = GOVERNANCE_CONTROLS,
): string[] {
    const errors: string[] = [];
    const controlIds = new Set<string>();
    const gateNumbers = new Set<number>();
    const validLawIds = new Set(PAD_LAWS.map((law) => law.id));

    for (const control of controls) {
        if (controlIds.has(control.controlId)) errors.push(`Duplicate controlId: ${control.controlId}`);
        if (gateNumbers.has(control.gateNumber)) errors.push(`Duplicate gateNumber: ${control.gateNumber}`);
        controlIds.add(control.controlId);
        gateNumbers.add(control.gateNumber);

        if (control.evidenceRequirements.length === 0) {
            errors.push(`${control.controlId} has no evidence requirement`);
        }
        for (const lawId of control.padLawIds) {
            if (!validLawIds.has(lawId)) errors.push(`${control.controlId} references unknown PAD Law ${lawId}`);
        }
        if (control.implementationStatus === "enforced" && control.limitation.trim() === "") {
            errors.push(`${control.controlId} claims enforcement without a stated limitation`);
        }
    }

    for (let gateNumber = 1; gateNumber <= 15; gateNumber += 1) {
        if (!gateNumbers.has(gateNumber)) errors.push(`Missing release gate ${gateNumber}`);
    }

    return errors;
}
