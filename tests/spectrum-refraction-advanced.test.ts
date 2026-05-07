/**
 * Phase D4c — Advanced Spectrum Refraction tests
 *
 * Covers: per-hemisphere timeouts, circuit breaker, SR audit trail,
 * concurrent fan-out timing, cost estimation, multi-key secret store.
 */

import { describe, it, beforeEach } from "mocha";
import * as assert from "assert";
import {
    LlmProviderManager,
    type SRGenerationOutput,
    type SRCostEstimate,
    type LlmGenerationOutput,
} from "../src/core/operator/llm-provider-manager.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";
import type { SpectrumRefractionConfig } from "../src/core/operator/model-capability-matrix.js";
import type { ActivityBus } from "../src/core/activity/bus.js";

// ─── Minimal ActivityBus mock ────────────────────────────────────────────────

interface CapturedEvent {
    operation: string;
    status: string;
    details: Record<string, unknown>;
}

function makeMockActivityBus(): { bus: ActivityBus; events: CapturedEvent[] } {
    const events: CapturedEvent[] = [];
    const bus = {
        emit(event: { operation: string; status: string; details: Record<string, unknown> }) {
            events.push({ operation: event.operation, status: event.status, details: event.details });
            return event as any;
        },
        subscribe: () => () => { },
        listEvents: () => [],
    } as unknown as ActivityBus;
    return { bus, events };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal SR config using providers that never appear in the same instance.
 *  Uses openai (left) vs anthropic (right) to guarantee isolation. */
function makeSRConfig(overrides: Partial<SpectrumRefractionConfig> = {}): SpectrumRefractionConfig {
    return {
        enabled: true,
        leftModel: { providerId: "openai", model: "gpt-4o" },
        rightModel: { providerId: "anthropic", model: "claude-3-5-sonnet-20241022" },
        ...overrides,
    };
}

/** Build a fake LlmGenerationOutput. */
function fakeOutput(content: string, provider: string = "openai", model: string = "gpt-4o"): LlmGenerationOutput {
    return { providerId: provider as any, model, content };
}

/** Subclass LlmProviderManager to inject a controlled `generate` implementation. */
function makeManagedProvider(
    generateImpl: (input: any, selection?: any) => Promise<LlmGenerationOutput | null>,
    bus?: ActivityBus,
): LlmProviderManager {
    const store = new InMemoryProviderSecretStore();
    const mgr = new LlmProviderManager(process.env, [], store, undefined, undefined, bus);
    // Override generate() for unit test control
    (mgr as any).generate = generateImpl;
    return mgr;
}

// ─── 1. Per-hemisphere timeout ───────────────────────────────────────────────

describe("Spectrum Refraction Advanced — Per-Hemisphere Timeout", () => {
    it("returns partial result when left hemisphere times out", async () => {
        const mgr = makeManagedProvider(async (input: any, selection?: any) => {
            const provider = selection?.providerId ?? "openai";
            const model = selection?.model ?? "";
            // Left hemisphere is openai/gpt-4o with leftTimeoutMs:50
            if (provider === "openai" && model === "gpt-4o") {
                await new Promise(() => { }); // intentionally never resolves — timeout wins
                return null;
            }
            return fakeOutput(`Response from ${provider}`, provider, model || "model");
        });

        const config = makeSRConfig({ leftTimeoutMs: 50, rightTimeoutMs: 5_000 });

        const result = await mgr.generateSR(
            { message: "test", conversation: [], systemPrompt: "sys" },
            config,
        );

        assert.ok(result, "generateSR should return a result even with left timeout");
        assert.ok(
            result.hemispheres.left === null,
            "Left hemisphere result should be null after timeout",
        );
        assert.ok(
            result.content.length > 0,
            "Aggregated content should still be returned",
        );
    }).timeout(10_000);

    it("returns partial result when right hemisphere times out", async () => {
        const mgr = makeManagedProvider(async (input: any, selection?: any) => {
            const provider = selection?.providerId ?? "openai";
            if (provider === "anthropic") {
                await new Promise(() => { }); // right — never resolves
                return null;
            }
            return fakeOutput(`Response from ${provider}`, provider, selection?.model ?? "model");
        });

        const config = makeSRConfig({ leftTimeoutMs: 5_000, rightTimeoutMs: 50 });
        const result = await mgr.generateSR(
            { message: "test", conversation: [], systemPrompt: "sys" },
            config,
        );

        assert.ok(result, "generateSR should return despite right timeout");
        assert.ok(result.hemispheres.right === null, "Right hemisphere should be null");
    }).timeout(10_000);
});

// ─── 2. Circuit breaker ──────────────────────────────────────────────────────

describe("Spectrum Refraction Advanced — Circuit Breaker", () => {
    it("opens left circuit after threshold consecutive failures", async () => {
        const THRESHOLD = 3;
        let leftCallCount = 0;

        const mgr = makeManagedProvider(async (input: any, selection?: any) => {
            const provider = selection?.providerId ?? "openai";
            if (provider === "openai") {
                leftCallCount++;
                return null; // always fails (timeout simulation)
            }
            return fakeOutput("right ok", provider, selection?.model ?? "model");
        });

        // Force leftTimeoutMs very small so failures are fast
        const config = makeSRConfig({ leftTimeoutMs: 50, circuitBreakerEnabled: true });

        // Need to record failures manually since our mock doesn't actually time out
        // Instead, directly call recordCBOutcome to simulate failures
        for (let i = 0; i < THRESHOLD; i++) {
            (mgr as any).recordCBOutcome("left:openai", false);
        }

        const state = mgr.getSRCircuitBreakerState();
        assert.ok(state["left:openai"], "Circuit breaker state should exist for left:openai");
        assert.strictEqual(state["left:openai"]!.open, true, "Circuit should be open after threshold failures");
        assert.ok(
            state["left:openai"]!.openUntil > Date.now(),
            "openUntil should be in the future",
        );
    });

    it("resets circuit after success", () => {
        const mgr = makeManagedProvider(async () => null);

        // Open the circuit
        for (let i = 0; i < 3; i++) {
            (mgr as any).recordCBOutcome("left:openai", false);
        }
        assert.strictEqual(mgr.getSRCircuitBreakerState()["left:openai"]?.open, true);

        // Simulate success
        (mgr as any).recordCBOutcome("left:openai", true);
        const state = mgr.getSRCircuitBreakerState()["left:openai"];
        assert.ok(!state || state.failures === 0, "Failures should reset on success");
    });

    it("getSRCircuitBreakerState returns open=false for closed circuits", () => {
        const mgr = makeManagedProvider(async () => null);

        // 2 failures — below threshold, circuit still closed
        (mgr as any).recordCBOutcome("right:anthropic", false);
        (mgr as any).recordCBOutcome("right:anthropic", false);

        const state = mgr.getSRCircuitBreakerState()["right:anthropic"];
        assert.ok(state, "State should exist");
        assert.strictEqual(state!.open, false, "Circuit should still be closed below threshold");
        assert.strictEqual(state!.failures, 2);
    });

    it("respects circuitBreakerEnabled=false (no tracking)", async () => {
        const mgr = makeManagedProvider(async () => null);

        // Open the circuit first (with CB enabled)
        for (let i = 0; i < 3; i++) {
            (mgr as any).recordCBOutcome("left:openai", false);
        }
        assert.strictEqual(mgr.getSRCircuitBreakerState()["left:openai"]?.open, true);

        // With circuitBreakerEnabled: false, isCBOpen should still return true because
        // we're checking the config flag — let's check that generateSR with disabled CB
        // does NOT skip the hemisphere
        const config = makeSRConfig({ leftTimeoutMs: 50, circuitBreakerEnabled: false });
        let leftCalled = false;
        (mgr as any).generate = async (input: any, selection?: any) => {
            if (selection?.providerId === "openai") {
                leftCalled = true;
                return fakeOutput("left ok", "openai", "gpt-4o");
            }
            return fakeOutput("right ok", selection?.providerId ?? "anthropic");
        };

        await mgr.generateSR(
            { message: "test", conversation: [], systemPrompt: "sys" },
            config,
        );

        assert.strictEqual(leftCalled, true, "Left should be called even if CB has prior state, when CB disabled");
    });
});

// ─── 3. SR Audit Trail ───────────────────────────────────────────────────────

describe("Spectrum Refraction Advanced — Audit Trail", () => {
    it("emits sr.fanout_start before fan-out", async () => {
        const { bus, events } = makeMockActivityBus();
        const mgr = makeManagedProvider(async (input: any, selection?: any) => {
            return fakeOutput("ok", selection?.providerId ?? "openai", selection?.model ?? "gpt-4o");
        }, bus);

        await mgr.generateSR(
            { message: "hello", conversation: [], systemPrompt: "sys" },
            makeSRConfig(),
        );

        const startEvent = events.find(e => e.operation === "sr.fanout_start");
        assert.ok(startEvent, "sr.fanout_start event should be emitted");
        assert.strictEqual(startEvent!.status, "started");
        assert.ok("leftProvider" in startEvent!.details);
        assert.ok("rightProvider" in startEvent!.details);
        assert.ok("isolationLevel" in startEvent!.details);
    });

    it("emits sr.fanout_complete after parallel generation", async () => {
        const { bus, events } = makeMockActivityBus();
        const mgr = makeManagedProvider(async (input: any, selection?: any) => {
            return fakeOutput("ok", selection?.providerId ?? "openai", selection?.model ?? "gpt-4o");
        }, bus);

        await mgr.generateSR(
            { message: "hello", conversation: [], systemPrompt: "sys" },
            makeSRConfig(),
        );

        const completeEvent = events.find(e => e.operation === "sr.fanout_complete");
        assert.ok(completeEvent, "sr.fanout_complete event should be emitted");
        assert.strictEqual(completeEvent!.status, "succeeded");
        assert.ok(typeof completeEvent!.details["fanOutMs"] === "number");
    });

    it("emits sr.generation_complete with timing after aggregation", async () => {
        const { bus, events } = makeMockActivityBus();
        const mgr = makeManagedProvider(async (input: any, selection?: any) => {
            return fakeOutput("ok", selection?.providerId ?? "openai", selection?.model ?? "gpt-4o");
        }, bus);

        await mgr.generateSR(
            { message: "hello", conversation: [], systemPrompt: "sys" },
            makeSRConfig(),
        );

        const genComplete = events.find(e => e.operation === "sr.generation_complete");
        assert.ok(genComplete, "sr.generation_complete event should be emitted");
        assert.strictEqual(genComplete!.status, "succeeded");
        assert.ok(typeof genComplete!.details["totalMs"] === "number");
        assert.ok(typeof genComplete!.details["fanOutMs"] === "number");
        assert.ok(typeof genComplete!.details["aggregationMs"] === "number");
    });

    it("emits sr.circuit_breaker_triggered when circuit is open", async () => {
        const { bus, events } = makeMockActivityBus();
        const mgr = makeManagedProvider(async (input: any, selection?: any) => {
            return fakeOutput("ok", selection?.providerId ?? "openai");
        }, bus);

        // Force left circuit open
        for (let i = 0; i < 3; i++) {
            (mgr as any).recordCBOutcome("left:openai", false);
        }

        await mgr.generateSR(
            { message: "hello", conversation: [], systemPrompt: "sys" },
            makeSRConfig({ circuitBreakerEnabled: true }),
        );

        const cbEvent = events.find(e => e.operation === "sr.circuit_breaker_triggered");
        assert.ok(cbEvent, "sr.circuit_breaker_triggered should be emitted when CB is open");
        assert.strictEqual(cbEvent!.details["hemisphere"], "left");
    });
});

// ─── 4. Fan-out concurrency ───────────────────────────────────────────────────

describe("Spectrum Refraction Advanced — Fan-out Concurrency", () => {
    it("total time ≈ max of hemispheres, not their sum", async () => {
        const DELAY = 200;

        const mgr = makeManagedProvider(async (input: any, selection?: any) => {
            await new Promise(r => setTimeout(r, DELAY));
            return fakeOutput("ok", selection?.providerId ?? "openai", selection?.model ?? "model");
        });

        const start = Date.now();
        const result = await mgr.generateSR(
            { message: "test", conversation: [], systemPrompt: "sys" },
            makeSRConfig({ leftTimeoutMs: 5_000, rightTimeoutMs: 5_000 }),
        );
        const elapsed = Date.now() - start;

        assert.ok(result, "generateSR should return a result");
        // If run sequentially, elapsed ≥ DELAY * 3. Concurrent → elapsed ≈ DELAY + aggregation.
        // We assert elapsed < 3 * DELAY to confirm parallel execution.
        assert.ok(
            elapsed < DELAY * 3,
            `Fan-out should be concurrent. Elapsed: ${elapsed}ms, threshold: ${DELAY * 3}ms`,
        );
    }).timeout(15_000);
});

// ─── 5. Cost estimation ───────────────────────────────────────────────────────

describe("Spectrum Refraction Advanced — Cost Estimation", () => {
    it("returns SRCostEstimate with correct shape", () => {
        const mgr = makeManagedProvider(async () => null);
        const config = makeSRConfig();
        const estimate = mgr.estimateSRCost(config, 1_000, 500);

        assert.ok(typeof estimate.leftEstimatedCostUsd === "number");
        assert.ok(typeof estimate.rightEstimatedCostUsd === "number");
        assert.ok(typeof estimate.mainFanOutEstimatedCostUsd === "number");
        assert.ok(typeof estimate.aggregationEstimatedCostUsd === "number");
        assert.ok(typeof estimate.totalEstimatedCostUsd === "number");
        assert.strictEqual(estimate.currency, "USD");
        assert.strictEqual(estimate.avgInputTokens, 1_000);
        assert.strictEqual(estimate.avgOutputTokens, 500);
    });

    it("totalEstimatedCostUsd ≥ sum of constituent parts", () => {
        const mgr = makeManagedProvider(async () => null);
        const estimate = mgr.estimateSRCost(makeSRConfig(), 2_000, 1_000);
        const sum = estimate.leftEstimatedCostUsd + estimate.rightEstimatedCostUsd
            + estimate.mainFanOutEstimatedCostUsd + estimate.aggregationEstimatedCostUsd;
        assert.ok(
            Math.abs(estimate.totalEstimatedCostUsd - sum) < 0.0001,
            "totalEstimatedCostUsd should equal the sum of parts",
        );
    });

    it("aggregation cost uses expanded input (3x output tokens added)", () => {
        const mgr = makeManagedProvider(async () => null);
        const avgInput = 1_000;
        const avgOutput = 500;
        // aggregation input = avgInput + avgOutput * 3 = 2500
        // So aggregation cost should be larger than single-hemisphere cost
        const estimate = mgr.estimateSRCost(makeSRConfig(), avgInput, avgOutput);
        // Only meaningful if pricing data exists for gpt-4o; if 0, just check the shape
        if (estimate.aggregationEstimatedCostUsd > 0) {
            assert.ok(
                estimate.aggregationEstimatedCostUsd >= estimate.leftEstimatedCostUsd,
                "Aggregation cost should be ≥ left hemisphere cost given larger input",
            );
        }
    });
});

// ─── 6. Multi-key ProviderSecretStore ─────────────────────────────────────────

describe("Spectrum Refraction Advanced — Multi-Key Secret Store", () => {
    it("sets and gets key for default slot", () => {
        const store = new InMemoryProviderSecretStore();
        store.setApiKey("openai", "sk-default");
        assert.strictEqual(store.getApiKey("openai"), "sk-default");
        assert.strictEqual(store.hasApiKey("openai"), true);
    });

    it("sets and gets key for named slot", () => {
        const store = new InMemoryProviderSecretStore();
        store.setApiKey("openai", "sk-slot-a", "a");
        assert.strictEqual(store.getApiKey("openai", "a"), "sk-slot-a");
        assert.strictEqual(store.hasApiKey("openai", "a"), true);
        assert.strictEqual(store.getApiKey("openai"), null, "Default slot should be empty");
    });

    it("default and named slots are independent", () => {
        const store = new InMemoryProviderSecretStore();
        store.setApiKey("openai", "sk-default");
        store.setApiKey("openai", "sk-a", "a");
        store.setApiKey("openai", "sk-b", "b");

        assert.strictEqual(store.getApiKey("openai"), "sk-default");
        assert.strictEqual(store.getApiKey("openai", "a"), "sk-a");
        assert.strictEqual(store.getApiKey("openai", "b"), "sk-b");
    });

    it("listSlots returns only named slot names", () => {
        const store = new InMemoryProviderSecretStore();
        store.setApiKey("openai", "sk-default");
        store.setApiKey("openai", "sk-a", "a");
        store.setApiKey("openai", "sk-b", "b");
        store.setApiKey("anthropic", "sk-ant", "x");

        const slots = store.listSlots("openai");
        assert.deepStrictEqual(slots.sort(), ["a", "b"], "listSlots should return named slots only");
        assert.strictEqual(store.listSlots("anthropic").length, 1);
    });

    it("clearApiKey removes only the specified slot", () => {
        const store = new InMemoryProviderSecretStore();
        store.setApiKey("openai", "sk-default");
        store.setApiKey("openai", "sk-a", "a");

        store.clearApiKey("openai", "a");
        assert.strictEqual(store.getApiKey("openai", "a"), null);
        assert.strictEqual(store.getApiKey("openai"), "sk-default", "Default should still exist");
    });

    it("returns null for unknown provider+slot", () => {
        const store = new InMemoryProviderSecretStore();
        assert.strictEqual(store.getApiKey("openai"), null);
        assert.strictEqual(store.getApiKey("openai", "nonexistent"), null);
        assert.strictEqual(store.listSlots("openai").length, 0);
    });
});
