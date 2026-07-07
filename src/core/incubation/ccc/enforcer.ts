// RuntimePlanEnforcer — refuses to authorize execution of any step flagged as
// unsatisfiable by the CausalCompiler. Emits ActivityBus events on each refusal
// or pass so operator dashboards can surface compile-time governance.

import type { ActivityBus } from "../../activity/bus.js";
import type { CompiledStep, RuntimePlan } from "./types.js";
import { captureEnvironmentSnapshot, detectSnapshotDrift } from "./snapshot.js";

export interface EnforcementDecision {
    allowed: boolean;
    stepId: string;
    reason?: string;
    violatedPrincipleIds: string[];
    projectedDecision: CompiledStep["projectedDecision"];
}

export class RuntimePlanEnforcer {
    constructor(
        private readonly bus: ActivityBus,
        private readonly sessionId: string = "incubation",
    ) {}

    authorizeStep(plan: RuntimePlan, stepId: string): EnforcementDecision {
        const step = plan.steps.find((s) => s.stepId === stepId);
        if (!step) {
            this.bus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: "incubation.ccc.step_unknown",
                status: "failed",
                details: { dagId: plan.dagId, stepId, compilationHash: plan.compilationHash },
            });
            return {
                allowed: false,
                stepId,
                reason: `unknown step ${stepId} in plan ${plan.dagId}`,
                violatedPrincipleIds: [],
                projectedDecision: {
                    tier: "tier3_approval",
                    decision: "deny",
                    reasons: [`unknown step ${stepId}`],
                },
            };
        }

        const originalSnapshot = plan.environmentSnapshots?.[stepId];
        if (originalSnapshot) {
            const currentSnapshot = captureEnvironmentSnapshot();
            const driftReason = detectSnapshotDrift(originalSnapshot, currentSnapshot);
            if (driftReason) {
                this.bus.emit({
                    sessionId: this.sessionId,
                    layer: "governance",
                    operation: "incubation.ccc.step_drifted",
                    status: "failed",
                    policyDecision: "deny",
                    details: {
                        dagId: plan.dagId,
                        stepId,
                        operation: step.operation,
                        driftReason,
                        compilationHash: plan.compilationHash,
                    },
                });
                return {
                    allowed: false,
                    stepId,
                    reason: `Environment drift detected: ${driftReason}`,
                    violatedPrincipleIds: [],
                    projectedDecision: {
                        tier: "tier3_approval",
                        decision: "deny",
                        reasonCodes: ["CCC_ENVIRONMENT_DRIFT"],
                        reasons: [driftReason],
                    },
                };
            }
        }

        if (step.violations.length > 0) {
            const principleIds = step.violations.map((v) => v.principleId);
            this.bus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: "incubation.ccc.step_blocked",
                status: "failed",
                policyDecision: "deny",
                details: {
                    dagId: plan.dagId,
                    stepId,
                    operation: step.operation,
                    principles: principleIds,
                    reasonCodes: step.violations.map((v) => v.reasonCode).filter(Boolean),
                    compilationHash: plan.compilationHash,
                },
            });
            return {
                allowed: false,
                stepId,
                reason: `principles violated: ${principleIds.join(", ")}`,
                violatedPrincipleIds: principleIds,
                projectedDecision: step.projectedDecision,
            };
        }

        if (step.projectedDecision.decision === "deny") {
            this.bus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: "incubation.ccc.step_blocked",
                status: "failed",
                policyDecision: "deny",
                details: {
                    dagId: plan.dagId,
                    stepId,
                    operation: step.operation,
                    reasonCodes: step.projectedDecision.reasonCodes ?? [],
                    compilationHash: plan.compilationHash,
                },
            });
            return {
                allowed: false,
                stepId,
                reason: "policy projection: deny",
                violatedPrincipleIds: [],
                projectedDecision: step.projectedDecision,
            };
        }

        this.bus.emit({
            sessionId: this.sessionId,
            layer: "governance",
            operation: "incubation.ccc.step_authorized",
            status: "succeeded",
            details: {
                dagId: plan.dagId,
                stepId,
                tier: step.projectedDecision.tier,
                compilationHash: plan.compilationHash,
            },
        });
        return {
            allowed: true,
            stepId,
            violatedPrincipleIds: [],
            projectedDecision: step.projectedDecision,
        };
    }
}
