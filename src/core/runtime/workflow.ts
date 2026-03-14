import type { OperationRisk } from "../policy/types.js";

export interface WorkflowStep {
    id: string;
    operation: string;
    args: Record<string, unknown>;
    risk: OperationRisk;
    mutatesState: boolean;
    rollbackPlan?: string;
    retries?: number;
    timeoutMs?: number;
}

export interface WorkflowFallback {
    stepId: string;
    condition: "always" | "on_failure" | "on_timeout";
    nextStepId: string;
}

export interface WorkflowDAG {
    id: string;
    name: string;
    steps: WorkflowStep[];
    fallbacks: WorkflowFallback[];
}

export type WorkflowStepOutcome = "succeeded" | "failed" | "timed_out";

export interface WorkflowExecution {
    workflowId: string;
    sessionId: string;
    status: "running" | "succeeded" | "failed" | "paused";
    stepResults: Map<string, { ok: boolean; output: Record<string, unknown>; error?: string }>;
    currentStepId: string;
    startTime: string;
    endTime?: string;
    durationMs?: number;
}

export class WorkflowExecutor {
    constructor() { }

    createDAG(
        name: string,
        steps: WorkflowStep[],
        fallbacks: WorkflowFallback[] = [],
    ): WorkflowDAG {
        return {
            id: generateId(),
            name,
            steps,
            fallbacks,
        };
    }

    validateDAG(dag: WorkflowDAG): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        const stepIds = new Set(dag.steps.map((s) => s.id));

        for (const step of dag.steps) {
            if (!step.id) {
                errors.push("Step must have an id");
            }
            if (!step.operation) {
                errors.push(`Step ${step.id} must have an operation`);
            }
        }

        for (const fallback of dag.fallbacks) {
            if (!stepIds.has(fallback.stepId)) {
                errors.push(`Fallback references unknown step: ${fallback.stepId}`);
            }
            if (!stepIds.has(fallback.nextStepId)) {
                errors.push(`Fallback references unknown next step: ${fallback.nextStepId}`);
            }
        }

        return { valid: errors.length === 0, errors };
    }

    getNextStep(
        dag: WorkflowDAG,
        currentStepId: string,
        outcome: WorkflowStepOutcome,
    ): WorkflowStep | null {
        const fallbacks = dag.fallbacks.filter((f) => {
            if (f.stepId !== currentStepId) {
                return false;
            }

            if (f.condition === "always") {
                return true;
            }

            if (f.condition === "on_failure") {
                return outcome === "failed";
            }

            return outcome === "timed_out";
        });

        if (fallbacks.length > 0) {
            const nextStepId = fallbacks[0]!.nextStepId;
            return dag.steps.find((s) => s.id === nextStepId) ?? null;
        }

        const currentIdx = dag.steps.findIndex((s) => s.id === currentStepId);
        if (currentIdx >= 0 && currentIdx < dag.steps.length - 1) {
            return dag.steps[currentIdx + 1] ?? null;
        }

        return null;
    }

    hasFallbackForOutcome(
        dag: WorkflowDAG,
        stepId: string,
        outcome: WorkflowStepOutcome,
    ): boolean {
        return this.getNextStep(dag, stepId, outcome) !== null;
    }
}

function generateId(): string {
    return "workflow-" + Math.random().toString(36).slice(2, 9);
}
