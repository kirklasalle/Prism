import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";

test("Demo completion creates an operator-bound output session with embedded HTML", () => {
    const reportDir = mkdtempSync(join(tmpdir(), "prism-demo-output-test-"));
    const htmlPath = join(reportDir, "report.html");
    const mdPath = join(reportDir, "report.md");
    writeFileSync(htmlPath, "<!doctype html><html><body><h1>Demo report</h1></body></html>", "utf-8");
    writeFileSync(mdPath, "# Demo report\n", "utf-8");

    const chatStore = new ChatSessionStore(":memory:");
    let createInput: Record<string, unknown> | null = null;
    const service = {
        _demoOperatorEmail: "operator@example.com",
        chatStore,
        createChatSession(input: Record<string, unknown>) {
            createInput = input;
            return chatStore.createSession({
                ...input,
                executionProfile: "individual",
            } as any);
        },
    };

    try {
        const session = (DashboardService.prototype as any).createDemoOutputSession.call(service, {
            htmlPath,
            mdPath,
            summary: { passed: 7, failed: 0, durationMs: 1250 },
        });
        assert.strictEqual(session.title, "Demo Output Session");
        assert.strictEqual(session.operatorEmail, "operator@example.com");
        const capturedInput = createInput as Record<string, unknown> | null;
        assert.ok(capturedInput);
        assert.strictEqual(capturedInput.characterId, null);
        assert.strictEqual(capturedInput.allowUnbound, true);
        const messages = chatStore.getMessages(session.sessionId);
        assert.strictEqual(messages.length, 1);
        assert.strictEqual(messages[0]!.metadata.intent, "demo_report");
        assert.match(String(messages[0]!.metadata.demoReportHtml), /<h1>Demo report<\/h1>/);
    } finally {
        chatStore.close();
        rmSync(reportDir, { recursive: true, force: true });
    }
});