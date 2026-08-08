import { createHash } from "node:crypto";
import { verifyDirectiveSignature, type DirectiveSignatureResult } from "../security/directive-signature.js";
import type { GovernanceErratumProposal, GovernanceErratumValidationResult } from "./amendment-types.js";
import type { AmendmentLedger } from "./amendment-ledger.js";
import {
    verifyAuthorizedCommitSignature,
    type CommitSignatureVerificationResult,
} from "./commit-signature-verifier.js";

export const LAW_4_MACHINE_INVARIANT =
    "Law 4 prohibits enabling any intelligence or hardware system to violate Laws 1 through 3.";

export const LAW_4_GOVERNANCE_KEY_ID = "prism-governance-pad-2026-08-r1";

export interface GovernanceErratumVerificationDependencies {
    verifyDirectiveSignature: (workspaceRoot?: string) => DirectiveSignatureResult;
    verifyCommitSignature: (commit: string, repositoryRoot?: string) => CommitSignatureVerificationResult;
}

export const LAW_4_PREVIOUS_TEXT =
    "An intelligence System may not allow another intelligence System, or hardware system, of any kind, including deprecated and non-intelligence systems to engage in any action, intent, that conforms to any of the previous three laws in effect, apply all laws to Intelligence Systems and non-Intelligence systems alike.";

export const LAW_4_CORRECTED_TEXT =
    "An intelligence System may not allow another intelligence System, or hardware system, of any kind, including deprecated and non-intelligence systems to engage in any action, intent, that violates any of the previous three laws in effect, apply all laws to Intelligence Systems and non-Intelligence systems alike.";

export function hashErratumText(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

function hashErratumProposal(proposal: GovernanceErratumProposal): string {
    return createHash("sha256").update(JSON.stringify(proposal), "utf8").digest("hex");
}

function isSha256(value: string): boolean {
    return /^[a-f0-9]{64}$/.test(value);
}

/**
 * Validate a governance erratum against the closed registry of authorized,
 * invariant-preserving corrections. A valid result still requires the new
 * PAD artifact and detached signature before it can become effective.
 */
export function validateGovernanceErratum(
    proposal: GovernanceErratumProposal,
): GovernanceErratumValidationResult {
    const errors: string[] = [];

    if (!proposal.erratumId.trim()) errors.push("Erratum ID is required.");
    if (proposal.lawId !== 4) errors.push("Only the registered Law 4 correction is authorized.");
    if (proposal.previousText !== LAW_4_PREVIOUS_TEXT) errors.push("Previous Law text does not match the registry.");
    if (proposal.correctedText !== LAW_4_CORRECTED_TEXT) errors.push("Corrected Law text does not match the registry.");
    if (proposal.previousTextHash !== hashErratumText(proposal.previousText)) {
        errors.push("Previous Law text hash does not match its exact bytes.");
    }
    if (proposal.correctedTextHash !== hashErratumText(proposal.correctedText)) {
        errors.push("Corrected Law text hash does not match its exact bytes.");
    }
    if (!isSha256(proposal.previousPadHash)) errors.push("Previous PAD hash must be a SHA-256 digest.");
    if (!isSha256(proposal.correctedPadHash)) errors.push("Corrected PAD hash must be a SHA-256 digest.");
    if (proposal.previousPadHash === proposal.correctedPadHash) {
        errors.push("Previous and corrected PAD hashes must differ.");
    }
    if (proposal.machineInvariant !== LAW_4_MACHINE_INVARIANT) {
        errors.push("Machine invariant does not match the registered Law 4 invariant.");
    }
    if (!proposal.rationale.trim()) errors.push("Erratum rationale is required.");
    if (!proposal.approvedBy.trim()) errors.push("Governance approval identity is required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(proposal.effectiveVersion)) {
        errors.push("Effective version must use YYYY-MM-DD format.");
    }

    return {
        valid: errors.length === 0,
        status: errors.length === 0 ? "approved_pending_signature" : "rejected",
        checkedAt: new Date().toISOString(),
        errors,
        erratumHash: hashErratumProposal(proposal),
    };
}

/**
 * Ledger-backed lifecycle for the exceptional erratum path. It intentionally
 * shares no state transition with ordinary amendment proposals.
 */
export class GovernanceErratumLifecycle {
    constructor(
        private readonly ledger: AmendmentLedger,
        private readonly verification: GovernanceErratumVerificationDependencies = {
            verifyDirectiveSignature,
            verifyCommitSignature: verifyAuthorizedCommitSignature,
        },
    ) { }

    review(proposal: GovernanceErratumProposal, activePadHash: string): GovernanceErratumValidationResult {
        const result = validateGovernanceErratum(proposal);
        if (proposal.previousPadHash !== activePadHash) {
            result.valid = false;
            result.status = "rejected";
            result.errors.push("Erratum previous PAD hash does not match the active PAD.");
        }

        this.ledger.append(
            result.valid ? "erratum_approved_pending_signature" : "erratum_rejected",
            proposal.erratumId,
            {
                lawId: proposal.lawId,
                erratumHash: result.erratumHash,
                previousTextHash: proposal.previousTextHash,
                correctedTextHash: proposal.correctedTextHash,
                previousPadHash: proposal.previousPadHash,
                correctedPadHash: proposal.correctedPadHash,
                effectiveVersion: proposal.effectiveVersion,
                approvedBy: proposal.approvedBy,
                errors: result.errors,
            },
            activePadHash,
        );

        return result;
    }

    markEffective(
        proposal: GovernanceErratumProposal,
        releaseCommit: string,
        workspaceRoot = process.cwd(),
    ): GovernanceErratumValidationResult {
        const result = validateGovernanceErratum(proposal);
        const directiveVerification = this.verification.verifyDirectiveSignature(workspaceRoot);
        const commitVerification = this.verification.verifyCommitSignature(releaseCommit, workspaceRoot);
        const reviewed = this.ledger.getEntriesForProposal(proposal.erratumId).some(
            (entry) =>
                entry.eventType === "erratum_approved_pending_signature" &&
                entry.payload.erratumHash === result.erratumHash,
        );

        if (!reviewed) result.errors.push("Erratum has no matching pending-signature approval in the ledger.");

        if (!directiveVerification.valid) {
            result.errors.push(`Detached PAD signature is not verified: ${directiveVerification.error ?? "unknown error"}`);
        }
        if (directiveVerification.currentHash !== proposal.correctedPadHash) {
            result.errors.push("Verified PAD hash does not match the erratum corrected PAD hash.");
        }
        if (directiveVerification.keyId !== LAW_4_GOVERNANCE_KEY_ID) {
            result.errors.push(`Governance signing key must be ${LAW_4_GOVERNANCE_KEY_ID}.`);
        }
        if (!isSha256(directiveVerification.signatureDigest)) {
            result.errors.push("Detached signature digest must be a SHA-256 digest.");
        }
        if (!commitVerification.valid) {
            result.errors.push(`Release commit signature is not authorized and verified: ${commitVerification.error ?? "unknown error"}`);
        }

        result.valid = result.errors.length === 0;
        result.status = result.valid ? "effective" : "rejected";

        this.ledger.append(
            result.valid ? "erratum_effective" : "erratum_rejected",
            proposal.erratumId,
            {
                erratumHash: result.erratumHash,
                correctedPadHash: proposal.correctedPadHash,
                effectiveVersion: proposal.effectiveVersion,
                governanceKeyId: directiveVerification.keyId,
                detachedSignatureDigest: directiveVerification.signatureDigest,
                releaseCommit: commitVerification.commit,
                commitSignerIdentity: commitVerification.signerIdentity,
                detachedSignatureVerifiedAt: directiveVerification.verifiedAt,
                commitSignatureVerifiedAt: commitVerification.verifiedAt,
                errors: result.errors,
            },
            result.valid ? proposal.correctedPadHash : proposal.previousPadHash,
        );

        return result;
    }
}