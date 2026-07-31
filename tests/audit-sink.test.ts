/**
 * AuditSink Unit Tests — Phase 4 (Option 3)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { AuditSink } from "../src/core/activity/audit-sink.js";
import { verifyAuditCheckpoint } from "../src/core/activity/hash-chained-audit.js";

describe("AuditSink", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-auditsink-test-"));
    });

    afterEach(() => {
        if (existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it("flushes signed checkpoints automatically when window size is reached", () => {
        const bus = new ActivityBus();
        const sink = new AuditSink(bus, {
            enabled: true,
            sinkType: "file",
            exportDir: tmpDir,
            checkpointWindowSize: 3,
        });

        sink.start();

        bus.emit({ sessionId: "s1", layer: "agent", operation: "op1", status: "succeeded", details: {} });
        bus.emit({ sessionId: "s1", layer: "agent", operation: "op2", status: "succeeded", details: {} });
        assert.strictEqual(sink.getCheckpointCount(), 0, "No checkpoint should flush before window size");

        bus.emit({ sessionId: "s1", layer: "agent", operation: "op3", status: "succeeded", details: {} });
        assert.strictEqual(sink.getCheckpointCount(), 1, "Checkpoint #1 must flush when window size 3 is hit");

        sink.stop();
    });

    it("flushes remaining buffer on stop() and generates valid signature", () => {
        const bus = new ActivityBus();
        const sink = new AuditSink(bus, {
            enabled: true,
            sinkType: "file",
            exportDir: tmpDir,
            checkpointWindowSize: 10,
        });

        sink.start();
        bus.emit({ sessionId: "s1", layer: "agent", operation: "op1", status: "succeeded", details: {} });

        const checkpoint = sink.flushCheckpoint();
        assert.ok(checkpoint);
        assert.strictEqual(checkpoint.eventCount, 1);
        assert.ok(verifyAuditCheckpoint(checkpoint), "Flushed checkpoint signature must be valid");

        sink.stop();
    });
});
