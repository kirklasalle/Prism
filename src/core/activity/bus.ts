import { createHash, randomUUID } from "node:crypto";
import type { ActivityEvent, ActivitySubscriber } from "./types.js";

export class ActivityBus {
    private readonly subscribers = new Set<ActivitySubscriber>();
    private readonly events: ActivityEvent[] = [];

    subscribe(subscriber: ActivitySubscriber): () => void {
        this.subscribers.add(subscriber);
        return () => this.subscribers.delete(subscriber);
    }

    emit(event: Omit<ActivityEvent, "id" | "timestamp" | "hash">): ActivityEvent {
        const fullEvent: ActivityEvent = {
            ...event,
            id: randomUUID(),
            timestamp: new Date().toISOString(),
        };

        fullEvent.hash = this.hashEvent(fullEvent);
        this.events.push(fullEvent);

        for (const subscriber of this.subscribers) {
            subscriber.onEvent(fullEvent);
        }

        return fullEvent;
    }

    listEvents(): readonly ActivityEvent[] {
        return this.events;
    }

    private hashEvent(event: ActivityEvent): string {
        const payload = JSON.stringify({
            sessionId: event.sessionId,
            layer: event.layer,
            operation: event.operation,
            status: event.status,
            details: event.details,
            authorityTier: event.authorityTier,
            policyDecision: event.policyDecision,
            sideEffects: event.sideEffects,
            rollbackPlan: event.rollbackPlan,
        });

        return createHash("sha256").update(payload).digest("hex");
    }
}
