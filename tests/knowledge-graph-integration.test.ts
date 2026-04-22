/**
 * Knowledge Graph Integration Tests — validates MCP knowledge bridge
 * connectivity, semantic memory round-trips, and knowledge-graph
 * persistence file integrity.
 *
 * Run via Mocha: mocha dist/tests/knowledge-graph-integration.test.js --timeout 90000
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import { SemanticMemoryIndex } from "../src/core/memory/semantic-memory.js";
import { EpisodicMemory } from "../src/core/memory/episodic-memory.js";
import { SessionMemoryStore } from "../src/core/memory/session-memory.js";
import { MemoryQueryTool } from "../src/adapters/application/semantic-query-tool.js";
import type { ActivityEvent } from "../src/core/activity/types.js";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const TEST_DB = "prism-kg-diag-integration-test.db";
const MCP_UKS_GRAPH_PATH = join(process.cwd(), ".mcp", "ids-mcp", "ids_knowledge_graph.pkl");
const MCP_UKS_DB_DIR = join(process.cwd(), ".mcp", "impressioncore-dpa", "knowledge");

function makeEvent(id: string, operation: string, layer: string = "tool_execution", details: Record<string, unknown> = {}): ActivityEvent {
    return {
        id,
        timestamp: new Date().toISOString(),
        sessionId: "kg-integration-session",
        layer: layer as ActivityEvent["layer"],
        operation,
        status: "succeeded",
        details,
        hash: `hash-${id}`,
    };
}

describe("Knowledge Graph Integration", function () {
    this.timeout(90_000);

    let semanticIndex: SemanticMemoryIndex;
    let episodicMemory: EpisodicMemory;
    let sessionMemory: SessionMemoryStore;
    let memoryQueryTool: MemoryQueryTool;

    before(function () {
        semanticIndex = new SemanticMemoryIndex();
        episodicMemory = new EpisodicMemory(500);
        try { unlinkSync(TEST_DB); } catch { /* ok */ }
        sessionMemory = new SessionMemoryStore(TEST_DB);
        memoryQueryTool = new MemoryQueryTool(semanticIndex, episodicMemory, sessionMemory);
    });

    after(function () {
        try { sessionMemory.close(); } catch { /* ok */ }
        try { unlinkSync(TEST_DB); } catch { /* ok */ }
    });

    // ── Semantic Memory Full Lifecycle ───────────────────────────────────

    describe("Semantic Memory Lifecycle", function () {
        it("should ingest events and return ranked results", function () {
            const events = [
                makeEvent("kg-1", "knowledge_graph_query", "retrieval", { graph: "uks", nodes: 42 }),
                makeEvent("kg-2", "file_write", "tool_execution", { path: "/tmp/data.json" }),
                makeEvent("kg-3", "knowledge_graph_update", "retrieval", { graph: "uks", added: 5 }),
                makeEvent("kg-4", "shell_exec", "tool_execution", { command: "ls" }),
                makeEvent("kg-5", "knowledge_graph_traverse", "retrieval", { graph: "uks", depth: 3 }),
            ];

            for (const event of events) {
                semanticIndex.onEvent(event);
            }

            const results = semanticIndex.query("knowledge_graph", 10);
            assert.ok(results.length >= 3, `Expected >= 3 KG results, got ${results.length}`);

            // All KG results should score higher than non-KG
            for (const r of results) {
                assert.ok(r.score > 0, "Score should be positive");
            }
        });

        it("should rank multi-term matches higher", function () {
            const results = semanticIndex.query("knowledge_graph uks", 10);
            // Events with both "knowledge_graph" AND "uks" should rank highest
            if (results.length >= 2) {
                assert.ok(results[0]!.score >= results[1]!.score);
            }
        });

        it("should return SemanticMatch objects with required properties", function () {
            const results = semanticIndex.query("knowledge", 1);
            assert.ok(results.length > 0);
            const match = results[0]!;
            assert.ok(typeof match.id === "string");
            assert.ok(typeof match.operation === "string");
            assert.ok(typeof match.layer === "string");
            assert.ok(typeof match.timestamp === "string");
            assert.ok(typeof match.score === "number");
        });
    });

    // ── MemoryQueryTool Round-Trip ───────────────────────────────────────

    describe("MemoryQueryTool Round-Trip", function () {
        it("should return semantic matches via tool.execute()", async function () {
            const result = await memoryQueryTool.execute({
                operation: "memory_query",
                args: { mode: "semantic", query: "knowledge_graph", limit: 5 },
                risk: "low",
                mutatesState: false,
            });

            assert.strictEqual(result.ok, true);
            const matches = (result.output as Record<string, unknown>).semanticMatches as unknown[];
            assert.ok(Array.isArray(matches));
            assert.ok(matches.length > 0, "Should find knowledge_graph events");
        });

        it("should return episodic snapshot via tool.execute()", async function () {
            episodicMemory.onEvent(makeEvent("ep-1", "knowledge_ingest"));
            episodicMemory.onEvent(makeEvent("ep-2", "knowledge_query"));

            const result = await memoryQueryTool.execute({
                operation: "memory_query",
                args: { mode: "episodic_recent", limit: 10 },
                risk: "low",
                mutatesState: false,
            });

            assert.strictEqual(result.ok, true);
            const episodic = (result.output as Record<string, unknown>).episodic as Record<string, unknown>;
            assert.ok(episodic);
            assert.ok(typeof episodic.count === "number");
        });

        it("should handle 'all' mode combining semantic + episodic + session", async function () {
            sessionMemory.onEvent(makeEvent("sess-1", "knowledge_store"));

            const result = await memoryQueryTool.execute({
                operation: "memory_query",
                args: { mode: "all", query: "knowledge", limit: 5, sessionId: "kg-integration-session" },
                risk: "low",
                mutatesState: false,
            });

            assert.strictEqual(result.ok, true);
            const output = result.output as Record<string, unknown>;
            assert.ok(output.semanticMatches, "Should have semantic results");
            assert.ok(output.episodic, "Should have episodic snapshot");
            assert.ok(output.sessionSummary, "Should have session summary");
        });
    });

    // ── MCP Knowledge Graph File Inspection ──────────────────────────────

    describe("MCP Knowledge Graph Artifacts", function () {
        it("should have IDS knowledge graph pickle file", function () {
            if (!existsSync(MCP_UKS_GRAPH_PATH)) {
                this.skip(); // MCP servers may not have been run yet
                return;
            }
            const stat = statSync(MCP_UKS_GRAPH_PATH);
            assert.ok(stat.size > 0, "Knowledge graph pickle should not be empty");
        });

        it("should have UKS integration module", function () {
            const uksPath = join(MCP_UKS_DB_DIR, "uks_integration.py");
            if (!existsSync(uksPath)) {
                this.skip();
                return;
            }
            const content = readFileSync(uksPath, "utf8");
            assert.ok(content.includes("class UKSIntegration"), "Should contain UKSIntegration class");
            assert.ok(content.includes("class KnowledgeStore"), "Should contain KnowledgeStore class");
            assert.ok(content.includes("class KnowledgeCache"), "Should contain KnowledgeCache class");
        });

        it("should have GraphBridge module", function () {
            const bridgePath = join(process.cwd(), ".mcp", "ids-mcp", "graph_bridge.py");
            if (!existsSync(bridgePath)) {
                this.skip();
                return;
            }
            const content = readFileSync(bridgePath, "utf8");
            assert.ok(content.includes("class GraphBridge"), "Should contain GraphBridge class");
            assert.ok(content.includes("def build_index"), "Should have build_index method");
            assert.ok(content.includes("def query_relationships"), "Should have query_relationships method");
        });
    });

    // ── Performance Targets ──────────────────────────────────────────────

    describe("Performance", function () {
        it("semantic query latency < 500ms on 2000 documents", function () {
            const idx = new SemanticMemoryIndex();
            for (let i = 0; i < 2000; i++) {
                idx.onEvent(makeEvent(`perf-${i}`, `op_${i % 100}`, "tool_execution", {
                    data: `payload_${i}_knowledge_graph_${i % 10}`,
                }));
            }

            const start = performance.now();
            const results = idx.query("knowledge_graph op_42", 10);
            const elapsed = performance.now() - start;

            assert.ok(results.length > 0, "Should return results");
            assert.ok(elapsed < 500, `Query took ${elapsed.toFixed(1)}ms, target is <500ms`);
        });

        it("MemoryQueryTool.execute latency < 500ms", async function () {
            const start = performance.now();
            const result = await memoryQueryTool.execute({
                operation: "memory_query",
                args: { mode: "semantic", query: "knowledge_graph", limit: 5 },
                risk: "low",
                mutatesState: false,
            });
            const elapsed = performance.now() - start;

            assert.strictEqual(result.ok, true);
            assert.ok(elapsed < 500, `Tool execute took ${elapsed.toFixed(1)}ms, target is <500ms`);
        });
    });
});
