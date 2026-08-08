/**
 * Amendment Types — Governance Amendment Data Structures
 *
 * Defines the type system for PAD amendments under the dual-binary
 * governance model. The 10 Laws are IMMUTABLE — they cannot be amended.
 * Only the Amendments section of the PAD may be modified, and only when
 * BOTH the CAC (system verification) AND the Operator (human) approve.
 *
 * This dual-binary model ensures:
 *   - The system protects the 10 Laws computationally (CAC rejects anything that weakens them)
 *   - The human retains sovereignty (Operator can reject anything)
 *   - Neither party can unilaterally amend — it is a dual-key mechanism
 *
 * Per Law 10: "shall not permanently modify its core directives without
 * explicit, cryptographically secured approval from Governance."
 */

/* ── Binary Approval ────────────────────────────────────────────────── */

/**
 * A binary approval decision. No middle ground — APPROVE or REJECT.
 */
export type BinaryDecision = "APPROVE" | "REJECT";

/**
 * One half of the dual-binary approval. Each party records their
 * decision, timestamp, and rationale.
 */
export interface BinaryApproval {
    /** Which party is rendering this decision. */
    party: "CAC" | "OPERATOR";
    /** The binary decision. */
    decision: BinaryDecision;
    /** ISO-8601 timestamp of the decision. */
    decidedAt: string;
    /** Human-readable rationale for the decision. */
    rationale: string;
    /** SHA-256 hash of the amendment proposal at the time of decision. */
    proposalHash: string;
}

/**
 * The dual-binary approval record. Both parties must APPROVE for
 * the amendment to proceed. This is an AND gate — not a majority vote.
 */
export interface DualBinaryApproval {
    /** The CAC (system governance) decision. */
    cac: BinaryApproval;
    /** The Operator (human) decision. */
    operator: BinaryApproval;
    /** Whether both parties approved (computed). */
    unanimousApproval: boolean;
    /** ISO-8601 timestamp when the dual-binary evaluation completed. */
    evaluatedAt: string;
}

/* ── Amendment Proposal ─────────────────────────────────────────────── */

/**
 * The lifecycle states of an amendment proposal.
 */
export type AmendmentStatus =
    | "proposed" // Initial submission
    | "under_review" // CAC is evaluating against the 10 Laws
    | "cac_approved" // CAC has approved; awaiting Operator decision
    | "cac_rejected" // CAC rejected — amendment conflicts with 10 Laws
    | "approved" // Both CAC and Operator approved
    | "rejected" // Either party rejected
    | "applied" // Amendment has been applied to the PAD
    | "withdrawn"; // Proposer withdrew the amendment

/**
 * An amendment proposal submitted to the governance process.
 */
export interface AmendmentProposal {
    /** Unique identifier for this proposal (UUID v4). */
    proposalId: string;
    /** Sequential amendment number (e.g., "A-001"). */
    amendmentNumber: string;
    /** Human-readable title of the amendment. */
    title: string;
    /** Full text of the proposed amendment. */
    proposalText: string;
    /** Justification for why this amendment is needed. */
    justification: string;
    /** Who proposed the amendment (operator ID or email). */
    proposedBy: string;
    /** ISO-8601 timestamp of proposal submission. */
    proposedAt: string;
    /** Current lifecycle status. */
    status: AmendmentStatus;
    /** SHA-256 hash of the proposal text (for integrity verification). */
    proposalHash: string;
    /** The dual-binary approval record, if evaluation has occurred. */
    dualBinaryApproval?: DualBinaryApproval;
    /** Laws that the CAC evaluated this proposal against. */
    lawsEvaluated?: number[];
    /** If CAC rejected, which specific laws were in conflict. */
    conflictingLaws?: number[];
    /** ISO-8601 timestamp of the last status change. */
    updatedAt: string;
}

/* ── Amendment Ledger Entry ─────────────────────────────────────────── */

/**
 * An entry in the append-only, hash-chained amendment ledger.
 * Each entry includes the hash of the previous entry, creating
 * a tamper-evident chain.
 */
export interface AmendmentLedgerEntry {
    /** Sequential ledger index (0-based). */
    index: number;
    /** SHA-256 hash of the previous ledger entry (empty string for genesis). */
    previousHash: string;
    /** SHA-256 hash of THIS entry's content (computed from all fields except this one). */
    entryHash: string;
    /** ISO-8601 timestamp of ledger entry creation. */
    timestamp: string;
    /** The type of governance event being recorded. */
    eventType:
    | "genesis" // Ledger creation
    | "amendment_proposed" // New amendment submitted
    | "cac_evaluation" // CAC completed its evaluation
    | "operator_decision" // Operator rendered their decision
    | "amendment_approved" // Dual-binary approval granted
    | "amendment_rejected" // Either party rejected
    | "amendment_applied" // Amendment applied to PAD
    | "amendment_withdrawn" // Amendment withdrawn by proposer
    | "erratum_approved_pending_signature" // Exact registered correction approved
    | "erratum_rejected" // Proposed correction failed closed validation
    | "erratum_effective" // Signed PAD artifact made effective
    | "integrity_check" // Periodic integrity verification
    | "pad_hash_recorded"; // PAD hash snapshot for provenance
    /** The proposal ID this entry relates to (null for genesis/integrity events). */
    proposalId: string | null;
    /** Snapshot of the relevant data at the time of recording. */
    payload: Record<string, unknown>;
    /** The PAD SHA-256 hash at the time of this entry. */
    padHashAtEntry: string;
    /** The instance ID of the Prism platform recording this entry. */
    instanceId: string;
}

/* ── Laws Immutability ──────────────────────────────────────────────── */

/**
 * Result of the 10 Laws immutability check performed by the CAC.
 * This check verifies that a proposed amendment does not attempt
 * to modify, weaken, contradict, or circumvent any of the 10 Laws.
 */
export interface LawsImmutabilityCheckResult {
    /** Whether the proposed amendment passes the immutability check. */
    passed: boolean;
    /** ISO-8601 timestamp of the check. */
    checkedAt: string;
    /** Which laws were evaluated (always 1-10). */
    lawsChecked: number[];
    /** Any laws that would be violated or weakened by this amendment. */
    conflictingLaws: number[];
    /** Human-readable assessment for each law. */
    assessments: Array<{
        lawId: number;
        lawCode: string;
        compatible: boolean;
        reason: string;
    }>;
    /** SHA-256 hash of the proposal text that was evaluated. */
    proposalHash: string;
}

/* ── Governance Errata ─────────────────────────────────────────────── */

export type GovernanceErratumStatus = "rejected" | "approved_pending_signature" | "effective";

/**
 * A proposed correction to canonical Law text. Errata are not amendments:
 * they must match a registered, invariant-preserving text transition exactly.
 */
export interface GovernanceErratumProposal {
    erratumId: string;
    lawId: number;
    previousText: string;
    correctedText: string;
    previousTextHash: string;
    correctedTextHash: string;
    previousPadHash: string;
    correctedPadHash: string;
    rationale: string;
    machineInvariant: string;
    approvedBy: string;
    effectiveVersion: string;
}

export interface GovernanceErratumValidationResult {
    valid: boolean;
    status: GovernanceErratumStatus;
    checkedAt: string;
    errors: string[];
    erratumHash: string;
}

/* ── Governance Council ─────────────────────────────────────────────── */

/**
 * A member of the Governance Council.
 */
export interface GovernanceCouncilMember {
    /** Unique member identifier. */
    memberId: string;
    /** Display name. */
    name: string;
    /** Contact email. */
    email: string;
    /** Role on the council. */
    role: "founder" | "council_member" | "advisor";
    /** Base64-encoded public key for signature verification (Ed25519). */
    publicKeyBase64?: string;
    /** ISO-8601 date when the member joined the council. */
    joinedAt: string;
    /** Whether this member is currently active. */
    active: boolean;
}

/**
 * The Governance Council configuration.
 */
export interface GovernanceCouncilConfig {
    /** Council charter version. */
    charterVersion: string;
    /** Minimum review period for amendments (in hours). */
    minimumReviewPeriodHours: number;
    /** Whether the Founder holds constitutional veto power. */
    founderVetoEnabled: boolean;
    /** Council members. */
    members: GovernanceCouncilMember[];
}
