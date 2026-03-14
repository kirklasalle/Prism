import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActivityBus } from "../src/core/activity/bus.js";
import { SelfReviewScheduler } from "../src/core/operator/self-review-scheduler.js";

export async function testSelfReviewScheduler(): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), "prism-self-review-"));

    try {
        const bus = new ActivityBus();
        const sessionId = "test-session";

        bus.emit({
            sessionId,
            layer: "governance",
            operation: "workflow.approval_requested",
            status: "succeeded",
            details: {},
        });
        bus.emit({
            sessionId,
            layer: "retrieval",
            operation: "retrieval.semantic_query",
            status: "succeeded",
            details: {},
        });
        bus.emit({
            sessionId,
            layer: "tool_execution",
            operation: "file_write",
            status: "failed",
            details: { reason: "denied" },
        });

        const scheduler = new SelfReviewScheduler({
            activityBus: bus,
            sessionId,
            environmentProfile: "dev",
            outputDir: tempDir,
            intervalsMs: {
                daily: 1_000,
                weekly: 2_000,
                monthly: 3_000,
            },
        });

        const reports = scheduler.runInitialPass();
        scheduler.stop();

        assert.strictEqual(reports.length, 3);
        assert.strictEqual(reports[0]!.cadence, "daily");
        assert.strictEqual(reports[1]!.cadence, "weekly");
        assert.strictEqual(reports[2]!.cadence, "monthly");

        const latestPath = join(tempDir, "self-review-latest.json");
        const dailyPath = join(tempDir, "self-review-daily.json");
        const weeklyPath = join(tempDir, "self-review-weekly.json");
        const monthlyPath = join(tempDir, "self-review-monthly.json");
        const historyPath = join(tempDir, "self-review-history.ndjson");

        assert.ok(existsSync(latestPath));
        assert.ok(existsSync(dailyPath));
        assert.ok(existsSync(weeklyPath));
        assert.ok(existsSync(monthlyPath));
        assert.ok(existsSync(historyPath));

        const latest = JSON.parse(readFileSync(latestPath, "utf-8"));
        assert.ok(["daily", "weekly", "monthly"].includes(latest.cadence));
        assert.strictEqual(latest.sessionId, sessionId);
        assert.ok(typeof latest.metrics.eventsTotal === "number");

        const historyLines = readFileSync(historyPath, "utf-8").trim().split("\n");
        assert.strictEqual(historyLines.length, 3);

        const selfReviewEvents = bus
            .listEvents()
            .filter((event) => event.operation.startsWith("prism.self_review."));
        assert.strictEqual(selfReviewEvents.length, 3);
        assert.ok(selfReviewEvents.every((event) => event.status === "succeeded"));

        const overflowScheduler = new SelfReviewScheduler({
            activityBus: bus,
            sessionId,
            environmentProfile: "dev",
            outputDir: tempDir,
            intervalsMs: {
                monthly: 30 * 24 * 60 * 60 * 1000,
            },
        });
        const overflowConfiguration = overflowScheduler.getConfiguration();
        overflowScheduler.stop();

        assert.strictEqual(overflowConfiguration.intervalsMs.monthly, 2_147_000_000);
        assert.ok(
            overflowConfiguration.warnings.some((warning) =>
                warning.includes("monthly self-review interval") && warning.includes("clamped"),
            ),
        );

        console.log("✓ SelfReviewScheduler tests passed");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
