import type { ActivityEvent, ActivitySubscriber } from "../activity/types.js";
export interface SemanticMatch {
    id: string;
    operation: string;
    layer: string;
    timestamp: string;
    score: number;
}
export declare class SemanticMemoryIndex implements ActivitySubscriber {
    private readonly documents;
    onEvent(event: ActivityEvent): void;
    query(search: string, limit?: number): SemanticMatch[];
}
