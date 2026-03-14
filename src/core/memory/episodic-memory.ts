import type { ActivityEvent, ActivitySubscriber } from "../activity/types.js";

export interface EpisodicSnapshot {
    count: number;
    estimatedTokens: number;
    recentOperations: string[];
}

export class EpisodicMemory implements ActivitySubscriber {
    private readonly events: ActivityEvent[] = [];
    private estimatedTokens = 0;

    constructor(private readonly maxEvents: number = 500) { }

    onEvent(event: ActivityEvent): void {
        this.events.push(event);
        this.estimatedTokens += estimateEventTokens(event);

        while (this.events.length > this.maxEvents) {
            const removed = this.events.shift();
            if (removed) {
                this.estimatedTokens = Math.max(0, this.estimatedTokens - estimateEventTokens(removed));
            }
        }
    }

    recent(limit: number = 20): ActivityEvent[] {
        return this.events.slice(-Math.max(1, limit));
    }

    snapshot(limit: number = 20): EpisodicSnapshot {
        return {
            count: this.events.length,
            estimatedTokens: this.estimatedTokens,
            recentOperations: this.recent(limit).map((event) => event.operation),
        };
    }
}

function estimateEventTokens(event: ActivityEvent): number {
    const payload = JSON.stringify(event.details ?? {});
    return Math.ceil(payload.length / 4) + 16;
}
