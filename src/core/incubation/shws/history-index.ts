// WorkflowHistoryIndex — rolling buffer of recent workflow runs, indexed by
// failed-step operation so the synthesizer can quickly look up successful
// repair fragments from history.

import type { WorkflowStep } from "../../runtime/workflow.js";
import type { HistoryFragment } from "./types.js";

export class WorkflowHistoryIndex {
    private readonly fragments: HistoryFragment[] = [];
    private readonly byOperation = new Map<string, HistoryFragment[]>();

    constructor(private readonly maxFragments: number = 200) { }

    record(fragment: HistoryFragment): void {
        this.fragments.push(fragment);
        const list = this.byOperation.get(fragment.operation) ?? [];
        list.push(fragment);
        this.byOperation.set(fragment.operation, list);

        while (this.fragments.length > this.maxFragments) {
            const dropped = this.fragments.shift();
            if (!dropped) break;
            const opList = this.byOperation.get(dropped.operation);
            if (opList) {
                const idx = opList.indexOf(dropped);
                if (idx >= 0) opList.splice(idx, 1);
                if (opList.length === 0) this.byOperation.delete(dropped.operation);
            }
        }
    }

    findRepairs(operation: string, limit: number = 5): HistoryFragment[] {
        const all = this.byOperation.get(operation) ?? [];
        return all
            .filter((f) => f.succeeded && f.repairSteps.length > 0)
            .slice(-Math.max(1, limit))
            .reverse();
    }

    size(): number {
        return this.fragments.length;
    }

    /** Used by the synthesizer for variant scoring. */
    similarRepairs(failedStep: WorkflowStep, limit: number = 5): HistoryFragment[] {
        const direct = this.findRepairs(failedStep.operation, limit);
        if (direct.length > 0) return direct;
        // Loose match: any repair fragment whose first step risk matches
        return this.fragments
            .filter((f) => f.succeeded && f.repairSteps[0]?.risk === failedStep.risk)
            .slice(-limit)
            .reverse();
    }
}
