import type { ActivityBus } from "../activity/bus.js";
import type { ApprovalQueue } from "../approval/approval-queue.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolRequest } from "../tools/types.js";
import type { WorkflowDAG } from "./workflow.js";
import type { WorkflowStepOutcome } from "./workflow.js";
import type { WorkflowStep } from "./workflow.js";
import { WorkflowExecutor } from "./workflow.js";
import type { AgentPool } from "../agents/agent-pool.js";
import type { SubAgentRequest, SubAgentResult } from "../agents/agent-types.js";
import { TaskDecomposer } from "../agents/task-decomposer.js";
import type { DecomposedPlan } from "../agents/task-decomposer.js";

export type { SubAgentRequest, SubAgentResult, DecomposedPlan };

export interface OrchestratorOptions {
    approvalQueue?: ApprovalQueue;
    approvalTimeoutMs?: number;
    agentPool?: AgentPool;
}

export class Orchestrator {
    private readonly approvalQueue: ApprovalQueue | undefined;
    private readonly approvalTimeoutMs: number;
    private agentPool: AgentPool | undefined;

    constructor(
        private readonly sessionId: string,
        private readonly activityBus: ActivityBus,
        private readonly policyEngine: PolicyEngine,
        private readonly toolRegistry: ToolRegistry,
        options: OrchestratorOptions = {},
    ) {
        this.approvalQueue = options.approvalQueue;
        this.approvalTimeoutMs = options.approvalTimeoutMs ?? 30_000;
        this.agentPool = options.agentPool;
    }

    /** Provide or replace the AgentPool after construction. */
    setAgentPool(pool: AgentPool): void {
        this.agentPool = pool;
    }

    /**
     * Decompose a complex goal into an ordered plan of sub-agent steps.
     * Returns null if no AgentPool is configured.
     */
    async decompose(goal: string, context?: string): Promise<DecomposedPlan | null> {
        if (!this.agentPool) return null;
        const decomposer = new TaskDecomposer(this.agentPool);
        const plan = await decomposer.decompose(goal, context);
        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "agent",
            operation: "agent.decompose",
            status: plan.ok ? "succeeded" : "failed",
            details: {
                goal,
                stepCount: plan.steps.length,
                ...(plan.error ? { error: plan.error } : {}),
            },
        });
        return plan;
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

    /**
     * Dispatch a goal to the AgentPool, governed by the policy engine.
     * Returns null if no AgentPool is configured.
     */
    async runSubAgent(request: SubAgentRequest): Promise<SubAgentResult | null> {
        if (!this.agentPool) {
            this.activityBus.emit({
                sessionId: this.sessionId,
                layer: "agent",
                operation: "agent.dispatch.blocked",
                status: "failed",
                details: { reason: "No AgentPool configured." },
            });
            return null;
        }

        const risk = request.risk ?? "low";
        const operation = `agent.${request.agentId ?? request.role ?? "chat"}`;

        const policy = this.policyEngine.evaluate({
            operation,
            risk,
            mutatesState: false,
            isWhitelisted: false,
        });

        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "governance",
            operation: `${operation}.policy_check`,
            status: policy.decision === "deny" ? "failed" : "succeeded",
            authorityTier: policy.tier,
            policyDecision: policy.decision,
            details: { reasons: policy.reasons },
        });

        if (policy.decision === "deny") {
            return {
                ok: false,
                content: "",
                agentId: request.agentId ?? request.role ?? "chat",
                model: "",
                tier: 0,
                durationMs: 0,
                traceId: "",
                error: "Policy denied agent dispatch.",
            };
        }

        if (policy.decision === "require_approval") {
            if (!this.approvalQueue) {
                return {
                    ok: false,
                    content: "",
                    agentId: request.agentId ?? request.role ?? "chat",
                    model: "",
                    tier: 0,
                    durationMs: 0,
                    traceId: "",
                    error: "Approval required but no approval queue configured.",
                };
            }
            const approved = await this.approvalQueue.request(
                this.sessionId,
                operation,
                { goal: request.goal, risk },
                this.approvalTimeoutMs,
            );
            if (!approved) {
                return {
                    ok: false,
                    content: "",
                    agentId: request.agentId ?? request.role ?? "chat",
                    model: "",
                    tier: 0,
                    durationMs: 0,
                    traceId: "",
                    error: "Agent dispatch denied or timed out.",
                };
            }
        }

        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "agent",
            operation: `${operation}.started`,
            status: "started",
            authorityTier: policy.tier,
            policyDecision: policy.decision,
            details: { goal: request.goal, role: request.role, agentId: request.agentId },
        });

        const result = await this.agentPool.dispatch(request);

        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "agent",
            operation,
            status: result.ok ? "succeeded" : "failed",
            authorityTier: policy.tier,
            policyDecision: policy.decision,
            durationMs: result.durationMs,
            details: {
                agentId: result.agentId,
                model: result.model,
                tier: result.tier,
                traceId: result.traceId,
                contentLength: result.content.length,
                ...(result.error ? { error: result.error } : {}),
            },
        });

        return result;
    }

    /**
     * Execute a DecomposedPlan:
     *   - Steps with no shared dependencies run in parallel via Promise.allSettled
     *   - Dependent steps run after their batch resolves
     *
     * Returns results grouped by batch (outer array = batches, inner = results).
     */
    async runDecomposed(plan: DecomposedPlan): Promise<SubAgentResult[][]> {
        if (!plan.ok || plan.steps.length === 0) return [];

        const batches = TaskDecomposer.toParallelBatches(plan);
        const allBatchResults: SubAgentResult[][] = [];
        const planId = `plan.${Date.now()}`;

        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "agent",
            operation: `${planId}.started`,
            status: "started",
            details: {
                goal: plan.goal,
                stepCount: plan.steps.length,
                batchCount: batches.length,
            },
        });

        let allOk = true;

        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
            const batch = batches[batchIdx]!;

            this.activityBus.emit({
                sessionId: this.sessionId,
                layer: "agent",
                operation: `${planId}.batch.${batchIdx}.started`,
                status: "started",
                details: { batchIndex: batchIdx, stepCount: batch.length },
            });

            // Run all steps in this batch concurrently
            const batchPromises = batch.map((req) => this.runSubAgent(req));
            const settled = await Promise.allSettled(batchPromises);

            const batchResults: SubAgentResult[] = settled.map((s) => {
                if (s.status === "fulfilled" && s.value !== null) {
                    return s.value;
                }
                // Rejected or null result — synthesize a failure record
                const errMsg =
                    s.status === "rejected"
                        ? String(s.reason)
                        : "runSubAgent returned null (no AgentPool)";
                allOk = false;
                return {
                    ok: false,
                    content: "",
                    agentId: "unknown",
                    model: "",
                    tier: 0,
                    durationMs: 0,
                    traceId: "",
                    error: errMsg,
                };
            });

            if (batchResults.some((r) => !r.ok)) allOk = false;

            this.activityBus.emit({
                sessionId: this.sessionId,
                layer: "agent",
                operation: `${planId}.batch.${batchIdx}.completed`,
                status: batchResults.every((r) => r.ok) ? "succeeded" : "failed",
                durationMs: Math.max(...batchResults.map((r) => r.durationMs)),
                details: {
                    batchIndex: batchIdx,
                    successCount: batchResults.filter((r) => r.ok).length,
                    failCount: batchResults.filter((r) => !r.ok).length,
                },
            });

            allBatchResults.push(batchResults);
        }

        this.activityBus.emit({
            sessionId: this.sessionId,
            layer: "agent",
            operation: `${planId}.completed`,
            status: allOk ? "succeeded" : "failed",
            details: {
                goal: plan.goal,
                batchCount: batches.length,
                totalSteps: plan.steps.length,
            },
        });

        return allBatchResults;
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