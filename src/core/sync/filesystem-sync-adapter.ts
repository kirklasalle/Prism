/**
 * Filesystem Sync Adapter — JSONL round-trip via a shared directory.
 *
 * Layout under `{root}`:
 *   - outbound/{instanceId}-{ts}.jsonl   — events this instance pushed
 *   - inbound/{instanceId}/cursor.json   — per-source pull cursor (line offset)
 *
 * Idempotency: pulls track per-source last-applied event id; duplicates are skipped.
 * Replay safety: pulled events are tagged `_replayedFrom = sourceInstance`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { SyncAdapter, SyncBatch, SyncEvent, SyncStatus, SyncLayer } from "./sync-adapter.js";

const ALL_LAYERS: SyncLayer[] = ["audit", "memory", "preferences", "marketplace"];

export interface FilesystemSyncAdapterOptions {
    root: string;
    instanceId: string;
    layers?: SyncLayer[];
}

export class FilesystemSyncAdapter implements SyncAdapter {
    readonly name = "filesystem";
    private readonly root: string;
    private readonly instanceId: string;
    private readonly layers: SyncLayer[];
    private lastPushAt: string | null = null;
    private lastPullAt: string | null = null;
    private queuedOutbound = 0;
    private readonly seenIds = new Set<string>();

    constructor(opts: FilesystemSyncAdapterOptions) {
        this.root = opts.root;
        this.instanceId = opts.instanceId;
        this.layers = opts.layers ?? ALL_LAYERS;
    }

    async init(): Promise<void> {
        mkdirSync(join(this.root, "outbound"), { recursive: true });
        mkdirSync(join(this.root, "inbound", this.instanceId), { recursive: true });
        // Hydrate seenIds cursor.
        const cursorPath = join(this.root, "inbound", this.instanceId, "cursor.json");
        if (existsSync(cursorPath)) {
            try {
                const data = JSON.parse(readFileSync(cursorPath, "utf-8")) as { seen?: string[] };
                for (const id of data.seen ?? []) this.seenIds.add(id);
            } catch {
                /* ignore corrupt cursor */
            }
        }
    }

    async push(batch: SyncBatch): Promise<{ accepted: number; rejected: number }> {
        const filtered = batch.events.filter(e => this.layers.includes(e.layer));
        if (filtered.length === 0) return { accepted: 0, rejected: batch.events.length - filtered.length };
        const file = join(this.root, "outbound", `${this.instanceId}-${Date.now()}.jsonl`);
        const lines = filtered.map(e => JSON.stringify(e)).join("\n") + "\n";
        appendFileSync(file, lines, "utf-8");
        this.queuedOutbound += filtered.length;
        this.lastPushAt = new Date().toISOString();
        return { accepted: filtered.length, rejected: batch.events.length - filtered.length };
    }

    async pull(): Promise<SyncBatch | null> {
        const outboundDir = join(this.root, "outbound");
        if (!existsSync(outboundDir)) return null;

        const files = readdirSync(outboundDir)
            .filter(f => f.endsWith(".jsonl") && !f.startsWith(`${this.instanceId}-`))
            .map(f => ({ name: f, mtime: statSync(join(outboundDir, f)).mtimeMs }))
            .sort((a, b) => a.mtime - b.mtime);

        const events: SyncEvent[] = [];
        let primarySource = "remote";
        for (const f of files) {
            const sourceMatch = /^(.+)-\d+\.jsonl$/.exec(basename(f.name));
            const source = sourceMatch?.[1] ?? "remote";
            primarySource = source;
            const content = readFileSync(join(outboundDir, f.name), "utf-8");
            for (const line of content.split("\n")) {
                if (!line.trim()) continue;
                try {
                    const ev = JSON.parse(line) as SyncEvent;
                    if (this.seenIds.has(ev.id)) continue;
                    if (!this.layers.includes(ev.layer)) continue;
                    this.seenIds.add(ev.id);
                    events.push({ ...ev, _replayedFrom: source });
                } catch {
                    /* skip malformed line */
                }
            }
        }

        // Persist cursor.
        if (events.length > 0) {
            const cursorPath = join(this.root, "inbound", this.instanceId, "cursor.json");
            writeFileSync(cursorPath, JSON.stringify({ seen: Array.from(this.seenIds) }), "utf-8");
            this.lastPullAt = new Date().toISOString();
        }

        if (events.length === 0) return null;
        return { events, source: primarySource };
    }

    async status(): Promise<SyncStatus> {
        return {
            adapter: this.name,
            enabled: true,
            lastPushAt: this.lastPushAt,
            lastPullAt: this.lastPullAt,
            queuedOutbound: this.queuedOutbound,
            layers: this.layers,
        };
    }
}
