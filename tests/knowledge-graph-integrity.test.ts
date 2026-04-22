/**
 * Knowledge Graph Integrity Tests — validates graph persistence files,
 * semantic-memory structural integrity, episodic memory bounds, and
 * session-memory SQLite schema.
 *
 * Run via Mocha: mocha dist/tests/knowledge-graph-integrity.test.js --timeout 90000
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import { SemanticMemoryIndex } from "../src/core/memory/semantic-memory.js";
import { EpisodicMemory } from "../src/core/memory/episodic-memory.js";
import { SessionMemoryStore } from "../src/core/memory/session-memory.js";
import type { ActivityEvent } from "../src/core/activity/types.js";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TEST_DB = "prism-kg-diag-integrity-test.db";

function makeEvent(id: string, operation: string, layer: string = "tool_execution", details: Record<string, unknown> = {}): ActivityEvent {
    return {
        id,
        timestamp: new Date().toISOString(),
        sessionId: "integrity-session",
        layer: layer as ActivityEvent["layer"],
        operation,
        status: "succeeded",
        details,
        hash: `hash-${id}`,
    };
}

describe("Knowledge Graph Integrity", function () {
    this.timeout(90_000);

    // ── MCP Graph Persistence Validation ─────────────────────────────────

    describe("MCP Graph Persistence", function () {
        const idsMcpDir = join(process.cwd(), ".mcp", "ids-mcp");
        const graphPath = join(idsMcpDir, "ids_knowledge_graph.pkl");
        const backupPath = join(idsMcpDir, "backups", "knowledge_graph.pkl");

        it("ids-mcp directory exists", function () {
            if (!existsSync(idsMcpDir)) {
                this.skip();
                return;
            }
            assert.ok(existsSync(idsMcpDir));
        });

        it("knowledge graph pickle file exists and is non-empty", function () {
            if (!existsSync(graphPath)) {
                this.skip();
                return;
            }
            const stat = statSync(graphPath);
            assert.ok(stat.size > 0, `Graph file is empty (${stat.size} bytes)`);
        });

        it("knowledge graph backup exists for disaster recovery", function () {
            if (!existsSync(backupPath)) {
                this.skip();
                return;
            }
            const stat = statSync(backupPath);
            assert.ok(stat.size > 0, "Backup should be non-empty");
        });

        it("UKS integration Python module has required classes", function () {
            const uksPath = join(process.cwd(), ".mcp", "impressioncore-dpa", "knowledge", "uks_integration.py");
            if (!existsSync(uksPath)) {
                this.skip();
                return;
            }
            const content = readFileSync(uksPath, "utf8");
            const requiredClasses = ["UKSIntegration", "KnowledgeStore", "KnowledgeCache", "UKSMemoryManager"];
            for (const cls of requiredClasses) {
                assert.ok(content.includes(`class ${cls}`), `Missing class: ${cls}`);
            }
        });

        it("UKS integration has required enums", function () {
            const uksPath = join(process.cwd(), ".mcp", "impressioncore-dpa", "knowledge", "uks_integration.py");
            if (!existsSync(uksPath)) {
                this.skip();
                return;
            }
            const content = readFileSync(uksPath, "utf8");
            assert.ok(content.includes("class KnowledgeType"), "Missing KnowledgeType enum");
            assert.ok(content.includes("class RelationType"), "Missing RelationType enum");
        });

        it("GraphBridge has required methods", function () {
            const bridgePath = join(process.cwd(), ".mcp", "ids-mcp", "graph_bridge.py");
            if (!existsSync(bridgePath)) {
                this.skip();
                return;
            }
            const content = readFileSync(bridgePath, "utf8");
            const requiredMethods = ["build_index", "save_graph", "load_graph", "query_relationships", "trace_lineage"];
            for (const method of requiredMethods) {
                assert.ok(content.includes(`def ${method}`), `Missing method: ${method}`);
            }
        });
    });

    // ── Semantic Memory Structural Integrity ─────────────────────────────

    describe("Semantic Memory Structure", function () {
        let index: SemanticMemoryIndex;

        before(function () {
            index = new SemanticMemoryIndex();
        });

        it("maintains unique event IDs (no duplicates)", function () {
            index.onEvent(makeEvent("unique-1", "op_a"));
            index.onEvent(makeEvent("unique-2", "op_b"));
            index.onEvent(makeEvent("unique-3", "op_c"));

            const resultA = index.query("op_a", 10);
            const resultB = index.query("op_b", 10);
            assert.equal(resultA.length, 1);
            assert.equal(resultB.length, 1);
            assert.notEqual(resultA[0]!.id, resultB[0]!.id);
        });

        it("last-write-wins for duplicate IDs preserves consistency", function () {
            index.onEvent(makeEvent("dup-1", "original_op"));
            index.onEvent(makeEvent("dup-1", "updated_op"));

            const original = index.query("original_op", 10);
            const updated = index.query("updated_op", 10);
            assert.equal(original.length, 0, "Original should be overwritten");
            assert.equal(updated.length, 1, "Updated should exist");
        });

        it("scores are bounded between 0 and 1", function () {
            for (let i = 0; i < 50; i++) {
                index.onEvent(makeEvent(`score-${i}`, `operation_${i % 10}`, "tool_execution", { data: `payload_${i}` }));
            }

            const results = index.query("operation_5 payload", 50);
            for (const match of results) {
                assert.ok(match.score > 0, `Score ${match.score} should be > 0`);
                assert.ok(match.score <= 1, `Score ${match.score} should be <= 1`);
            }
        });

        it("empty terms after tokenization return empty results", function () {
            index.onEvent(makeEvent("tok-1", "valid_operation"));
            // All tokens < 2 chars will be filtered
            assert.equal(index.query("a b c", 10).length, 0);
        });
    });

    // ── Episodic Memory Boundary Integrity ───────────────────────────────

    describe("Episodic Memory Boundaries", function () {
        it("respects max capacity (FIFO eviction)", function () {
            const ep = new EpisodicMemory(5);
            for (let i = 0; i < 10; i++) {
                ep.onEvent(makeEvent(`ep-${i}`, `op_${i}`));
            }
            const snapshot = ep.snapshot(10);
            assert.equal(snapshot.count, 5, "Should cap at maxEvents=5");
        });

        it("recent() returns newest events first (stack order)", function () {
            const ep = new EpisodicMemory(100);
            ep.onEvent(makeEvent("old", "op_old"));
            ep.onEvent(makeEvent("new", "op_new"));

            const recent = ep.recent(1);
            assert.equal(recent.length, 1);
            assert.equal(recent[0]!.id, "new");
        });

        it("estimated tokens increase with events", function () {
            const ep = new EpisodicMemory(100);
            const before = ep.snapshot().estimatedTokens;
            ep.onEvent(makeEvent("tok-1", "operation", "tool_execution", { large: "x".repeat(200) }));
            const after_tokens = ep.snapshot().estimatedTokens;
            assert.ok(after_tokens > before, "Token count should increase");
        });

        it("tokens decrease after eviction", function () {
            const ep = new EpisodicMemory(2);
            ep.onEvent(makeEvent("t1", "op1", "tool_execution", { data: "x".repeat(500) }));
            ep.onEvent(makeEvent("t2", "op2", "tool_execution", { data: "y".repeat(500) }));
            const tokensAt2 = ep.snapshot().estimatedTokens;

            ep.onEvent(makeEvent("t3", "op3", "tool_execution", { data: "z".repeat(10) }));
            const tokensAt3 = ep.snapshot().estimatedTokens;

            // After eviction of the large t1 event, tokens should decrease
            assert.ok(tokensAt3 < tokensAt2, "Tokens should decrease after evicting large event");
        });
    });

    // ── Session Memory SQLite Schema Integrity ───────────────────────────

    describe("Session Memory SQLite Schema", function () {
        let sessionMemory: SessionMemoryStore;

        before(function () {
            try { unlinkSync(TEST_DB); } catch { /* ok */ }
            sessionMemory = new SessionMemoryStore(TEST_DB);
        });

        after(function () {
            try { sessionMemory.close(); } catch { /* ok */ }
            try { unlinkSync(TEST_DB); } catch { /* ok */ }
        });

        it("creates session_summaries table", function () {
            const db = new DatabaseSync(TEST_DB);
            try {
                const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries'").all();
                assert.ok(tables.length > 0, "session_summaries table should exist");
            } finally {
                db.close();
            }
        });

        it("session_summaries table has required columns", function () {
            const db = new DatabaseSync(TEST_DB);
            try {
                const columns = db.prepare("PRAGMA table_info(session_summaries)").all() as Array<{ name: string }>;
                const columnNames = columns.map((c) => c.name);
                const required = ["session_id", "total_events", "failures", "tool_executions", "updated_at"];
                for (const col of required) {
                    assert.ok(columnNames.includes(col), `Missing column: ${col}`);
                }
            } finally {
                db.close();
            }
        });

        it("upsert works correctly for new sessions", function () {
            sessionMemory.onEvent(makeEvent("ss-1", "op_start"));
            const summary = sessionMemory.getSessionSummary("integrity-session");
            assert.ok(summary, "Should have a session summary after event");
            assert.equal(summary!.sessionId, "integrity-session");
            assert.equal(summary!.totalEvents, 1);
        });

        it("upsert increments counters for existing sessions", function () {
            sessionMemory.onEvent(makeEvent("ss-2", "op_next"));
            const summary = sessionMemory.getSessionSummary("integrity-session");
            assert.ok(summary);
            assert.equal(summary!.totalEvents, 2);
        });

        it("tracks failures correctly", function () {
            const failEvent: ActivityEvent = {
                ...makeEvent("ss-fail", "op_fail"),
                status: "failed",
            };
            sessionMemory.onEvent(failEvent);
            const summary = sessionMemory.getSessionSummary("integrity-session");
            assert.ok(summary);
            assert.ok(summary!.failures >= 1, "Should track failures");
        });

        it("returns null for unknown session", function () {
            const summary = sessionMemory.getSessionSummary("nonexistent-session");
            assert.strictEqual(summary, null);
        });
    });

    // ── Cross-Module Coherence ───────────────────────────────────────────

    describe("Cross-Module Coherence", function () {
        it("same event ingested into all three stores maintains consistency", function () {
            const event = makeEvent("coherence-1", "knowledge_graph_query", "retrieval", { nodes: 42 });

            const sem = new SemanticMemoryIndex();
            const ep = new EpisodicMemory(100);
            try { unlinkSync(TEST_DB + ".coherence"); } catch { /* ok */ }
            const sess = new SessionMemoryStore(TEST_DB + ".coherence");

            try {
                sem.onEvent(event);
                ep.onEvent(event);
                sess.onEvent(event);

                // Semantic: queryable
                const semResults = sem.query("knowledge_graph_query", 5);
                assert.ok(semResults.length >= 1);

                // Episodic: present in recent
                const recent = ep.recent(5);
                assert.ok(recent.some((e) => e.id === "coherence-1"));

                // Session: tracked
                const summary = sess.getSessionSummary("integrity-session");
                assert.ok(summary);
                assert.ok(summary!.totalEvents >= 1);
            } finally {
                sess.close();
                try { unlinkSync(TEST_DB + ".coherence"); } catch { /* ok */ }
            }
        });
    });
});
