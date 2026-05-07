// WorkflowSynthesizer — proposes (never auto-applies) repair sub-DAGs for a
// failed step by mining a WorkflowHistoryIndex, validating each candidate via
// the CausalCompiler, and routing the survivor through ApprovalQueue tier-3.
//
// Hard limits:
//   - max depth 3 (no chained synthesis of synthesis)
//   - max 1 active synthesis per workflow
//   - never executes; result is a SynthesizedCandidate with approvalId

import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../../activity/bus.js";
import type { ApprovalQueue } from "../../approval/approval-queue.js";
import type { ExecutionProfile } from "../../policy/execution-profiles.js";
import type { Constitution } from "../ccc/types.js";
import type { WorkflowDAG, WorkflowStep, WorkflowFallback } from "../../runtime/workflow.js";
import { WorkflowHistoryIndex } from "./history-index.js";
import { PolicyValidator } from "./policy-validator.js";
import type { SynthesizedCandidate, SynthesizerStats } from "./types.js";

export interface SynthesizerOptions {
    maxDepth?: number;
    sessionId?: string;
}

export class WorkflowSynthesizer {
    private readonly maxDepth: number;
    private readonly sessionId: string;
    private readonly activeByWorkflow = new Map<string, string>(); // workflowId -> candidateId
    private readonly recentCandidates: SynthesizedCandidate[] = [];
    private stats: SynthesizerStats = {
        proposedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        historySize: 0,
    };

    constructor(
        private readonly history: WorkflowHistoryIndex,
        private readonly validator: PolicyValidator,
        private readonly approvals: ApprovalQueue,
        private readonly bus: ActivityBus,
        opts: SynthesizerOptions = {},
    ) {
        this.maxDepth = opts.maxDepth ?? 3;
        this.sessionId = opts.sessionId ?? "incubation";
    }

    proposeFallback(input: {
        failedStepId: string;
        dag: WorkflowDAG;
        profile: ExecutionProfile;
        constitution: Constitution;
        currentDepth?: number;
    }): SynthesizedCandidate | null {
        const depth = input.currentDepth ?? 0;
        if (depth >= this.maxDepth) {
            this.bus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: "incubation.shws.depth_capped",
                status: "failed",
                details: { dagId: input.dag.id, failedStepId: input.failedStepId, depth },
            });
            return null;
        }
        if (this.activeByWorkflow.has(input.dag.id)) {
            this.bus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: "incubation.shws.already_active",
                status: "failed",
                details: { dagId: input.dag.id, failedStepId: input.failedStepId },
            });
            return null;
        }

        const failed = input.dag.steps.find((s) => s.id === input.failedStepId);
        if (!failed) return null;

        const repairs = this.history.similarRepairs(failed, 5);
        if (repairs.length === 0) {
            this.bus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: "incubation.shws.no_history",
                status: "failed",
                details: { dagId: input.dag.id, failedStepId: input.failedStepId, operation: failed.operation },
            });
            return null;
        }

        const candidateId = randomUUID();
        const fragment = repairs[0];
        const proposedSteps: WorkflowStep[] = fragment.repairSteps.map((s, i) => ({
            ...s,
            id: `${candidateId}-step-${i}`,
        }));
        const proposedFallbacks: WorkflowFallback[] = proposedSteps.length > 1
            ? proposedSteps.slice(0, -1).map((s, i) => ({
                stepId: s.id,
                condition: "on_failure" as const,
                nextStepId: proposedSteps[i + 1].id,
            }))
            : [];

        const validation = this.validator.validate({
            candidateId,
            proposedSteps,
            proposedFallbacks,
            profile: input.profile,
            constitution: input.constitution,
        });

        if (!validation.enforceable) {
            this.stats = { ...this.stats, rejectedCount: this.stats.rejectedCount + 1 };
            const rejected: SynthesizedCandidate = {
                candidateId,
                sourceFragmentId: fragment.workflowId,
                failedStepId: input.failedStepId,
                proposedSteps,
                proposedFallbacks,
                compiledPlan: validation.plan,
                rationale: `mined from workflow ${fragment.workflowId} step ${fragment.stepId}`,
                rejected: { reason: validation.rejectionReason ?? "unknown" },
                requiresTier3Approval: true,
                prototype: true,
            };
            this.recordCandidate(rejected);
            this.bus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: "incubation.shws.candidate_rejected",
                status: "failed",
                policyDecision: "deny",
                details: {
                    candidateId,
                    dagId: input.dag.id,
                    failedStepId: input.failedStepId,
                    reason: validation.rejectionReason,
                },
            });
            return rejected;
        }

        // Route through ApprovalQueue tier-3 — never auto-execute.
        // We explicitly DO NOT await — caller decides how to consume.
        this.approvals.request(
            this.sessionId,
            `incubation.shws.apply.${candidateId}`,
            {
                candidateId,
                dagId: input.dag.id,
                failedStepId: input.failedStepId,
                proposedSteps,
                compilationHash: validation.plan.compilationHash,
            },
            120_000,
        ).then((approved) => {
            if (approved) {
                this.stats = { ...this.stats, approvedCount: this.stats.approvedCount + 1 };
            } else {
                this.stats = { ...this.stats, rejectedCount: this.stats.rejectedCount + 1 };
            }
            this.activeByWorkflow.delete(input.dag.id);
            this.bus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: approved
                    ? "incubation.shws.candidate_approved"
                    : "incubation.shws.candidate_denied",
                status: approved ? "succeeded" : "failed",
                policyDecision: approved ? "allow" : "deny",
                details: { candidateId, dagId: input.dag.id, depth },
            });
        }).catch(() => {
            this.activeByWorkflow.delete(input.dag.id);
        });

        const candidate: SynthesizedCandidate = {
            candidateId,
            sourceFragmentId: fragment.workflowId,
            failedStepId: input.failedStepId,
            proposedSteps,
            proposedFallbacks,
            compiledPlan: validation.plan,
            rationale: `mined from workflow ${fragment.workflowId} step ${fragment.stepId}; depth=${depth}`,
            requiresTier3Approval: true,
            prototype: true,
        };
        this.activeByWorkflow.set(input.dag.id, candidateId);
        this.stats = { ...this.stats, proposedCount: this.stats.proposedCount + 1 };
        this.recordCandidate(candidate);

        this.bus.emit({
            sessionId: this.sessionId,
            layer: "governance",
            operation: "incubation.shws.candidate_proposed",
            status: "succeeded",
            details: {
                candidateId,
                dagId: input.dag.id,
                failedStepId: input.failedStepId,
                proposedStepCount: proposedSteps.length,
                compilationHash: validation.plan.compilationHash,
                depth,
            },
        });
        return candidate;
    }

    getStats(): SynthesizerStats {
        return { ...this.stats, historySize: this.history.size() };
    }

    getRecentCandidates(limit: number = 20): SynthesizedCandidate[] {
        return this.recentCandidates.slice(-Math.max(1, limit)).reverse();
    }

    private recordCandidate(candidate: SynthesizedCandidate): void {
        this.recentCandidates.push(candidate);
        while (this.recentCandidates.length > 50) this.recentCandidates.shift();
    }
}
