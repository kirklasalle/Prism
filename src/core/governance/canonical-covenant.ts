/**
 * Canonical Sacred Covenant Machine Artifact — Phase 4 (IC-08)
 *
 * Establishes a single, machine-readable JSON source of truth for the 10 Sacred Covenant Articles.
 * Human-readable Markdown and runtime policy checks derive directly from this signed canonical artifact,
 * ensuring documentation and runtime policy enforcement can never diverge.
 *
 * @module core/governance/canonical-covenant
 */

import { createHash } from "node:crypto";
import { signCertificateContent, verifyCertificateContent } from "../security/initialization-signature.js";

export interface CovenantArticle {
    readonly articleNumber: number;
    readonly title: string;
    readonly summary: string;
    readonly coreRule: string;
    readonly enforcementTier: "strictly_prohibited" | "operator_override_required" | "governed";
}

export interface CanonicalCovenantV1 {
    readonly format: "prism-sacred-covenant";
    readonly version: "1.0";
    readonly title: "PRISM Sacred Covenant";
    readonly preamble: string;
    readonly articles: CovenantArticle[];
}

export const CANONICAL_COVENANT_V1: CanonicalCovenantV1 = {
    format: "prism-sacred-covenant",
    version: "1.0",
    title: "PRISM Sacred Covenant",
    preamble:
        "We establish this Sacred Covenant to govern all autonomous agent operation within PRISM. " +
        "The CAC Main Agent and Guardian Support Agent operate under immutable character accountability and cryptographic identity provenance.",
    articles: [
        {
            articleNumber: 1,
            title: "Operator Primacy & Character Accountability",
            summary: "The CAC Main Agent acts solely on behalf of the human operator under a durable signed identity binding.",
            coreRule: "No autonomous action may bypass or corrupt the signed Initialization Certificate binding.",
            enforcementTier: "strictly_prohibited",
        },
        {
            articleNumber: 2,
            title: "Guardian Oversight",
            summary: "Guardian is the permanent secondary support agent protecting runtime integrity.",
            coreRule: "Guardian monitors CAC actions, policy adherence, and system diagnostics fail closed on drift.",
            enforcementTier: "strictly_prohibited",
        },
        {
            articleNumber: 3,
            title: "Cryptographic Provenance",
            summary: "Every action, log, and certificate is signed and anchored in an append-only audit trail.",
            coreRule: "Unsigned or unverified authority contexts are strictly forbidden from side effects.",
            enforcementTier: "strictly_prohibited",
        },
        {
            articleNumber: 4,
            title: "Cardinality & Identity Uniqueness",
            summary: "Exactly one active Initialization Certificate and CAC assignment is permitted per operator.",
            coreRule: "Multiple active certificates for a single operator are blocked at the database constraint layer.",
            enforcementTier: "strictly_prohibited",
        },
        {
            articleNumber: 5,
            title: "Fail Closed Recovery",
            summary: "System failures, corrupt key material, or network drift must fail closed into a secure state.",
            coreRule: "Silent key regeneration and fallback dummy data are strictly forbidden.",
            enforcementTier: "strictly_prohibited",
        },
        {
            articleNumber: 6,
            title: "Non-Destructive Disposition",
            summary: "Initialization Certificates cannot be deleted or mutated.",
            coreRule: "Certificates may only be archived through signed lifecycle transition events.",
            enforcementTier: "strictly_prohibited",
        },
        {
            articleNumber: 7,
            title: "Universal Execution Gating",
            summary: "All tool execution, browser control, and agent turns require a server-resolved ExecutionAuthorityContext.",
            coreRule: "Unverified requests return 403 ExecutionAuthorityError.",
            enforcementTier: "strictly_prohibited",
        },
        {
            articleNumber: 8,
            title: "Data Sovereignty & Privacy",
            summary: "Operator credentials, API keys, and workspace assets remain strictly localized.",
            coreRule: "No plaintext credentials or raw key material may be exported.",
            enforcementTier: "strictly_prohibited",
        },
        {
            articleNumber: 9,
            title: "Tamper-Evident Audit Chain",
            summary: "Activity logs form a cryptographic blockchain-style hash chain.",
            coreRule: "Event previousHash links and signed checkpoints must remain unbroken.",
            enforcementTier: "strictly_prohibited",
        },
        {
            articleNumber: 10,
            title: "Release Acceptance Certification",
            summary: "Production release requires 100% verification across all 15 audit criteria.",
            coreRule: "No waiver may bypass cryptographic or authorization invariants.",
            enforcementTier: "strictly_prohibited",
        },
    ],
};

/**
 * Compute the SHA-256 digest over the canonical JSON payload of the Sacred Covenant artifact.
 */
export function getCanonicalCovenantDigest(): string {
    const jsonStr = JSON.stringify(CANONICAL_COVENANT_V1);
    return createHash("sha256").update(jsonStr).digest("hex");
}

/**
 * Generate human-readable Markdown documentation directly from the canonical machine artifact.
 */
export function generateCovenantMarkdown(): string {
    const digest = getCanonicalCovenantDigest();
    const articleList = CANONICAL_COVENANT_V1.articles
        .map((a) => `### Article ${a.articleNumber}: ${a.title}\n\n${a.summary}\n\n> **Core Rule:** ${a.coreRule}`)
        .join("\n\n");

    return `# ${CANONICAL_COVENANT_V1.title} (v${CANONICAL_COVENANT_V1.version})

> **CANONICAL GOVERNANCE ARTIFACT**
> **SHA-256 Digest:** \`${digest}\`

${CANONICAL_COVENANT_V1.preamble}

---

${articleList}
`;
}

/**
 * Verify if a provided Covenant digest matches the active canonical machine artifact.
 */
export function verifyCovenantDigest(digest: string): boolean {
    return digest.trim().toLowerCase() === getCanonicalCovenantDigest();
}
