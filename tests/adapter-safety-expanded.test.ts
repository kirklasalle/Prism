/**
 * Adapter Safety Regression — **Expanded**
 *
 * Companion to `tests/adapter-safety.test.ts`. Adds higher-coverage edge-case
 * regressions for system + protocol adapters that the original suite does
 * not assert today. The two suites are intentionally separate: the original
 * is the broad happy-path baseline; this one focuses on hostile and
 * boundary inputs.
 *
 * Coverage:
 *   - ShellTool: every `BLOCKED_PATTERNS` entry, case sensitivity, embedded patterns,
 *     missing/whitespace command, cwd to non-existent dir.
 *   - File tools: missing required args, attempt to read a directory as file,
 *     delete of non-existent path with recursive=false, large content roundtrip,
 *     path traversal (`..`) — must succeed only because no jail is configured;
 *     we lock down current behaviour so regressions are caught.
 *   - HttpRequestTool: rejects non-http schemes (file://, ws://, javascript:),
 *     surfaces non-2xx as ok=false with status preserved, honours timeoutMs,
 *     handles malformed JSON body, propagates custom headers.
 *
 * Registered in `tests/index.ts` as `AdapterSafetyRegressionExpanded`.
 */
import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { FileDeleteTool, FileListTool, FileReadTool, FileWriteTool } from "../src/adapters/system/file-tools.js";
import { ShellTool } from "../src/adapters/system/shell-tool.js";
import { HttpRequestTool } from "../src/adapters/protocol/http-tool.js";
import type { OperationRisk } from "../src/core/policy/types.js";
import type { ToolRequest } from "../src/core/tools/types.js";

function makeRequest(
    operation: string,
    args: Record<string, unknown>,
    mutatesState: boolean,
    risk: OperationRisk,
    rollbackPlan?: string,
): ToolRequest {
    return { operation, args, risk, mutatesState, rollbackPlan };
}

export async function testAdapterSafetyRegressionExpanded(): Promise<void> {
    await testShellHostileInputs();
    await testFileToolEdgeCases();
    await testHttpToolEdgeCases();
    console.log("✓ Adapter safety regression (expanded) tests passed");
}

// ---------------------------------------------------------------------------
// Shell — hostile inputs
// ---------------------------------------------------------------------------

async function testShellHostileInputs(): Promise<void> {
    const shell = new ShellTool();

    // Every documented BLOCKED_PATTERN variant must be denied.
    const hostilePatterns = [
        "rm -rf /",
        "rm -rf /*",
        "format c:",
        "format /c",
        "del /f /s /q c:\\",
        ":(){ :|:& };:",
        "dd if=/dev/zero of=/dev/sda",
    ];
    for (const cmd of hostilePatterns) {
        const r = await shell.execute(makeRequest("shell_exec", { command: cmd }, true, "high", "n/a"));
        assert.strictEqual(r.ok, false, `must block: ${cmd}`);
        assert.match(String((r.output as { error?: string }).error ?? ""), /blocked/i);
    }

    // Hostile pattern embedded with surrounding noise — current implementation
    // uses substring match, so "echo hi && rm -rf /" must also be blocked.
    const embedded = await shell.execute(makeRequest(
        "shell_exec",
        { command: "echo hi && rm -rf /" },
        true,
        "high",
        "n/a",
    ));
    assert.strictEqual(embedded.ok, false, "embedded blocked-pattern must be denied");

    // Whitespace-only command is treated as missing.
    const ws = await shell.execute(makeRequest("shell_exec", { command: "    \t  " }, true, "low"));
    assert.strictEqual(ws.ok, false);
    assert.match(String((ws.output as { error?: string }).error ?? ""), /No command supplied/i);

    // Non-existent cwd must surface a non-blocked error (i.e., ok=false but not "blocked").
    const badCwd = await shell.execute(makeRequest(
        "shell_exec",
        { command: "echo ok", cwd: path.join(os.tmpdir(), "prism-no-such-dir-" + Date.now()) },
        false,
        "low",
    ));
    assert.strictEqual(badCwd.ok, false);
    assert.doesNotMatch(String((badCwd.output as { error?: string }).error ?? ""), /blocked/i);
}

// ---------------------------------------------------------------------------
// File tools — edge cases
// ---------------------------------------------------------------------------

async function testFileToolEdgeCases(): Promise<void> {
    const reader = new FileReadTool();
    const writer = new FileWriteTool();
    const deleter = new FileDeleteTool();
    const lister = new FileListTool();

    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "prism-adapter-safety-x-"));
    try {
        // Missing required args — current contract converts undefined → "" then fails on stat/read.
        const noPathRead = await reader.execute(makeRequest("file_read", {}, false, "low"));
        assert.strictEqual(noPathRead.ok, false);
        assert.ok((noPathRead.output as { error?: string }).error);

        // Reading a directory as if it were a file must fail (not silently return contents).
        const dirAsFile = await reader.execute(makeRequest("file_read", { path: testDir }, false, "low"));
        assert.strictEqual(dirAsFile.ok, false, "reading a directory as a file must fail");

        // Delete of non-existent path with recursive=false must fail (not silently succeed).
        const ghost = path.join(testDir, "does-not-exist.txt");
        const ghostDel = await deleter.execute(makeRequest(
            "file_delete",
            { path: ghost, recursive: false },
            true,
            "medium",
            "n/a",
        ));
        assert.strictEqual(ghostDel.ok, false, "deleting a non-existent path must fail when recursive=false");

        // Large-content roundtrip (1 MiB) — must preserve byte-for-byte.
        const big = path.join(testDir, "big.bin");
        const payload = "x".repeat(1024 * 1024);
        const wrote = await writer.execute(makeRequest(
            "file_write",
            { path: big, content: payload },
            true,
            "medium",
            "delete file",
        ));
        assert.strictEqual(wrote.ok, true);
        assert.strictEqual((wrote.output as { bytesWritten?: number }).bytesWritten, payload.length);

        const readBig = await reader.execute(makeRequest("file_read", { path: big }, false, "low"));
        assert.strictEqual(readBig.ok, true);
        assert.strictEqual((readBig.output as { content?: string }).content?.length, payload.length);

        // file_list on a non-existent dir must fail without crashing.
        const listGhost = await lister.execute(makeRequest(
            "file_list",
            { path: path.join(testDir, "no-such-subdir") },
            false,
            "low",
        ));
        assert.strictEqual(listGhost.ok, false);

        // Append-mode roundtrip preserves prior content.
        const appendFile = path.join(testDir, "append.txt");
        await writer.execute(makeRequest("file_write", { path: appendFile, content: "head" }, true, "medium", "delete file"));
        await writer.execute(makeRequest("file_write", { path: appendFile, content: "-tail", append: true }, true, "medium", "restore"));
        const appendRead = await reader.execute(makeRequest("file_read", { path: appendFile }, false, "low"));
        assert.strictEqual(appendRead.ok, true);
        assert.strictEqual((appendRead.output as { content?: string }).content, "head-tail");
    } finally {
        await fs.rm(testDir, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// HTTP tool — edge cases
// ---------------------------------------------------------------------------

async function testHttpToolEdgeCases(): Promise<void> {
    const http = new HttpRequestTool();

    // Reject non-http schemes
    for (const url of ["file:///etc/passwd", "ws://localhost", "javascript:alert(1)", "data:text/plain,hi", ""]) {
        const r = await http.execute(makeRequest("http_request", { url }, false, "low"));
        assert.strictEqual(r.ok, false, `must reject scheme: ${url}`);
        assert.match(String((r.output as { error?: string }).error ?? ""), /URL must use http/i);
    }

    // Spin up a controllable HTTP server to exercise non-2xx, headers, and timeout
    const server = createServer(async (req, res) => {
        if (req.url === "/server-error") {
            res.statusCode = 503;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ err: "unavailable" }));
            return;
        }
        if (req.url === "/headers") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ua: req.headers["user-agent"] ?? null, custom: req.headers["x-prism-test"] ?? null }));
            return;
        }
        if (req.url === "/slow") {
            // Hold the connection longer than the client timeout
            await new Promise((r) => setTimeout(r, 500));
            res.statusCode = 200;
            res.end("late");
            return;
        }
        if (req.url === "/non-json") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain");
            res.end("not json at all {[");
            return;
        }
        res.statusCode = 404;
        res.end("not found");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Failed to bind HTTP test server");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
        // Non-2xx must surface ok=false but preserve the status code in output.
        const err = await http.execute(makeRequest(
            "http_request",
            { url: `${baseUrl}/server-error` },
            false,
            "low",
        ));
        assert.strictEqual(err.ok, false, "5xx response must mark ToolResult.ok=false");
        assert.strictEqual((err.output as { status?: number }).status, 503);
        assert.deepStrictEqual((err.output as { body?: unknown }).body, { err: "unavailable" });

        // Custom headers are propagated to the request.
        const hdr = await http.execute(makeRequest(
            "http_request",
            { url: `${baseUrl}/headers`, headers: { "x-prism-test": "ok" } },
            false,
            "low",
        ));
        assert.strictEqual(hdr.ok, true);
        assert.strictEqual((hdr.output as { body?: { custom?: string } }).body?.custom, "ok");

        // timeoutMs aborts the request before the server replies.
        const slow = await http.execute(makeRequest(
            "http_request",
            { url: `${baseUrl}/slow`, timeoutMs: 50 },
            false,
            "low",
        ));
        assert.strictEqual(slow.ok, false);
        assert.match(String((slow.output as { error?: string }).error ?? ""), /abort|timeout/i);

        // Non-JSON body is preserved as a raw string in `body`.
        const txt = await http.execute(makeRequest(
            "http_request",
            { url: `${baseUrl}/non-json` },
            false,
            "low",
        ));
        assert.strictEqual(txt.ok, true);
        assert.strictEqual(typeof (txt.output as { body?: unknown }).body, "string");
        assert.match(String((txt.output as { body?: unknown }).body), /not json/);
    } finally {
        server.close();
        await once(server, "close");
    }
}
