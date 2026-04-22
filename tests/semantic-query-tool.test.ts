/**
 * Diagnostics for MemoryQueryTool and SemanticQueryTool — contract
 * validation, mode switching, error handling, and integration with
 * SemanticMemoryIndex / EpisodicMemory / SessionMemoryStore.
 *
 * Run via node:test: node --test dist/tests/semantic-query-tool.test.js
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemoryQueryTool, SemanticQueryTool } from "../src/adapters/application/semantic-query-tool.js";
import { SemanticMemoryIndex } from "../src/core/memory/semantic-memory.js";
import { EpisodicMemory } from "../src/core/memory/episodic-memory.js";
import { SessionMemoryStore } from "../src/core/memory/session-memory.js";
import type { ToolRequest } from "../src/core/tools/types.js";
import type { ActivityEvent } from "../src/core/activity/types.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "prism-kg-diag-sqt-test.db";

function makeRequest(args: Record<string, unknown>): ToolRequest {
    return { operation: "memory_query", args, risk: "low", mutatesState: false };
}

function makeEvent(id: string, operation: string, layer: string = "tool_execution"): ActivityEvent {
    return {
        id,
        timestamp: new Date().toISOString(),
        sessionId: "test-session",
        layer: layer as ActivityEvent["layer"],
        operation,
        status: "succeeded",
        details: { test: true },
        hash: `hash-${id}`,
    };
}

describe("MemoryQueryTool — Diagnostics", () => {
    let tool: MemoryQueryTool;
    let semanticIndex: SemanticMemoryIndex;
    let episodicMemory: EpisodicMemory;
    let sessionMemory: SessionMemoryStore;

    beforeEach(() => {
        semanticIndex = new SemanticMemoryIndex();
        episodicMemory = new EpisodicMemory(100);
        try { unlinkSync(TEST_DB); } catch { /* ok */ }
        sessionMemory = new SessionMemoryStore(TEST_DB);
        tool = new MemoryQueryTool(semanticIndex, episodicMemory, sessionMemory);
    });

    // ── Contract & Identity ──────────────────────────────────────────────

    it("has name 'memory_query'", () => {
        assert.equal(tool.name, "memory_query");
    });

    it("has a contract with version", () => {
        assert.ok(tool.contract);
        assert.equal(tool.contract.version, "1.0.0");
    });

    it("contract args include mode, query, limit, sessionId", () => {
        const args = tool.contract.args;
        assert.ok(args.mode);
        assert.ok(args.query);
        assert.ok(args.limit);
        assert.ok(args.sessionId);
    });

    // ── Semantic mode ────────────────────────────────────────────────────

    it("semantic mode returns matches from SemanticMemoryIndex", async () => {
        semanticIndex.onEvent(makeEvent("e1", "file_write"));
        semanticIndex.onEvent(makeEvent("e2", "shell_exec"));

        const result = await tool.execute(makeRequest({ mode: "semantic", query: "file_write", limit: 5 }));
        assert.equal(result.ok, true);
        const matches = (result.output as Record<string, unknown>).semanticMatches as unknown[];
        assert.ok(Array.isArray(matches));
        assert.ok(matches.length >= 1);
    });

    it("semantic mode requires query", async () => {
        const result = await tool.execute(makeRequest({ mode: "semantic", query: "" }));
        assert.equal(result.ok, false);
        assert.ok((result.output as Record<string, unknown>).error);
    });

    // ── Episodic mode ────────────────────────────────────────────────────

    it("episodic_recent returns recent events", async () => {
        episodicMemory.onEvent(makeEvent("e1", "op1"));
        episodicMemory.onEvent(makeEvent("e2", "op2"));

        const result = await tool.execute(makeRequest({ mode: "episodic_recent", limit: 5 }));
        assert.equal(result.ok, true);
        const episodic = (result.output as Record<string, unknown>).episodic;
        assert.ok(episodic);
    });

    // ── Session summary mode ─────────────────────────────────────────────

    it("session_summary returns null for unknown session", async () => {
        const result = await tool.execute(makeRequest({ mode: "session_summary", sessionId: "nonexistent" }));
        assert.equal(result.ok, true);
        assert.equal((result.output as Record<string, unknown>).sessionSummary, null);
    });

    it("session_summary returns data for a tracked session", async () => {
        sessionMemory.onEvent(makeEvent("e1", "op1"));

        const result = await tool.execute(makeRequest({ mode: "session_summary", sessionId: "test-session" }));
        assert.equal(result.ok, true);
        const summary = (result.output as Record<string, unknown>).sessionSummary as Record<string, unknown> | null;
        assert.ok(summary);
        assert.equal(summary!.sessionId, "test-session");
    });

    // ── All mode ─────────────────────────────────────────────────────────

    it("'all' mode returns semantic, episodic, and session data", async () => {
        semanticIndex.onEvent(makeEvent("e1", "file_write"));
        episodicMemory.onEvent(makeEvent("e2", "op2"));
        sessionMemory.onEvent(makeEvent("e3", "op3"));

        const result = await tool.execute(makeRequest({ mode: "all", query: "file_write", limit: 5, sessionId: "test-session" }));
        assert.equal(result.ok, true);
        const output = result.output as Record<string, unknown>;
        assert.ok(output.semanticMatches);
        assert.ok(output.episodic);
        assert.ok(output.sessionSummary);
    });

    it("'all' mode requires query", async () => {
        const result = await tool.execute(makeRequest({ mode: "all", query: "" }));
        assert.equal(result.ok, false);
    });

    // ── Default mode ─────────────────────────────────────────────────────

    it("defaults to 'all' mode when mode not specified", async () => {
        semanticIndex.onEvent(makeEvent("e1", "file_write"));
        const result = await tool.execute(makeRequest({ query: "file_write" }));
        assert.equal(result.ok, true);
        assert.equal((result.output as Record<string, unknown>).mode, "all");
    });

    // ── Side effects ─────────────────────────────────────────────────────

    it("reports read-only side effects", async () => {
        semanticIndex.onEvent(makeEvent("e1", "file_write"));
        const result = await tool.execute(makeRequest({ mode: "semantic", query: "file_write" }));
        assert.ok(result.sideEffects);
        assert.ok(result.sideEffects!.length > 0);
        assert.equal(result.sideEffects![0]!.type, "api");
    });

    // ── Invalid args ─────────────────────────────────────────────────────

    it("handles invalid mode gracefully (falls back to 'all')", async () => {
        semanticIndex.onEvent(makeEvent("e1", "file_write"));
        const result = await tool.execute(makeRequest({ mode: "bogus_mode", query: "file_write" }));
        assert.equal(result.ok, true);
        assert.equal((result.output as Record<string, unknown>).mode, "all");
    });

    it("handles non-number limit gracefully", async () => {
        semanticIndex.onEvent(makeEvent("e1", "file_write"));
        const result = await tool.execute(makeRequest({ mode: "semantic", query: "file_write", limit: "not_a_number" }));
        assert.equal(result.ok, true);
    });
});

describe("SemanticQueryTool — Diagnostics", () => {
    it("has name 'semantic_query'", () => {
        const semanticIndex = new SemanticMemoryIndex();
        const episodicMemory = new EpisodicMemory(100);
        let sessionMemory: SessionMemoryStore;
        try { unlinkSync(TEST_DB + ".sq"); } catch { /* ok */ }
        sessionMemory = new SessionMemoryStore(TEST_DB + ".sq");
        const tool = new SemanticQueryTool(semanticIndex, episodicMemory, sessionMemory);
        assert.equal(tool.name, "semantic_query");
    });

    it("extends MemoryQueryTool (inherits execute behavior)", async () => {
        const semanticIndex = new SemanticMemoryIndex();
        const episodicMemory = new EpisodicMemory(100);
        let sessionMemory: SessionMemoryStore;
        try { unlinkSync(TEST_DB + ".sq2"); } catch { /* ok */ }
        sessionMemory = new SessionMemoryStore(TEST_DB + ".sq2");
        const tool = new SemanticQueryTool(semanticIndex, episodicMemory, sessionMemory);

        semanticIndex.onEvent(makeEvent("e1", "file_write"));
        const result = await tool.execute(makeRequest({ mode: "semantic", query: "file_write" }));
        assert.equal(result.ok, true);
        const matches = (result.output as Record<string, unknown>).semanticMatches as unknown[];
        assert.ok(matches.length >= 1);
    });
});
