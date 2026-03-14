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
    return {
        operation,
        args,
        risk,
        mutatesState,
        rollbackPlan,
    };
}

async function createTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = createServer(async (req, res) => {
        if ((req.url ?? "") === "/json" && req.method === "GET") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, mode: "get" }));
            return;
        }

        if ((req.url ?? "") === "/echo" && req.method === "POST") {
            let body = "";
            for await (const chunk of req) {
                body += chunk.toString();
            }

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, received: body ? JSON.parse(body) : null }));
            return;
        }

        res.statusCode = 404;
        res.end("not found");
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Unable to start HTTP test server");
    }

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: async () => {
            server.close();
            await once(server, "close");
        },
    };
}

export async function testAdapterSafetyRegression(): Promise<void> {
    const shell = new ShellTool();
    const blocked = await shell.execute(makeRequest("shell_exec", { command: "rm -rf /" }, true, "high", "n/a"));
    assert.strictEqual(blocked.ok, false);
    assert.match(String((blocked.output as { error?: string }).error ?? ""), /blocked/i);

    const empty = await shell.execute(makeRequest("shell_exec", { command: "" }, true, "low", "n/a"));
    assert.strictEqual(empty.ok, false);
    assert.match(String((empty.output as { error?: string }).error ?? ""), /No command supplied/i);

    const shellSuccess = await shell.execute(makeRequest("shell_exec", { command: "echo prism-shell-ok" }, false, "low"));
    assert.strictEqual(shellSuccess.ok, true);
    assert.match(String((shellSuccess.output as { stdout?: string }).stdout ?? ""), /prism-shell-ok/i);

    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "prism-adapter-test-"));
    const testFile = path.join(testDir, "sample.txt");

    const writer = new FileWriteTool();
    const reader = new FileReadTool();
    const lister = new FileListTool();
    const deleter = new FileDeleteTool();

    const writeResult = await writer.execute(makeRequest("file_write", { path: testFile, content: "alpha" }, true, "medium", "delete file"));
    assert.strictEqual(writeResult.ok, true);
    assert.strictEqual(Array.isArray(writeResult.sideEffects), true);

    const appendResult = await writer.execute(makeRequest("file_write", { path: testFile, content: "-beta", append: true }, true, "medium", "restore from backup"));
    assert.strictEqual(appendResult.ok, true);

    const readResult = await reader.execute(makeRequest("file_read", { path: testFile }, false, "low"));
    assert.strictEqual(readResult.ok, true);
    assert.strictEqual((readResult.output as { content?: string }).content, "alpha-beta");

    const listResult = await lister.execute(makeRequest("file_list", { path: testDir }, false, "low"));
    assert.strictEqual(listResult.ok, true);
    const entries = (listResult.output as { entries?: Array<{ name: string }> }).entries ?? [];
    assert.strictEqual(entries.some((entry) => entry.name === "sample.txt"), true);

    const deleteResult = await deleter.execute(makeRequest("file_delete", { path: testFile }, true, "medium", "restore file"));
    assert.strictEqual(deleteResult.ok, true);

    const missingRead = await reader.execute(makeRequest("file_read", { path: testFile }, false, "low"));
    assert.strictEqual(missingRead.ok, false);

    const http = new HttpRequestTool();
    const invalidUrl = await http.execute(makeRequest("http_request", { url: "ftp://example.com" }, false, "low"));
    assert.strictEqual(invalidUrl.ok, false);
    assert.match(String((invalidUrl.output as { error?: string }).error ?? ""), /URL must use http/i);

    const server = await createTestServer();
    try {
        const getResult = await http.execute(makeRequest("http_request", { url: `${server.baseUrl}/json`, method: "GET" }, false, "low"));
        assert.strictEqual(getResult.ok, true);
        assert.strictEqual((getResult.output as { status?: number }).status, 200);
        assert.deepStrictEqual((getResult.output as { body?: unknown }).body, { ok: true, mode: "get" });

        const postResult = await http.execute(makeRequest(
            "http_request",
            {
                url: `${server.baseUrl}/echo`,
                method: "POST",
                body: { probe: "adapter-regression" },
            },
            false,
            "low",
        ));

        assert.strictEqual(postResult.ok, true);
        assert.deepStrictEqual((postResult.output as { body?: unknown }).body, {
            ok: true,
            received: { probe: "adapter-regression" },
        });
    } finally {
        await server.close();
        await fs.rm(testDir, { recursive: true, force: true });
    }

    console.log("✓ Adapter safety regression tests passed");
}