/**
 * Cognition Cycles Plugin & SIEM Exporter Unit Test Suite — Phase 4
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { CognitionCyclesBridge } from "../src/plugins/cognition-cycles/bridge.js";
import { CognitionCyclesPlugin } from "../src/plugins/cognition-cycles/index.js";
import { createServerAuthorityContext } from "../src/core/security/execution-authority-context.js";
import { SiemExporter } from "../src/core/activity/siem-exporter.js";
import { createAuditCheckpoint } from "../src/core/activity/hash-chained-audit.js";

describe("Cognition Cycles Plugin & SIEM Exporter Suite", () => {
    let tmpDir: string;
    let originalEnv: string | undefined;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-cognition-test-"));
        originalEnv = process.env.PRISM_CONFIG_DIR;
        process.env.PRISM_CONFIG_DIR = tmpDir;
    });

    afterEach(() => {
        if (originalEnv) {
            process.env.PRISM_CONFIG_DIR = originalEnv;
        } else {
            delete process.env.PRISM_CONFIG_DIR;
        }
        if (existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── 1. CognitionCyclesBridge Tests ────────────────────────────────────

    describe("1. CognitionCyclesBridge Execution", () => {
        it("executes micro, meso, macro, and meta cycles cleanly", async () => {
            const bridge = new CognitionCyclesBridge();

            const microRes = await bridge.executeCycle({ level: "micro", inputPrompt: "Execute step 1 tactical reasoning" });
            assert.strictEqual(microRes.level, "micro");
            assert.ok(microRes.steps.length > 0);
            assert.ok(microRes.finalSynthesis.length > 0);

            const metaRes = await bridge.executeCycle({ level: "meta", inputPrompt: "Reflect on system decision" });
            assert.strictEqual(metaRes.level, "meta");
            assert.ok(metaRes.finalSynthesis.length > 0);
        });
    });

    // ── 2. CognitionCyclesPlugin & Tools Tests ────────────────────────────

    describe("2. CognitionCyclesPlugin & Tools Registration", () => {
        it("registers 3 PRISM cognition tools", () => {
            const plugin = new CognitionCyclesPlugin();
            const tools = plugin.getTools();
            assert.strictEqual(tools.length, 3);
            const names = tools.map((t) => t.name);
            assert.ok(names.includes("cognition_cycle_run"));
            assert.ok(names.includes("cognition_cycle_reflect"));
            assert.ok(names.includes("cognition_cycle_meta_eval"));
        });

        it("runs cognition cycle under authority context and emits event onto ActivityBus", async () => {
            const bus = new ActivityBus();
            const plugin = new CognitionCyclesPlugin(bus);

            const serverCtx = createServerAuthorityContext({
                certificateId: "cert-cognition-1",
                assignmentId: "asgn-cognition-2",
                operatorEmail: "operator@prismrefraction.com",
            });

            const result = await plugin.runCognitionCycle(
                { level: "meso", inputPrompt: "Plan task feature scope" },
                serverCtx,
            );

            assert.strictEqual(result.level, "meso");
            assert.strictEqual(bus.listEvents().length, 1);

            const evt = bus.listEvents()[0]!;
            assert.strictEqual(evt.operation, "cognition.meso_cycle");
            assert.strictEqual(evt.operatorEmail, "operator@prismrefraction.com");
            assert.strictEqual(evt.assignmentId, "asgn-cognition-2");
            assert.ok(evt.previousHash);
        });
    });

    // ── 3. SiemExporter Tests ─────────────────────────────────────────────

    describe("3. SiemExporter Verification", () => {
        it("handles unconfigured webhook gracefully", async () => {
            const exporter = new SiemExporter({ enabled: true });
            const bus = new ActivityBus();
            bus.emit({ sessionId: "s1", layer: "agent", operation: "op1", status: "succeeded", details: {} });

            const checkpoint = createAuditCheckpoint([...bus.listEvents()]);
            const success = await exporter.exportCheckpoint(checkpoint);
            assert.strictEqual(success, false, "Unconfigured exporter must return false cleanly without crashing");
        });
    });
});
