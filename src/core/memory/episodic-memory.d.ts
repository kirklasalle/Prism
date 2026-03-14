import type { ActivityEvent, ActivitySubscriber } from "../activity/types.js";
export interface EpisodicSnapshot {
    count: number;
    estimatedTokens: number;
    recentOperations: string[];
}
export declare class EpisodicMemory implements ActivitySubscriber {
    private readonly maxEvents;
    private readonly events;
    private estimatedTokens;
    constructor(maxEvents?: number);
    onEvent(event: ActivityEvent): void;
    recent(limit?: number): ActivityEvent[];
    snapshot(limit?: number): EpisodicSnapshot;
}
