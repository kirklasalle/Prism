// Constitutional Causal Compiler (CCC) — Phase H prototype.
// Types for declarative constitutions, compiled runtime plans, and policy projections.
// See docs/TODO.md "Novel Systems Incubation" and the session plan in /memories/session/.

import type { OperationRisk } from "../../policy/types.js";
import type { PolicyResult } from "../../policy/types.js";

export type RiskFilter = OperationRisk;

export interface ConstitutionPrinciple {
    id: string;
    description?: string;
    appliesTo: {
        operations?: string[];          // e.g. ["email_ops", "shell_exec"]; empty/undefined = all
        risk?: RiskFilter[];            // e.g. ["medium", "high"]
    };
    require?: {
        rollbackPlan?: boolean;
        verifiedEmail?: boolean;
        cacBound?: boolean;
        maxTimeoutMs?: number;          // step.timeoutMs must be ≤ this
    };
    forbidIfReasonCode?: string[];      // e.g. ["CAC_PLACEHOLDER_IDENTITY_DENY"]
}

export interface MemoryInvariant {
    id: string;
    type: "min_coverage" | "min_utility" | "no_drift_above";
    threshold: number;                  // [0,1] for coverage/utility, [0,∞) for drift
}

export interface Constitution {
    version: string;                    // semver
    id: string;
    description?: string;
    principles: ConstitutionPrinciple[];
    memoryInvariants?: MemoryInvariant[];
}

export interface PrincipleViolation {
    stepId: string;
    principleId: string;
    reason: string;
    reasonCode?: string;
}

export interface CompiledStep {
    stepId: string;
    operation: string;
    risk: OperationRisk;
    preconditions: string[];            // human-readable + machine-checkable invariant ids
    postconditions: string[];
    projectedDecision: PolicyResult;    // what PolicyEngine.evaluate() will say at runtime
    appliedPrincipleIds: string[];
    violations: PrincipleViolation[];
}

export interface RuntimePlan {
    dagId: string;
    dagName: string;
    constitutionId: string;
    constitutionVersion: string;
    profileSegment: "individual" | "business";
    compilationHash: string;            // sha256 of canonicalized plan
    generatedAt: string;
    steps: CompiledStep[];
    unsatisfiableSteps: PrincipleViolation[];
    /** True if every step has a non-deny projection AND no unsatisfiable principles. */
    enforceable: boolean;
    prototype: true;
}
