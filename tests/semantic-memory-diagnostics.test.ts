/**
 * Comprehensive diagnostics for SemanticMemoryIndex — ingestion, querying,
 * edge cases, performance, and ActivitySubscriber interface compliance.
 *
 * Run via node:test: node --test dist/tests/semantic-memory-diagnostics.test.js
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SemanticMemoryIndex } from "../src/core/memory/semantic-memory.js";
import type { ActivityEvent } from "../src/core/activity/types.js";

function makeEvent(id: string, operation: string, layer: string = "tool_execution", details: Record<string, unknown> = {}): ActivityEvent {
    return {
        id,
        timestamp: new Date().toISOString(),
        sessionId: "diag-session",
        layer: layer as ActivityEvent["layer"],
        operation,
        status: "succeeded",
        details,
        hash: `hash-${id}`,
    };
}

describe("SemanticMemoryIndex — Diagnostics", () => {
    let index: SemanticMemoryIndex;

    beforeEach(() => {
        index = new SemanticMemoryIndex();
    });

    // ── Construction & Interface ─────────────────────────────────────────

    it("implements ActivitySubscriber.onEvent()", () => {
        assert.equal(typeof index.onEvent, "function");
    });

    it("implements query()", () => {
        assert.equal(typeof index.query, "function");
    });

    it("starts with no documents (empty query returns empty)", () => {
        const results = index.query("anything", 10);
        assert.equal(results.length, 0);
    });

    // ── Ingestion ────────────────────────────────────────────────────────

    it("ingests a single event and makes it queryable", () => {
        index.onEvent(makeEvent("e1", "file_write", "tool_execution", { path: "/tmp/test.txt" }));
        const results = index.query("file_write", 5);
        assert.equal(results.length, 1);
        assert.equal(results[0]!.id, "e1");
        assert.equal(results[0]!.operation, "file_write");
    });

    it("ingests multiple events with distinct operations", () => {
        index.onEvent(makeEvent("e1", "file_write"));
        index.onEvent(makeEvent("e2", "shell_exec"));
        index.onEvent(makeEvent("e3", "http_request"));

        const results = index.query("shell_exec", 10);
        assert.equal(results.length, 1);
        assert.equal(results[0]!.id, "e2");
    });

    it("overwrites duplicate event IDs (last write wins)", () => {
        index.onEvent(makeEvent("e1", "file_write"));
        index.onEvent(makeEvent("e1", "shell_exec"));

        const fileResults = index.query("file_write", 10);
        assert.equal(fileResults.length, 0);

        const shellResults = index.query("shell_exec", 10);
        assert.equal(shellResults.length, 1);
    });

    // ── Query Accuracy ───────────────────────────────────────────────────

    it("matches on operation token", () => {
        index.onEvent(makeEvent("e1", "file_write"));
        index.onEvent(makeEvent("e2", "file_read"));
        index.onEvent(makeEvent("e3", "shell_exec"));

        const results = index.query("file", 10);
        assert.equal(results.length, 2);
    });

    it("matches on layer token", () => {
        index.onEvent(makeEvent("e1", "op_a", "governance"));
        index.onEvent(makeEvent("e2", "op_b", "tool_execution"));

        const results = index.query("governance", 5);
        assert.ok(results.some((r) => r.id === "e1"));
    });

    it("matches on details content", () => {
        index.onEvent(makeEvent("e1", "file_write", "tool_execution", { path: "/etc/config.txt" }));
        index.onEvent(makeEvent("e2", "shell_exec", "tool_execution", { command: "node --version" }));

        const results = index.query("config", 5);
        assert.equal(results.length, 1);
        assert.equal(results[0]!.id, "e1");
    });

    it("multi-term queries score higher for more matches", () => {
        index.onEvent(makeEvent("e1", "file_write", "governance", { path: "/etc" }));
        index.onEvent(makeEvent("e2", "file_write", "tool_execution", { path: "/tmp" }));

        // "file_write governance" — e1 matches both terms, e2 matches only file_write
        const results = index.query("file_write governance", 10);
        assert.equal(results.length, 2);
        assert.equal(results[0]!.id, "e1"); // Higher score
        assert.ok(results[0]!.score > results[1]!.score);
    });

    it("returns results sorted by score descending", () => {
        index.onEvent(makeEvent("e1", "alpha_beta_gamma"));
        index.onEvent(makeEvent("e2", "alpha_beta"));
        index.onEvent(makeEvent("e3", "alpha"));

        const results = index.query("alpha beta gamma", 10);
        for (let i = 1; i < results.length; i++) {
            assert.ok(results[i - 1]!.score >= results[i]!.score);
        }
    });

    it("respects the limit parameter", () => {
        for (let i = 0; i < 20; i++) {
            index.onEvent(makeEvent(`e${i}`, "common_operation"));
        }

        const results = index.query("common", 3);
        assert.equal(results.length, 3);
    });

    // ── Edge Cases ───────────────────────────────────────────────────────

    it("returns empty for empty query string", () => {
        index.onEvent(makeEvent("e1", "file_write"));
        const results = index.query("", 10);
        assert.equal(results.length, 0);
    });

    it("returns empty for whitespace-only query", () => {
        index.onEvent(makeEvent("e1", "file_write"));
        const results = index.query("   ", 10);
        assert.equal(results.length, 0);
    });

    it("returns empty for single-character tokens (filtered out)", () => {
        index.onEvent(makeEvent("e1", "a_b_c"));
        // Single chars "a", "b", "c" are filtered
        const results = index.query("a b c", 10);
        assert.equal(results.length, 0);
    });

    it("case-insensitive matching", () => {
        index.onEvent(makeEvent("e1", "File_Write"));
        const results = index.query("FILE_WRITE", 10);
        assert.equal(results.length, 1);
    });

    it("handles special characters in details gracefully", () => {
        index.onEvent(makeEvent("e1", "file_write", "tool_execution", {
            path: "/tmp/test file (1).txt",
            content: "line1\nline2\ttab",
        }));
        const results = index.query("test file", 5);
        assert.ok(results.length >= 1);
    });

    it("handles events with empty details", () => {
        index.onEvent(makeEvent("e1", "heartbeat", "performance", {}));
        const results = index.query("heartbeat", 5);
        assert.equal(results.length, 1);
    });

    it("handles events with nested details", () => {
        index.onEvent(makeEvent("e1", "analysis", "tool_execution", {
            deep: { nested: { value: "knowledge_graph_test" } },
        }));
        const results = index.query("knowledge_graph_test", 5);
        assert.equal(results.length, 1);
    });

    // ── SemanticMatch Shape ──────────────────────────────────────────────

    it("SemanticMatch has required fields", () => {
        index.onEvent(makeEvent("e1", "file_write", "governance"));
        const results = index.query("file_write", 1);
        assert.equal(results.length, 1);
        const match = results[0]!;
        assert.equal(typeof match.id, "string");
        assert.equal(typeof match.operation, "string");
        assert.equal(typeof match.layer, "string");
        assert.equal(typeof match.timestamp, "string");
        assert.equal(typeof match.score, "number");
        assert.ok(match.score > 0 && match.score <= 1);
    });

    // ── Performance ──────────────────────────────────────────────────────

    it("indexes 1000 events in under 500ms", () => {
        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            index.onEvent(makeEvent(`perf-${i}`, `operation_${i % 50}`, "tool_execution", {
                idx: i,
                payload: `data_chunk_${i}_with_extra_content`,
            }));
        }
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 500, `Ingestion took ${elapsed.toFixed(1)}ms (limit: 500ms)`);
    });

    it("queries 1000-document index in under 50ms", () => {
        for (let i = 0; i < 1000; i++) {
            index.onEvent(makeEvent(`perf-${i}`, `operation_${i % 50}`, "tool_execution", {
                idx: i,
                payload: `data_chunk_${i}`,
            }));
        }

        const start = performance.now();
        const results = index.query("operation_25", 10);
        const elapsed = performance.now() - start;

        assert.ok(results.length > 0);
        assert.ok(elapsed < 50, `Query took ${elapsed.toFixed(1)}ms (limit: 50ms)`);
    });

    it("handles 5000 events without error", () => {
        for (let i = 0; i < 5000; i++) {
            index.onEvent(makeEvent(`bulk-${i}`, `bulk_op_${i % 100}`));
        }
        const results = index.query("bulk_op_42", 5);
        assert.ok(results.length > 0);
    });
});
