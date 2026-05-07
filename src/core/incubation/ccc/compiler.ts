// CausalCompiler — projects a workflow DAG against a Constitution + the live
// PolicyEngine to produce a deterministic, content-addressed RuntimePlan.
//
// This is a *compile-time* analysis: we run PolicyEngine.evaluate() over each
// step's static envelope (operation, risk, mutatesState, rollbackPlan, profile)
// and capture the projected decision. We then evaluate each constitution
// principle against the step. Violations are recorded but do not throw — the
// resulting plan exposes them via `unsatisfiableSteps` and `enforceable=false`.

import { createHash } from "node:crypto";
import type { WorkflowDAG } from "../../runtime/workflow.js";
import type { PolicyEngine } from "../../policy/engine.js";
import type { PolicyContext, PolicyResult } from "../../policy/types.js";
import type { ExecutionProfile } from "../../policy/execution-profiles.js";
import type {
    CompiledStep,
    Constitution,
    ConstitutionPrinciple,
    PrincipleViolation,
    RuntimePlan,
} from "./types.js";

export interface CompileOptions {
    profile: ExecutionProfile;
    constitution: Constitution;
    /** Optional CAC snapshot used for projection — same shape as PolicyContext.cac. */
    cac?: PolicyContext["cac"];
    /** Set of operations that are "email-bound" for E5 OAuth gate projection. */
    emailBoundOperations?: Set<string>;
}

export class CausalCompiler {
    constructor(private readonly policyEngine: PolicyEngine) { }

    compile(dag: WorkflowDAG, opts: CompileOptions): RuntimePlan {
        const steps: CompiledStep[] = [];
        const unsatisfiable: PrincipleViolation[] = [];

        for (const step of dag.steps) {
            const ctx: PolicyContext = {
                operation: step.operation,
                risk: step.risk,
                mutatesState: step.mutatesState,
                rollbackPlan: step.rollbackPlan,
                executionProfile: opts.profile,
                cac: opts.cac,
                emailBound: opts.emailBoundOperations?.has(step.operation) === true,
            };
            const projected: PolicyResult = this.policyEngine.evaluate(ctx);

            const applicable = applicablePrinciples(opts.constitution, step.operation, step.risk);
            const violations: PrincipleViolation[] = [];
            const appliedIds: string[] = [];

            for (const p of applicable) {
                appliedIds.push(p.id);
                const v = checkPrinciple(p, step, projected);
                if (v) {
                    violations.push({ stepId: step.id, principleId: p.id, ...v });
                }
            }

            const compiledStep: CompiledStep = {
                stepId: step.id,
                operation: step.operation,
                risk: step.risk,
                preconditions: derivePreconditions(applicable),
                postconditions: derivePostconditions(applicable),
                projectedDecision: projected,
                appliedPrincipleIds: appliedIds,
                violations,
            };
            steps.push(compiledStep);
            unsatisfiable.push(...violations);
        }

        const enforceable = unsatisfiable.length === 0
            && steps.every((s) => s.projectedDecision.decision !== "deny");

        const skeleton = {
            dagId: dag.id,
            dagName: dag.name,
            constitutionId: opts.constitution.id,
            constitutionVersion: opts.constitution.version,
            profileSegment: opts.profile.segment,
            steps: steps.map((s) => ({
                stepId: s.stepId,
                operation: s.operation,
                risk: s.risk,
                preconditions: s.preconditions,
                postconditions: s.postconditions,
                projectedDecision: {
                    tier: s.projectedDecision.tier,
                    decision: s.projectedDecision.decision,
                    reasonCodes: s.projectedDecision.reasonCodes ?? [],
                },
                appliedPrincipleIds: s.appliedPrincipleIds,
                violations: s.violations.map((v) => ({
                    principleId: v.principleId,
                    reasonCode: v.reasonCode,
                })),
            })),
        };

        const compilationHash = sha256Canonical(skeleton);

        return {
            dagId: dag.id,
            dagName: dag.name,
            constitutionId: opts.constitution.id,
            constitutionVersion: opts.constitution.version,
            profileSegment: opts.profile.segment,
            compilationHash,
            // generatedAt is stamped after hash so it doesn't perturb determinism
            generatedAt: new Date().toISOString(),
            steps,
            unsatisfiableSteps: unsatisfiable,
            enforceable,
            prototype: true,
        };
    }
}

function applicablePrinciples(
    c: Constitution,
    operation: string,
    risk: "low" | "medium" | "high",
): ConstitutionPrinciple[] {
    return c.principles.filter((p) => {
        const ops = p.appliesTo.operations;
        if (ops && ops.length > 0 && !ops.includes(operation)) return false;
        const risks = p.appliesTo.risk;
        if (risks && risks.length > 0 && !risks.includes(risk)) return false;
        return true;
    });
}

function checkPrinciple(
    p: ConstitutionPrinciple,
    step: { rollbackPlan?: string; timeoutMs?: number; operation: string },
    projected: PolicyResult,
): { reason: string; reasonCode?: string } | null {
    if (p.require?.rollbackPlan && !step.rollbackPlan) {
        return {
            reason: `principle ${p.id}: requires rollbackPlan`,
            reasonCode: "CCC_ROLLBACK_PLAN_REQUIRED",
        };
    }
    if (p.require?.maxTimeoutMs !== undefined
        && step.timeoutMs !== undefined
        && step.timeoutMs > p.require.maxTimeoutMs) {
        return {
            reason: `principle ${p.id}: timeoutMs ${step.timeoutMs} exceeds maxTimeoutMs ${p.require.maxTimeoutMs}`,
            reasonCode: "CCC_TIMEOUT_EXCEEDED",
        };
    }
    if (p.forbidIfReasonCode && p.forbidIfReasonCode.length > 0) {
        const codes = projected.reasonCodes ?? [];
        const hit = codes.find((c) => p.forbidIfReasonCode!.includes(c));
        if (hit) {
            return {
                reason: `principle ${p.id}: forbidden reason code ${hit}`,
                reasonCode: hit,
            };
        }
    }
    if (p.require?.verifiedEmail || p.require?.cacBound) {
        // These are projected via PolicyEngine; if the projection denies, capture it.
        if (projected.decision === "deny") {
            return {
                reason: `principle ${p.id}: projected policy decision is deny`,
                reasonCode: projected.reasonCodes?.[0],
            };
        }
    }
    return null;
}

function derivePreconditions(applicable: ConstitutionPrinciple[]): string[] {
    const pre: string[] = [];
    for (const p of applicable) {
        if (p.require?.rollbackPlan) pre.push(`${p.id}:rollbackPlan`);
        if (p.require?.verifiedEmail) pre.push(`${p.id}:verifiedEmail`);
        if (p.require?.cacBound) pre.push(`${p.id}:cacBound`);
        if (p.require?.maxTimeoutMs !== undefined) pre.push(`${p.id}:maxTimeoutMs<=${p.require.maxTimeoutMs}`);
    }
    return pre;
}

function derivePostconditions(applicable: ConstitutionPrinciple[]): string[] {
    return applicable.map((p) => `${p.id}:satisfied`);
}

function sha256Canonical(value: unknown): string {
    return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function canonicalize(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return "[" + value.map(canonicalize).join(",") + "]";
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}
