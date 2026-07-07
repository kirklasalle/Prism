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
    processedSteps?: WorkflowStep[];
}

export class PolicyValidator {
    constructor(private readonly compiler: CausalCompiler) {}

    validate(inputs: ValidatorInputs): ValidationResult {
        // Evaluate cumulative risk of all actions in the repair chain
        let totalMediumRiskCount = 0;
        let targetsDeletionOrAlteration = false;

        for (const step of inputs.proposedSteps) {
            if (step.risk === "medium") {
                totalMediumRiskCount++;
            }
            const op = step.operation.toLowerCase();
            if (
                op.includes("delete") ||
                op.includes("remove") ||
                op.includes("truncate") ||
                op.includes("destroy") ||
                op.includes("format")
            ) {
                targetsDeletionOrAlteration = true;
            }
        }

        // If we have multiple medium-risk steps, or if they target deletion/alteration signatures collectively,
        // we upgrade the risk tier to "high" (Tier 3)
        const shouldUpgrade = totalMediumRiskCount >= 2 || (totalMediumRiskCount >= 1 && targetsDeletionOrAlteration);

        const processedSteps = inputs.proposedSteps.map((step) => {
            if (shouldUpgrade && step.risk === "medium") {
                return {
                    ...step,
                    risk: "high" as const,
                };
            }
            return step;
        });

        const dag = {
            id: `shws-candidate-${inputs.candidateId}`,
            name: `SHWS proposal ${inputs.candidateId}`,
            steps: processedSteps,
            fallbacks: inputs.proposedFallbacks,
        };
        const plan = this.compiler.compile(dag, {
            profile: inputs.profile,
            constitution: inputs.constitution,
        });
        if (!plan.enforceable) {
            const denials = plan.steps.filter((s) => s.projectedDecision.decision === "deny").map((s) => s.stepId);
            const violations = plan.unsatisfiableSteps.map((v) => `${v.stepId}:${v.principleId}`);
            return {
                plan,
                enforceable: false,
                rejectionReason: `policy/constitution violations: denied=[${denials.join(",")}] violations=[${violations.join(",")}]`,
                processedSteps,
            };
        }
        return { plan, enforceable: true, processedSteps };
    }
}
