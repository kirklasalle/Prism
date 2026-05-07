/**
 * Frontend Unit Tests for tab-computer.js — DOM rendering logic.
 *
 * Uses jsdom to provide a minimal browser-like environment, then loads
 * tab-computer.js with a mocked dashboard-core.js so we can test:
 *   - renderLocalSystemInfo (system info grid)
 *   - renderUsageMetrics (RAM/VRAM bars + sparklines)
 *   - renderEnvVarsList (PRISM vs system vars)
 *   - renderDeviceTree (collapsible categories)
 *   - filterDeviceTree (search filter)
 *   - drawSparkline (does not throw)
 *
 * Run: mocha dist/tests/tab-computer-ui.test.js --timeout 30000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

/* ── Global DOM scaffold ──────────────────────────────────────────────── */

const SCAFFOLD_HTML = `<!DOCTYPE html><html><body>
<!-- System info grid -->
<div id="local-system-info"></div>

<!-- Usage metrics -->
<div id="usage-metrics"></div>

<!-- Console panel -->
<input id="computer-console-input" />
<pre id="computer-console-output"></pre>

<!-- Environment variables -->
<div id="env-vars-list"></div>

<!-- Device manager -->
<div id="device-tree-container"></div>
<input id="dm-search-input" />
<span id="dm-total-badge"></span>

<!-- Policy -->
<div id="policy-status-output"></div>

<!-- Framebuffer -->
<img id="framebuffer-preview" style="display:none;" />
<video id="framebuffer-preview-video" style="display:none;"></video>
<div id="fb-placeholder"></div>
<div id="fb-meta"></div>
<div id="framebuffer-media-bar" style="display:none;"></div>
<button id="fb-mc-playpause"></button>
<button id="fb-mc-speed-half"></button>
<button id="fb-mc-speed-1x"></button>
<button id="fb-mc-speed-2x"></button>
<div id="fb-gallery-grid"></div>
<div id="fb-diagnostics-result" style="display:none;"></div>
</body></html>`;

const MOCK_DASHBOARD_CORE = `
export const state = {
  computerSystemInfo: null,
  computerUsageData: null,
  computerEnvVars: null,
  computerDevices: null,
  computerConsoleHistory: [],
  ramHistory: [],
  vramHistory: [],
};
export function request(url, opts) { return Promise.resolve({}); }
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export function dashboardLog() {}
export function safeRenderStep() {}
export function formatUptime(sec) {
  if (!sec || sec <= 0) return '—';
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  return h + 'h ' + m + 'm';
}
`;

/* ── Module types ─────────────────────────────────────────────────────── */

interface TabComputerModule {
    renderLocalSystemInfo(): void;
    renderUsageMetrics(data: any): void;
    drawSparkline(canvasId: string, history: number[], color: string): void;
    renderEnvVarsList(): void;
    renderDeviceTree(): void;
    filterDeviceTree(): void;
    pollUsage(): Promise<void>;
}

/* ── Suite ────────────────────────────────────────────────────────────── */

describe("tab-computer.js — Frontend Unit Tests", function () {
    this.timeout(30_000);

    let tmpDir: string;
    let mod: TabComputerModule;
    let dom: InstanceType<typeof JSDOM>;
    let mockState: Record<string, any>;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-tab-computer-ui-"));
        writeFileSync(join(tmpDir, "dashboard-core.js"), MOCK_DASHBOARD_CORE, "utf-8");
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-computer.js"),
            join(tmpDir, "tab-computer.js"),
        );

        dom = new JSDOM(SCAFFOLD_HTML, { url: "http://localhost" });
        (global as any).document = dom.window.document;
        (global as any).window = dom.window;
        Object.defineProperty(global, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
        (global as any).HTMLElement = dom.window.HTMLElement;
        Object.defineProperty(global, "location", { value: dom.window.location, writable: true, configurable: true });
        (global as any).URL = dom.window.URL;
        (global as any).fetch = () => Promise.reject(new Error("fetch not mocked"));
        (global as any).setInterval = dom.window.setInterval.bind(dom.window);
        (global as any).clearInterval = dom.window.clearInterval.bind(dom.window);
        (global as any).alert = () => { };

        // Stub canvas getContext for jsdom (no native canvas)
        const origGetContext = dom.window.HTMLCanvasElement.prototype.getContext;
        dom.window.HTMLCanvasElement.prototype.getContext = function (type: string) {
            if (type === "2d") {
                return {
                    clearRect() { }, beginPath() { }, moveTo() { }, lineTo() { },
                    stroke() { }, closePath() { }, fill() { },
                    strokeStyle: "", lineWidth: 0, lineJoin: "", fillStyle: "",
                } as any;
            }
            return origGetContext.call(this, type);
        };

        const moduleUrl = pathToFileURL(join(tmpDir, "tab-computer.js")).href;
        mod = await import(moduleUrl) as TabComputerModule;

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
        delete (global as any).URL;
        delete (global as any).fetch;
        delete (global as any).setInterval;
        delete (global as any).clearInterval;
        delete (global as any).alert;
        rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        dom.window.document.body.innerHTML = new JSDOM(SCAFFOLD_HTML).window.document.body.innerHTML;
        mockState.computerSystemInfo = null;
        mockState.computerUsageData = null;
        mockState.computerEnvVars = null;
        mockState.computerDevices = null;
        mockState.computerConsoleHistory = [];
        mockState.ramHistory = [];
        mockState.vramHistory = [];
    });

    /* ── renderLocalSystemInfo ────────────────────────────────────────── */

    describe("renderLocalSystemInfo", () => {
        it("renders nothing when computerSystemInfo is null", () => {
            mockState.computerSystemInfo = null;
            mod.renderLocalSystemInfo();
            const el = dom.window.document.getElementById("local-system-info");
            assert.strictEqual(el!.innerHTML, "", "should be empty when no data");
        });

        it("renders system info grid with correct fields", () => {
            mockState.computerSystemInfo = {
                os: "Windows_NT 10.0.22631",
                hostname: "PRISM-DEV",
                platform: "win32 x64",
                uptime: 86400,
                cpus: 16,
                totalMemory: 34359738368,
                freeMemory: 17179869184,
                homeDir: "C:\\Users\\dev",
                gpu: null,
            };
            mod.renderLocalSystemInfo();
            const el = dom.window.document.getElementById("local-system-info");
            const html = el!.innerHTML;
            assert.ok(html.includes("Windows_NT"), "should contain OS name");
            assert.ok(html.includes("PRISM-DEV"), "should contain hostname");
            assert.ok(html.includes("win32 x64"), "should contain platform");
            assert.ok(html.includes("16"), "should contain CPU count");
            assert.ok(html.includes("24h"), "should contain uptime");
        });

        it("renders GPU info when gpu is present", () => {
            mockState.computerSystemInfo = {
                os: "Windows_NT 10.0",
                hostname: "TEST",
                platform: "win32 x64",
                uptime: 3600,
                cpus: 8,
                totalMemory: 16 * 1024 * 1024 * 1024,
                freeMemory: 8 * 1024 * 1024 * 1024,
                homeDir: "/home/dev",
                gpu: { name: "NVIDIA RTX 4090", vramTotalMb: 24576, driverVersion: "560.35", cudaVersion: "12.6" },
            };
            mod.renderLocalSystemInfo();
            const html = dom.window.document.getElementById("local-system-info")!.innerHTML;
            assert.ok(html.includes("NVIDIA RTX 4090"), "should contain GPU name");
            assert.ok(html.includes("VRAM"), "should have VRAM label");
            assert.ok(html.includes("CUDA"), "should show CUDA version");
        });
    });

    /* ── renderUsageMetrics ───────────────────────────────────────────── */

    describe("renderUsageMetrics", () => {
        it("clears container when data is null/falsy", () => {
            mod.renderUsageMetrics(null);
            const el = dom.window.document.getElementById("usage-metrics");
            assert.strictEqual(el!.innerHTML, "", "should clear on null data");
        });

        it("renders RAM usage bar", () => {
            mod.renderUsageMetrics({
                ramTotal: 34359738368,
                ramFree: 17179869184,
                gpu: null,
            });
            const html = dom.window.document.getElementById("usage-metrics")!.innerHTML;
            assert.ok(html.includes("RAM Usage"), "should contain RAM Usage label");
            assert.ok(html.includes("50%"), "should show ~50% usage");
        });

        it("renders VRAM usage when GPU data present", () => {
            mod.renderUsageMetrics({
                ramTotal: 34359738368,
                ramFree: 17179869184,
                gpu: { vramUsedMb: 4096, vramTotalMb: 24576, gpuUtilPct: 30, memUtilPct: 17, tempC: 55 },
            });
            const html = dom.window.document.getElementById("usage-metrics")!.innerHTML;
            assert.ok(html.includes("VRAM Usage"), "should contain VRAM Usage label");
            assert.ok(html.includes("55°C"), "should show GPU temperature");
        });

        it("shows 'No GPU detected' when gpu is absent", () => {
            mod.renderUsageMetrics({ ramTotal: 100, ramFree: 50, gpu: null });
            const html = dom.window.document.getElementById("usage-metrics")!.innerHTML;
            assert.ok(html.includes("No GPU detected"), "should show no GPU message");
        });

        it("pushes to ramHistory", () => {
            const before = mockState.ramHistory.length;
            mod.renderUsageMetrics({ ramTotal: 100, ramFree: 50, gpu: null });
            assert.strictEqual(mockState.ramHistory.length, before + 1, "should push one entry to ramHistory");
        });
    });

    /* ── renderEnvVarsList ────────────────────────────────────────────── */

    describe("renderEnvVarsList", () => {
        it("does nothing when computerEnvVars is null", () => {
            mockState.computerEnvVars = null;
            mod.renderEnvVarsList();
            const el = dom.window.document.getElementById("env-vars-list");
            assert.strictEqual(el!.innerHTML, "", "should remain empty");
        });

        it("renders PRISM variables section", () => {
            mockState.computerEnvVars = {
                prismVars: [{ key: "PRISM_ENV", value: "test" }, { key: "PRISM_PORT", value: "3000" }],
                systemVars: [{ key: "PATH", value: "/usr/bin" }],
            };
            mod.renderEnvVarsList();
            const html = dom.window.document.getElementById("env-vars-list")!.innerHTML;
            assert.ok(html.includes("PRISM Variables"), "should contain PRISM Variables header");
            assert.ok(html.includes("PRISM_ENV"), "should contain PRISM_ENV");
            assert.ok(html.includes("PRISM_PORT"), "should contain PRISM_PORT");
        });

        it("renders system variables section", () => {
            mockState.computerEnvVars = {
                prismVars: [],
                systemVars: [{ key: "PATH", value: "/usr/bin" }, { key: "HOME", value: "/home/user" }],
            };
            mod.renderEnvVarsList();
            const html = dom.window.document.getElementById("env-vars-list")!.innerHTML;
            assert.ok(html.includes("System Variables"), "should contain System Variables header");
            assert.ok(html.includes("PATH"), "should contain PATH");
        });

        it("truncates system vars to 50 entries", () => {
            const systemVars = [];
            for (let i = 0; i < 60; i++) {
                systemVars.push({ key: `VAR_${String(i).padStart(3, "0")}`, value: `value${i}` });
            }
            mockState.computerEnvVars = { prismVars: [], systemVars };
            mod.renderEnvVarsList();
            const html = dom.window.document.getElementById("env-vars-list")!.innerHTML;
            assert.ok(html.includes("and 10 more"), "should show truncation message");
        });
    });

    /* ── renderDeviceTree ─────────────────────────────────────────────── */

    describe("renderDeviceTree", () => {
        it("shows placeholder when no device data", () => {
            mockState.computerDevices = null;
            mod.renderDeviceTree();
            const el = dom.window.document.getElementById("device-tree-container");
            assert.strictEqual(el!.innerHTML, "", "should remain empty when no data");
        });

        it("renders device categories", () => {
            mockState.computerDevices = {
                devices: {
                    "Processors": [{ name: "Intel Core i9-14900K", status: "OK" }],
                    "Memory": [{ name: "16 GB DDR5", status: "OK" }, { name: "16 GB DDR5", status: "OK" }],
                },
            };
            mod.renderDeviceTree();
            const html = dom.window.document.getElementById("device-tree-container")!.innerHTML;
            assert.ok(html.includes("Processors"), "should contain Processors category");
            assert.ok(html.includes("Memory"), "should contain Memory category");
            assert.ok(html.includes("Intel Core i9-14900K"), "should contain device name");
            assert.ok(html.includes("(2)"), "should show device count for Memory");
        });

        it("shows WMI fallback notice when present", () => {
            mockState.computerDevices = {
                devices: { "Processors": [{ name: "CPU", status: "OK" }] },
                fallback: true,
            };
            mod.renderDeviceTree();
            const html = dom.window.document.getElementById("device-tree-container")!.innerHTML;
            assert.ok(html.includes("WMI scan unavailable"), "should show fallback notice");
        });

        it("updates total badge", () => {
            mockState.computerDevices = {
                devices: {
                    "Processors": [{ name: "CPU", status: "OK" }],
                    "Memory": [{ name: "RAM", status: "OK" }],
                },
            };
            mod.renderDeviceTree();
            const badge = dom.window.document.getElementById("dm-total-badge");
            assert.ok(badge!.textContent!.includes("2 device"), "badge should show device count");
        });
    });

    /* ── filterDeviceTree ─────────────────────────────────────────────── */

    describe("filterDeviceTree", () => {
        it("filters devices by search query", () => {
            mockState.computerDevices = {
                devices: {
                    "Processors": [{ name: "Intel Core i9", status: "OK" }],
                    "Display Adapters": [{ name: "NVIDIA RTX 4090", status: "OK" }],
                },
            };
            // Set search to "nvidia"
            const searchInput = dom.window.document.getElementById("dm-search-input") as any;
            if (searchInput) searchInput.value = "nvidia";
            mod.filterDeviceTree();
            const html = dom.window.document.getElementById("device-tree-container")!.innerHTML;
            assert.ok(html.includes("NVIDIA RTX 4090"), "should show matching device");
            assert.ok(!html.includes("Intel Core i9"), "should hide non-matching device");
        });
    });

    /* ── drawSparkline ────────────────────────────────────────────────── */

    describe("drawSparkline", () => {
        it("does not throw with missing canvas", () => {
            assert.doesNotThrow(() => {
                mod.drawSparkline("nonexistent-canvas", [10, 20, 30], "#69d2ff");
            });
        });

        it("does not throw with empty history", () => {
            assert.doesNotThrow(() => {
                mod.drawSparkline("sparkline-ram", [], "#69d2ff");
            });
        });
    });
});
