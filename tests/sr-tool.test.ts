/**
 * Tests for Phase D: SR-as-a-Tool.
 */

import { SpectrumRefractionTool, shouldRouteToSR } from "../src/adapters/cognition/sr-tool.js";
import type { LlmProviderManager } from "../src/core/operator/llm-provider-manager.js";
import type { SpectrumRefractionConfig } from "../src/core/operator/model-capability-matrix.js";
import type { ToolRequest } from "../src/core/tools/types.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

function makeRequest(args: Record<string, unknown>): ToolRequest {
    return { operation: "cognition.spectrum_refraction", args, risk: "medium", mutatesState: false };
}

class FakeProviderManager {
    public lastConfig: SpectrumRefractionConfig | null = null;
    public estimatedCost = 0.05;
    public failGenerate = false;

    estimateSRCost(cfg: SpectrumRefractionConfig): { totalEstimatedCostUsd: number } {
        this.lastConfig = cfg;
        return { totalEstimatedCostUsd: this.estimatedCost };
    }

    async generateSR(): Promise<{ content: string; isolationLevel: "full" | "model" | "insufficient"; timing: { fanOutMs: number; aggregationMs: number; totalMs: number } } | null> {
        if (this.failGenerate) return null;
        return {
            content: "synthesized response",
            isolationLevel: "full",
            timing: { fanOutMs: 100, aggregationMs: 50, totalMs: 150 },
        };
    }
}

export async function testSrTool(): Promise<void> {
    const fake = new FakeProviderManager();
    const cfg: SpectrumRefractionConfig = {
        enabled: true,
        leftModel: { providerId: "openai", model: "gpt-4o" },
        rightModel: { providerId: "anthropic", model: "claude-3.5-sonnet" },
    };
    const tool = new SpectrumRefractionTool({ providerManager: fake as unknown as LlmProviderManager, defaultConfig: cfg });

    // ── Empty message rejected ──
    const r1 = await tool.execute(makeRequest({ message: "" }));
    assert(!r1.ok && r1.output.error === "message is required", "empty message rejected");

    // ── Cost gate triggers when cost exceeds default $0.10 ──
    fake.estimatedCost = 0.50;
    const r2 = await tool.execute(makeRequest({ message: "long task" }));
    assert(!r2.ok && r2.output.error === "cost_gate_exceeded", "cost gate triggers");
    assert(typeof r2.output.gateUsd === "number", "gate value reported");

    // ── force=true bypasses gate ──
    const r3 = await tool.execute(makeRequest({ message: "long task", force: true }));
    assert(r3.ok, "force=true bypasses cost gate: " + JSON.stringify(r3.output));
    assert(r3.output.content === "synthesized response", "content propagated");

    // ── Cost under gate executes ──
    fake.estimatedCost = 0.01;
    const r4 = await tool.execute(makeRequest({ message: "task" }));
    assert(r4.ok, "executes under gate");

    // ── No active config returns no_active_sr_config ──
    const tool2 = new SpectrumRefractionTool({ providerManager: fake as unknown as LlmProviderManager });
    const r5 = await tool2.execute(makeRequest({ message: "task" }));
    assert(!r5.ok && r5.output.error === "no_active_sr_config", "no config error");

    // ── hemispheres[] in args overrides defaultConfig ──
    const r6 = await tool.execute(makeRequest({
        message: "task",
        hemispheres: [
            { id: "h1", providerId: "openai", model: "gpt-4o", role: "logic" },
            { id: "h2", providerId: "anthropic", model: "claude-3.5-sonnet", role: "creative" },
        ],
    }));
    assert(r6.ok, "hemispheres[] arg works: " + JSON.stringify(r6.output));
    assert(fake.lastConfig?.hemispheres?.length === 2, "hemispheres[] threaded through");

    // ── generateSR null => sr_generation_failed ──
    fake.failGenerate = true;
    const r7 = await tool.execute(makeRequest({ message: "task" }));
    assert(!r7.ok && r7.output.error === "sr_generation_failed", "failure surfaced");

    // ── shouldRouteToSR opt-in only ──
    const prevFlag = process.env.PRISM_SR_AGENT_ROUTING;
    delete process.env.PRISM_SR_AGENT_ROUTING;
    assert(shouldRouteToSR("x".repeat(1000), 0.1) === false, "routing off by default");
    process.env.PRISM_SR_AGENT_ROUTING = "on";
    try {
        assert(shouldRouteToSR("x".repeat(1000), 0.1) === true, "routing engages on long+low-conf");
        assert(shouldRouteToSR("short", 0.1) === false, "routing skips short");
        assert(shouldRouteToSR("x".repeat(1000), 0.9) === false, "routing skips high-conf");
    } finally {
        if (prevFlag === undefined) delete process.env.PRISM_SR_AGENT_ROUTING;
        else process.env.PRISM_SR_AGENT_ROUTING = prevFlag;
    }

    console.log("  ✓ SR-as-a-Tool");
}
