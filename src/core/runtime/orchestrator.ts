import type { ActivityBus } from "../activity/bus.js";
import type { ApprovalQueue } from "../approval/approval-queue.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolRequest } from "../tools/types.js";
import type { WorkflowDAG } from "./workflow.js";
import type { WorkflowStepOutcome } from "./workflow.js";
import type { WorkflowStep } from "./workflow.js";
import { WorkflowExecutor } from "./workflow.js";

export interface OrchestratorOptions {
    approvalQueue?: ApprovalQueue;
    approvalTimeoutMs?: number;
}

export class Orchestrator {
    private readonly approvalQueue: ApprovalQueue | undefined;
    private readonly approvalTimeoutMs: number;

    constructor(
        private readonly sessionId: string,
        private readonly activityBus: ActivityBus,
        private readonly policyEngine: PolicyEngine,
        private readonly toolRegistry: ToolRegistry,
        options: OrchestratorOptions = {},
    ) {
        this.approvalQueue = options.approvalQueue;
        this.approvalTimeoutMs = options.approvalTimeoutMs ?? 30_000;
    }

    private readonly workflowExecutor = new WorkflowExecutor();

    async run(request: ToolRequest): Promise<void> {
        const start = Date.now();

        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "tool_execution",
            operation: request.operation,
            status: "started",
            details: { args: request.args },
        });

        const policy = this.policyEngine.evaluate({
            operation: request.operation,
            risk: request.risk,
            mutatesState: request.mutatesState,
            rollbackPlan: request.rollbackPlan,
            isWhitelisted: false,
        });

        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "governance",
            operation: `${request.operation}.policy_check`,
            status: policy.decision === "deny" ? "failed" : "succeeded",
            authorityTier: policy.tier,
            policyDecision: policy.decision,
            details: { reasons: policy.reasons },
            rollbackPlan: request.rollbackPlan,
        });

        if (policy.decision === "deny") {
            return;
        }

        if (policy.decision === "require_approval") {
            if (!this.approvalQueue) {
                this.activityBus.emit({
                    sessionId: this.sessionId,
                    layer: "governance",
                    operation: `${request.operation}.approval_blocked`,
                    status: "failed",
                    authorityTier: policy.tier,
                    policyDecision: policy.decision,
                    details: { message: "No approval queue configured — operation blocked." },
                });
                return;
            }

            this.activityBus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: `${request.operation}.approval_requested`,
                status: "started",
                authorityTier: policy.tier,
                policyDecision: policy.decision,
                details: {
                    message: "Waiting for live approval via ApprovalService.",
                    approvalServiceUrl: "http://localhost:7070",
                },
                rollbackPlan: request.rollbackPlan,
            });

            const approved = await this.approvalQueue.request(
                this.sessionId,
                request.operation,
                { args: request.args, risk: request.risk, rollbackPlan: request.rollbackPlan },
                this.approvalTimeoutMs,
            );

            if (!approved) {
                this.activityBus.emit({
                    sessionId: this.sessionId,
                    layer: "governance",
                    operation: `${request.operation}.approval_denied`,
                    status: "failed",
                    authorityTier: policy.tier,
                    policyDecision: "deny",
                    details: { message: "Operation denied or timed out." },
                });
                return;
            }

            this.activityBus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: `${request.operation}.approval_granted`,
                status: "succeeded",
                authorityTier: policy.tier,
                policyDecision: "allow",
                details: { message: "Operation approved by Kirk. Proceeding." },
            });
        }

        // Execute tool — reached by tier1/tier2 directly, or tier3 after approval
        const tool = this.toolRegistry.get(request.operation);
        if (!tool) {
            this.activityBus.emit({
                sessionId: this.sessionId,
                layer: "tool_execution",
                operation: `${request.operation}.not_found`,
                status: "failed",
                authorityTier: policy.tier,
                policyDecision: policy.decision,
                details: { message: `Tool "${request.operation}" not found in registry.` },
            });
            return;
        }

        const contractErrors = this.toolRegistry.validateRequest(request);
        if (contractErrors.length > 0) {
            this.activityBus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: `${request.operation}.contract_validation`,
                status: "failed",
                authorityTier: policy.tier,
                policyDecision: policy.decision,
                details: { errors: contractErrors },
            });
            return;
        }

        const result = await tool.execute(request);

        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "tool_execution",
            operation: request.operation,
            status: result.ok ? "succeeded" : "failed",
            authorityTier: policy.tier,
            policyDecision: policy.decision,
            durationMs: Date.now() - start,
            details: result.output,
            sideEffects: result.sideEffects,
            rollbackPlan: request.rollbackPlan,
        });
    }

    async runWorkflow(dag: WorkflowDAG): Promise<void> {
        const validation = this.workflowExecutor.validateDAG(dag);
        if (!validation.valid) {
            this.activityBus.emit({
                sessionId: this.sessionId,
                layer: "governance",
                operation: `workflow.${dag.id}.validation_failed`,
                status: "failed",
                details: { errors: validation.errors },
            });
            return;
        }

        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "causal",
            operation: `workflow.${dag.id}.started`,
            status: "started",
            details: { workflowName: dag.name, stepCount: dag.steps.length },
        });

        let currentStep: WorkflowStep | null = dag.steps[0];
        let workflowOk = true;

        while (currentStep) {
            const outcome = await this.executeWorkflowStep(currentStep);
            const nextStep = this.workflowExecutor.getNextStep(dag, currentStep.id, outcome);

            if (outcome !== "succeeded" && nextStep === null) {
                workflowOk = false;
            }

            currentStep = nextStep;
        }

        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "causal",
            operation: `workflow.${dag.id}.completed`,
            status: workflowOk ? "succeeded" : "failed",
            details: { workflowName: dag.name, success: workflowOk },
        });
    }

    private async executeWorkflowStep(step: WorkflowStep): Promise<WorkflowStepOutcome> {
        const retries = Math.max(0, step.retries ?? 0);
        const maxAttempts = retries + 1;
        const timeoutMs = step.timeoutMs;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            this.activityBus.emit({
                sessionId: this.sessionId,
                layer: "causal",
                operation: `workflow.step.${step.id}.attempt.${attempt}`,
                status: "started",
                details: {
                    stepId: step.id,
                    operation: step.operation,
                    attempt,
                    maxAttempts,
                    timeoutMs: timeoutMs ?? null,
                },
            });

            const request: ToolRequest = {
                operation: step.operation,
                args: step.args,
                risk: step.risk,
                mutatesState: step.mutatesState,
                rollbackPlan: step.rollbackPlan,
            };

            let timedOut = false;
            if (typeof timeoutMs === "number" && timeoutMs > 0) {
                const timedOutSymbol = Symbol("timed_out");
                const runOutcome = await Promise.race([
                    this.run(request).then(() => "completed" as const),
                    sleep(timeoutMs).then(() => timedOutSymbol),
                ]);
                timedOut = runOutcome === timedOutSymbol;
            } else {
                await this.run(request);
            }

            if (timedOut) {
                this.activityBus.emit({
                    sessionId: this.sessionId,
                    layer: "causal",
                    operation: `workflow.step.${step.id}.timeout`,
                    status: "failed",
                    details: {
                        stepId: step.id,
                        operation: step.operation,
                        attempt,
                        timeoutMs,
                    },
                });

                if (attempt < maxAttempts) {
                    continue;
                }

                return "timed_out";
            }

            const recentEvent = this.activityBus.listEvents().slice(-1)[0];
            const stepOk =
                recentEvent?.layer === "tool_execution" &&
                recentEvent.operation === step.operation &&
                recentEvent.status === "succeeded";

            if (stepOk) {
                return "succeeded";
            }

            if (attempt < maxAttempts) {
                this.activityBus.emit({
                    sessionId: this.sessionId,
                    layer: "causal",
                    operation: `workflow.step.${step.id}.retrying`,
                    status: "started",
                    details: {
                        stepId: step.id,
                        operation: step.operation,
                        nextAttempt: attempt + 1,
                        maxAttempts,
                    },
                });
                continue;
            }

            return "failed";
        }

        return "failed";
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}