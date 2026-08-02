import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { SupportLogAuditor } from "../src/core/operator/support-log-auditor.js";

describe("SupportLogAuditor", () => {
    let directory: string;
    let store: ChatSessionStore;
    let bus: ActivityBus;
    let auditor: SupportLogAuditor;

    before(() => {
        directory = mkdtempSync(join(tmpdir(), "prism-support-audit-"));
        store = new ChatSessionStore(join(directory, "support.db"));
        bus = new ActivityBus();
        auditor = new SupportLogAuditor(bus, store, "audit-session");
    });

    after(() => {
        store.close();
        rmSync(directory, { recursive: true, force: true });
    });

    it("creates incidents for warnings and errors but not ordinary events", () => {
        bus.emit({
            sessionId: "audit-session",
            layer: "tool_execution",
            operation: "browser.navigation",
            status: "succeeded",
            details: {},
        });
        bus.emit({
            sessionId: "audit-session",
            layer: "performance",
            operation: "provider.warning",
            status: "succeeded",
            details: { message: "Provider latency exceeded threshold", correlationId: "corr-1" },
        });
        bus.emit({
            sessionId: "audit-session",
            layer: "tool_execution",
            operation: "browser.navigate",
            status: "failed",
            details: { error: "Navigation timeout", remediation: "Retry with a longer timeout" },
        });

        const result = auditor.audit("initialization");
        const incidents = store.listSupportTickets();

        assert.deepEqual(result, { scanned: 2, incidentsCreated: 2, duplicatesSkipped: 0 });
        assert.equal(incidents.length, 2);
        assert.ok(incidents.every((ticket) => ticket.metadata.itemType === "incident"));
        assert.ok(incidents.some((ticket) => ticket.metadata.correlationId === "corr-1"));
        assert.ok(incidents.some((ticket) => ticket.metadata.remediation === "Retry with a longer timeout"));
    });

    it("deduplicates repeated open incidents by fingerprint", () => {
        bus.emit({
            sessionId: "audit-session",
            layer: "tool_execution",
            operation: "browser.navigate",
            status: "failed",
            details: { error: "Navigation timeout" },
        });

        const result = auditor.audit("scheduled");

        assert.deepEqual(result, { scanned: 1, incidentsCreated: 0, duplicatesSkipped: 1 });
        assert.equal(store.listSupportTickets().length, 2);
    });
});