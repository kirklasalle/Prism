export class EpisodicMemory {
    maxEvents;
    events = [];
    estimatedTokens = 0;
    constructor(maxEvents = 500) {
        this.maxEvents = maxEvents;
    }
    onEvent(event) {
        this.events.push(event);
        this.estimatedTokens += estimateEventTokens(event);
        while (this.events.length > this.maxEvents) {
            const removed = this.events.shift();
            if (removed) {
                this.estimatedTokens = Math.max(0, this.estimatedTokens - estimateEventTokens(removed));
            }
        }
    }
    recent(limit = 20) {
        return this.events.slice(-Math.max(1, limit));
    }
    snapshot(limit = 20) {
        return {
            count: this.events.length,
            estimatedTokens: this.estimatedTokens,
            recentOperations: this.recent(limit).map((event) => event.operation),
        };
    }
}
function estimateEventTokens(event) {
    const payload = JSON.stringify(event.details ?? {});
    return Math.ceil(payload.length / 4) + 16;
}
//# sourceMappingURL=episodic-memory.js.map