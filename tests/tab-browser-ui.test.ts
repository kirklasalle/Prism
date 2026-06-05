/**
 * Frontend Unit Tests for tab-browser.js â€” DOM rendering logic.
 *
 * Uses jsdom to provide a minimal browser-like environment, then loads
 * tab-browser.js with a mocked dashboard-core.js so we can test:
 *   - setBrowserView (sub-view toggling)
 *   - renderBrowserSessions (session card HTML)
 *   - renderStorageContent (cookies / local / session tables)
 *   - renderBrowserProfiles (profile list)
 *   - populateBrowserSessionDropdowns (dropdown population)
 *   - browserLogAction (action log + 100 cap)
 *   - browserSessionChanged (dropdown sync)
 *
 * Run: mocha dist/tests/tab-browser-ui.test.js --timeout 30000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

// Minimal JSDOM type (no @types/jsdom to avoid DOM/fetch type conflicts)
type JSDOMInstance = InstanceType<typeof JSDOM>;

/* â”€â”€ Global DOM scaffold â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const SCAFFOLD_HTML = `<!DOCTYPE html><html><body>
<!-- Sub-view panels -->
<div id="browser-sessions-panel"></div>
<div id="browser-viewport-panel"></div>
<div id="browser-network-panel"></div>
<div id="browser-console-panel"></div>
<div id="browser-dom-panel"></div>
<div id="browser-storage-panel"></div>
<div id="browser-profiles-panel"></div>

<!-- Sub-view nav buttons -->
<button id="bv-sessions"></button>
<button id="bv-viewport"></button>
<button id="bv-network"></button>
<button id="bv-console"></button>
<button id="bv-dom"></button>
<button id="bv-storage"></button>
<button id="bv-profiles"></button>

<!-- Session list -->
<div id="browser-sessions-list"></div>

<!-- Viewport controls -->
<select id="browser-active-session"></select>
<select id="browser-network-session"></select>
<select id="browser-console-session"></select>
<select id="browser-dom-session"></select>
<select id="browser-storage-session"></select>
<select id="browser-launch-profile"></select>

<div id="browser-page-info"></div>
<div id="browser-viewport-container"></div>
<div id="browser-f12-btn" style="background:var(--surface);color:var(--accent);"></div>

<!-- Storage -->
<div id="browser-storage-content"></div>
<button id="storage-tab-cookies"></button>
<button id="storage-tab-local"></button>
<button id="storage-tab-session"></button>

<!-- Profiles -->
<div id="browser-profiles-list"></div>
<input id="browser-profile-email" />
<select id="browser-profile-segment"><option value="individual">individual</option></select>

<!-- Network -->
<tbody id="browser-network-body"></tbody>

<!-- Console -->
<div id="browser-console-entries"></div>

<!-- DOM -->
<div id="browser-dom-content"></div>

<!-- Diagnostics -->
<div id="browser-diagnostics-result" style="display:none;"></div>

<!-- Action log -->
<div id="browser-action-history"></div>

<!-- Evaluate -->
<input id="browser-eval-input" />
<div id="browser-eval-result" style="display:none;"></div>

<!-- Click / Type inputs -->
<input id="browser-click-selector" />
<input id="browser-type-selector" />
<input id="browser-type-text" />
<input id="browser-url-input" />

<!-- Browser info -->
<span id="browser-default"></span>
</body></html>`;

const MOCK_DASHBOARD_CORE = `
export const state = { browserSessions: [], browserStorage: null, activeBrowserSessionId: '' };
export function request(url, opts) { return Promise.resolve({}); }
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export function dashboardLog() {}
export function authHeaders(extra) { return extra || {}; }
`;

/* â”€â”€ Module types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

interface TabBrowserModule {
    setBrowserView(view: string): void;
    renderBrowserSessions(sessions: any[]): void;
    renderStorageContent(data: any, subView: string): void;
    renderBrowserProfiles(profiles: any[]): void;
    populateBrowserSessionDropdowns(): void;
    browserLogAction(action: string, detail: string): void;
    browserSessionChanged(): void;
    toggleBrowserDevTools(): void;
    setStorageSubView(subView: string): void;
}

/* â”€â”€ Suite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

describe("tab-browser.js â€“ Frontend Unit Tests", function () {
    this.timeout(30_000);

    let tmpDir: string;
    let mod: TabBrowserModule;
    let dom: JSDOM;
    let mockState: Record<string, any>;
    let savedURL: unknown;
    let savedFetch: unknown;

    before(async () => {
        savedURL = (global as any).URL;
        savedFetch = (global as any).fetch;
        // Set up temp directory with mock dashboard-core.js and real tab-browser.js
        tmpDir = mkdtempSync(join(tmpdir(), "prism-tab-browser-ui-"));
        writeFileSync(join(tmpDir, "dashboard-core.js"), MOCK_DASHBOARD_CORE, "utf-8");
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-browser.js"),
            join(tmpDir, "tab-browser.js"),
        );

        // Set up jsdom environment
        dom = new JSDOM(SCAFFOLD_HTML, { url: "http://localhost" });
        (global as any).document = dom.window.document;
        (global as any).window = dom.window;
        Object.defineProperty(global, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
        (global as any).HTMLElement = dom.window.HTMLElement;
        Object.defineProperty(global, "location", { value: dom.window.location, writable: true, configurable: true });
        (global as any).URL = dom.window.URL;
        (global as any).fetch = () => Promise.reject(new Error("fetch not mocked"));

        // Import the module from the temp directory (resolves ./dashboard-core.js to our mock)
        const moduleUrl = pathToFileURL(join(tmpDir, "tab-browser.js")).href;
        mod = await import(moduleUrl) as TabBrowserModule;

        // Grab the mock state reference
        const coreUrl = pathToFileURL(join(tmpDir, "dashboard-core.js")).href;
        const core = await import(coreUrl);
        mockState = core.state;
    });

    after(() => {
        delete (global as any).document;
        delete (global as any).window;
        delete (global as any).navigator;
        delete (global as any).HTMLElement;
        delete (global as any).location;
        // Restore rather than delete: prevent leaving global.URL undefined
        if (savedURL !== undefined) {
            (global as any).URL = savedURL;
        } else {
            delete (global as any).URL;
        }
        if (savedFetch !== undefined) {
            (global as any).fetch = savedFetch;
        } else {
            delete (global as any).fetch;
        }
        rmSync(tmpDir, { recursive: true, force: true });
    });

    /** Reset the DOM between tests */
    beforeEach(() => {
        dom.window.document.body.innerHTML = new JSDOM(SCAFFOLD_HTML).window.document.body.innerHTML;
        mockState.browserSessions = [];
        mockState.browserStorage = null;
        mockState.activeBrowserSessionId = "";
    });

    /* â”€â”€ setBrowserView â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    describe("setBrowserView", () => {
        it("shows the selected panel and hides others", () => {
            mod.setBrowserView("viewport");
            const viewportPanel = dom.window.document.getElementById("browser-viewport-panel");
            const sessionsPanel = dom.window.document.getElementById("browser-sessions-panel");
            assert.notStrictEqual(viewportPanel!.style.display, "none");
            assert.strictEqual(sessionsPanel!.style.display, "none");
        });

        it("toggles active class on navigation buttons", () => {
            mod.setBrowserView("network");
            const networkBtn = dom.window.document.getElementById("bv-network");
            const sessionsBtn = dom.window.document.getElementById("bv-sessions");
            assert.ok(networkBtn!.classList.contains("active"));
            assert.ok(!sessionsBtn!.classList.contains("active"));
        });

        it("cycles through all seven views", () => {
            const views = ["sessions", "viewport", "network", "console", "dom", "storage", "profiles"];
            for (const v of views) {
                mod.setBrowserView(v);
                const panel = dom.window.document.getElementById(`browser-${v}-panel`);
                assert.notStrictEqual(panel!.style.display, "none", `${v} panel should be visible`);
                const btn = dom.window.document.getElementById(`bv-${v}`);
                assert.ok(btn!.classList.contains("active"), `bv-${v} button should be active`);
            }
        });
    });

    /* â”€â”€ renderBrowserSessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    describe("renderBrowserSessions", () => {
        it("shows placeholder when sessions is empty", () => {
            mod.renderBrowserSessions([]);
            const el = dom.window.document.getElementById("browser-sessions-list");
            assert.ok(el!.innerHTML.includes("No active browser sessions"));
        });

        it("renders session cards with session IDs", () => {
            mod.renderBrowserSessions([
                { sessionId: "s1", id: "s1", headless: true, url: "https://example.com", createdAt: new Date().toISOString() },
                { sessionId: "s2", id: "s2", headless: false, url: "", createdAt: new Date().toISOString() },
            ]);
            const el = dom.window.document.getElementById("browser-sessions-list");
            assert.ok(el!.innerHTML.includes("s1"));
            assert.ok(el!.innerHTML.includes("s2"));
            assert.ok(el!.innerHTML.includes("Headless"));
            assert.ok(el!.innerHTML.includes("Headed"));
        });

        it("displays profile badge when profileId is present", () => {
            mod.renderBrowserSessions([
                { sessionId: "s1", id: "s1", headless: true, profileId: "prof-abc" },
            ]);
            const el = dom.window.document.getElementById("browser-sessions-list");
            assert.ok(el!.innerHTML.includes("prof-abc"));
            assert.ok(el!.innerHTML.includes("Profile:"));
        });

        it("handles null/undefined gracefully", () => {
            mod.renderBrowserSessions(null as any);
            const el = dom.window.document.getElementById("browser-sessions-list");
            assert.ok(el!.innerHTML.includes("No active browser sessions"));
        });
    });

    /* â”€â”€ renderStorageContent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    describe("renderStorageContent", () => {
        it("shows placeholder when data is null", () => {
            mod.renderStorageContent(null, "cookies");
            const el = dom.window.document.getElementById("browser-storage-content");
            assert.ok(el!.innerHTML.includes("No storage data"));
        });

        it("renders cookie table from semicolon-separated string", () => {
            mod.renderStorageContent({ cookies: "foo=bar; baz=qux", local: "{}", session: "{}" }, "cookies");
            const el = dom.window.document.getElementById("browser-storage-content");
            assert.ok(el!.innerHTML.includes("foo"));
            assert.ok(el!.innerHTML.includes("bar"));
            assert.ok(el!.innerHTML.includes("baz"));
            assert.ok(el!.innerHTML.includes("qux"));
            assert.ok(el!.innerHTML.includes("<table"));
        });

        it("shows 'No cookies found' for empty cookie string", () => {
            mod.renderStorageContent({ cookies: "", local: "{}", session: "{}" }, "cookies");
            const el = dom.window.document.getElementById("browser-storage-content");
            assert.ok(el!.innerHTML.includes("No cookies found"));
        });

        it("renders localStorage entries as key-value table", () => {
            mod.renderStorageContent(
                { cookies: "", local: JSON.stringify({ theme: "dark", lang: "en" }), session: "{}" },
                "local",
            );
            const el = dom.window.document.getElementById("browser-storage-content");
            assert.ok(el!.innerHTML.includes("theme"));
            assert.ok(el!.innerHTML.includes("dark"));
            assert.ok(el!.innerHTML.includes("lang"));
        });

        it("renders sessionStorage entries", () => {
            mod.renderStorageContent(
                { cookies: "", local: "{}", session: JSON.stringify({ token: "abc123" }) },
                "session",
            );
            const el = dom.window.document.getElementById("browser-storage-content");
            assert.ok(el!.innerHTML.includes("token"));
            assert.ok(el!.innerHTML.includes("abc123"));
        });

        it("truncates long values at 200 chars", () => {
            const longVal = "x".repeat(300);
            mod.renderStorageContent(
                { cookies: "", local: JSON.stringify({ key: longVal }), session: "{}" },
                "local",
            );
            const el = dom.window.document.getElementById("browser-storage-content");
            // Should contain truncated version (200 chars + ellipsis), not the full 300
            assert.ok(!el!.innerHTML.includes("x".repeat(300)));
            assert.ok(el!.innerHTML.includes("x".repeat(200)));
        });
    });

    /* â”€â”€ renderBrowserProfiles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    describe("renderBrowserProfiles", () => {
        it("shows placeholder for empty profiles", () => {
            mod.renderBrowserProfiles([]);
            const el = dom.window.document.getElementById("browser-profiles-list");
            assert.ok(el!.innerHTML.includes("No profiles created yet"));
        });

        it("renders profile cards with display name and email", () => {
            mod.renderBrowserProfiles([
                { id: "p1", displayName: "Work Profile", prismUserEmail: "kirk@co.com", executionProfileSegment: "enterprise" },
                { id: "p2", displayName: "Personal", prismUserEmail: "me@home.com" },
            ]);
            const el = dom.window.document.getElementById("browser-profiles-list");
            assert.ok(el!.innerHTML.includes("Work Profile"));
            assert.ok(el!.innerHTML.includes("kirk@co.com"));
            assert.ok(el!.innerHTML.includes("enterprise"));
            assert.ok(el!.innerHTML.includes("Personal"));
        });

        it("includes delete button for each profile", () => {
            mod.renderBrowserProfiles([{ id: "p1", displayName: "Test" }]);
            const el = dom.window.document.getElementById("browser-profiles-list");
            assert.ok(el!.innerHTML.includes("Delete"));
            assert.ok(el!.innerHTML.includes("browserDeleteProfile"));
        });
    });

    /* â”€â”€ populateBrowserSessionDropdowns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    describe("populateBrowserSessionDropdowns", () => {
        it("shows 'No active sessions' when sessions list is empty", () => {
            mockState.browserSessions = [];
            mod.populateBrowserSessionDropdowns();
            const sel = dom.window.document.getElementById("browser-active-session") as any;
            assert.ok(sel!.innerHTML.includes("No active sessions"));
        });

        it("populates dropdown options for each session", () => {
            mockState.browserSessions = [
                { sessionId: "s1", id: "s1", headless: true, url: "https://example.com" },
                { sessionId: "s2", id: "s2", headless: false },
            ];
            mod.populateBrowserSessionDropdowns();
            const sel = dom.window.document.getElementById("browser-active-session") as any;
            const options = sel!.querySelectorAll("option");
            // "Select sessionâ€¦" + 2 sessions = 3 options
            assert.ok(options.length >= 3, `Expected at least 3 options, got ${options.length}`);
        });

        it("auto-selects the only session when there is exactly one", () => {
            mockState.browserSessions = [
                { sessionId: "only-one", id: "only-one", headless: true },
            ];
            mod.populateBrowserSessionDropdowns();
            const sel = dom.window.document.getElementById("browser-active-session") as any;
            assert.strictEqual(sel!.value, "only-one");
        });

        it("syncs all panel dropdowns", () => {
            mockState.browserSessions = [
                { sessionId: "sync-test", id: "sync-test", headless: true },
            ];
            mod.populateBrowserSessionDropdowns();
            const ids = ["browser-network-session", "browser-console-session", "browser-dom-session", "browser-storage-session"];
            for (const id of ids) {
                const sel = dom.window.document.getElementById(id) as any;
                assert.ok(sel!.querySelectorAll("option").length >= 2, `${id} should have options`);
            }
        });
    });

    /* â”€â”€ browserLogAction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    describe("browserLogAction", () => {
        it("renders action entries in the history container", () => {
            mod.browserLogAction("navigate", "https://example.com");
            const el = dom.window.document.getElementById("browser-action-history");
            assert.ok(el!.innerHTML.includes("navigate"));
            assert.ok(el!.innerHTML.includes("https://example.com"));
        });

        it("caps the log at 100 entries (renders max 30)", () => {
            for (let i = 0; i < 110; i++) {
                mod.browserLogAction("action" + i, "detail" + i);
            }
            const el = dom.window.document.getElementById("browser-action-history");
            // The rendered HTML should contain at most 30 entries
            const entryCount = (el!.innerHTML.match(/font-weight:600/g) || []).length;
            assert.ok(entryCount <= 30, `Expected <= 30 rendered entries, got ${entryCount}`);
        });
    });

    /* â”€â”€ browserSessionChanged â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    describe("browserSessionChanged", () => {
        it("syncs all panel dropdowns to the active session", () => {
            mockState.browserSessions = [
                { sessionId: "s1", id: "s1", headless: true, url: "https://test.com" },
                { sessionId: "s2", id: "s2", headless: false },
            ];
            // First populate so options exist
            mod.populateBrowserSessionDropdowns();

            // Manually set the primary dropdown
            const mainSel = dom.window.document.getElementById("browser-active-session") as any;
            mainSel!.value = "s2";

            mod.browserSessionChanged();

            assert.strictEqual(mockState.activeBrowserSessionId, "s2");
        });

        it("updates page info text with session URL", () => {
            mockState.browserSessions = [
                { sessionId: "s1", id: "s1", headless: true, url: "https://test.com" },
            ];
            mod.populateBrowserSessionDropdowns();
            const mainSel = dom.window.document.getElementById("browser-active-session") as any;
            mainSel!.value = "s1";
            mod.browserSessionChanged();
            const pageInfo = dom.window.document.getElementById("browser-page-info");
            assert.ok(pageInfo!.textContent!.includes("https://test.com"));
        });
    });

    /* â”€â”€ toggleBrowserDevTools â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    describe("toggleBrowserDevTools", () => {
        it("switches to console view on first toggle", () => {
            mod.toggleBrowserDevTools();
            const consolePanel = dom.window.document.getElementById("browser-console-panel");
            assert.notStrictEqual(consolePanel!.style.display, "none");
        });

        it("switches back to sessions view on second toggle", () => {
            // State is already open=true from the previous test,
            // so one call toggles it back to false → sessions view
            mod.toggleBrowserDevTools();
            const sessionsPanel = dom.window.document.getElementById("browser-sessions-panel");
            assert.notStrictEqual(sessionsPanel!.style.display, "none");
        });
    });
});
