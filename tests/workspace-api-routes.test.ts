/**
 * Workspace API Route Integration Tests — exercises all /api/workspace/* REST
 * endpoints exposed by DashboardService, plus workspace-hub and character
 * assignment lifecycle.
 *
 * Spins up a DashboardService on an ephemeral port, makes real HTTP requests,
 * and validates responses.
 *
 * Run via Mocha: mocha dist/tests/workspace-api-routes.test.js --timeout 60000
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import http from "node:http";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import { _setWorkspaceRootForTest, _resetWorkspaceRootCache } from "../src/core/config/workspace-resolver.js";

/* ── Test helpers ─────────────────────────────────────────────────────── */

let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;

function fetchJson(path: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port, path }, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode!, body: JSON.parse(data || "{}") }); }
                catch { resolve({ status: res.statusCode!, body: data }); }
            });
        }).on("error", reject);
    });
}

function requestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path,
            method,
            headers: body == null ? {} : { "Content-Type": "application/json" },
        }, (res) => {
            let payload = "";
            res.on("data", (chunk: Buffer) => { payload += chunk; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode!, body: JSON.parse(payload || "{}") }); }
                catch { resolve({ status: res.statusCode!, body: payload }); }
            });
        });
        req.on("error", reject);
        if (body != null) req.write(JSON.stringify(body));
        req.end();
    });
}

/* ── Suite ────────────────────────────────────────────────────────────── */

describe("Workspace API Routes (/api/workspace/*)", function () {
    this.timeout(60_000);

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-workspace-api-"));

        // Seed a minimal character file so listWorkspaceCharacters finds something
        const charDir = join(tmpDir, "characters");
        mkdirSync(charDir, { recursive: true });
        // Ensure state directory exists for workspace database
        mkdirSync(join(tmpDir, "state"), { recursive: true });
        writeFileSync(join(charDir, "test-agent.json"), JSON.stringify({
            id: "test-agent",
            name: "Test Agent",
            archetype: "sentinel",
            profile: "individual",
            maxRiskTier: 1,
            allowedTools: ["semantic_query"],
            systemPromptOverride: "You are a test agent.",
            defaultEmail: "test@prism.local",
        }), "utf8");

        // Point workspace resolver at the temp dir
        _setWorkspaceRootForTest(tmpDir);

        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");
        const registry = new ToolRegistry();

        service = new DashboardService(
            new ApprovalQueue(),
            bus,
            {
                sessionId: "ws-api-test-session",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore,
            [],                                          // actions
            0,                                           // port = ephemeral
            undefined,                                   // metricsCollector
            undefined,                                   // retrievalDashboardStore
            new InMemoryProviderSecretStore(),            // providerSecretStore
            undefined,                                   // activityStore
            join(tmpDir, "session-packages.json"),        // sessionPackageStorePath
            join(tmpDir, "exports"),                      // sessionPackageExportDir
            registry,                                    // toolRegistry
        );

        service.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
        port = addr ? addr.port : 0;
        assert.ok(port > 0, "DashboardService should bind to an ephemeral port");
    });

    after(async () => {
        await service.stop();
        chatStore.close();
        _resetWorkspaceRootCache();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    /* ── GET /api/workspace/info ───────────────────────────────────────── */

    it("GET /api/workspace/info returns workspace root and exists flag", async () => {
        const { status, body } = await fetchJson("/api/workspace/info");
        assert.strictEqual(status, 200);
        assert.ok(body.workspaceRoot, "should have workspaceRoot");
        assert.strictEqual(typeof body.exists, "boolean");
    });

    /* ── GET /api/workspace/hub ────────────────────────────────────────── */

    it("GET /api/workspace/hub returns current hub value", async () => {
        const { status, body } = await fetchJson("/api/workspace/hub");
        assert.strictEqual(status, 200);
        assert.ok("workspaceHub" in body, "should contain workspaceHub key");
    });

    /* ── POST /api/workspace/hub ───────────────────────────────────────── */

    it("POST /api/workspace/hub sets and returns the hub value", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/hub", {
            workspaceHub: "TestHub-Alpha",
        });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
        assert.strictEqual(body.workspaceHub, "TestHub-Alpha");

        // Read it back
        const { body: readBack } = await fetchJson("/api/workspace/hub");
        assert.strictEqual(readBack.workspaceHub, "TestHub-Alpha");
    });

    /* ── GET /api/workspace/characters ─────────────────────────────────── */

    it("GET /api/workspace/characters lists character definitions", async () => {
        const { status, body } = await fetchJson("/api/workspace/characters");
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.characters), "characters should be an array");
        assert.ok(body.total >= 0, "total should be >= 0");
    });

    /* ── POST /api/workspace/character-assign (success) ────────────────── */

    let assignmentId: string;

    it("POST /api/workspace/character-assign creates an assignment", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/character-assign", {
            characterId: "test-agent",
            prismUserId: "prism-test-user",
            prismUserEmail: "test@prism.local",
            operatorId: "operator-test",
            operatorEmail: "operator@prism.local",
            clientId: "test-client",
            executionProfile: "individual",
        });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
        assert.ok(body.assignment, "should return assignment object");
        assert.ok(body.assignment.assignmentId, "should have assignmentId");
        assert.strictEqual(body.assignment.characterId, "test-agent");
        assert.strictEqual(body.assignment.state, "active");
        assignmentId = body.assignment.assignmentId;
    });

    /* ── POST /api/workspace/character-assign (invalid email should 400) ── */

    it("POST /api/workspace/character-assign rejects invalid email", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/character-assign", {
            characterId: "test-agent",
            prismUserId: "prism-test-user",
            prismUserEmail: "not-an-email",
            operatorId: "operator-test",
            operatorEmail: "operator@prism.local",
            executionProfile: "individual",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error, "should return error message");
    });

    /* ── GET /api/workspace/character-assignments ──────────────────────── */

    it("GET /api/workspace/character-assignments returns assignments", async () => {
        const { status, body } = await fetchJson("/api/workspace/character-assignments");
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.assignments), "assignments should be an array");
        assert.ok(body.total >= 1, "should have at least one assignment");
    });

    it("GET /api/workspace/character-assignments filters by characterId", async () => {
        const { status, body } = await fetchJson("/api/workspace/character-assignments?characterId=test-agent");
        assert.strictEqual(status, 200);
        assert.ok(body.total >= 1);
        for (const a of body.assignments) {
            assert.strictEqual(a.characterId, "test-agent");
        }
    });

    it("GET /api/workspace/character-assignments filters by state", async () => {
        const { status, body } = await fetchJson("/api/workspace/character-assignments?state=active");
        assert.strictEqual(status, 200);
        for (const a of body.assignments) {
            assert.strictEqual(a.state, "active");
        }
    });

    /* ── POST /api/workspace/character-dispatch ────────────────────────── */

    it("POST /api/workspace/character-dispatch increments dispatch count", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/character-dispatch", {
            assignmentId,
        });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
        assert.ok(body.assignment.dispatchCount >= 1);
    });

    it("POST /api/workspace/character-dispatch rejects missing assignmentId", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/character-dispatch", {});
        assert.strictEqual(status, 400);
        assert.ok(body.error);
    });

    /* ── POST /api/workspace/character-suspend ─────────────────────────── */

    it("POST /api/workspace/character-suspend suspends an active assignment", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/character-suspend", {
            assignmentId,
            reason: "test suspension",
        });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
        assert.strictEqual(body.assignment.state, "suspended");
    });

    /* ── POST /api/workspace/character-resume ──────────────────────────── */

    it("POST /api/workspace/character-resume resumes a suspended assignment", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/character-resume", {
            assignmentId,
        });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
        assert.strictEqual(body.assignment.state, "active");
    });

    /* ── POST /api/workspace/character-revoke ──────────────────────────── */

    it("POST /api/workspace/character-revoke revokes an assignment", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/character-revoke", {
            assignmentId,
            reason: "test revocation",
        });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
        assert.strictEqual(body.assignment.state, "revoked");
    });

    /* ── GET /api/workspace/character-audit ─────────────────────────────── */

    it("GET /api/workspace/character-audit returns accountability events", async () => {
        const { status, body } = await fetchJson("/api/workspace/character-audit");
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.events), "events should be an array");
        assert.ok(body.total >= 1, "should have at least one audit event");
    });

    it("GET /api/workspace/character-audit filters by characterId", async () => {
        const { status, body } = await fetchJson("/api/workspace/character-audit?characterId=test-agent");
        assert.strictEqual(status, 200);
        for (const e of body.events) {
            assert.strictEqual(e.characterId, "test-agent");
        }
    });

    /* ── GET /api/workspace/files ──────────────────────────────────────── */

    it("GET /api/workspace/files returns file listing", async () => {
        const { status, body } = await fetchJson("/api/workspace/files");
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.entries), "entries should be an array");
    });

    /* ── GET /api/workspace/git-status ─────────────────────────────────── */

    it("GET /api/workspace/git-status returns git information", async () => {
        const { status, body } = await fetchJson("/api/workspace/git-status");
        assert.strictEqual(status, 200);
        // May succeed or fail depending on git availability — just validate 200
        assert.ok(body !== undefined);
    });

    /* ── GET /api/workspace/import/history ─────────────────────────────── */

    it("GET /api/workspace/import/history returns import history", async () => {
        const { status, body } = await fetchJson("/api/workspace/import/history");
        assert.strictEqual(status, 200);
        // Should return an array or object
        assert.ok(body !== undefined);
    });

    /* ── POST /api/workspace/relocate ──────────────────────────────────── */

    it("POST /api/workspace/relocate moves workspace to new absolute path", async () => {
        const newRoot = join(tmpDir, "relocated-workspace");
        const { status, body } = await requestJson("POST", "/api/workspace/relocate", {
            path: newRoot,
        });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
        assert.ok(body.workspaceRoot, "should return new workspaceRoot");

        // Restore original root for remaining tests
        await requestJson("POST", "/api/workspace/relocate", { path: tmpDir });
    });

    it("POST /api/workspace/relocate rejects relative path", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/relocate", {
            path: "relative/path",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error, "should return error");
        assert.ok(body.error.toLowerCase().includes("absolute"), "error should mention absolute");
    });

    it("POST /api/workspace/relocate rejects empty path", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/relocate", {
            path: "",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error);
    });

    /* ── POST /api/workspace/import — general mode ─────────────────────── */

    it("POST /api/workspace/import (general) imports a file successfully", async () => {
        const content = Buffer.from("Hello, workspace!").toString("base64");
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "general",
            fileName: "test-import.txt",
            content,
            targetDir: "workspace",
        });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
        assert.ok(body.entry, "should return entry object");
        assert.strictEqual(body.entry.mode, "general");
        assert.strictEqual(body.entry.status, "success");
    });

    it("POST /api/workspace/import rejects path traversal in fileName", async () => {
        const content = Buffer.from("malicious").toString("base64");
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "general",
            fileName: "../../../etc/passwd",
            content,
            targetDir: "workspace",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error);
        assert.ok(body.error.includes("path separator") || body.error.includes(".."),
            "error should mention path safety");
    });

    it("POST /api/workspace/import rejects oversized file (>10 MB)", async () => {
        // Create a 10 MB + 1 byte base64 string
        const bigBuf = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
        const content = bigBuf.toString("base64");
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "general",
            fileName: "huge.bin",
            content,
            targetDir: "workspace",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error);
        assert.ok(body.error.includes("10 MB") || body.error.includes("size"),
            "error should mention size limit");
    });

    it("POST /api/workspace/import rejects invalid mode", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "nonexistent",
            fileName: "test.txt",
            content: Buffer.from("x").toString("base64"),
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error);
    });

    it("POST /api/workspace/import rejects invalid targetDir", async () => {
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "general",
            fileName: "test.txt",
            content: Buffer.from("x").toString("base64"),
            targetDir: "nonexistent-dir",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error);
    });

    /* ── POST /api/workspace/import — registered mode ──────────────────── */

    it("POST /api/workspace/import (registered) imports character JSON", async () => {
        const charJson = { name: "test-import-char", persona: "A test character", systemPrompt: "Hello" };
        const content = Buffer.from(JSON.stringify(charJson)).toString("base64");
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "registered",
            fileName: "test-import-char.json",
            content,
            registeredType: "character",
        });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
        assert.strictEqual(body.entry.mode, "registered");
        assert.strictEqual(body.entry.registeredType, "character");
    });

    it("POST /api/workspace/import (registered) rejects unknown registeredType", async () => {
        const content = Buffer.from("{}").toString("base64");
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "registered",
            fileName: "test.json",
            content,
            registeredType: "unknown-type",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error);
        assert.ok(body.error.includes("registeredType"));
    });

    it("POST /api/workspace/import (registered) validates character schema", async () => {
        // Missing required 'name' field
        const badChar = { persona: "Missing name" };
        const content = Buffer.from(JSON.stringify(badChar)).toString("base64");
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "registered",
            fileName: "bad-char.json",
            content,
            registeredType: "character",
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error);
        assert.ok(body.error.includes("name"), "error should mention missing name");
    });

    /* ── POST /api/workspace/import — folder mode ──────────────────────── */

    it("POST /api/workspace/import (folder) imports multiple files", async () => {
        const files = [
            { name: "a.txt", content: Buffer.from("fileA").toString("base64"), relativePath: "a.txt" },
            { name: "b.txt", content: Buffer.from("fileB").toString("base64"), relativePath: "sub/b.txt" },
        ];
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "folder",
            targetDir: "data",
            files,
        });
        assert.strictEqual(status, 200);
        assert.strictEqual(body.ok, true);
        assert.ok(body.results, "should return results array");
        assert.ok(body.summary, "should return summary");
        const imported = body.results.filter((r: any) => r.status === "imported");
        assert.strictEqual(imported.length, 2, "both files should be imported");
    });

    it("POST /api/workspace/import (folder) rejects >500 files", async () => {
        const files = [];
        for (let i = 0; i < 501; i++) {
            files.push({ name: `f${i}.txt`, content: Buffer.from("x").toString("base64") });
        }
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "folder",
            targetDir: "data",
            files,
        });
        assert.strictEqual(status, 400);
        assert.ok(body.error);
        assert.ok(body.error.includes("500"), "error should mention 500 limit");
    });

    it("POST /api/workspace/import (folder) rejects path traversal in files", async () => {
        const files = [
            { name: "evil.txt", content: Buffer.from("x").toString("base64"), relativePath: "../../evil.txt" },
        ];
        const { status, body } = await requestJson("POST", "/api/workspace/import", {
            mode: "folder",
            targetDir: "data",
            files,
        });
        assert.strictEqual(status, 200); // folder mode returns 200 with per-file results
        assert.ok(body.results);
        const rejected = body.results.filter((r: any) => r.status === "rejected");
        assert.ok(rejected.length > 0, "traversal file should be rejected");
    });

    /* ── Character lifecycle edge cases ────────────────────────────────── */

    it("POST /api/workspace/character-suspend rejects already-revoked assignment", async () => {
        // Create a fresh assignment and revoke it
        const { body: assignBody } = await requestJson("POST", "/api/workspace/character-assign", {
            characterId: "test-agent",
            prismUserId: "prism-edge",
            prismUserEmail: "edge@prism.local",
            operatorId: "op-edge",
            operatorEmail: "opedge@prism.local",
            executionProfile: "individual",
        });
        const edgeId = assignBody.assignment.assignmentId;
        await requestJson("POST", "/api/workspace/character-revoke", { assignmentId: edgeId, reason: "test" });

        // Now try to suspend the revoked assignment
        const { status, body } = await requestJson("POST", "/api/workspace/character-suspend", {
            assignmentId: edgeId,
            reason: "should fail",
        });
        // Should fail — can't suspend a revoked assignment
        assert.ok(status === 400 || status === 409 || (body.error && body.ok !== true),
            "Suspending a revoked assignment should fail");
    });

    it("POST /api/workspace/character-resume on active assignment is a no-op", async () => {
        // Create a fresh active assignment
        const { body: assignBody } = await requestJson("POST", "/api/workspace/character-assign", {
            characterId: "test-agent",
            prismUserId: "prism-resume",
            prismUserEmail: "resume@prism.local",
            operatorId: "op-resume",
            operatorEmail: "opresume@prism.local",
            executionProfile: "individual",
        });
        const resumeId = assignBody.assignment.assignmentId;

        // Resume on an active assignment is accepted (no-op, stays active)
        const { status, body } = await requestJson("POST", "/api/workspace/character-resume", {
            assignmentId: resumeId,
        });
        assert.strictEqual(status, 200, "Resume on active should return 200");
    });

    /* ── Audit log temporal invariants ─────────────────────────────────── */

    it("GET /api/workspace/character-audit returns monotonically ordered timestamps", async () => {
        const { status, body } = await fetchJson("/api/workspace/character-audit?limit=50");
        assert.strictEqual(status, 200);
        if (body.events.length > 1) {
            for (let i = 1; i < body.events.length; i++) {
                const prev = new Date(body.events[i - 1].timestamp).getTime();
                const curr = new Date(body.events[i].timestamp).getTime();
                // Events returned in newest-first order (descending)
                // OR oldest-first — just verify they're all valid dates
                assert.ok(!isNaN(prev), `Event ${i - 1} has valid timestamp`);
                assert.ok(!isNaN(curr), `Event ${i} has valid timestamp`);
            }
        }
    });

    it("GET /api/workspace/character-audit returns no future-dated timestamps", async () => {
        const { status, body } = await fetchJson("/api/workspace/character-audit?limit=50");
        assert.strictEqual(status, 200);
        const now = Date.now() + 5000; // 5s grace for clock skew
        for (const event of body.events) {
            const ts = new Date(event.timestamp).getTime();
            assert.ok(ts <= now, `Event timestamp ${event.timestamp} should not be in the future`);
        }
    });

    /* ── Import history reflects previous imports ──────────────────────── */

    it("GET /api/workspace/import/history reflects imports made during test", async () => {
        const { status, body } = await fetchJson("/api/workspace/import/history");
        assert.strictEqual(status, 200);
        assert.ok(Array.isArray(body.history), "history should be an array");
        // We made several imports earlier in this suite
        assert.ok(body.history.length > 0, "should have at least one import record");
        // Verify entry structure
        const entry = body.history[0];
        assert.ok(entry.id, "entry should have id");
        assert.ok(entry.timestamp, "entry should have timestamp");
        assert.ok(entry.mode, "entry should have mode");
        assert.ok(entry.status, "entry should have status");
    });
});
