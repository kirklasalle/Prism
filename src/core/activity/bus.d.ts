import type { ActivityEvent, ActivitySubscriber } from "./types.js";
export declare class ActivityBus {
    private readonly subscribers;
    private readonly events;
    subscribe(subscriber: ActivitySubscriber): () => void;
    emit(event: Omit<ActivityEvent, "id" | "timestamp" | "hash">): ActivityEvent;
    listEvents(): readonly ActivityEvent[];
    private hashEvent;
}
