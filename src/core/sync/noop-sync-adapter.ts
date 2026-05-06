import type { SyncAdapter, SyncBatch, SyncStatus, SyncLayer } from "./sync-adapter.js";

/** No-op adapter — accepts everything, returns nothing. Default when sync is off. */
export class NoopSyncAdapter implements SyncAdapter {
    readonly name = "noop";
    async init(): Promise<void> { /* nothing to do */ }
    async push(batch: SyncBatch): Promise<{ accepted: number; rejected: number }> {
        return { accepted: batch.events.length, rejected: 0 };
    }
    async pull(): Promise<SyncBatch | null> {
        return null;
    }
    async status(): Promise<SyncStatus> {
        const layers: SyncLayer[] = ["audit", "memory", "preferences", "marketplace"];
        return { adapter: this.name, enabled: false, lastPushAt: null, lastPullAt: null, queuedOutbound: 0, layers };
    }
}
