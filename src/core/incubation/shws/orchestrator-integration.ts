// ActivityBus middleware for SHWS — subscribes (does NOT modify Orchestrator)
// to record successful repair fragments into the WorkflowHistoryIndex. The
// orchestrator emits "tool_execution" events with `details.workflowId` and
// `details.stepId`; we observe these to build a history index used by the
// synthesizer.

import type { ActivityBus } from "../../activity/bus.js";
import type { ActivityEvent, ActivitySubscriber } from "../../activity/types.js";
import type { WorkflowStep } from "../../runtime/workflow.js";
import { WorkflowHistoryIndex } from "./history-index.js";

interface InProgressRepair {
    workflowId: string;
    failedStepId: string;
    failureCode?: string;
    repairSteps: WorkflowStep[];
    startedAt: string;
}

export class ShwsHistoryRecorder implements ActivitySubscriber {
    private readonly inProgress = new Map<string, InProgressRepair>();

    constructor(
        private readonly history: WorkflowHistoryIndex,
        bus: ActivityBus,
    ) {
        bus.subscribe(this);
    }

    onEvent(event: ActivityEvent): void {
        // Only consider workflow-tagged events.
        const workflowId = (event.details?.workflowId as string | undefined) ?? undefined;
        if (!workflowId) return;

        if (event.operation === "workflow.step.failed") {
            const failedStepId = (event.details?.stepId as string | undefined) ?? "unknown";
            this.inProgress.set(workflowId, {
                workflowId,
                failedStepId,
                failureCode: (event.details?.reasonCode as string | undefined),
                repairSteps: [],
                startedAt: event.timestamp,
            });
            return;
        }

        if (event.operation === "workflow.fallback.step" && event.status === "succeeded") {
            const repair = this.inProgress.get(workflowId);
            if (!repair) return;
            const step = (event.details?.step as WorkflowStep | undefined);
            if (step && repair.repairSteps.length < 3) {
                repair.repairSteps.push(step);
            }
            return;
        }

        if (event.operation === "workflow.completed") {
            const repair = this.inProgress.get(workflowId);
            if (!repair || repair.repairSteps.length === 0) return;
            this.history.record({
                workflowId: repair.workflowId,
                stepId: repair.failedStepId,
                operation: (event.details?.failedOperation as string | undefined) ?? "unknown",
                succeeded: event.status === "succeeded",
                failureCode: repair.failureCode,
                recordedAt: event.timestamp,
                repairSteps: repair.repairSteps,
            });
            this.inProgress.delete(workflowId);
        }
    }
}
