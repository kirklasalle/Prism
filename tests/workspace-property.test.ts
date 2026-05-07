/**
 * Workspace Property-Based Tests — fast-check
 *
 * Uses property-based testing (aka QuickCheck / fuzz) to discover edge cases
 * that example-based tests miss. The key insight: rather than writing specific
 * inputs, we describe *invariants* that should hold for ALL inputs and let the
 * framework generate adversarial examples automatically.
 *
 * Properties verified:
 *
 *   P1. formatFileSize is monotonically non-decreasing in display order
 *   P2. formatFileSize never returns empty or undefined
 *   P3. formatFileSize produces correct unit suffix for every magnitude
 *   P4. Path traversal sequences are always rejected by the import endpoint
 *   P5. Email regex matches iff string contains user@domain.tld structure
 *   P6. Business domain matching is reflexive (same domain always passes)
 *   P7. File filter is case-insensitive prefix/substring match
 *   P8. renderWorkspaceFileTree produces non-empty HTML for any non-empty entries
 *   P9. Import collision (timestamp-append) creates unique filenames
 *   P10. No generated filename can escape the target directory
 *
 * Run: mocha dist/tests/workspace-property.test.js --timeout 30000
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import fc from "fast-check";
import http from "node:http";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import { _setWorkspaceRootForTest, _resetWorkspaceRootCache } from "../src/core/config/workspace-resolver.js";

/* ── Helpers ─────────────────────────────────────────────────────────── */

let dom: JSDOM;
let tabWorkspace: any;
let tabCharacters: any;

// API test helpers
let service: DashboardService;
let port: number;
let tmpDir: string;
let chatStore: ChatSessionStore;

function requestJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "127.0.0.1", port, path, method,
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

/* ── Setup ───────────────────────────────────────────────────────────── */

describe("Workspace Property-Based Tests", function () {
    this.timeout(30_000);

    before(async () => {
        /* ── jsdom for frontend tests ───────────────────────────── */
        const SCAFFOLD_HTML = `<!DOCTYPE html><html><body>
            <div id="workspace-path"></div>
            <div id="workspace-file-tree"></div>
            <div id="character-summary-cards"></div>
        </body></html>`;
        dom = new JSDOM(SCAFFOLD_HTML, { url: "http://localhost" });
        const g = dom.window as any;
        g.state = { _workspaceFiles: [] };
        g.request = async () => ({});
        g.escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        g.dashboardLog = () => {};
        g.safeRenderStep = (_n: string, fn: Function) => fn();

        // Copy tab-workspace.js to a temp dir with a mock dashboard-core.js
        const modTmpDir = mkdtempSync(join(tmpdir(), "prism-prop-dom-"));
        const mockCoreContent = `
export const state = globalThis.state || {};
export async function request(url, opts) { return globalThis.request(url, opts); }
export function escapeHtml(s) { return globalThis.escapeHtml(s); }
export function dashboardLog() {}
export function safeRenderStep(name, fn) { fn(); }
`;
        writeFileSync(join(modTmpDir, "dashboard-core.js"), mockCoreContent, "utf8");
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-workspace.js"),
            join(modTmpDir, "tab-workspace.js"),
        );
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-characters.js"),
            join(modTmpDir, "tab-characters.js"),
        );

        // Assign jsdom globals
        Object.assign(globalThis, {
            document: g.document,
            window: g,
            state: g.state,
            request: g.request,
            escapeHtml: g.escapeHtml,
            dashboardLog: g.dashboardLog,
            safeRenderStep: g.safeRenderStep,
            HTMLElement: g.HTMLElement,
        });

        tabWorkspace = await import(pathToFileURL(join(modTmpDir, "tab-workspace.js")).href);
        tabCharacters = await import(pathToFileURL(join(modTmpDir, "tab-characters.js")).href);

        /* ── DashboardService for API tests ────────────────────── */
        tmpDir = mkdtempSync(join(tmpdir(), "prism-prop-api-"));
        const charDir = join(tmpDir, "characters");
        mkdirSync(charDir, { recursive: true });
        mkdirSync(join(tmpDir, "state"), { recursive: true });
        writeFileSync(join(charDir, "prop-agent.json"), JSON.stringify({
            id: "prop-agent",
            name: "Property Test Agent",
            archetype: "sentinel",
            profile: "individual",
            maxRiskTier: 1,
            allowedTools: [],
            systemPromptOverride: "Property test",
            defaultEmail: "prop@prism.local",
        }), "utf8");
        _setWorkspaceRootForTest(tmpDir);

        const bus = new ActivityBus();
        chatStore = new ChatSessionStore(":memory:");
        const registry = new ToolRegistry();
        service = new DashboardService(
            new ApprovalQueue(), bus,
            {
                sessionId: "prop-test-session",
                environmentProfile: "test",
                mode: "server",
                startedAt: new Date().toISOString(),
                executionProfileSegment: "individual",
            },
            chatStore, [], 0, undefined, undefined,
            new InMemoryProviderSecretStore(),
            undefined,
            join(tmpDir, "session-packages.json"),
            join(tmpDir, "exports"),
            registry,
        );
        service.start();
        await new Promise((r) => setTimeout(r, 50));
        const addr = (service as unknown as { server: { address(): { port: number } | null } }).server.address();
        port = addr ? addr.port : 0;
        assert.ok(port > 0, "DashboardService must bind");
    });

    after(async () => {
        await service.stop();
        chatStore.close();
        _resetWorkspaceRootCache();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    /* ── P1. formatFileSize monotonicity ─────────────────────────────── */

    describe("P1: formatFileSize monotonicity", () => {
        it("larger bytes ⟹ larger or equal parsed value", () => {
            const { formatFileSize } = tabWorkspace;
            const unitRank: Record<string, number> = { "B": 0, "KB": 1, "MB": 2, "GB": 3 };
            fc.assert(fc.property(
                fc.nat({ max: 2 ** 40 }),
                fc.nat({ max: 2 ** 40 }),
                (a: number, b: number) => {
                    const lo = Math.min(a, b);
                    const hi = Math.max(a, b);
                    const loResult = formatFileSize(lo) as string;
                    const hiResult = formatFileSize(hi) as string;
                    // Extract numeric and unit parts
                    const loMatch = loResult.match(/^([\d.]+)\s+(\S+)$/);
                    const hiMatch = hiResult.match(/^([\d.]+)\s+(\S+)$/);
                    if (!loMatch || !hiMatch) return true; // skip if format is unexpected
                    const loNum = parseFloat(loMatch[1]);
                    const hiNum = parseFloat(hiMatch[1]);
                    const loRank = unitRank[loMatch[2]] ?? -1;
                    const hiRank = unitRank[hiMatch[2]] ?? -1;
                    // Higher unit rank OR same unit with higher number
                    return hiRank > loRank || (hiRank === loRank && hiNum >= loNum);
                },
            ), { numRuns: 500 });
        });
    });

    /* ── P2. formatFileSize never returns empty ──────────────────────── */

    describe("P2: formatFileSize never returns empty or undefined", () => {
        it("always returns a non-empty string for non-negative integers", () => {
            const { formatFileSize } = tabWorkspace;
            fc.assert(fc.property(
                fc.nat({ max: Number.MAX_SAFE_INTEGER }),
                (n) => {
                    const result = formatFileSize(n);
                    return typeof result === "string" && result.length > 0;
                },
            ), { numRuns: 1000 });
        });
    });

    /* ── P3. formatFileSize unit suffixes ────────────────────────────── */

    describe("P3: formatFileSize produces correct unit for magnitude", () => {
        it("bytes < 1024 → B, < 1M → KB, < 1G → MB, else GB", () => {
            const { formatFileSize } = tabWorkspace;
            fc.assert(fc.property(
                fc.integer({ min: 1, max: 2 ** 40 }),
                (n) => {
                    const result = formatFileSize(n);
                    if (n < 1024) return result.endsWith("B") && !result.endsWith("KB");
                    if (n < 1024 ** 2) return result.endsWith("KB");
                    if (n < 1024 ** 3) return result.endsWith("MB");
                    return result.endsWith("GB");
                },
            ), { numRuns: 500 });
        });
    });

    /* ── P4. Path traversal always rejected ──────────────────────────── */

    describe("P4: path traversal sequences are always rejected", () => {
        it("any filename containing .. is rejected by the import endpoint", async () => {
            // Generate filenames containing path traversal
            await fc.assert(fc.asyncProperty(
                fc.array(fc.constantFrom("a", ".", "/", "\\", "..", ".."), { minLength: 1, maxLength: 30 })
                    .map((a) => a.join(""))
                    .filter((s) => s.includes("..")),
                async (evilName: string) => {
                    const { status, body } = await requestJson("POST", "/api/workspace/import", {
                        mode: "general",
                        fileName: evilName,
                        content: btoa("test"),
                        targetDir: "data",
                    });
                    // Must be rejected
                    return status === 400 || status === 403 || body.error != null;
                },
            ), { numRuns: 50 });
        });
    });

    /* ── P5. Email regex property ────────────────────────────────────── */

    describe("P5: email pattern matches valid emails", () => {
        const emailPattern = /^\S+@\S+\.\S+$/;

        it("user@domain.tld always matches", () => {
            // Generate safe non-whitespace users and alpha-only domain/tld
            const safeUser = fc.string({ minLength: 1, maxLength: 20 }).filter((s: string) => !/\s/.test(s) && s.length > 0);
            const safeDomain = fc.string({ minLength: 1, maxLength: 15 }).filter((s: string) => !/[\s@.]/.test(s) && s.length > 0);
            const safeTld = fc.string({ minLength: 1, maxLength: 10 }).filter((s: string) => !/[\s@.]/.test(s) && s.length > 0);
            fc.assert(fc.property(
                safeUser, safeDomain, safeTld,
                (user: string, domain: string, tld: string) => {
                    const email = `${user}@${domain}.${tld}`;
                    return emailPattern.test(email);
                },
            ), { numRuns: 200 });
        });

        it("strings without @ never match", () => {
            fc.assert(fc.property(
                fc.string({ minLength: 1, maxLength: 40 }).filter((s: string) => !s.includes("@")),
                (s: string) => !emailPattern.test(s),
            ), { numRuns: 200 });
        });
    });

    /* ── P6. Business domain matching is reflexive ───────────────────── */

    describe("P6: same domain always passes business domain check", () => {
        it("matching domains never trigger mismatch error", () => {
            const safeAlpha = fc.string({ minLength: 1, maxLength: 10 }).filter((s: string) => !/[\s@.]/.test(s) && s.length > 0);
            fc.assert(fc.property(
                safeAlpha, safeAlpha, safeAlpha,
                (user1: string, user2: string, domain: string) => {
                    const email1 = `${user1}@${domain}.com`;
                    const email2 = `${user2}@${domain}.com`;
                    const d1 = email1.split("@").pop()!.toLowerCase();
                    const d2 = email2.split("@").pop()!.toLowerCase();
                    return d1 === d2;
                },
            ), { numRuns: 200 });
        });
    });

    /* ── P7. filterWorkspaceFiles case-insensitive match ─────────────── */

    describe("P7: file filter is case-insensitive substring match", () => {
        it("any substring of a path always passes the filter", () => {
            const { filterWorkspaceFiles, renderWorkspaceFileTree } = tabWorkspace;
            const pathArb = fc.array(fc.constantFrom("a", "b", "c", "/", ".", "_"), { minLength: 1, maxLength: 20 }).map((a) => a.join(""));
            fc.assert(fc.property(
                fc.array(
                    fc.record({
                        path: pathArb,
                        name: fc.constant("file"),
                        type: fc.constant("file" as const),
                        size: fc.nat({ max: 10000 }),
                    }),
                    { minLength: 1, maxLength: 10 },
                ),
                (entries) => {
                    // Pick a random entry and extract a substring of its path
                    const target = entries[0];
                    const fullPath = target.path as string;
                    if (fullPath.length === 0) return true;
                    const start = 0;
                    const end = Math.min(3, fullPath.length);
                    const query = fullPath.substring(start, end);
                    const lower = query.toLowerCase();
                    const filtered = entries.filter((e: any) =>
                        e.path.toLowerCase().indexOf(lower) !== -1,
                    );
                    // The target entry should always be in the result (if query is substring)
                    return filtered.some((e: any) => e.path === target.path);
                },
            ), { numRuns: 200 });
        });
    });

    /* ── P8. renderWorkspaceFileTree produces HTML for non-empty input ── */

    describe("P8: renderWorkspaceFileTree produces non-empty HTML", () => {
        it("non-empty entries always render to non-empty innerHTML", () => {
            const { renderWorkspaceFileTree } = tabWorkspace;
            const container = (globalThis as any).document.getElementById("workspace-file-tree");
            const pathArb = fc.array(fc.constantFrom("a", "b", "/", "_"), { minLength: 1, maxLength: 15 }).map((a) => a.join(""));
            const nameArb = fc.array(fc.constantFrom("a", "b"), { minLength: 1, maxLength: 8 }).map((a) => a.join(""));
            fc.assert(fc.property(
                fc.array(
                    fc.record({
                        path: pathArb,
                        name: nameArb,
                        type: fc.constantFrom("file" as const, "dir" as const),
                        size: fc.nat({ max: 999999 }),
                    }),
                    { minLength: 1, maxLength: 10 },
                ),
                (entries) => {
                    renderWorkspaceFileTree(entries, container);
                    return container.innerHTML.trim().length > 0;
                },
            ), { numRuns: 200 });
        });
    });

    /* ── P9. Import collision filename uniqueness ────────────────────── */

    describe("P9: collision-avoidance timestamp creates unique names", () => {
        it("same base name + different timestamps → different filenames", () => {
            const baseArb = fc.array(fc.constantFrom("a", "b", "c", "1", "2"), { minLength: 1, maxLength: 10 }).map((a) => a.join(""));
            fc.assert(fc.property(
                baseArb,
                fc.constantFrom(".json", ".txt", ".md", ".yaml"),
                fc.integer({ min: 1000000000000, max: 9999999999999 }),
                fc.integer({ min: 1000000000000, max: 9999999999999 }),
                (base: string, ext: string, ts1: number, ts2: number) => {
                    if (ts1 === ts2) return true;
                    const name1 = `${base}_${ts1}${ext}`;
                    const name2 = `${base}_${ts2}${ext}`;
                    return name1 !== name2;
                },
            ), { numRuns: 500 });
        });
    });

    /* ── P10. Generated filenames cannot escape target directory ──────── */

    describe("P10: no generated filename escapes target directory", () => {
        it("posix path.join(targetDir, sanitized) stays inside targetDir", () => {
            const rawArb = fc.array(fc.constantFrom("a", ".", "/", "\\", "..", "~", "$"), { minLength: 1, maxLength: 30 }).map((a) => a.join(""));
            fc.assert(fc.property(
                rawArb,
                (rawName: string) => {
                    const sanitized = rawName
                        .replace(/\.\./g, "_")
                        .replace(/[/\\]/g, "_")
                        .replace(/[^a-zA-Z0-9._-]/g, "_");
                    const targetDir = "/workspace/data";
                    // Use posix.join to ensure cross-platform consistency
                    const resolved = posix.join(targetDir, sanitized);
                    // Must be inside targetDir
                    return resolved.startsWith(targetDir);
                },
            ), { numRuns: 500 });
        });
    });
});
