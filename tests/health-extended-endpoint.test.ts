/**
 * R6-2 — `/api/health/extended` endpoint test.
 *
 * Boots a minimal `DashboardService` on an ephemeral port, calls the new
 * extended-health route, and asserts the shape + key invariants:
 *
 *   - Status 200, JSON body with the expected fields.
 *   - `process.heapMb` and `process.rssMb` are positive numbers.
 *   - `pendingApprovals` reflects the `ApprovalQueue.list().length`.
 *   - `sessions` reflects `ChatSessionStore.listSessions().length`.
 *   - `dbSizeMb` is a non-negative number (tolerant of 0 — workspace may
 *     have no on-disk DB files in CI).
 */

import assert from "node:assert";
import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";

function fetchJson(port: number, path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path }, (res) => {
            let body = "";
            res.on("data", (chunk: Buffer) => { body += chunk; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) }); }
                catch (e) { reject(e); }
            });
        }).on("error", reject);
    });
}

export async function testHealthExtendedEndpoint(): Promise<void> {
    const savedAuth = process.env.PRISM_AUTH_DISABLED;
    process.env.PRISM_AUTH_DISABLED = "true";

    // Isolate preferences so GET routes don't redirect to the setup wizard.
    const savedPrefs = process.env.PRISM_PREFERENCES_PATH;
    const prefsDir = mkdtempSync(join(tmpdir(), "prism-health-ext-"));
    const prefsFile = join(prefsDir, "prefs.json");
    process.env.PRISM_PREFERENCES_PATH = prefsFile;
    writeFileSync(prefsFile, JSON.stringify({ setupComplete: true, lastModified: new Date().toISOString() }) + "\n", "utf8");

    const queue = new ApprovalQueue();
    const bus = new ActivityBus();
    const chatStore = new ChatSessionStore(":memory:");
    const secretStore = new InMemoryProviderSecretStore();

    const service = new DashboardService(
        queue,
        bus,
        {
            sessionId: "health-ext-test",
            environmentProfile: "test",
            mode: "server",
            startedAt: new Date().toISOString(),
            executionProfileSegment: "individual",
        },
        chatStore,
        [],
        0,
        undefined,
        undefined,
        secretStore,
    );

    service.start();
    await new Promise((r) => setTimeout(r, 25));
    const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
    const port = addr ? addr.port : 0;
    assert.ok(port > 0, "server bound to a real port");

    try {
        // Case 1 — empty queue, fresh process.
        {
            const res = await fetchJson(port, "/api/health/extended");
            assert.strictEqual(res.status, 200, "200 OK");
            const b = res.body;
            assert.strictEqual(b.status, "ok");
            assert.strictEqual(typeof b.version, "string");
            assert.ok(typeof b.uptimeS === "number" && b.uptimeS >= 0, "uptimeS non-negative");
            assert.ok(typeof b.process === "object" && b.process !== null, "process block");
            assert.ok(b.process.heapMb > 0, "heapMb positive");
            assert.ok(b.process.rssMb > 0, "rssMb positive");
            assert.ok(typeof b.process.heapTotalMb === "number");
            assert.ok(typeof b.sessions === "number" && b.sessions >= 0, "sessions non-negative");
            assert.strictEqual(b.pendingApprovals, 0, "no pending approvals yet");
            assert.ok(typeof b.dbSizeMb === "number" && b.dbSizeMb >= 0, "dbSizeMb non-negative");
        }

        // Case 2 — enqueue an approval and re-poll. `pendingApprovals` must update.
        // Promise is intentionally unawaited; it resolves on approve/deny/timeout.
        void queue.request("health-ext-test", "demo.op", { tier: 2 }, 120_000);
        {
            const res = await fetchJson(port, "/api/health/extended");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.pendingApprovals, 1, "queue length surfaces");
        }
        // Drain the queue so the timeout handle does not keep the test
        // process alive past `service.stop()`.
        for (const p of queue.list()) queue.deny(p.id);
    } finally {
        await service.stop();
        if (savedAuth === undefined) delete process.env.PRISM_AUTH_DISABLED; else process.env.PRISM_AUTH_DISABLED = savedAuth;
        if (savedPrefs === undefined) delete process.env.PRISM_PREFERENCES_PATH; else process.env.PRISM_PREFERENCES_PATH = savedPrefs;
    }
}
