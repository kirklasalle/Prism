/**
 * R6-3 — Approval queue endpoint round-trip test (v0.20.2).
 *
 * Boots a minimal `DashboardService`, enqueues a tier-2 approval via
 * `ApprovalQueue.request`, then exercises the three routes that the new
 * Approval Queue UI hits:
 *
 *   GET  /api/approval/pending
 *   POST /api/approval/:id/approve
 *   POST /api/approval/:id/deny
 *
 * Asserts list shape, that approve resolves the pending promise to `true`,
 * that deny resolves to `false`, and that both decisions remove the entry
 * from the queue. No UI assertions — those are deliberately covered by
 * the IIFE controller's own DOM contract (additive, observability only).
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

interface JsonRes { status: number; body: any; }

function get(port: number, path: string): Promise<JsonRes> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path }, (res) => {
            let body = "";
            res.on("data", (c: Buffer) => { body += c; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode ?? 0, body: body ? JSON.parse(body) : null }); }
                catch (e) { reject(e); }
            });
        }).on("error", reject);
    });
}

function post(port: number, path: string): Promise<JsonRes> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path,
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": "2" },
        }, (res) => {
            let body = "";
            res.on("data", (c: Buffer) => { body += c; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode ?? 0, body: body ? JSON.parse(body) : null }); }
                catch (e) { reject(e); }
            });
        });
        req.on("error", reject);
        req.write("{}");
        req.end();
    });
}

export async function testApprovalQueueEndpoints(): Promise<void> {
    const savedAuth = process.env.PRISM_AUTH_DISABLED;
    process.env.PRISM_AUTH_DISABLED = "true";
    const savedPrefs = process.env.PRISM_PREFERENCES_PATH;
    const prefsDir = mkdtempSync(join(tmpdir(), "prism-approval-q-"));
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
            sessionId: "approval-q-test",
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
    assert.ok(port > 0, "server bound");

    try {
        // Empty list to start.
        {
            const res = await get(port, "/api/approval/pending");
            assert.strictEqual(res.status, 200);
            assert.ok(Array.isArray(res.body), "pending list is array");
            assert.strictEqual(res.body.length, 0, "no entries yet");
        }

        // Enqueue → approve round-trip. Promise must resolve to `true`.
        const approvePromise = queue.request("approval-q-test", "demo.tier2.approve", { tier: 2 }, 120_000);
        const approvedId = (() => {
            const list = queue.list();
            assert.strictEqual(list.length, 1, "one pending after request");
            return list[0]!.id;
        })();
        {
            const res = await get(port, "/api/approval/pending");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.length, 1, "endpoint sees 1 entry");
            assert.strictEqual(res.body[0].id, approvedId);
            assert.strictEqual(res.body[0].operation, "demo.tier2.approve");
        }
        {
            const res = await post(port, `/api/approval/${approvedId}/approve`);
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.approved, true);
        }
        const approvedResult = await approvePromise;
        assert.strictEqual(approvedResult, true, "approve resolves promise to true");
        assert.strictEqual(queue.list().length, 0, "queue drained after approve");

        // Enqueue → deny round-trip. Promise must resolve to `false`.
        const denyPromise = queue.request("approval-q-test", "demo.tier2.deny", { tier: 2 }, 120_000);
        const deniedId = queue.list()[0]!.id;
        {
            const res = await post(port, `/api/approval/${deniedId}/deny`);
            assert.strictEqual(res.status, 200);
            // The deny route returns `{ denied: true }` on success.
            assert.strictEqual(res.body.denied, true);
        }
        const deniedResult = await denyPromise;
        assert.strictEqual(deniedResult, false, "deny resolves promise to false");
        assert.strictEqual(queue.list().length, 0, "queue drained after deny");

        // Unknown id on either route returns 404.
        {
            const res = await post(port, "/api/approval/does-not-exist/approve");
            assert.strictEqual(res.status, 404, "unknown id approve → 404");
        }
        {
            const res = await post(port, "/api/approval/does-not-exist/deny");
            assert.strictEqual(res.status, 404, "unknown id deny → 404");
        }
    } finally {
        await service.stop();
        if (savedAuth === undefined) delete process.env.PRISM_AUTH_DISABLED; else process.env.PRISM_AUTH_DISABLED = savedAuth;
        if (savedPrefs === undefined) delete process.env.PRISM_PREFERENCES_PATH; else process.env.PRISM_PREFERENCES_PATH = savedPrefs;
    }
}
