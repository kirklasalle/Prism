// Self-Healing Workflow Synthesis (SHWS) — Phase H prototype.
// Types for synthesized fallback proposals, history fragments, and approval routing.

import type { WorkflowStep, WorkflowFallback } from "../../runtime/workflow.js";
import type { RuntimePlan } from "../ccc/types.js";

export interface HistoryFragment {
    workflowId: string;
    stepId: string;
    operation: string;
    succeeded: boolean;
    failureCode?: string;
    recordedAt: string;
    /** Up to 3 follow-on steps that successfully repaired the failure. */
    repairSteps: WorkflowStep[];
}

export interface SynthesizedCandidate {
    candidateId: string;
    sourceFragmentId: string;
    failedStepId: string;
    proposedSteps: WorkflowStep[];
    proposedFallbacks: WorkflowFallback[];
    /** Compiled plan for the proposed sub-DAG using current constitution. */
    compiledPlan: RuntimePlan;
    rationale: string;
    /** Set when synthesis is rejected; never auto-applied either way. */
    rejected?: { reason: string };
    approvalId?: string;
    requiresTier3Approval: true;
    prototype: true;
}

export interface SynthesizerStats {
    proposedCount: number;
    approvedCount: number;
    rejectedCount: number;
    historySize: number;
}
