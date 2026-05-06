/**
 * Sync Adapter Interface (Phase F)
 *
 * Provides a generic seam for cross-device/cross-instance synchronization.
 * Concrete adapters: NoopSyncAdapter (default), FilesystemSyncAdapter
 * (round-trips JSONL via a shared directory). HTTP/cloud adapters can be
 * added later without touching call sites.
 *
 * Layer allowlist controls which subsystems contribute to outbound batches.
 */

export type SyncLayer = "audit" | "memory" | "preferences" | "marketplace";

export interface SyncEvent {
    /** Stable event id (for idempotency). */
    id: string;
    /** Layer the event originated from. */
    layer: SyncLayer;
    /** Tenant id (defaults to "default"). */
    tenantId: string;
    /** Wall-clock at emission. */
    ts: string;
    /** Payload — opaque to the adapter. */
    payload: Record<string, unknown>;
    /** Set on inbound events that have been replayed from another instance. */
    _replayedFrom?: string;
}

export interface SyncBatch {
    events: SyncEvent[];
    /** Source instance id. */
    source: string;
}

export interface SyncStatus {
    adapter: string;
    enabled: boolean;
    lastPushAt: string | null;
    lastPullAt: string | null;
    queuedOutbound: number;
    layers: SyncLayer[];
}

export interface SyncAdapter {
    readonly name: string;
    init(): Promise<void>;
    push(batch: SyncBatch): Promise<{ accepted: number; rejected: number }>;
    pull(): Promise<SyncBatch | null>;
    status(): Promise<SyncStatus>;
}
