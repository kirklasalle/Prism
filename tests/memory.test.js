import assert from "node:assert";
import { EpisodicMemory } from "../src/core/memory/episodic-memory.js";
import { SemanticMemoryIndex } from "../src/core/memory/semantic-memory.js";
export async function testEpisodicMemory() {
    const episodic = new EpisodicMemory(10);
    // Empty state
    let snapshot = episodic.snapshot();
    assert.strictEqual(snapshot.count, 0);
    assert.strictEqual(snapshot.estimatedTokens, 0);
    // Add events
    for (let i = 0; i < 5; i++) {
        episodic.onEvent({
            id: `event-${i}`,
            timestamp: new Date().toISOString(),
            sessionId: "test-session",
            layer: "tool_execution",
            operation: `op${i}`,
            status: "succeeded",
            details: { result: i },
            hash: "fake-hash",
        });
    }
    snapshot = episodic.snapshot();
    assert.strictEqual(snapshot.count, 5);
    assert.ok(snapshot.estimatedTokens > 0);
    // Get recent events
    const recent = episodic.recent(3);
    assert.strictEqual(recent.length, 3);
    assert.strictEqual(recent[recent.length - 1].operation, "op4");
    // Test max capacity
    for (let i = 5; i < 15; i++) {
        episodic.onEvent({
            id: `event-${i}`,
            timestamp: new Date().toISOString(),
            sessionId: "test-session",
            layer: "tool_execution",
            operation: `op${i}`,
            status: "succeeded",
            details: { result: i },
            hash: "fake-hash",
        });
    }
    snapshot = episodic.snapshot();
    assert.strictEqual(snapshot.count, 10); // Max capacity is 10
    const oldest = episodic.recent(1);
    assert.strictEqual(oldest[0].operation, "op14"); // Most recent
    console.log("✓ EpisodicMemory tests passed");
}
export async function testSemanticMemoryIndex() {
    const index = new SemanticMemoryIndex();
    // Add events
    index.onEvent({
        id: "event-1",
        timestamp: new Date().toISOString(),
        sessionId: "test-session",
        layer: "tool_execution",
        operation: "file_write",
        status: "succeeded",
        details: { path: "/etc/config.txt" },
        hash: "hash-1",
    });
    index.onEvent({
        id: "event-2",
        timestamp: new Date().toISOString(),
        sessionId: "test-session",
        layer: "governance",
        operation: "file_write.policy_check",
        status: "succeeded",
        details: { tier: "tier3_approval" },
        hash: "hash-2",
    });
    index.onEvent({
        id: "event-3",
        timestamp: new Date().toISOString(),
        sessionId: "test-session",
        layer: "tool_execution",
        operation: "shell_exec",
        status: "succeeded",
        details: { command: "node --version" },
        hash: "hash-3",
    });
    // Query for file_write
    const fileMatches = index.query("file_write", 5);
    assert.strictEqual(fileMatches.length, 2); // event-1 and event-2
    assert.strictEqual(fileMatches[0].operation, "file_write");
    // Query for governance layer
    const govMatches = index.query("governance", 5);
    assert.ok(govMatches.some((m) => m.id === "event-2"));
    // Query that doesn't match
    const noMatches = index.query("nonexistent_term", 5);
    assert.strictEqual(noMatches.length, 0);
    console.log("✓ SemanticMemoryIndex tests passed");
}
//# sourceMappingURL=memory.test.js.map