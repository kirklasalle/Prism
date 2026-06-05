import assert from "node:assert";
import { LLRECompiler } from "../src/core/llre/ast.js";
import { LLRETelemetry } from "../src/core/llre/telemetry.js";
import { SqliteActivityStore } from "../src/core/activity/sqlite-store.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApiHandler } from "../src/core/operator/routes/api-handler.js";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

export async function testLlreSuite(): Promise<void> {
    // 1. Test AST compiler
    const systemPrompt = `
    You are a helpful assistant.
    <objective>
      Perform data conversion and analysis.
    </objective>
    <constraints>
      Use concise language.
    </constraints>
    `;
    const ast = LLRECompiler.compile(systemPrompt);
    assert.strictEqual(ast.sections.objective, "Perform data conversion and analysis.");
    assert.strictEqual(ast.sections.constraints, "Use concise language.");
    assert.ok(ast.signalDensity >= 0);

    // 2. Test Telemetry Calculation
    const metrics = LLRETelemetry.calculate({
        objective: { successCriteria: ["concise language"] },
        steps: [{ tool: "search", success: true }],
        latencyMs: 1500,
        tokensConsumed: 100,
        costUsd: 0.0015
    });
    assert.ok(metrics.teq >= 0);
    assert.ok(metrics.rsi >= 0);
    assert.ok(metrics.csr >= 0);
    assert.strictEqual(metrics.tca, 1.0);

    // 3. Test Database Layer
    const testDir = join(process.cwd(), "state-llre-test");
    if (existsSync(testDir)) {
        try { rmSync(testDir, { recursive: true, force: true }); } catch {}
    }
    mkdirSync(testDir, { recursive: true });

    let store: SqliteActivityStore | null = null;
    try {
        const bus = new ActivityBus();
        const dbFile = join(testDir, "test.db");
        store = new SqliteActivityStore(dbFile);
        bus.subscribe(store);

        // Save telemetry
        const sessionId = "sess-1";
        const score = 0.85;

        store.saveLlreTelemetry({
            sessionId,
            modelName: "gpt-4",
            tokensConsumed: 1000,
            latencyMs: 2500,
            costUsd: 0.0015,
            rsi: 0.9,
            csr: 0.75,
            tca: 1.0,
            teq: score
        });

        // Query telemetry
        const rows = store.queryLlreTelemetry(sessionId);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].session_id, sessionId);
        assert.strictEqual(rows[0].teq_score, score);

        // Test event interception
        let interceptPromise = new Promise<void>((resolve) => {
            bus.subscribe({
                onEvent(event) {
                    if (event.operation === "llre.telemetry.recorded") {
                        resolve();
                    }
                }
            });
        });

        bus.emit({
            sessionId: sessionId,
            layer: "llm",
            operation: "llre.telemetry.recorded",
            status: "succeeded",
            details: {
                sessionId: sessionId,
                modelName: "gpt-4",
                tokensConsumed: 1200,
                latencyMs: 1800,
                costUsd: 0.002,
                teq: 0.9,
                rsi: 0.85,
                csr: 0.7,
                tca: 1.0
            }
        });

        await interceptPromise;
        // Wait a tiny bit for async database write via subscription
        await new Promise((resolve) => setTimeout(resolve, 100));

        const updatedRows = store.queryLlreTelemetry(sessionId);
        assert.strictEqual(updatedRows.length, 2);

        // 4. Test API routing summary calculations
        const mockDashboard = {
            getActivityStore() {
                return store;
            }
        } as any;

        const apiHandler = new ApiHandler();
        const req = {
            url: `/api/llre/summary?sessionId=${sessionId}`,
            method: "GET"
        } as any;

        let resJson: any = null;
        let resCode = 200;
        const res = {
            writeHead(code: number) {
                resCode = code;
            },
            end(body: string) {
                resJson = JSON.parse(body);
            }
        } as any;

        const handled = apiHandler.match(req);
        assert.ok(handled);
        await apiHandler.handle(req, res, mockDashboard);

        assert.strictEqual(resCode, 200);
        assert.strictEqual(resJson.count, 2);
        assert.ok(resJson.teq > 0);
        assert.ok(resJson.rsi > 0);
        assert.ok(resJson.csr > 0);
        assert.ok(resJson.tca > 0);
        assert.ok(resJson.costUsd > 0);

        console.log("✓ LLRE tests passed");
    } finally {
        if (store) {
            try { store.close(); } catch {}
        }
        if (existsSync(testDir)) {
            try { rmSync(testDir, { recursive: true, force: true }); } catch {}
        }
    }
}
