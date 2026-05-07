/**
 * Sync Engine — orchestrates push/pull ticks across a configured adapter.
 *
 * Stateless wrapper. Caller supplies the adapter and an event source/sink.
 * No HTTP/cloud here — the adapter abstraction IS the seam.
 */

import type { SyncAdapter, SyncBatch, SyncEvent } from "./sync-adapter.js";
import { NoopSyncAdapter } from "./noop-sync-adapter.js";
import { FilesystemSyncAdapter } from "./filesystem-sync-adapter.js";

export interface SyncEngineOptions {
    adapter: SyncAdapter;
    /** Hook invoked per inbound event after deduplication + replay-tagging. */
    onInboundEvent?: (event: SyncEvent) => void;
}

export class SyncEngine {
    private readonly adapter: SyncAdapter;
    private readonly outbound: SyncEvent[] = [];
    private readonly onInbound?: (event: SyncEvent) => void;

    constructor(opts: SyncEngineOptions) {
        this.adapter = opts.adapter;
        this.onInbound = opts.onInboundEvent;
    }

    async init(): Promise<void> {
        await this.adapter.init();
    }

    /** Queue an event for the next push tick. */
    enqueue(event: SyncEvent): void {
        this.outbound.push(event);
    }

    /** Flush queued events. */
    async pushNow(source: string): Promise<{ accepted: number; rejected: number }> {
        if (this.outbound.length === 0) return { accepted: 0, rejected: 0 };
        const batch: SyncBatch = { events: this.outbound.slice(), source };
        this.outbound.length = 0;
        return this.adapter.push(batch);
    }

    /** Pull pending inbound events and dispatch via callback. */
    async pullNow(): Promise<{ count: number }> {
        const batch = await this.adapter.pull();
        if (!batch) return { count: 0 };
        for (const ev of batch.events) {
            this.onInbound?.(ev);
        }
        return { count: batch.events.length };
    }

    async status(): Promise<ReturnType<SyncAdapter["status"]>> {
        return this.adapter.status();
    }

    get adapterName(): string {
        return this.adapter.name;
    }
}

/**
 * Factory — selects an adapter based on `PRISM_SYNC_ADAPTER`:
 *  - `noop` (default), `none` — NoopSyncAdapter
 *  - `filesystem` — FilesystemSyncAdapter (requires root + instanceId)
 */
export function createSyncAdapterFromEnv(opts: { root: string; instanceId: string }): SyncAdapter {
    const choice = (process.env.PRISM_SYNC_ADAPTER ?? "noop").toLowerCase();
    if (choice === "filesystem") {
        return new FilesystemSyncAdapter({ root: opts.root, instanceId: opts.instanceId });
    }
    return new NoopSyncAdapter();
}
