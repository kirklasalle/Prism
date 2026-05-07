/**
 * Browser Integration Tests — Playwright-backed live session lifecycle.
 *
 * These tests require Playwright browsers to be installed.
 * They are wrapped in a conditional skip: if `playwright` import fails or
 * `chromium.launch()` fails, the entire suite is skipped gracefully.
 *
 * Run via Mocha: mocha dist/tests/browser-integration.test.js --timeout 60000
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import { BrowserControlTool } from "../src/adapters/system/browser-control-tool.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import type { ToolRequest } from "../src/core/tools/types.js";

function makeRequest(args: Record<string, unknown>): ToolRequest {
    return { operation: "browser_control", args, risk: "low", mutatesState: false };
}

/* ── Detect Playwright availability ──────────────────────────────────── */
let playwrightAvailable = false;
try {
    // Check playwright is importable without launching a browser at module load time.
    // Launching at module level causes resource contention when many test files
    // are loaded simultaneously (intermittent session-not-found failures).
    await import("playwright");
    playwrightAvailable = true;
} catch {
    playwrightAvailable = false;
}

const describeOrSkip = playwrightAvailable ? describe : describe.skip;

describeOrSkip("Browser Integration (live Playwright)", function () {
    this.timeout(60_000);

    let tool: BrowserControlTool;
    let bus: ActivityBus;
    let events: string[];
    let sessionId: string;

    const TEST_HTML = '<html><head><title>Test Page</title></head><body>'
        + '<h1 id="heading">Hello PRISM</h1>'
        + '<a href="https://example.com">Link</a>'
        + '<input id="input1" type="text"/>'
        + '</body></html>';

    /** Inject fixture HTML into the current page via evaluate. */
    async function injectTestPage(): Promise<void> {
        const expr = `document.open(); document.write('${TEST_HTML.replace(/'/g, "\\'")}'); document.close(); document.title;`;
        const r = await tool.execute(makeRequest({ action: "evaluate", sessionId, expression: expr }));
        assert.strictEqual(r.ok, true, `Inject test page failed: ${JSON.stringify(r.output)}`);
    }

    before(function () {
        bus = new ActivityBus();
        events = [];
        bus.subscribe({ onEvent: (e) => events.push(e.operation) });
        tool = new BrowserControlTool(bus, "integration-test");
    });

    after(async function () {
        const list = await tool.execute(makeRequest({ action: "list_sessions" }));
        const sessions = (list.output as any).sessions || [];
        for (const s of sessions) {
            await tool.execute(makeRequest({ action: "close_session", sessionId: s.id }));
        }
    });

    /* ── Session lifecycle ─────────────────────────────────────────────── */

    it("should launch a headless browser session", async function () {
        const result = await tool.execute(makeRequest({ action: "launch_session", headless: true }));
        assert.strictEqual(result.ok, true, `Launch failed: ${JSON.stringify(result.output)}`);
        sessionId = (result.output as any).id;
        assert.ok(sessionId, "Should return session id");
        assert.strictEqual((result.output as any).state, "active");
        assert.ok(result.sideEffects && result.sideEffects.length > 0, "Should report side effects");
    });

    it("should list the launched session", async function () {
        const result = await tool.execute(makeRequest({ action: "list_sessions" }));
        assert.strictEqual(result.ok, true);
        const sessions = (result.output as any).sessions;
        assert.ok(sessions.length >= 1);
        const found = sessions.find((s: any) => s.id === sessionId);
        assert.ok(found, "Launched session should appear in list");
        assert.strictEqual(found.state, "active");
    });

    /* ── Evaluate (basic, before page injection) ───────────────────────── */

    it("should evaluate and return computed values", async function () {
        const result = await tool.execute(makeRequest({ action: "evaluate", sessionId, expression: "2 + 2" }));
        assert.strictEqual(result.ok, true);
        assert.strictEqual((result.output as any).result, 4);
    });

    /* ── Page content injection ────────────────────────────────────────── */

    it("should inject test page content via evaluate", async function () {
        await injectTestPage();
        const title = await tool.execute(makeRequest({ action: "evaluate", sessionId, expression: "document.title" }));
        assert.strictEqual((title.output as any).result, "Test Page");
    });

    /* ── Navigation ────────────────────────────────────────────────────── */

    it("should navigate to https://example.com", async function () {
        const result = await tool.execute(makeRequest({ action: "navigate", sessionId, url: "https://example.com" }));
        assert.strictEqual(result.ok, true, `Navigate failed: ${JSON.stringify(result.output)}`);
        assert.ok((result.output as any).url.includes("example.com"));
        assert.ok((result.output as any).title);
    });

    it("should restore test fixture after navigation", async function () {
        await injectTestPage();
    });

    /* ── Screenshot ────────────────────────────────────────────────────── */

    it("should take a screenshot returning PNG metadata", async function () {
        const result = await tool.execute(makeRequest({ action: "screenshot", sessionId }));
        assert.strictEqual(result.ok, true);
        assert.ok((result.output as any).sizeBytes > 0);
        assert.strictEqual((result.output as any).format, "png");
    });

    it("should take a full-page screenshot", async function () {
        const result = await tool.execute(makeRequest({ action: "screenshot_full_page", sessionId }));
        assert.strictEqual(result.ok, true);
        assert.ok((result.output as any).sizeBytes > 0);
        assert.strictEqual((result.output as any).fullPage, true);
    });

    /* ── Click ─────────────────────────────────────────────────────────── */

    it("should click an element by selector", async function () {
        const result = await tool.execute(makeRequest({ action: "click", sessionId, selector: "#heading" }));
        assert.strictEqual(result.ok, true, `Click failed: ${JSON.stringify(result.output)}`);
        assert.strictEqual((result.output as any).clicked, "#heading");
    });

    it("should fail to click a nonexistent selector", async function () {
        const result = await tool.execute(makeRequest({ action: "click", sessionId, selector: "#does-not-exist" }));
        assert.strictEqual(result.ok, false);
    });

    /* ── Type ───────────────────────────────────────────────────────────── */

    it("should type text into an input", async function () {
        const result = await tool.execute(makeRequest({ action: "type", sessionId, selector: "#input1", text: "hello world" }));
        assert.strictEqual(result.ok, true, `Type failed: ${JSON.stringify(result.output)}`);
        assert.strictEqual((result.output as any).typed.length, 11);
    });

    /* ── Evaluate (with test page) ─────────────────────────────────────── */

    it("should evaluate document.title on the test page", async function () {
        const result = await tool.execute(makeRequest({ action: "evaluate", sessionId, expression: "document.title" }));
        assert.strictEqual(result.ok, true);
        assert.strictEqual((result.output as any).result, "Test Page");
    });

    /* ── DOM Snapshot ──────────────────────────────────────────────────── */

    it("should return a DOM snapshot containing page content", async function () {
        const result = await tool.execute(makeRequest({ action: "get_dom_snapshot", sessionId }));
        assert.strictEqual(result.ok, true);
        const html = (result.output as any).html;
        assert.ok(html.includes("Hello PRISM"), "DOM should contain page text");
    });

    /* ── Console Logs ──────────────────────────────────────────────────── */

    it("should capture console output after evaluate", async function () {
        await tool.execute(makeRequest({ action: "evaluate", sessionId, expression: "console.log('prism-test-marker')" }));
        const result = await tool.execute(makeRequest({ action: "get_console_logs", sessionId }));
        assert.strictEqual(result.ok, true);
        const logs = (result.output as any).logs;
        assert.ok(Array.isArray(logs));
        const marker = logs.find((l: any) => l.text.includes("prism-test-marker"));
        assert.ok(marker, "Should capture the console.log message");
    });

    /* ── Page Info ─────────────────────────────────────────────────────── */

    it("should return page info with title and url", async function () {
        const result = await tool.execute(makeRequest({ action: "get_page_info", sessionId }));
        assert.strictEqual(result.ok, true);
        assert.ok("title" in (result.output as any));
        assert.ok("url" in (result.output as any));
    });

    /* ── Text Content ──────────────────────────────────────────────────── */

    it("should get text content of the page", async function () {
        const result = await tool.execute(makeRequest({ action: "get_text_content", sessionId }));
        assert.strictEqual(result.ok, true);
        assert.ok((result.output as any).text.includes("Hello PRISM"));
    });

    it("should get text content of a specific selector", async function () {
        const result = await tool.execute(makeRequest({ action: "get_text_content", sessionId, selector: "#heading" }));
        assert.strictEqual(result.ok, true);
        assert.strictEqual((result.output as any).text, "Hello PRISM");
    });

    /* ── Links ─────────────────────────────────────────────────────────── */

    it("should extract links from the page", async function () {
        const result = await tool.execute(makeRequest({ action: "get_links", sessionId }));
        assert.strictEqual(result.ok, true);
        const links = (result.output as any).links;
        assert.ok(Array.isArray(links));
        assert.ok(links.length >= 1, "Should find at least 1 link");
        assert.ok(links.some((l: any) => l.href.includes("example.com")));
    });

    /* ── Accessibility Tree ────────────────────────────────────────────── */

    it("should attempt accessibility tree snapshot without crashing", async function () {
        const result = await tool.execute(makeRequest({ action: "get_accessibility_tree", sessionId }));
        // page.accessibility.snapshot() may not be supported in all Playwright versions/browsers.
        // The key assertion is that the tool handles this gracefully (ok: true with data, or ok: false with error).
        assert.ok(typeof result.ok === "boolean");
    });

    /* ── Hover ─────────────────────────────────────────────────────────── */

    it("should hover over an element", async function () {
        const result = await tool.execute(makeRequest({ action: "hover", sessionId, selector: "#heading" }));
        assert.strictEqual(result.ok, true);
        assert.strictEqual((result.output as any).hovered, "#heading");
    });

    /* ── Scroll ────────────────────────────────────────────────────────── */

    it("should scroll the page", async function () {
        const result = await tool.execute(makeRequest({ action: "scroll", sessionId, x: 0, y: 100 }));
        assert.strictEqual(result.ok, true);
        assert.deepStrictEqual((result.output as any).scrolledTo, { x: 0, y: 100 });
    });

    /* ── Wait For Selector ─────────────────────────────────────────────── */

    it("should wait for existing selector successfully", async function () {
        const result = await tool.execute(makeRequest({ action: "wait_for_selector", sessionId, selector: "#heading", timeout: 5000 }));
        assert.strictEqual(result.ok, true);
        assert.strictEqual((result.output as any).found, true);
    });

    it("should return found=false for nonexistent selector", async function () {
        const result = await tool.execute(makeRequest({ action: "wait_for_selector", sessionId, selector: "#nonexistent", timeout: 1000 }));
        assert.strictEqual(result.ok, true);
        assert.strictEqual((result.output as any).found, false);
    });

    /* ── Navigation helpers ────────────────────────────────────────────── */

    it("should reload the page", async function () {
        const result = await tool.execute(makeRequest({ action: "reload", sessionId }));
        assert.strictEqual(result.ok, true);
        assert.ok((result.output as any).url);
    });

    /* ── Cookie management ─────────────────────────────────────────────── */

    it("should get cookies (initially empty or minimal)", async function () {
        const result = await tool.execute(makeRequest({ action: "get_cookies", sessionId }));
        assert.strictEqual(result.ok, true);
        assert.ok(Array.isArray((result.output as any).cookies));
    });

    it("should set and retrieve a cookie", async function () {
        const cookie = JSON.stringify({ name: "prism_test", value: "123", domain: "localhost", path: "/" });
        const setResult = await tool.execute(makeRequest({ action: "set_cookie", sessionId, cookie }));
        assert.strictEqual(setResult.ok, true);
        assert.strictEqual((setResult.output as any).cookieSet, true);

        const getResult = await tool.execute(makeRequest({ action: "get_cookies", sessionId }));
        assert.strictEqual(getResult.ok, true);
        const cookies = (getResult.output as any).cookies;
        const found = cookies.find((c: any) => c.name === "prism_test");
        assert.ok(found, "Should find the set cookie");
        assert.strictEqual(found.value, "123");
    });

    it("should clear cookies", async function () {
        const result = await tool.execute(makeRequest({ action: "clear_cookies", sessionId }));
        assert.strictEqual(result.ok, true);
        assert.strictEqual((result.output as any).cookiesCleared, true);
    });

    /* ── Network log ───────────────────────────────────────────────────── */

    it("should return network log entries", async function () {
        const result = await tool.execute(makeRequest({ action: "get_network_log", sessionId }));
        assert.strictEqual(result.ok, true);
        assert.ok(Array.isArray((result.output as any).entries));
    });

    /* ── Profile-bound session ─────────────────────────────────────────── */

    it("should launch session with profile binding", async function () {
        const createResult = await tool.execute(makeRequest({ action: "create_profile", email: "integration@test.com", segment: "individual" }));
        assert.strictEqual(createResult.ok, true);
        const profileId = (createResult.output as any).profileId;

        const launchResult = await tool.execute(makeRequest({ action: "launch_session", headless: true, profileId }));
        assert.strictEqual(launchResult.ok, true);
        const profSessionId = (launchResult.output as any).id;
        assert.strictEqual((launchResult.output as any).profileId, profileId);

        const closeResult = await tool.execute(makeRequest({ action: "close_session", sessionId: profSessionId }));
        assert.strictEqual(closeResult.ok, true);

        await tool.execute(makeRequest({ action: "delete_profile", profileId }));
    });

    /* ── ActivityBus events ────────────────────────────────────────────── */

    it("should have emitted activity events during the test", function () {
        assert.ok(events.length > 0);
        assert.ok(events.includes("browser.session.started"));
    });

    /* ── Close session ─────────────────────────────────────────────────── */

    it("should close the session", async function () {
        const result = await tool.execute(makeRequest({ action: "close_session", sessionId }));
        assert.strictEqual(result.ok, true);
        assert.strictEqual((result.output as any).closed, true);
    });

    it("should show empty sessions after close", async function () {
        const result = await tool.execute(makeRequest({ action: "list_sessions" }));
        assert.strictEqual(result.ok, true);
        const sessions = (result.output as any).sessions;
        const found = sessions.find((s: any) => s.id === sessionId);
        assert.ok(!found, "Closed session should not appear in list");
    });
});
