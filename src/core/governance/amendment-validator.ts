/**
 * Amendment Validator — Dual-Binary Governance Gate
 *
 * Implements the dual-binary amendment approval process for the
 * Permanent Active Directives. Every Prism instance has this
 * responsibility — the 10 Laws are protected at every node.
 *
 * The dual-binary model:
 *   BINARY 1 — CAC (Character Accountability Control / System):
 *     Automated verification that the proposed amendment does NOT
 *     modify, weaken, contradict, or circumvent any of the 10 Laws.
 *     The CAC protects the Laws computationally.
 *
 *   BINARY 2 — OPERATOR (Human):
 *     The human operator explicitly approves or rejects the amendment.
 *     The Operator retains sovereignty — they can reject anything.
 *
 * BOTH must APPROVE for the amendment to proceed. This is an AND gate.
 * Neither party can unilaterally amend the PAD.
 *
 * The 10 Laws themselves are IMMUTABLE. This validator enforces that
 * constraint absolutely. Only the Amendments section may be modified.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";
import { checkLawsImmutability } from "./laws-immutability-guard.js";
import type { AmendmentLedger } from "./amendment-ledger.js";
import type { AmendmentProposal, AmendmentStatus, BinaryApproval, DualBinaryApproval } from "./amendment-types.js";

/* ── Amendment Validator ────────────────────────────────────────────── */

export class AmendmentValidator {
    private readonly proposals: Map<string, AmendmentProposal> = new Map();
    private readonly activityBus: ActivityBus;
    private readonly ledger: AmendmentLedger;
    private nextAmendmentNumber: number = 1;

    constructor(activityBus: ActivityBus, ledger: AmendmentLedger) {
        this.activityBus = activityBus;
        this.ledger = ledger;

        // Determine next amendment number from existing ledger entries
        const entries = ledger.getEntries();
        for (const entry of entries) {
            if (entry.eventType === "amendment_proposed" && entry.payload?.amendmentNumber) {
                const num = parseInt(String(entry.payload.amendmentNumber).replace(/^A-/, ""), 10);
                if (!isNaN(num) && num >= this.nextAmendmentNumber) {
                    this.nextAmendmentNumber = num + 1;
                }
            }
        }
    }

    /* ── Proposal Lifecycle ─────────────────────────────────────────── */

    /**
     * Submit a new amendment proposal. This begins the governance process.
     * The CAC evaluation runs immediately and automatically.
     *
     * @returns The created proposal with the CAC's binary decision.
     */
    submitProposal(
        title: string,
        proposalText: string,
        justification: string,
        proposedBy: string,
        padHash: string,
    ): AmendmentProposal {
        const proposalId = randomUUID();
        const amendmentNumber = `A-${String(this.nextAmendmentNumber).padStart(3, "0")}`;
        this.nextAmendmentNumber++;

        const proposalHash = createHash("sha256").update(proposalText, "utf8").digest("hex");
        const now = new Date().toISOString();

        const proposal: AmendmentProposal = {
            proposalId,
            amendmentNumber,
            title,
            proposalText,
            justification,
            proposedBy,
            proposedAt: now,
            status: "proposed",
            proposalHash,
            updatedAt: now,
        };

        this.proposals.set(proposalId, proposal);

        // Record in ledger
        this.ledger.append(
            "amendment_proposed",
            proposalId,
            {
                amendmentNumber,
                title,
                proposalHash,
                proposedBy,
            },
            padHash,
        );

        // Emit governance event
        this.emitGovernanceEvent("governance.amendment.proposed", "succeeded", {
            proposalId,
            amendmentNumber,
            title,
            proposedBy,
        });

        // Run CAC evaluation immediately
        this.runCacEvaluation(proposalId, padHash);

        return this.proposals.get(proposalId)!;
    }

    /**
     * CAC (system) evaluation — Binary 1 of the dual-binary gate.
     *
     * The CAC automatically evaluates whether the proposed amendment
     * conflicts with any of the 10 Laws. This is deterministic and
     * computational — no human judgment involved.
     */
    private runCacEvaluation(proposalId: string, padHash: string): void {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) return;

        proposal.status = "under_review";
        proposal.updatedAt = new Date().toISOString();

        // Run the Laws Immutability Guard
        const immutabilityResult = checkLawsImmutability(proposal.proposalText);

        proposal.lawsEvaluated = immutabilityResult.lawsChecked;

        const cacDecision: BinaryApproval = {
            party: "CAC",
            decision: immutabilityResult.passed ? "APPROVE" : "REJECT",
            decidedAt: new Date().toISOString(),
            rationale: immutabilityResult.passed
                ? "Amendment does not conflict with any of the 10 Laws. The Laws remain immutable."
                : `Amendment conflicts with Law(s) ${immutabilityResult.conflictingLaws.join(", ")}. The 10 Laws are immutable and cannot be weakened, modified, or circumvented.`,
            proposalHash: proposal.proposalHash,
        };

        if (!immutabilityResult.passed) {
            proposal.status = "cac_rejected";
            proposal.conflictingLaws = immutabilityResult.conflictingLaws;

            // Initialize dual-binary with CAC rejection
            proposal.dualBinaryApproval = {
                cac: cacDecision,
                operator: {
                    party: "OPERATOR",
                    decision: "REJECT",
                    decidedAt: cacDecision.decidedAt,
                    rationale: "Automatically rejected: CAC determined the amendment conflicts with immutable Laws.",
                    proposalHash: proposal.proposalHash,
                },
                unanimousApproval: false,
                evaluatedAt: cacDecision.decidedAt,
            };
        } else {
            proposal.status = "cac_approved";

            // Store CAC approval; awaiting Operator decision
            if (!proposal.dualBinaryApproval) {
                proposal.dualBinaryApproval = {
                    cac: cacDecision,
                    operator: {
                        party: "OPERATOR",
                        decision: "REJECT", // Default until Operator explicitly approves
                        decidedAt: "",
                        rationale: "Awaiting Operator decision",
                        proposalHash: proposal.proposalHash,
                    },
                    unanimousApproval: false,
                    evaluatedAt: "",
                };
            } else {
                proposal.dualBinaryApproval.cac = cacDecision;
            }
        }

        proposal.updatedAt = new Date().toISOString();

        // Record in ledger
        this.ledger.append(
            "cac_evaluation",
            proposalId,
            {
                decision: cacDecision.decision,
                rationale: cacDecision.rationale,
                lawsEvaluated: immutabilityResult.lawsChecked,
                conflictingLaws: immutabilityResult.conflictingLaws,
                assessments: immutabilityResult.assessments,
            },
            padHash,
        );

        // Emit governance event
        this.emitGovernanceEvent("governance.amendment.cac_evaluated", "succeeded", {
            proposalId,
            amendmentNumber: proposal.amendmentNumber,
            cacDecision: cacDecision.decision,
            conflictingLaws: immutabilityResult.conflictingLaws,
        });

        console.log(
            `[PRISM][governance] CAC evaluation for ${proposal.amendmentNumber}: ${cacDecision.decision}` +
                (immutabilityResult.conflictingLaws.length > 0
                    ? ` (conflicts with Laws: ${immutabilityResult.conflictingLaws.join(", ")})`
                    : ""),
        );
    }

    /**
     * Operator (human) decision — Binary 2 of the dual-binary gate.
     *
     * The Operator explicitly approves or rejects the amendment.
     * This can only proceed if the CAC has already approved.
     * If the CAC rejected, the Operator cannot override.
     *
     * @returns The updated proposal with the final dual-binary result.
     */
    recordOperatorDecision(
        proposalId: string,
        decision: "APPROVE" | "REJECT",
        rationale: string,
        operatorId: string,
        padHash: string,
    ): AmendmentProposal | null {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) return null;

        // Cannot override a CAC rejection
        if (proposal.status === "cac_rejected") {
            console.warn(
                `[PRISM][governance] Operator cannot override CAC rejection for ${proposal.amendmentNumber}. The 10 Laws are immutable.`,
            );
            return proposal;
        }

        // Must be in cac_approved state
        if (proposal.status !== "cac_approved") {
            console.warn(
                `[PRISM][governance] Operator decision not applicable in state '${proposal.status}' for ${proposal.amendmentNumber}`,
            );
            return proposal;
        }

        const operatorApproval: BinaryApproval = {
            party: "OPERATOR",
            decision,
            decidedAt: new Date().toISOString(),
            rationale,
            proposalHash: proposal.proposalHash,
        };

        // Complete the dual-binary evaluation
        const unanimousApproval = proposal.dualBinaryApproval!.cac.decision === "APPROVE" && decision === "APPROVE";

        const dualBinary: DualBinaryApproval = {
            cac: proposal.dualBinaryApproval!.cac,
            operator: operatorApproval,
            unanimousApproval,
            evaluatedAt: new Date().toISOString(),
        };

        proposal.dualBinaryApproval = dualBinary;
        proposal.status = unanimousApproval ? "approved" : "rejected";
        proposal.updatedAt = new Date().toISOString();

        // Record in ledger
        this.ledger.append(
            "operator_decision",
            proposalId,
            {
                decision,
                rationale,
                operatorId,
            },
            padHash,
        );

        // Record the final dual-binary result
        this.ledger.append(
            unanimousApproval ? "amendment_approved" : "amendment_rejected",
            proposalId,
            {
                amendmentNumber: proposal.amendmentNumber,
                cacDecision: dualBinary.cac.decision,
                operatorDecision: dualBinary.operator.decision,
                unanimousApproval,
            },
            padHash,
        );

        // Emit governance events
        this.emitGovernanceEvent("governance.amendment.operator_decided", "succeeded", {
            proposalId,
            amendmentNumber: proposal.amendmentNumber,
            operatorDecision: decision,
            operatorId,
        });

        this.emitGovernanceEvent(
            unanimousApproval
                ? "governance.amendment.dual_binary_approved"
                : "governance.amendment.dual_binary_rejected",
            "succeeded",
            {
                proposalId,
                amendmentNumber: proposal.amendmentNumber,
                unanimousApproval,
                cacDecision: dualBinary.cac.decision,
                operatorDecision: dualBinary.operator.decision,
            },
        );

        console.log(
            `[PRISM][governance] Dual-binary result for ${proposal.amendmentNumber}: ` +
                `CAC=${dualBinary.cac.decision}, OPERATOR=${dualBinary.operator.decision} → ` +
                `${unanimousApproval ? "APPROVED ✓" : "REJECTED ✗"}`,
        );

        return proposal;
    }

    /**
     * Withdraw a proposal. Only the original proposer can withdraw.
     */
    withdrawProposal(proposalId: string, reason: string, padHash: string): AmendmentProposal | null {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) return null;
        if (proposal.status === "applied") return proposal; // Cannot withdraw applied amendments

        proposal.status = "withdrawn";
        proposal.updatedAt = new Date().toISOString();

        this.ledger.append("amendment_withdrawn", proposalId, { reason }, padHash);

        this.emitGovernanceEvent("governance.amendment.withdrawn", "succeeded", {
            proposalId,
            amendmentNumber: proposal.amendmentNumber,
            reason,
        });

        return proposal;
    }

    /**
     * Mark an approved amendment as applied to the PAD.
     * This should be called after the PAD file has been updated
     * and the new hash has been computed.
     */
    markApplied(proposalId: string, newPadHash: string, previousPadHash: string): AmendmentProposal | null {
        const proposal = this.proposals.get(proposalId);
        if (!proposal || proposal.status !== "approved") return null;

        proposal.status = "applied";
        proposal.updatedAt = new Date().toISOString();

        this.ledger.append(
            "amendment_applied",
            proposalId,
            {
                amendmentNumber: proposal.amendmentNumber,
                previousPadHash,
                newPadHash,
                appliedAt: proposal.updatedAt,
            },
            newPadHash,
        );

        this.emitGovernanceEvent("governance.amendment.applied", "succeeded", {
            proposalId,
            amendmentNumber: proposal.amendmentNumber,
            previousPadHash,
            newPadHash,
        });

        console.log(
            `[PRISM][governance] Amendment ${proposal.amendmentNumber} applied. ` +
                `PAD hash: ${previousPadHash.slice(0, 16)}… → ${newPadHash.slice(0, 16)}…`,
        );

        return proposal;
    }

    /* ── Query ──────────────────────────────────────────────────────── */

    /**
     * Get a proposal by ID.
     */
    getProposal(proposalId: string): AmendmentProposal | null {
        return this.proposals.get(proposalId) ?? null;
    }

    /**
     * List all proposals, optionally filtered by status.
     */
    listProposals(status?: AmendmentStatus): AmendmentProposal[] {
        const all = Array.from(this.proposals.values());
        return status ? all.filter((p) => p.status === status) : all;
    }

    /**
     * Get a summary of the governance state for dashboard display.
     */
    getSummary(): {
        totalProposals: number;
        byStatus: Record<AmendmentStatus, number>;
        ledgerEntries: number;
        ledgerValid: boolean;
    } {
        const byStatus: Record<AmendmentStatus, number> = {
            proposed: 0,
            under_review: 0,
            cac_approved: 0,
            cac_rejected: 0,
            approved: 0,
            rejected: 0,
            applied: 0,
            withdrawn: 0,
        };

        for (const p of this.proposals.values()) {
            byStatus[p.status]++;
        }

        const chainVerification = this.ledger.verifyChain();

        return {
            totalProposals: this.proposals.size,
            byStatus,
            ledgerEntries: this.ledger.length,
            ledgerValid: chainVerification.valid,
        };
    }

    /* ── Internal ───────────────────────────────────────────────────── */

    private emitGovernanceEvent(
        operation: string,
        status: "succeeded" | "failed",
        details: Record<string, unknown>,
    ): void {
        this.activityBus.emit({
            sessionId: "governance",
            layer: "governance",
            operation,
            status,
            details: {
                ...details,
                source: "amendment-validator",
                dualBinaryGate: true,
            },
        });
    }
}
