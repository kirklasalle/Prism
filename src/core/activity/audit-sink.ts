/**
 * Background Audit Sink & Checkpoint Exporter — Phase 4 (IC-11, Option 3)
 *
 * Listens to the `ActivityBus` append-only hash chain, periodically computes Ed25519-signed
 * audit checkpoints, and exports tamper-evident audit logs to a local disk sink or remote log aggregator.
 *
 * @module core/activity/audit-sink
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ActivityBus } from "./bus.js";
import {
    createAuditCheckpoint,
    verifyAuditCheckpoint,
    type HashChainedEvent,
    type SignedAuditCheckpoint,
} from "./hash-chained-audit.js";
import { workspacePath } from "../config/workspace-resolver.js";

export interface AuditSinkConfig {
    readonly enabled: boolean;
    readonly sinkType: "file" | "console";
    readonly exportDir?: string;
    readonly checkpointWindowSize: number;
}

export class AuditSink {
    private readonly config: AuditSinkConfig;
    private readonly bus: ActivityBus;
    private readonly buffer: HashChainedEvent[] = [];
    private unsubscribe?: () => void;
    private checkpointCount = 0;

    constructor(bus: ActivityBus, config?: Partial<AuditSinkConfig>) {
        this.bus = bus;
        this.config = {
            enabled: config?.enabled ?? true,
            sinkType: config?.sinkType ?? "file",
            exportDir: config?.exportDir ?? workspacePath("audit"),
            checkpointWindowSize: config?.checkpointWindowSize ?? 10,
        };
    }

    /**
     * Start listening to the ActivityBus and exporting checkpoints.
     */
    start(): void {
        if (!this.config.enabled) return;

        this.unsubscribe = this.bus.subscribe({
            onEvent: (event) => this.handleEvent(event as HashChainedEvent),
        });
    }

    /**
     * Stop listening.
     */
    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = undefined;
        }

        // Flush remaining buffer into a final checkpoint
        if (this.buffer.length > 0) {
            this.flushCheckpoint();
        }
    }

    private handleEvent(event: HashChainedEvent): void {
        this.buffer.push(event);
        if (this.buffer.length >= this.config.checkpointWindowSize) {
            this.flushCheckpoint();
        }
    }

    /**
     * Compute a signed audit checkpoint over buffered events and export to sink.
     */
    flushCheckpoint(): SignedAuditCheckpoint | null {
        if (this.buffer.length === 0) return null;

        const eventsToFlush = [...this.buffer];
        this.buffer.length = 0;

        const checkpoint = createAuditCheckpoint(eventsToFlush);
        this.checkpointCount++;

        if (this.config.sinkType === "file") {
            this.writeCheckpointToFile(checkpoint, eventsToFlush);
        } else if (this.config.sinkType === "console") {
            console.log(`[PRISM][audit-sink] Checkpoint #${this.checkpointCount} created: rootHash=${checkpoint.rootHash.slice(0, 16)}... events=${checkpoint.eventCount}`);
        }

        return checkpoint;
    }

    private writeCheckpointToFile(checkpoint: SignedAuditCheckpoint, events: HashChainedEvent[]): void {
        try {
            const targetDir = this.config.exportDir || workspacePath("audit");
            if (!existsSync(targetDir)) {
                mkdirSync(targetDir, { recursive: true });
            }

            const checkpointFile = join(targetDir, `checkpoint-${checkpoint.sequenceStart}-${checkpoint.sequenceEnd}.json`);
            const logChainFile = join(targetDir, "chained_events.log");

            // Write signed checkpoint JSON manifest
            writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2), "utf-8");

            // Append serialized events to log chain file
            const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
            appendFileSync(logChainFile, lines, "utf-8");
        } catch (err: any) {
            console.error(`[PRISM][audit-sink] Error writing audit checkpoint to file: ${err.message}`);
        }
    }

    getCheckpointCount(): number {
        return this.checkpointCount;
    }
}
