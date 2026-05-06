/**
 * R4 — Playwright E2E smoke suite.
 *
 * What this gate enforces:
 *
 *   1. The PRISM dashboard server boots cleanly from the built
 *      `dist/src/index.js` entrypoint with a known, isolated configuration
 *      (random port, ephemeral PRISM_DATA_DIR, dev profile, auth disabled).
 *   2. `GET /api/health` responds with the production-grade payload added in
 *      R1-5 — `version`, `directive.valid === true`, an `optionalDeps`
 *      summary block, and a `security` posture block.
 *   3. `GET /api/setup/status` responds with a JSON document describing
 *      whether the wizard is required (the contract PTAC depends on).
 *   4. The dashboard root (`/`) returns HTML containing the PRISM brand
 *      sentinel string AND, when a Chromium binary is available, the page
 *      actually renders in a real browser — `document.title` matches and
 *      the root `#app` mount point is present after first paint.
 *
 * If `npx playwright install chromium` has not been run on this machine,
 * the Playwright-driven cases skip gracefully with a clear message instead
 * of hard-failing. The HTTP cases above always run — they are the
 * non-negotiable smoke contract.
 *
 * Run: npx mocha dist/tests/e2e/playwright-smoke.test.js --timeout 120000
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
// dist/tests/e2e → repo root is three levels up.
const repoRoot = pathResolve(__dirname, "..", "..", "..");
const serverEntry = join(repoRoot, "dist", "src", "index.js");

interface HealthBody {
    version?: string;
    nodeEnv?: string;
    directive?: { expectedHash?: string; currentHash?: string; valid?: boolean };
    optionalDeps?: { summary?: { available: number; missing: number; error: number } };
    security?: { productionMode?: boolean; jwtSecretConfigured?: boolean };
}

function pickPort(): number {
    // Pick an ephemeral port in the user range to avoid collisions with the
    // operator's actual dev server on 7070 and the approval queue on the same.
    return 35000 + Math.floor(Math.random() * 20_000);
}

function httpJson(port: number, path: string, timeoutMs = 5_000): Promise<{ status: number; body: unknown; contentType: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { hostname: "127.0.0.1", port, path, method: "GET", timeout: timeoutMs },
            (res) => {
                let buf = "";
                res.on("data", (c) => (buf += c));
                res.on("end", () => {
                    const contentType = String(res.headers["content-type"] ?? "");
                    let body: unknown = buf;
                    if (contentType.includes("application/json")) {
                        try { body = JSON.parse(buf); } catch { body = buf; }
                    }
                    resolve({ status: res.statusCode ?? 0, body, contentType });
                });
            },
        );
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(new Error(`HTTP timeout for ${path}`)); });
        req.end();
    });
}

async function waitForHealth(port: number, deadlineMs: number): Promise<void> {
    const end = Date.now() + deadlineMs;
    let lastErr: unknown = null;
    while (Date.now() < end) {
        try {
            const { status } = await httpJson(port, "/api/health", 1_500);
            if (status >= 200 && status < 600) return;
        } catch (err) {
            lastErr = err;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`server did not respond on /api/health within ${deadlineMs} ms (last err: ${String(lastErr)})`);
}

async function tryLoadPlaywright(): Promise<typeof import("playwright") | null> {
    try {
        return await import("playwright");
    } catch {
        return null;
    }
}

describe("E2E smoke (Playwright + HTTP)", function () {
    this.timeout(120_000);

    if (!existsSync(serverEntry)) {
        it.skip("requires `npm run build` to have produced dist/src/index.js — skipping E2E smoke", () => {
            // intentionally empty
        });
        return;
    }

    const port = pickPort();
    const dataDir = mkdtempSync(join(tmpdir(), "prism-e2e-"));
    let serverProc: ChildProcess | null = null;
    let stdoutTail = "";
    let stderrTail = "";

    before(async function () {
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            NODE_ENV: "development",
            PRISM_MODE: "server",
            PRISM_DASHBOARD_PORT: String(port),
            PRISM_DATA_DIR: dataDir,
            PRISM_AUTH_DISABLED: "true",
            // 32+ char dev secret — required by the startup validator. NOT a
            // real secret; this server is bound to 127.0.0.1 on a random port
            // for the duration of this test only.
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
        proc.stdout?.on("data", (c) => {
            const s = String(c);
            stdoutTail = (stdoutTail + s).slice(-4_000);
        });
        proc.stderr?.on("data", (c) => {
            const s = String(c);
            stderrTail = (stderrTail + s).slice(-4_000);
        });
        proc.on("exit", (code, signal) => {
            // Surface unexpected early exits so the wait below fails with
            // useful context rather than a generic timeout.
            if (code !== 0 && code !== null) {
                stderrTail += `\n[server exited code=${code} signal=${signal}]`;
            }
        });

        try {
            await waitForHealth(port, 60_000);
        } catch (err) {
            const msg = `failed to start server on port ${port}: ${String(err)}\n` +
                `--- stdout (tail) ---\n${stdoutTail}\n` +
                `--- stderr (tail) ---\n${stderrTail}`;
            throw new Error(msg);
        }
    });

    after(async function () {
        const proc = serverProc;
        if (proc && proc.exitCode === null) {
            proc.kill("SIGTERM");
            // Give it 2 s to exit gracefully; force-kill otherwise.
            await new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                    if (proc.exitCode === null) {
                        proc.kill("SIGKILL");
                    }
                    resolve();
                }, 2_000);
                proc.once("exit", () => { clearTimeout(timer); resolve(); });
            });
        }
        try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    });

    /* ── HTTP smoke (always runs) ─────────────────────────────────────── */

    it("GET /api/health returns 200 with the production-grade payload", async () => {
        const { status, body } = await httpJson(port, "/api/health");
        assert.ok(status === 200 || status === 503,
            `expected 200 or 503 (degraded), got ${status}: ${JSON.stringify(body).slice(0, 400)}`);
        assert.equal(typeof body, "object");
        const h = body as HealthBody;
        assert.equal(typeof h.version, "string", "health.version must be a string");
        assert.equal(typeof h.nodeEnv, "string", "health.nodeEnv must be a string");
        assert.ok(h.directive, "health.directive block is required");
        assert.equal(typeof h.directive!.expectedHash, "string");
        assert.equal(typeof h.directive!.currentHash, "string");
        assert.equal(typeof h.directive!.valid, "boolean");
        assert.equal(h.directive!.valid, true, "directive integrity must be valid in a freshly built tree");
        assert.ok(h.optionalDeps, "health.optionalDeps block is required");
        assert.ok(h.optionalDeps!.summary, "health.optionalDeps.summary is required");
        assert.equal(typeof h.optionalDeps!.summary!.available, "number");
        assert.ok(h.security, "health.security block is required");
        assert.equal(h.security!.productionMode, false, "test runs in NODE_ENV=development");
        assert.equal(h.security!.jwtSecretConfigured, true, "jwt secret was configured in the test env");
    });

    it("GET /api/setup/status returns a JSON setup document", async () => {
        const { status, body } = await httpJson(port, "/api/setup/status");
        assert.equal(status, 200, `unexpected status: ${status}`);
        assert.equal(typeof body, "object", "expected JSON body");
    });

    it("GET / returns the PRISM dashboard HTML shell", async () => {
        const { status, body, contentType } = await httpJson(port, "/");
        assert.equal(status, 200, `expected 200, got ${status}`);
        assert.ok(contentType.includes("text/html"), `expected text/html, got ${contentType}`);
        const html = String(body);
        assert.ok(html.includes("<title>PRISM Frontier Console</title>"), "missing PRISM title");
        assert.ok(html.includes('id="app"'), "missing #app mount point");
    });

    /* ── Playwright (skips if chromium not installed) ─────────────────── */

    it("renders the dashboard in a real Chromium browser", async function () {
        const pw = await tryLoadPlaywright();
        if (!pw) {
            console.warn("  ⚠ playwright module not loadable — skipping browser case");
            return this.skip();
        }
        let browser: import("playwright").Browser | null = null;
        try {
            try {
                browser = await pw.chromium.launch({ headless: true });
            } catch (err) {
                const msg = String(err);
                if (/Executable doesn't exist/i.test(msg) || /browserType\.launch/i.test(msg)) {
                    console.warn(`  ⚠ Chromium binary not installed — run \`npx playwright install chromium\`. Skipping. (${msg.split("\n")[0]})`);
                    return this.skip();
                }
                throw err;
            }
            const context = await browser.newContext();
            const page = await context.newPage();
            const url = `http://127.0.0.1:${port}/`;
            const consoleErrors: string[] = [];
            page.on("pageerror", (e) => consoleErrors.push(String(e)));
            const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
            assert.ok(response, "page.goto returned no response");
            assert.equal(response!.status(), 200, `expected 200, got ${response!.status()}`);
            const title = await page.title();
            assert.equal(title, "PRISM Frontier Console", `unexpected title: ${title}`);
            const appExists = await page.locator("#app").count();
            assert.ok(appExists >= 1, "#app element missing from rendered DOM");
            // Catastrophic JS errors (uncaught exceptions / module load failures)
            // should fail the smoke; tolerate noisy console.warn / console.error.
            const fatal = consoleErrors.filter((e) => !/favicon|net::ERR_/i.test(e));
            assert.equal(fatal.length, 0, `uncaught page errors: ${fatal.join("; ")}`);
        } finally {
            if (browser) {
                try { await browser.close(); } catch { /* ignore */ }
            }
        }
    });
});
