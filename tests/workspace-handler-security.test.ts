/**
 * Security-focused unit tests for WorkspaceHandler.
 *
 * These call handler.handle() directly with fake req/res objects, bypassing the
 * HTTP auth middleware, so we can validate the hardening added to the workspace
 * routes:
 *   - relocate rejects drive roots and protected system directories
 *   - /files walk excludes heavy/VCS dirs and caps depth + entry count
 *   - import blocks executables by extension AND by magic bytes (all profiles)
 *   - import rejects oversized payloads before decoding
 *
 * Run: mocha dist/tests/workspace-handler-security.test.js --timeout 30000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { WorkspaceHandler } from "../src/core/operator/routes/workspace-handler.js";
import { _setWorkspaceRootForTest, _resetWorkspaceRootCache } from "../src/core/config/workspace-resolver.js";
import type { DashboardService } from "../src/core/operator/dashboard-service.js";

class FakeRes extends EventEmitter {
    statusCode = 200;
    headers: Record<string, string | string[]> = {};
    body = "";
    ended = false;

    setHeader(key: string, value: string | string[]): void {
        this.headers[key.toLowerCase()] = value;
    }
    writeHead(status: number, headers?: Record<string, string>): this {
        this.statusCode = status;
        if (headers) for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v;
        return this;
    }
    write(chunk: string): boolean {
        this.body += chunk;
        return true;
    }
    end(chunk?: string): this {
        if (chunk) this.body += chunk;
        this.ended = true;
        return this;
    }
    json<T>(): T {
        return this.body ? (JSON.parse(this.body) as T) : (null as unknown as T);
    }
}

function makeReq(method: string, url: string, body?: unknown): IncomingMessage {
    const emitter = new EventEmitter() as IncomingMessage;
    (emitter as unknown as { method: string }).method = method;
    (emitter as unknown as { url: string }).url = url;
    (emitter as unknown as { headers: Record<string, string> }).headers = {};
    const raw = body === undefined ? "" : JSON.stringify(body);
    (emitter as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<Buffer> })[Symbol.asyncIterator] =
        async function* () {
            if (raw) yield Buffer.from(raw, "utf-8");
        };
    return emitter;
}

/** Minimal fake DashboardService providing only what WorkspaceHandler needs. */
function makeFakeService(importHistory: unknown[]): DashboardService {
    return {
        readJsonBody: async <T extends object>(req: IncomingMessage): Promise<T> => {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
            const raw = Buffer.concat(chunks).toString("utf-8").trim();
            return (raw ? JSON.parse(raw) : {}) as T;
        },
        getImportHistory: () => importHistory,
    } as unknown as DashboardService;
}

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

describe("WorkspaceHandler — security hardening", function () {
    this.timeout(30_000);

    let tmpRoot: string;
    let handler: WorkspaceHandler;
    let importHistory: unknown[];

    before(() => {
        tmpRoot = mkdtempSync(join(tmpdir(), "prism-ws-sec-"));
        mkdirSync(join(tmpRoot, "workspace"), { recursive: true });
        _setWorkspaceRootForTest(tmpRoot);
        handler = new WorkspaceHandler();
    });

    after(() => {
        _resetWorkspaceRootCache();
        rmSync(tmpRoot, { recursive: true, force: true });
    });

    beforeEach(() => {
        _setWorkspaceRootForTest(tmpRoot);
        importHistory = [];
    });

    /* ── relocate guard ──────────────────────────────────────────────── */

    it("relocate rejects a drive/filesystem root", async () => {
        const target = platform() === "win32" ? "C:\\" : "/";
        const res = new FakeRes();
        await handler.handle(
            makeReq("POST", "/api/workspace/relocate", { path: target }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.json<{ error: string }>().error, /root/i);
    });

    it("relocate rejects a protected system directory", async () => {
        const target = platform() === "win32" ? "C:\\Windows\\System32" : "/etc/prism";
        const res = new FakeRes();
        await handler.handle(
            makeReq("POST", "/api/workspace/relocate", { path: target }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.json<{ error: string }>().error, /protected system directory/i);
    });

    /* ── file walk limits ────────────────────────────────────────────── */

    it("/files excludes node_modules and .git contents", async () => {
        mkdirSync(join(tmpRoot, "node_modules", "pkg"), { recursive: true });
        writeFileSync(join(tmpRoot, "node_modules", "pkg", "index.js"), "x");
        mkdirSync(join(tmpRoot, ".git"), { recursive: true });
        writeFileSync(join(tmpRoot, ".git", "config"), "x");
        writeFileSync(join(tmpRoot, "real.txt"), "hello");

        const res = new FakeRes();
        await handler.handle(
            makeReq("GET", "/api/workspace/files"),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 200);
        const entries = res.json<{ entries: Array<{ path: string }> }>().entries;
        const paths = entries.map((e) => e.path);
        assert.ok(paths.includes("real.txt"), "should list normal files");
        assert.ok(paths.includes("node_modules"), "should list the ignored dir itself");
        assert.ok(!paths.some((p) => p.startsWith("node_modules/")), "should not descend into node_modules");
        assert.ok(!paths.some((p) => p.startsWith(".git/")), "should not descend into .git");
    });

    /* ── executable import policy (all profiles) ─────────────────────── */

    it("import rejects a blocked executable extension", async () => {
        const res = new FakeRes();
        await handler.handle(
            makeReq("POST", "/api/workspace/import", {
                mode: "general",
                fileName: "evil.exe",
                content: b64("harmless text"),
                targetDir: "workspace",
            }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.json<{ error: string }>().error, /executable/i);
    });

    it("import rejects executable magic bytes despite a safe extension", async () => {
        // PE "MZ" header hidden behind a .txt extension.
        const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]).toString("base64");
        const res = new FakeRes();
        await handler.handle(
            makeReq("POST", "/api/workspace/import", {
                mode: "general",
                fileName: "sneaky.txt",
                content: mz,
                targetDir: "workspace",
            }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.json<{ error: string }>().error, /executable content/i);
    });

    it("import rejects a shebang script despite a safe extension", async () => {
        const res = new FakeRes();
        await handler.handle(
            makeReq("POST", "/api/workspace/import", {
                mode: "general",
                fileName: "notes.md",
                content: b64("#!/bin/bash\nrm -rf /\n"),
                targetDir: "workspace",
            }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.json<{ error: string }>().error, /executable content/i);
    });

    it("import accepts an ordinary text file", async () => {
        const res = new FakeRes();
        await handler.handle(
            makeReq("POST", "/api/workspace/import", {
                mode: "general",
                fileName: "hello.txt",
                content: b64("just plain text"),
                targetDir: "workspace",
            }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.json<{ ok: boolean }>().ok, true);
    });

    /* ── size guard before decode ────────────────────────────────────── */

    it("import rejects an oversized payload", async () => {
        // ~11 MB of base64 without allocating a huge decoded buffer test-side.
        const bigB64 = "A".repeat(15 * 1024 * 1024);
        const res = new FakeRes();
        await handler.handle(
            makeReq("POST", "/api/workspace/import", {
                mode: "general",
                fileName: "big.txt",
                content: bigB64,
                targetDir: "workspace",
            }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.json<{ error: string }>().error, /10 MB|size/i);
    });

    /* ── file actions ────────────────────────────────────────────────── */

    it("download returns file contents for a file inside the workspace", async () => {
        writeFileSync(join(tmpRoot, "workspace", "test.txt"), "hello download", "utf-8");
        const res = new FakeRes();
        await handler.handle(
            makeReq("GET", "/api/workspace/file/download?path=workspace%2Ftest.txt"),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 200);
        assert.ok(res.body.includes("hello download"));
    });

    it("download rejects path traversal", async () => {
        const res = new FakeRes();
        await handler.handle(
            makeReq("GET", "/api/workspace/file/download?path=..%2F..%2Fetc%2Fpasswd"),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.json<{ error: string }>().error, /traversal|outside/i);
    });

    it("rename renames a file inside the workspace", async () => {
        writeFileSync(join(tmpRoot, "workspace", "old.txt"), "content", "utf-8");
        const res = new FakeRes();
        await handler.handle(
            makeReq("POST", "/api/workspace/file/rename", {
                path: "workspace/old.txt",
                newName: "new.txt",
            }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.json<{ ok: boolean }>().ok, true);
    });

    it("rename rejects path traversal in newName", async () => {
        writeFileSync(join(tmpRoot, "workspace", "target.txt"), "x", "utf-8");
        const res = new FakeRes();
        await handler.handle(
            makeReq("POST", "/api/workspace/file/rename", {
                path: "workspace/target.txt",
                newName: "../escaped.txt",
            }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.json<{ error: string }>().error, /invalid|traversal/i);
    });

    it("delete removes a file inside the workspace", async () => {
        writeFileSync(join(tmpRoot, "workspace", "todelete.txt"), "bye", "utf-8");
        const res = new FakeRes();
        await handler.handle(
            makeReq("DELETE", "/api/workspace/file/delete", {
                path: "workspace/todelete.txt",
            }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.json<{ ok: boolean }>().ok, true);
    });

    it("delete rejects path traversal", async () => {
        const res = new FakeRes();
        await handler.handle(
            makeReq("DELETE", "/api/workspace/file/delete", {
                path: "../../important.json",
            }),
            res as unknown as ServerResponse,
            makeFakeService(importHistory),
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.json<{ error: string }>().error, /traversal|outside/i);
    });
});
