/**
 * Tests for the Dual-Lens Memory Arbitration (DLMA) prototype.
 */
import assert from "node:assert/strict";
import { ActivityBus } from "../src/core/activity/bus.js";
import { EpisodicMemory } from "../src/core/memory/episodic-memory.js";
import { SemanticMemoryIndex } from "../src/core/memory/semantic-memory.js";
import { CausalLens } from "../src/core/incubation/dlma/causal-lens.js";
import { DualLensArbiter } from "../src/core/incubation/dlma/arbiter.js";
import { fuseLenses } from "../src/core/incubation/dlma/fusion.js";

export async function testDlmaArbiter(): Promise<void> {
    const bus = new ActivityBus();
    const episodic = new EpisodicMemory(100);
    const semantic = new SemanticMemoryIndex();
    bus.subscribe(episodic);
    bus.subscribe(semantic);

    // Seed memory: 2 successes + 1 deny + 1 failure for "search.email"; 1 success for "send.email"
    bus.emit({ sessionId: "s", layer: "tool_execution", operation: "search.email", status: "succeeded", details: { query: "invoice acme" } });
    bus.emit({ sessionId: "s", layer: "tool_execution", operation: "search.email", status: "succeeded", details: { query: "invoice acme" } });
    bus.emit({ sessionId: "s", layer: "tool_execution", operation: "search.email", status: "failed", details: { query: "invoice acme" } });
    bus.emit({ sessionId: "s", layer: "tool_execution", operation: "send.email", status: "succeeded", policyDecision: "deny", details: { query: "invoice acme" } });

    const causal = new CausalLens(episodic);

    // 1. Fusion math: dominant lens identified
    const fused = fuseLenses({
        semantic: [{ id: "a", operation: "search.email", layer: "tool_execution", timestamp: "t", score: 0.8, weight: 1 }],
        causal: [{ id: "a", operation: "search.email", layer: "tool_execution", timestamp: "t", score: 0.4, weight: 1 }],
        weights: { semantic: 0.7, causal: 0.3 },
        consequenceLookup: () => ({ succeeded: 2, failed: 1, denied: 0, trust: 0.33 }),
    }, 5);
    assert.equal(fused.length, 1);
    assert.ok(fused[0].fusedScore > 0.5 && fused[0].fusedScore < 0.8, `expected fused around 0.68, got ${fused[0].fusedScore}`);
    assert.match(fused[0].explanation, /dominant=semantic/);

    // 2. Empty memory fallback: query before recording semantic docs returns empty (causal still has events)
    const arbiter = new DualLensArbiter(semantic, causal, bus, { initialWeights: { semantic: 0.5, causal: 0.5 }, alpha: 0.3 });
    const r1 = arbiter.query("invoice acme", 3);
    assert.ok(r1.matches.length > 0, "fused matches expected after seeding");
    assert.ok(r1.queryId.length > 0);
    assert.deepEqual(r1.weights, { semantic: 0.5, causal: 0.5 });

    // 3. Consequence filtering: send.email has trust = (1 - 0 - 0)/1 = 1, but policyDecision deny means denied=1
    const sendProfile = causal.consequenceFor("send.email");
    assert.equal(sendProfile.denied, 1, "policyDecision deny must increment denied");
    assert.ok(sendProfile.trust < 0, "denied event should drop trust below zero");

    // 4. EMA weight update: feedback toward semantic increases semantic weight
    const before = { ...arbiter.getWeights() };
    arbiter.feedback({ queryId: r1.queryId, observedUtility: 1.0, chosenLens: "semantic" });
    const after = arbiter.getWeights();
    assert.ok(after.semantic > before.semantic, `expected semantic weight to grow: ${before.semantic} -> ${after.semantic}`);
    assert.ok(Math.abs(after.semantic + after.causal - 1) < 1e-9, "weights must remain normalized");

    // 5. Unknown feedback queryId is gracefully no-op (does not throw, does not change weights wildly)
    const w = arbiter.getWeights();
    arbiter.feedback({ queryId: "nonexistent", observedUtility: 1.0, chosenLens: "causal" });
    assert.deepEqual(arbiter.getWeights(), w, "unknown queryId must not alter weights");

    // 6. Empty-memory fallback for new arbiter
    const freshBus = new ActivityBus();
    const freshEp = new EpisodicMemory(50);
    const freshSem = new SemanticMemoryIndex();
    freshBus.subscribe(freshEp);
    freshBus.subscribe(freshSem);
    const freshArbiter = new DualLensArbiter(freshSem, new CausalLens(freshEp), freshBus);
    const empty = freshArbiter.query("anything", 5);
    assert.equal(empty.matches.length, 0, "empty memory must return zero matches");
}
