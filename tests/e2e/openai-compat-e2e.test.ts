/**
 * E2E — OpenAI compatibility surface (/v1/*) against a live PRISM server.
 *
 * Boots the built dashboard on a random ephemeral port (auth disabled for
 * the duration of the test, same pattern as `playwright-smoke.test.ts`) and
 * verifies that the OpenAI compatibility shim wired in by Workstream 1 is
 * actually reachable through the real HTTP stack:
 *
 *   1. POST /v1/chat/completions returns an OpenAI-shaped envelope
 *      carrying `prism_metadata` (transparency tag — Law 6).
 *   2. POST /v1/threads + GET /v1/threads/:id round-trip.
 *   3. POST /v1/threads/:id/messages + GET /v1/threads/:id/messages.
 *   4. POST /v1/threads/:id/runs returns a run object with a status.
 *
 * No provider is configured in this test environment; the shim's
 * "no-provider" fallback (a deterministic stub message) keeps the
 * envelope valid so the routing assertion does not depend on a live LLM.
 *
 * Run: npm run test:e2e (mocha picks up everything under dist/tests/e2e/)
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { describe, it, before, after } from "mocha";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = pathResolve(__dirname, "..", "..", "..");
const serverEntry = join(repoRoot, "dist", "src", "index.js");

function pickPort(): number {
    return 35000 + Math.floor(Math.random() * 20_000);
}

interface HttpResult {
    status: number;
    body: unknown;
}

function httpRequest(
    port: number,
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 5_000,
): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
        const payload = body !== undefined ? Buffer.from(JSON.stringify(body), "utf-8") : undefined;
        const req = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path,
                method,
                timeout: timeoutMs,
                headers: payload
                    ? { "Content-Type": "application/json", "Content-Length": String(payload.length) }
                    : {},
            },
            (res) => {
                let buf = "";
                res.on("data", (c) => (buf += c));
                res.on("end", () => {
                    let parsed: unknown = buf;
                    try { parsed = JSON.parse(buf); } catch { /* leave raw */ }
                    resolve({ status: res.statusCode ?? 0, body: parsed });
                });
            },
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error(`HTTP timeout for ${method} ${path}`)));
        if (payload) req.write(payload);
        req.end();
    });
}

async function waitForHealth(port: number, deadlineMs: number): Promise<void> {
    const end = Date.now() + deadlineMs;
    let lastErr: unknown = null;
    while (Date.now() < end) {
        try {
            const { status } = await httpRequest(port, "GET", "/api/health", undefined, 1_500);
            if (status >= 200 && status < 600) return;
        } catch (err) {
            lastErr = err;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`server did not respond on /api/health within ${deadlineMs} ms (last err: ${String(lastErr)})`);
}

describe("E2E /v1/* OpenAI compat surface", function () {
    this.timeout(120_000);

    if (!existsSync(serverEntry)) {
        it.skip("requires `npm run build` to have produced dist/src/index.js — skipping", () => { /* no-op */ });
        return;
    }

    const port = pickPort();
    const dataDir = mkdtempSync(join(tmpdir(), "prism-e2e-v1-"));
    let serverProc: ChildProcess | null = null;
    let stderrTail = "";

    before(async function () {
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            NODE_ENV: "development",
            PRISM_MODE: "server",
            PRISM_DASHBOARD_PORT: String(port),
            PRISM_DATA_DIR: dataDir,
            PRISM_AUTH_DISABLED: "true",
            PRISM_JWT_SECRET: "e2e-test-secret-do-not-use-in-prod-32chars-min",
            PRISM_ENV_PROFILE: "dev",
            PRISM_TELEMETRY_DISABLED: "true",
        };
        const proc = spawn(process.execPath, [serverEntry], {
            env,
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
        });
        serverProc = proc;
        proc.stderr?.on("data", (c) => { stderrTail = (stderrTail + String(c)).slice(-4_000); });
        try {
            await waitForHealth(port, 60_000);
        } catch (err) {
            throw new Error(`server boot failed: ${String(err)}\n--- stderr ---\n${stderrTail}`);
        }
    });

    after(async function () {
        const proc = serverProc;
        if (proc && proc.exitCode === null) {
            proc.kill("SIGTERM");
            await new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                    if (proc.exitCode === null) proc.kill("SIGKILL");
                    resolve();
                }, 2_000);
                proc.once("exit", () => { clearTimeout(timer); resolve(); });
            });
        }
        try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    });

    it("POST /v1/chat/completions returns an OpenAI-shaped response with prism_metadata", async () => {
        const { status, body } = await httpRequest(port, "POST", "/v1/chat/completions", {
            model: "gpt-4o",
            messages: [{ role: "user", content: "ping" }],
        });
        assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body).slice(0, 400)}`);
        const b = body as {
            object?: string;
            id?: string;
            choices?: Array<{ message?: { role?: string; content?: string } }>;
            prism_metadata?: { compat_shim?: string; notice?: string };
        };
        assert.equal(b.object, "chat.completion", "object field");
        assert.ok(typeof b.id === "string" && b.id.startsWith("chatcmpl-"), "id prefix");
        assert.equal(b.choices?.[0]?.message?.role, "assistant", "assistant role");
        assert.equal(typeof b.choices?.[0]?.message?.content, "string", "content present");
        assert.equal(b.prism_metadata?.compat_shim, "openai", "transparency tag");
        assert.ok(b.prism_metadata?.notice && b.prism_metadata.notice.includes("PRISM"), "notice present");
    });

    it("POST /v1/threads + GET /v1/threads/:id round-trips", async () => {
        const created = await httpRequest(port, "POST", "/v1/threads", { metadata: { source: "e2e" } });
        assert.equal(created.status, 200);
        const tid = (created.body as { id: string }).id;
        assert.ok(tid.startsWith("thread_"), "thread id prefix");

        const fetched = await httpRequest(port, "GET", `/v1/threads/${tid}`);
        assert.equal(fetched.status, 200);
        assert.equal((fetched.body as { id: string }).id, tid);
    });

    it("messages append + list and runs lifecycle", async () => {
        const t = await httpRequest(port, "POST", "/v1/threads", {});
        const tid = (t.body as { id: string }).id;

        const m = await httpRequest(port, "POST", `/v1/threads/${tid}/messages`, {
            role: "user",
            content: "hello PRISM",
        });
        assert.equal(m.status, 200);

        const list = await httpRequest(port, "GET", `/v1/threads/${tid}/messages`);
        assert.equal(list.status, 200);
        assert.equal((list.body as { data: unknown[] }).data.length, 1);

        const run = await httpRequest(port, "POST", `/v1/threads/${tid}/runs`, { assistant_id: "asst_e2e" });
        assert.equal(run.status, 200);
        const runBody = run.body as { status: string; id: string };
        // Status is either "completed" (no provider → stub fallback succeeds) or
        // "failed" (provider configured but unreachable in this test env). Both
        // are valid run-record envelopes; what matters is that the surface is
        // reachable and OpenAI-shaped.
        assert.ok(
            ["completed", "failed", "queued", "in_progress"].includes(runBody.status),
            `unexpected run status: ${runBody.status}`,
        );
        assert.ok(runBody.id.startsWith("run_"), "run id prefix");
    });

    it("unknown /v1 path returns a typed 404 envelope", async () => {
        const { status, body } = await httpRequest(port, "POST", "/v1/threads/abc/wrong");
        assert.equal(status, 404);
        const env = body as { error?: { code?: string } };
        assert.equal(env.error?.code, "not_found");
    });
});
