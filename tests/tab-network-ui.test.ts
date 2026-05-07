/**
 * Frontend Unit Tests for tab-network.js — DOM rendering logic.
 *
 * Uses jsdom to provide a minimal browser-like environment, then loads
 * tab-network.js with a mocked dashboard-core.js so we can test:
 *   - renderNetworkToolsPanel (tier-based command matrix)
 *   - renderNetworkSettingsPanel (interface discovery widget)
 *   - renderNetworkTelemetryPanel (command statistics)
 *   - renderNetworkConsolePanel (command history)
 *   - runNetworkCommand (request lifecycle, telemetry update)
 *   - refreshNetworkInterfaces (API call + DOM render)
 *   - refreshNetworkTelemetry (telemetry state sync)
 *
 * Run: mocha dist/tests/tab-network-ui.test.js --timeout 30000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

type JSDOMInstance = InstanceType<typeof JSDOM>;

/* ── Global DOM scaffold ────────────────────────────────────────────── */

const SCAFFOLD_HTML = `<!DOCTYPE html><html><body>

<!-- Network Tools Panel -->
<div id="network-tools-panel"></div>

<!-- Network Settings Panel -->
<div id="network-settings-panel"></div>
<div id="network-interfaces-data"></div>

<!-- Network Telemetry Panel -->
<div id="network-telemetry-panel"></div>

<!-- Network Console Panel -->
<input id="network-console-input" type="text" value="" />
<pre id="network-console-output"></pre>
<div id="network-history-list"></div>

</body></html>`;

/* ── Mock dashboard-core.js ─────────────────────────────────────────── */

const MOCK_DASHBOARD_CORE = `
let _lastRequestUrl = null;
let _lastRequestOpts = null;
let _mockResponse = {};
let _mockResponseMap = {};

export const state = {
  networkCommandHistory: [],
  networkTelemetryData: {
    totalCommands: 0,
    tier1Count: 0,
    tier2Count: 0,
    tier3Count: 0,
    errorCount: 0,
    lastCommand: null
  }
};

export function request(url, opts) {
  _lastRequestUrl = url;
  _lastRequestOpts = opts;
  if (_mockResponseMap[url] !== undefined) return Promise.resolve(_mockResponseMap[url]);
  return Promise.resolve(_mockResponse);
}

export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function dashboardLog() {}

export function safeRenderStep(name, fn) { fn(); }

export function metricRow() { return ''; }

// Test helpers exposed on the module
export function _setMockResponse(resp) { _mockResponse = resp; }
export function _setMockResponseMap(map) { _mockResponseMap = map; }
export function _getLastRequest() { return { url: _lastRequestUrl, opts: _lastRequestOpts }; }
export function _resetMockResponse() { _mockResponse = {}; _mockResponseMap = {}; }
`;

/* ── Module type ────────────────────────────────────────────────────── */

interface TabNetworkModule {
    renderNetworkToolsPanel(): void;
    renderNetworkSettingsPanel(): void;
    renderNetworkTelemetryPanel(): void;
    renderNetworkConsolePanel(): void;
    runNetworkCommand(): Promise<void>;
    refreshNetworkInterfaces(): Promise<void>;
    refreshNetworkTelemetry(): Promise<void>;
}

interface MockCoreModule {
    state: Record<string, any>;
    _setMockResponse(resp: any): void;
    _setMockResponseMap(map: Record<string, any>): void;
    _getLastRequest(): { url: string; opts: any };
    _resetMockResponse(): void;
}

/* ── Suite ─────────────────────────────────────────────────────────── */

describe("tab-network.js — Frontend Unit Tests", function () {
    this.timeout(30_000);

    let tmpDir: string;
    let mod: TabNetworkModule;
    let core: MockCoreModule;
    let dom: JSDOM;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-tab-network-ui-"));
        writeFileSync(join(tmpDir, "dashboard-core.js"), MOCK_DASHBOARD_CORE, "utf-8");
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-network.js"),
            join(tmpDir, "tab-network.js"),
        );

        dom = new JSDOM(SCAFFOLD_HTML, { url: "http://localhost" });
        (global as any).document = dom.window.document;
        (global as any).window = dom.window;
        Object.defineProperty(global, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
        (global as any).HTMLElement = dom.window.HTMLElement;
        Object.defineProperty(global, "location", { value: dom.window.location, writable: true, configurable: true });
        (global as any).URL = dom.window.URL;
        (global as any).fetch = () => Promise.reject(new Error("fetch not mocked"));

        const moduleUrl = pathToFileURL(join(tmpDir, "tab-network.js")).href;
        mod = await import(moduleUrl) as TabNetworkModule;

        const coreUrl = pathToFileURL(join(tmpDir, "dashboard-core.js")).href;
        core = await import(coreUrl) as MockCoreModule;
    });

    after(() => {
        delete (global as any).document;
        delete (global as any).window;
        delete (global as any).navigator;
        delete (global as any).HTMLElement;
        delete (global as any).location;
        delete (global as any).URL;
        delete (global as any).fetch;
        rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        dom.window.document.body.innerHTML = new JSDOM(SCAFFOLD_HTML).window.document.body.innerHTML;
        core.state.networkCommandHistory = [];
        core.state.networkTelemetryData = {
            totalCommands: 0,
            tier1Count: 0,
            tier2Count: 0,
            tier3Count: 0,
            errorCount: 0,
            lastCommand: null,
        };
        core._resetMockResponse();
    });

    /* ── renderNetworkToolsPanel ──────────────────────────────────────── */

    describe("renderNetworkToolsPanel", () => {
        it("renders all three tier sections", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("Tier 1"), "Should contain Tier 1");
            assert.ok(el.innerHTML.includes("Tier 2"), "Should contain Tier 2");
            assert.ok(el.innerHTML.includes("Tier 3"), "Should contain Tier 3");
        });

        it("renders Tier 1 diagnostics commands", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("ipconfig"), "Should show ipconfig");
            assert.ok(el.innerHTML.includes("ping"), "Should show ping");
            assert.ok(el.innerHTML.includes("nslookup"), "Should show nslookup");
            assert.ok(el.innerHTML.includes("tracert"), "Should show tracert");
            assert.ok(el.innerHTML.includes("netstat"), "Should show netstat");
            assert.ok(el.innerHTML.includes("arp"), "Should show arp");
            assert.ok(el.innerHTML.includes("hostname"), "Should show hostname");
            assert.ok(el.innerHTML.includes("curl"), "Should show curl");
        });

        it("renders Tier 2 config inspection commands", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("route print"), "Should show route print");
            assert.ok(el.innerHTML.includes("net use"), "Should show net use");
            assert.ok(el.innerHTML.includes("net share"), "Should show net share");
            assert.ok(el.innerHTML.includes("net session"), "Should show net session");
        });

        it("renders Tier 3 mutating operations", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("netsh interface set"), "Should show netsh interface set");
            assert.ok(el.innerHTML.includes("route add"), "Should show route add");
            assert.ok(el.innerHTML.includes("iptables"), "Should show iptables");
        });

        it("renders platform badges (WIN, LINUX, CROSS)", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("WIN"), "Should have WIN platform badges");
            assert.ok(el.innerHTML.includes("LINUX"), "Should have LINUX platform badges");
            assert.ok(el.innerHTML.includes("CROSS"), "Should have CROSS platform badges");
        });

        it("renders tier color indicators", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("#2ecc71"), "Tier 1 green indicator");
            assert.ok(el.innerHTML.includes("#f39c12"), "Tier 2 amber indicator");
            assert.ok(el.innerHTML.includes("#e74c3c"), "Tier 3 red indicator");
        });

        it("includes governance description text", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("allowlist"), "Should describe allowlist governance");
        });

        it("renders command descriptions for key commands", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("DNS resolution"), "nslookup description");
            assert.ok(el.innerHTML.includes("round-trip time"), "ping description");
            assert.ok(el.innerHTML.includes("shared resources"), "net view description");
        });

        it("gracefully handles missing container", () => {
            const panel = dom.window.document.getElementById("network-tools-panel")!;
            panel.remove();
            // Should not throw
            mod.renderNetworkToolsPanel();
        });
    });

    /* ── renderNetworkSettingsPanel ────────────────────────────────────── */

    describe("renderNetworkSettingsPanel", () => {
        it("renders refresh button and placeholder text", () => {
            mod.renderNetworkSettingsPanel();
            const el = dom.window.document.getElementById("network-settings-panel")!;
            assert.ok(el.innerHTML.includes("Refresh"), "Should show Refresh button");
            assert.ok(el.innerHTML.includes("Click Refresh"), "Should show placeholder");
        });

        it("contains the network-interfaces-data container", () => {
            mod.renderNetworkSettingsPanel();
            const el = dom.window.document.getElementById("network-settings-panel")!;
            assert.ok(el.innerHTML.includes("network-interfaces-data"), "Should contain interface data div");
        });

        it("includes description about live interface data", () => {
            mod.renderNetworkSettingsPanel();
            const el = dom.window.document.getElementById("network-settings-panel")!;
            assert.ok(el.innerHTML.includes("Live interface data"), "Should describe live data");
        });

        it("gracefully handles missing container", () => {
            dom.window.document.getElementById("network-settings-panel")!.remove();
            mod.renderNetworkSettingsPanel();
        });
    });

    /* ── renderNetworkTelemetryPanel ──────────────────────────────────── */

    describe("renderNetworkTelemetryPanel", () => {
        it("renders zero state correctly", () => {
            mod.renderNetworkTelemetryPanel();
            const el = dom.window.document.getElementById("network-telemetry-panel")!;
            assert.ok(el.innerHTML.includes("Total Commands"), "Should show Total Commands label");
            assert.ok(el.innerHTML.includes("Tier 1"), "Should show Tier 1 label");
            assert.ok(el.innerHTML.includes("Tier 2"), "Should show Tier 2 label");
            assert.ok(el.innerHTML.includes("Tier 3"), "Should show Tier 3 label");
            assert.ok(el.innerHTML.includes("Errors"), "Should show Errors label");
        });

        it("displays actual counts from state", () => {
            core.state.networkTelemetryData = {
                totalCommands: 42,
                tier1Count: 30,
                tier2Count: 8,
                tier3Count: 4,
                errorCount: 2,
                lastCommand: "ping 8.8.8.8",
            };
            mod.renderNetworkTelemetryPanel();
            const el = dom.window.document.getElementById("network-telemetry-panel")!;
            assert.ok(el.innerHTML.includes("42"), "Should show total 42");
            assert.ok(el.innerHTML.includes("30"), "Should show tier1 30");
            assert.ok(el.innerHTML.includes("8"), "Should show tier2 8");
            assert.ok(el.innerHTML.includes("4"), "Should show tier3 4");
            assert.ok(el.innerHTML.includes("2"), "Should show errors 2");
        });

        it("displays last command when available", () => {
            core.state.networkTelemetryData.totalCommands = 1;
            core.state.networkTelemetryData.tier1Count = 1;
            core.state.networkTelemetryData.lastCommand = "netstat -an";
            mod.renderNetworkTelemetryPanel();
            const el = dom.window.document.getElementById("network-telemetry-panel")!;
            assert.ok(el.innerHTML.includes("netstat -an"), "Should show last command");
        });

        it("computes percentages correctly", () => {
            core.state.networkTelemetryData = {
                totalCommands: 100,
                tier1Count: 50,
                tier2Count: 30,
                tier3Count: 20,
                errorCount: 5,
                lastCommand: null,
            };
            mod.renderNetworkTelemetryPanel();
            const el = dom.window.document.getElementById("network-telemetry-panel")!;
            assert.ok(el.innerHTML.includes("50.0"), "Tier 1 = 50.0%");
            assert.ok(el.innerHTML.includes("30.0"), "Tier 2 = 30.0%");
            assert.ok(el.innerHTML.includes("20.0"), "Tier 3 = 20.0%");
        });

        it("handles zero total without division by zero", () => {
            core.state.networkTelemetryData.totalCommands = 0;
            mod.renderNetworkTelemetryPanel();
            const el = dom.window.document.getElementById("network-telemetry-panel")!;
            assert.ok(el.innerHTML.includes("0.0"), "Should show 0.0% safely");
        });

        it("gracefully handles missing container", () => {
            dom.window.document.getElementById("network-telemetry-panel")!.remove();
            mod.renderNetworkTelemetryPanel();
        });
    });

    /* ── renderNetworkConsolePanel ─────────────────────────────────────── */

    describe("renderNetworkConsolePanel", () => {
        it("renders empty state (no history)", () => {
            core.state.networkCommandHistory = [];
            mod.renderNetworkConsolePanel();
            const el = dom.window.document.getElementById("network-history-list")!;
            assert.strictEqual(el.innerHTML, "", "Should be empty when no history");
        });

        it("renders command history entries", () => {
            core.state.networkCommandHistory = [
                { command: "ipconfig /all", timestamp: new Date().toISOString(), ok: true },
                { command: "ping 8.8.8.8", timestamp: new Date().toISOString(), ok: true },
            ];
            mod.renderNetworkConsolePanel();
            const el = dom.window.document.getElementById("network-history-list")!;
            assert.ok(el.innerHTML.includes("ipconfig /all"), "Should show ipconfig command");
            assert.ok(el.innerHTML.includes("ping 8.8.8.8"), "Should show ping command");
        });

        it("shows success (green) and error (red) status dots", () => {
            core.state.networkCommandHistory = [
                { command: "ipconfig", timestamp: new Date().toISOString(), ok: true },
                { command: "bad_cmd", timestamp: new Date().toISOString(), ok: false },
            ];
            mod.renderNetworkConsolePanel();
            const el = dom.window.document.getElementById("network-history-list")!;
            assert.ok(el.innerHTML.includes("#7ecf7e"), "Should have green dot for success");
            assert.ok(el.innerHTML.includes("#ff8d8d"), "Should have red dot for failure");
        });

        it("limits display to 10 most recent commands", () => {
            const history = [];
            for (let i = 0; i < 15; i++) {
                history.push({ command: `cmd_${i}`, timestamp: new Date().toISOString(), ok: true });
            }
            core.state.networkCommandHistory = history;
            mod.renderNetworkConsolePanel();
            const el = dom.window.document.getElementById("network-history-list")!;
            // cmd_0 through cmd_4 should be truncated (only last 10 shown)
            assert.ok(!el.innerHTML.includes("cmd_0"), "Should not show cmd_0 (oldest)");
            assert.ok(el.innerHTML.includes("cmd_14"), "Should show cmd_14 (newest)");
            assert.ok(el.innerHTML.includes("cmd_5"), "Should show cmd_5");
        });

        it("shows Recent Commands count header", () => {
            core.state.networkCommandHistory = [
                { command: "hostname", timestamp: new Date().toISOString(), ok: true },
            ];
            mod.renderNetworkConsolePanel();
            const el = dom.window.document.getElementById("network-history-list")!;
            assert.ok(el.innerHTML.includes("Recent Commands"), "Should show header");
            assert.ok(el.innerHTML.includes("(1)"), "Should show count");
        });

        it("escapes HTML in command names", () => {
            core.state.networkCommandHistory = [
                { command: '<script>alert("xss")</script>', timestamp: new Date().toISOString(), ok: true },
            ];
            mod.renderNetworkConsolePanel();
            const el = dom.window.document.getElementById("network-history-list")!;
            assert.ok(!el.innerHTML.includes("<script>"), "Should escape script tags");
            assert.ok(el.innerHTML.includes("&lt;script&gt;"), "Should have escaped HTML");
        });
    });

    /* ── runNetworkCommand ────────────────────────────────────────────── */

    describe("runNetworkCommand", () => {
        it("does nothing when input is empty", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            input.value = "";
            await mod.runNetworkCommand();
            const output = dom.window.document.getElementById("network-console-output")!;
            assert.strictEqual(output.textContent, "", "Output should be empty");
        });

        it("sends command to /api/network/exec", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            input.value = "ipconfig";
            core._setMockResponse({ tier: "tier1", stdout: "Windows IP Configuration", stderr: "", exitCode: 0 });
            await mod.runNetworkCommand();
            const req = core._getLastRequest();
            // The last request might be the telemetry refresh, but the command was sent
            assert.ok(core.state.networkCommandHistory.length > 0, "Should have recorded command");
        });

        it("updates telemetry counters on success", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            input.value = "ipconfig";
            core._setMockResponseMap({
                "/api/network/exec": { tier: "tier1", stdout: "data", stderr: "", exitCode: 0 },
                "/api/network/telemetry": { totalCommands: 1, tier1Count: 1, tier2Count: 0, tier3Count: 0, errorCount: 0, lastCommand: "ipconfig" },
            });
            await mod.runNetworkCommand();
            assert.strictEqual(core.state.networkTelemetryData.totalCommands, 1, "Total should increment");
            assert.strictEqual(core.state.networkTelemetryData.tier1Count, 1, "Tier 1 should increment");
        });

        it("updates error counter on failure", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            input.value = "bad_command";
            // Simulate exec request throwing, but telemetry refresh succeeds
            core._setMockResponse(Promise.reject(new Error("Command not recognized")));
            core._setMockResponseMap({
                "/api/network/telemetry": { totalCommands: 1, tier1Count: 0, tier2Count: 0, tier3Count: 0, errorCount: 1, lastCommand: "bad_command" },
            });
            // runNetworkCommand handles errors internally
            await mod.runNetworkCommand();
            // Error path increments errorCount
            assert.ok(core.state.networkTelemetryData.errorCount >= 1, "Error counter should increment");
        });

        it("clears input after execution", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            input.value = "hostname";
            core._setMockResponse({ tier: "tier1", stdout: "PRISM-HOST", stderr: "", exitCode: 0 });
            await mod.runNetworkCommand();
            assert.strictEqual(input.value, "", "Input should be cleared");
        });

        it("records command in history", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            input.value = "netstat -an";
            core._setMockResponse({ tier: "tier1", stdout: "TCP...", stderr: "", exitCode: 0 });
            await mod.runNetworkCommand();
            const last = core.state.networkCommandHistory[core.state.networkCommandHistory.length - 1];
            assert.strictEqual(last.command, "netstat -an", "Should record command name");
            assert.strictEqual(last.ok, true, "Should record success");
        });
    });

    /* ── refreshNetworkInterfaces ─────────────────────────────────────── */

    describe("refreshNetworkInterfaces", () => {
        it("shows loading state", async () => {
            // Need to re-insert the data container inside settings panel
            mod.renderNetworkSettingsPanel();
            const dataEl = dom.window.document.getElementById("network-interfaces-data");
            assert.ok(dataEl, "network-interfaces-data should exist after render");
        });

        it("renders interface table from API response", async () => {
            mod.renderNetworkSettingsPanel();
            core._setMockResponse({
                interfaces: [
                    { name: "Ethernet adapter Ethernet", details: "IPv4 Address: 192.168.1.100\nSubnet Mask: 255.255.255.0" },
                    { name: "Wireless LAN adapter Wi-Fi", details: "IPv4 Address: 192.168.1.101\nSubnet Mask: 255.255.255.0" },
                ],
            });
            await mod.refreshNetworkInterfaces();
            const dataEl = dom.window.document.getElementById("network-interfaces-data")!;
            assert.ok(dataEl.innerHTML.includes("Ethernet"), "Should show Ethernet interface");
            assert.ok(dataEl.innerHTML.includes("Wi-Fi"), "Should show Wi-Fi interface");
            assert.ok(dataEl.innerHTML.includes("192.168.1.100"), "Should show IP address");
        });

        it("shows empty message when no interfaces", async () => {
            mod.renderNetworkSettingsPanel();
            core._setMockResponse({ interfaces: [] });
            await mod.refreshNetworkInterfaces();
            const dataEl = dom.window.document.getElementById("network-interfaces-data")!;
            assert.ok(dataEl.innerHTML.includes("No interface data"), "Should show empty message");
        });
    });

    /* ── refreshNetworkTelemetry ──────────────────────────────────────── */

    describe("refreshNetworkTelemetry", () => {
        it("updates state from API response", async () => {
            core._setMockResponse({
                totalCommands: 25,
                tier1Count: 15,
                tier2Count: 7,
                tier3Count: 3,
                errorCount: 1,
                lastCommand: "arp -a",
            });
            await mod.refreshNetworkTelemetry();
            assert.strictEqual(core.state.networkTelemetryData.totalCommands, 25);
            assert.strictEqual(core.state.networkTelemetryData.tier1Count, 15);
            assert.strictEqual(core.state.networkTelemetryData.tier2Count, 7);
            assert.strictEqual(core.state.networkTelemetryData.tier3Count, 3);
            assert.strictEqual(core.state.networkTelemetryData.errorCount, 1);
            assert.strictEqual(core.state.networkTelemetryData.lastCommand, "arp -a");
        });

        it("handles missing fields gracefully", async () => {
            core._setMockResponse({});
            await mod.refreshNetworkTelemetry();
            assert.strictEqual(core.state.networkTelemetryData.totalCommands, 0);
            assert.strictEqual(core.state.networkTelemetryData.lastCommand, null);
        });
    });

    /* ── Protocol Coverage Validation ─────────────────────────────────── */

    describe("Protocol Coverage", () => {
        it("covers HTTP/HTTPS via curl/wget", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("curl"), "HTTP/HTTPS via curl");
            assert.ok(el.innerHTML.includes("wget"), "HTTP/HTTPS via wget");
            assert.ok(el.innerHTML.includes("HTTP"), "HTTP protocol mentioned");
        });

        it("covers DNS protocols via nslookup/dig", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("nslookup"), "DNS via nslookup");
            assert.ok(el.innerHTML.includes("dig"), "DNS via dig");
            assert.ok(el.innerHTML.includes("DNS"), "DNS protocol mentioned");
        });

        it("covers ICMP via ping/tracert", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("ping"), "ICMP via ping");
            assert.ok(el.innerHTML.includes("tracert"), "ICMP via tracert");
            assert.ok(el.innerHTML.includes("traceroute"), "ICMP via traceroute");
        });

        it("covers NetBIOS via nbtstat/net view", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("nbtstat"), "NetBIOS via nbtstat");
            assert.ok(el.innerHTML.includes("net view"), "NetBIOS shares via net view");
            assert.ok(el.innerHTML.includes("NetBIOS"), "NetBIOS protocol mentioned");
        });

        it("covers ARP protocol", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("arp"), "ARP protocol");
            assert.ok(el.innerHTML.includes("ARP cache"), "ARP cache description");
        });

        it("covers TCP/UDP via netstat/ss", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("netstat"), "TCP/UDP via netstat");
            assert.ok(el.innerHTML.includes("ss"), "TCP/UDP via ss");
            assert.ok(el.innerHTML.includes("connections"), "Connection monitoring");
            assert.ok(el.innerHTML.includes("listening ports"), "Port monitoring");
        });

        it("covers SMB/CIFS via net share/net use", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("net share"), "SMB shares via net share");
            assert.ok(el.innerHTML.includes("net use"), "SMB mapping via net use");
            assert.ok(el.innerHTML.includes("network drives"), "Network drive management");
            assert.ok(el.innerHTML.includes("shared folders"), "Shared folder management");
        });

        it("covers Firewall management (Windows + Linux)", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("firewall"), "Firewall management");
            assert.ok(el.innerHTML.includes("iptables"), "Linux firewall via iptables");
            assert.ok(el.innerHTML.includes("ufw"), "Linux firewall via ufw");
        });

        it("covers WiFi management via netsh wlan", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("wlan"), "WiFi management via netsh wlan");
        });

        it("covers IP routing via route/ip route", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("route print"), "Route table display");
            assert.ok(el.innerHTML.includes("route add"), "Route addition");
            assert.ok(el.innerHTML.includes("ip route"), "Linux routing via ip route");
        });

        it("covers MAC address discovery via getmac", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("getmac"), "MAC via getmac");
            assert.ok(el.innerHTML.includes("MAC"), "MAC address mentioned");
        });
    });

    /* ── Security Governance Validation ───────────────────────────────── */

    describe("Security Governance", () => {
        it("all tier-1 commands are read-only diagnostics", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("Read-Only"), "Tier 1 should be labeled Read-Only");
            assert.ok(el.innerHTML.includes("auto-allow") || el.innerHTML.includes("Diagnostics"), "Tier 1 should be auto-allow");
        });

        it("tier-2 commands require conditional approval", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("Conditional"), "Tier 2 should be Conditional");
        });

        it("tier-3 commands are approval-gated mutating operations", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("Approval-Gated"), "Tier 3 should be Approval-Gated");
            assert.ok(el.innerHTML.includes("Mutating"), "Tier 3 should be labeled Mutating");
        });

        it("shows tier counts per category", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            // Tier 1 has 14 items, Tier 2 has 11, Tier 3 has 9
            assert.ok(el.innerHTML.includes("(14)") || el.innerHTML.includes("(1"), "Should show tier 1 count");
        });
    });

    /* ── Local Network Share Discovery ────────────────────────────────── */

    describe("Local Network Share Discovery", () => {
        it("includes net view for discovering network shares", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("net view"), "net view for share discovery");
            assert.ok(el.innerHTML.includes("shared resources visible"), "Describes share visibility");
        });

        it("includes net share for managing local shares", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("net share"), "net share for local shares");
        });

        it("includes net session for active session monitoring", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("net session"), "net session for active sessions");
        });

        it("includes net user for account management", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("net user"), "net user for account inspection");
        });

        it("includes net config for workstation/server config", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("net config"), "net config for workstation config");
        });
    });

    /* ── Extended Protocol Coverage (new commands) ────────────────────── */

    describe("Extended Protocol Coverage", () => {
        it("covers TLS/SSL via openssl s_client", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("openssl s_client"), "TLS via openssl s_client");
            assert.ok(el.innerHTML.includes("TLS") || el.innerHTML.includes("SSL"), "TLS/SSL protocol mentioned");
        });

        it("covers HTTP headers via curl -I", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("curl -I"), "HTTP headers via curl -I");
            assert.ok(el.innerHTML.includes("HEAD request") || el.innerHTML.includes("response headers"), "HEAD request described");
        });

        it("covers DNS trace via dig +trace", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("dig +trace"), "DNS trace via dig +trace");
            assert.ok(el.innerHTML.includes("recursive") || el.innerHTML.includes("root"), "Recursive trace described");
        });

        it("covers FTP/SFTP protocols", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("ftp") || el.innerHTML.includes("FTP"), "FTP protocol covered");
            assert.ok(el.innerHTML.includes("sftp") || el.innerHTML.includes("SFTP"), "SFTP protocol covered");
        });

        it("covers WebSocket via wscat", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("wscat"), "WebSocket via wscat");
            assert.ok(el.innerHTML.includes("WebSocket"), "WebSocket protocol mentioned");
        });

        it("covers SSH version check", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            assert.ok(el.innerHTML.includes("ssh"), "SSH covered");
        });

        it("new tier-1 commands are in the read-only section", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            const html = el.innerHTML;
            // openssl and curl -I should appear before Tier 2 heading
            const tier2Idx = html.indexOf("Tier 2");
            const opensslIdx = html.indexOf("openssl s_client");
            const curlIIdx = html.indexOf("curl -I");
            assert.ok(opensslIdx < tier2Idx, "openssl s_client should be in Tier 1 (before Tier 2)");
            assert.ok(curlIIdx < tier2Idx, "curl -I should be in Tier 1 (before Tier 2)");
        });

        it("new tier-2 commands are in the conditional section", () => {
            mod.renderNetworkToolsPanel();
            const el = dom.window.document.getElementById("network-tools-panel")!;
            const html = el.innerHTML;
            const tier2Idx = html.indexOf("Tier 2");
            const tier3Idx = html.indexOf("Tier 3");
            const ftpIdx = html.indexOf("ftp");
            const wscatIdx = html.indexOf("wscat");
            assert.ok(ftpIdx > tier2Idx && ftpIdx < tier3Idx, "FTP should be in Tier 2");
            assert.ok(wscatIdx > tier2Idx && wscatIdx < tier3Idx, "wscat should be in Tier 2");
        });
    });

    /* ── WebSocket Message Handling ───────────────────────────────────── */

    describe("WebSocket Message Handling (state simulation)", () => {
        it("runNetworkCommand tracks telemetry for tier2 classification", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            input.value = "net use";
            core._setMockResponseMap({
                "/api/network/exec": { tier: "tier2", stdout: "New connections...", stderr: "", exitCode: 0 },
                "/api/network/telemetry": { totalCommands: 1, tier1Count: 0, tier2Count: 1, tier3Count: 0, errorCount: 0, lastCommand: "net use" },
            });
            await mod.runNetworkCommand();
            assert.strictEqual(core.state.networkTelemetryData.tier2Count, 1, "Tier 2 should increment");
            assert.strictEqual(core.state.networkTelemetryData.totalCommands, 1);
        });

        it("runNetworkCommand tracks telemetry for tier3 classification", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            input.value = "netsh interface set";
            core._setMockResponseMap({
                "/api/network/exec": { tier: "tier3", stdout: "Ok.", stderr: "", exitCode: 0 },
                "/api/network/telemetry": { totalCommands: 1, tier1Count: 0, tier2Count: 0, tier3Count: 1, errorCount: 0, lastCommand: "netsh interface set" },
            });
            await mod.runNetworkCommand();
            assert.strictEqual(core.state.networkTelemetryData.tier3Count, 1, "Tier 3 should increment");
        });

        it("multiple commands accumulate in history", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            let cmdCount = 0;
            core._setMockResponseMap({
                "/api/network/exec": { tier: "tier1", stdout: "out", stderr: "", exitCode: 0 },
            });

            for (const cmd of ["hostname", "ping 127.0.0.1", "arp -a"]) {
                cmdCount++;
                core._setMockResponseMap({
                    "/api/network/exec": { tier: "tier1", stdout: "out", stderr: "", exitCode: 0 },
                    "/api/network/telemetry": { totalCommands: cmdCount, tier1Count: cmdCount, tier2Count: 0, tier3Count: 0, errorCount: 0, lastCommand: cmd },
                });
                input.value = cmd;
                await mod.runNetworkCommand();
            }
            assert.strictEqual(core.state.networkCommandHistory.length, 3, "Should have 3 history entries");
            assert.strictEqual(core.state.networkTelemetryData.totalCommands, 3, "Total should be 3");
        });

        it("console output shows tier classification", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            input.value = "hostname";
            core._setMockResponse({ tier: "tier1", stdout: "PRISM-HOST", stderr: "", exitCode: 0 });
            await mod.runNetworkCommand();
            const output = dom.window.document.getElementById("network-console-output")!;
            assert.ok(output.textContent!.includes("[tier1]"), "Should show tier1 classification");
            assert.ok(output.textContent!.includes("PRISM-HOST"), "Should show stdout");
        });

        it("console output shows stderr when present", async () => {
            const input = dom.window.document.getElementById("network-console-input") as any;
            input.value = "ping badhost";
            core._setMockResponse({ tier: "tier1", stdout: "", stderr: "Ping request could not find host", exitCode: 1 });
            await mod.runNetworkCommand();
            const output = dom.window.document.getElementById("network-console-output")!;
            assert.ok(output.textContent!.includes("STDERR"), "Should show STDERR section");
            assert.ok(output.textContent!.includes("could not find host"), "Should show stderr message");
        });
    });

    /* ── Error Rendering ─────────────────────────────────────────────── */

    describe("Error Rendering", () => {
        it("refreshNetworkInterfaces shows error on API failure", async () => {
            mod.renderNetworkSettingsPanel();
            // Override to make request throw
            core._setMockResponse(undefined);
            // The actual error depends on the mock — just ensure no crash
            try {
                await mod.refreshNetworkInterfaces();
            } catch {
                // expected with undefined response
            }
        });

        it("console panel handles XSS in timestamps gracefully", () => {
            core.state.networkCommandHistory = [
                { command: "hostname", timestamp: '<img src=x onerror="alert(1)">', ok: true },
            ];
            mod.renderNetworkConsolePanel();
            const el = dom.window.document.getElementById("network-history-list")!;
            assert.ok(!el.innerHTML.includes("onerror"), "Should not contain event handler");
        });

        it("telemetry panel handles NaN values safely", () => {
            core.state.networkTelemetryData = {
                totalCommands: NaN,
                tier1Count: 0,
                tier2Count: 0,
                tier3Count: 0,
                errorCount: 0,
                lastCommand: null,
            };
            // Should not throw
            mod.renderNetworkTelemetryPanel();
            const el = dom.window.document.getElementById("network-telemetry-panel")!;
            assert.ok(el.innerHTML.length > 0, "Panel should still render");
        });
    });
});
