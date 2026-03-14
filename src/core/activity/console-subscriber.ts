import type { ActivityEvent, ActivitySubscriber } from "./types.js";

export class ConsoleActivitySubscriber implements ActivitySubscriber {
    onEvent(event: ActivityEvent): void {
        const prefix = `[${event.layer.toUpperCase()}] ${event.operation}`;
        const suffix = `status=${event.status} tier=${event.authorityTier ?? "n/a"} policy=${event.policyDecision ?? "n/a"}`;
        console.log(`${prefix} ${suffix}`);
    }
}
