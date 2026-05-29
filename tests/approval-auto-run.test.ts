import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";

// Simple integration test: enqueue an approval and verify the background
// handler runs the agentic executor when approved.
describe("Approval auto-run flow", () => {
    it("runs agentic executor after approval", async () => {
        // Isolate prefs/env similar to other tests
        const isolatedPrefsDir = mkdtempSync(join(tmpdir(), "prism-prefs-test-"));
        const isolatedPrefsFile = join(isolatedPrefsDir, "prefs.json");
        writeFileSync(isolatedPrefsFile, JSON.stringify({ setupComplete: true, lastModified: new Date().toISOString() }) + "\n", "utf-8");
        const activityBus = new ActivityBus();
        const approvalQueue = new ApprovalQueue();
        const chatSessionStore = new ChatSessionStore(":memory:");
        const providerSecretStore = new InMemoryProviderSecretStore();

        const dashboardService = new DashboardService(
            approvalQueue,
            activityBus,
            {
                sessionId: "test-session",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatSessionStore,
            [],
            0,
            undefined,
            undefined,
            providerSecretStore,
        );

        // Capture broadcasted events
        const events: any[] = [];
        dashboardService.broadcastEvent = (evt) => { events.push(evt); };

        // Stub agenticExecutor so we don't call external LLMs; simulate events
        (dashboardService as any).agenticExecutor = {
            execute: async (userMessage: string, conversation: any, systemPrompt: string, generateFn: any, sel: any, onEvent: any) => {
                if (onEvent) {
                    onEvent({ type: "tool_call", toolCall: { id: "t1", name: "browser_control", arguments: { url: "https://example.com" } }, iteration: 1 });
                    onEvent({ type: "tool_result", toolResult: { id: "t1", name: "browser_control", ok: true, output: { navigated: true } }, iteration: 1 });
                    onEvent({ type: "done", text: "Auto-run completed", iteration: 1 });
                }
                return { finalContent: "Auto-run completed", toolCallsExecuted: 1, iterations: 1, events: [] } as any;
            }
        };

        // Prepare classification matching Tier-2 purchase pattern
        const classification = { tier: 2, reasonCode: "MEDIUM_RISK_ALLOW_CONDITIONAL", matchedPattern: "buy/purchase" };
        const prompt = "Please buy jeans W32 L30 and find options";
        const ids = dashboardService.enqueueApprovalAndAutoRun("session-1", prompt, classification);

        const pending = approvalQueue.list();
        assert.equal(pending.length, 1, "one pending approval should be enqueued");
        const id = pending[0]!.id;

        // Approve — this should trigger the background handler
        const ok = approvalQueue.approve(id);
        assert.equal(ok, true, "approve() should return true");

        // Give background handler a moment to run
        await new Promise((r) => setTimeout(r, 20));

        // We expect that broadcastEvent was called with agentic events
        const agentic = events.find((e) => e.type === "agentic_event");
        assert.ok(agentic, "agentic_event should be broadcast");
        // Cleanup
        try { rmSync(isolatedPrefsDir, { recursive: true, force: true }); } catch { }
    });
});
