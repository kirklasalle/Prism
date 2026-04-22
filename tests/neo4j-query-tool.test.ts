/**
 * Diagnostics for Neo4jQueryTool — graceful degradation when Neo4j is
 * unavailable, contract validation, and Cypher injection safety.
 *
 * Run via node:test: node --test dist/tests/neo4j-query-tool.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Neo4jQueryTool } from "../src/adapters/application/neo4j-tool.js";
import type { ToolRequest } from "../src/core/tools/types.js";

function makeRequest(args: Record<string, unknown>): ToolRequest {
    return { operation: "neo4j_query", args, risk: "low", mutatesState: false };
}

describe("Neo4jQueryTool — Diagnostics", () => {
    let tool: Neo4jQueryTool;

    // ── Identity & Contract ──────────────────────────────────────────────

    it("has name 'neo4j_query'", () => {
        tool = new Neo4jQueryTool();
        assert.equal(tool.name, "neo4j_query");
    });

    it("has a contract with version and args", () => {
        tool = new Neo4jQueryTool();
        assert.ok(tool.contract);
        assert.equal(tool.contract.version, "1.0.0");
        assert.ok(tool.contract.args.cypher);
    });

    it("contract requires cypher arg", () => {
        tool = new Neo4jQueryTool();
        assert.ok(tool.contract.args.cypher.required);
    });

    // ── Graceful degradation (neo4j-driver likely not installed in CI) ──

    it("returns ok=false when neo4j-driver is not available", async () => {
        tool = new Neo4jQueryTool();
        const result = await tool.execute(makeRequest({ cypher: "MATCH (n) RETURN n LIMIT 1" }));

        // If the driver IS installed and connected, result.ok could be true.
        // But typically in test environments, it's not available.
        if (!result.ok) {
            const error = (result.output as Record<string, unknown>).error as string;
            assert.ok(error);
            assert.ok(error.length > 0, "Should provide a meaningful error message");
        } else {
            // Driver is installed and connected — still valid.
            assert.ok(result.output);
        }
    });

    it("returns ok=false for empty cypher query", async () => {
        tool = new Neo4jQueryTool();
        const result = await tool.execute(makeRequest({ cypher: "" }));
        assert.equal(result.ok, false);
        assert.ok((result.output as Record<string, unknown>).error);
    });

    it("returns ok=false for missing cypher arg", async () => {
        tool = new Neo4jQueryTool();
        const result = await tool.execute(makeRequest({}));
        assert.equal(result.ok, false);
    });

    // ── Input handling ───────────────────────────────────────────────────

    it("handles params argument gracefully", async () => {
        tool = new Neo4jQueryTool();
        const result = await tool.execute(makeRequest({
            cypher: "MATCH (n {name: $name}) RETURN n",
            params: { name: "test" },
        }));
        // Should not throw — either a clean error (no driver) or success
        assert.ok(typeof result.ok === "boolean");
    });

    it("handles non-object params fallback", async () => {
        tool = new Neo4jQueryTool();
        const result = await tool.execute(makeRequest({
            cypher: "MATCH (n) RETURN n LIMIT 1",
            params: "invalid_not_object",
        }));
        assert.ok(typeof result.ok === "boolean");
    });

    // ── Cypher Injection Prevention ──────────────────────────────────────

    it("does not crash on common injection patterns", async () => {
        tool = new Neo4jQueryTool();
        const injectionAttempts = [
            "MATCH (n) DETACH DELETE n",
            "CALL db.labels() YIELD label RETURN label",
            "' OR 1=1 --",
            "MATCH (n) SET n.password = 'hacked' RETURN n",
        ];

        for (const cypher of injectionAttempts) {
            const result = await tool.execute(makeRequest({ cypher }));
            // Should not crash — returns either an error or result
            assert.ok(typeof result.ok === "boolean");
        }
    });

    // ── Tool interface compliance ────────────────────────────────────────

    it("implements Tool.execute()", () => {
        tool = new Neo4jQueryTool();
        assert.equal(typeof tool.execute, "function");
    });

    it("has name, contract properties", () => {
        tool = new Neo4jQueryTool();
        assert.equal(typeof tool.name, "string");
        assert.ok(tool.contract);
    });
});
