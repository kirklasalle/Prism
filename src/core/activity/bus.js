import { createHash, randomUUID } from "node:crypto";
export class ActivityBus {
    subscribers = new Set();
    events = [];
    subscribe(subscriber) {
        this.subscribers.add(subscriber);
        return () => this.subscribers.delete(subscriber);
    }
    emit(event) {
        const fullEvent = {
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
    listEvents() {
        return this.events;
    }
    hashEvent(event) {
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
//# sourceMappingURL=bus.js.map