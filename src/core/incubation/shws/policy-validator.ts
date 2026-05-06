// Policy validator for synthesized fallback proposals — wraps the CausalCompiler
// so we never propose a plan that won't pass governance projection.

import type { CausalCompiler } from "../ccc/compiler.js";
import type { Constitution, RuntimePlan } from "../ccc/types.js";
import type { ExecutionProfile } from "../../policy/execution-profiles.js";
import type { WorkflowStep, WorkflowFallback } from "../../runtime/workflow.js";

export interface ValidatorInputs {
    candidateId: string;
    proposedSteps: WorkflowStep[];
    proposedFallbacks: WorkflowFallback[];
    profile: ExecutionProfile;
    constitution: Constitution;
}

export interface ValidationResult {
    plan: RuntimePlan;
    enforceable: boolean;
    rejectionReason?: string;
}

export class PolicyValidator {
    constructor(private readonly compiler: CausalCompiler) { }

    validate(inputs: ValidatorInputs): ValidationResult {
        const dag = {
            id: `shws-candidate-${inputs.candidateId}`,
            name: `SHWS proposal ${inputs.candidateId}`,
            steps: inputs.proposedSteps,
            fallbacks: inputs.proposedFallbacks,
        };
        const plan = this.compiler.compile(dag, {
            profile: inputs.profile,
            constitution: inputs.constitution,
        });
        if (!plan.enforceable) {
            const denials = plan.steps
                .filter((s) => s.projectedDecision.decision === "deny")
                .map((s) => s.stepId);
            const violations = plan.unsatisfiableSteps.map((v) => `${v.stepId}:${v.principleId}`);
            return {
                plan,
                enforceable: false,
                rejectionReason: `policy/constitution violations: denied=[${denials.join(",")}] violations=[${violations.join(",")}]`,
            };
        }
        return { plan, enforceable: true };
    }
}
