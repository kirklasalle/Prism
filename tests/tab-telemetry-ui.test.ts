/**
 * Frontend Unit Tests for tab-telemetry.js — DOM rendering logic.
 *
 * Uses jsdom to provide a minimal browser-like environment, then loads
 * tab-telemetry.js with a mocked dashboard-core.js so we can test:
 *   - renderUsagePanel (cost snapshot, model table, cost cap controls)
 *   - setUsageSort (model sort toggle)
 *   - renderWhatChanged (events, failures, deltas, top operations)
 *   - renderRuntimeExcellence (health scores, planner, self-healing)
 *   - renderReleaseReadiness (gates, decision, package evidence)
 *   - renderSelfReview (cadence, recommendations, review history)
 *   - renderRetrievalObservability (alerts by severity)
 *   - renderPackageHistory (package event table)
 *   - renderChatTelemetry (chat event table)
 *   - deltaLabel / pct (utility helpers)
 *
 * Run: mocha dist/tests/tab-telemetry-ui.test.js --timeout 30000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

type JSDOMInstance = InstanceType<typeof JSDOM>;

/* ── Global DOM scaffold ──────────────────────────────────────────────────── */

const SCAFFOLD_HTML = `<!DOCTYPE html><html><body>
<!-- Usage & Cost Panel -->
<div id="usage-cost-panel"></div>

<!-- Cap inputs (rendered dynamically but needed for saveUsageCaps/clearUsageCaps) -->
<input id="cap-session" type="number" />
<input id="cap-daily" type="number" />
<input id="cap-monthly" type="number" />
<div id="cap-save-msg" style="display:none;"></div>

<!-- Telemetry What Changed -->
<div id="telemetry-what-changed"></div>

<!-- Runtime Excellence -->
<div id="runtime-excellence"></div>

<!-- Release Readiness -->
<div id="release-readiness"></div>

<!-- Self Review -->
<div id="self-review"></div>

<!-- Retrieval Alerts -->
<div id="retrieval-alerts"></div>

<!-- Package History -->
<div id="package-history"></div>

<!-- Chat Telemetry -->
<div id="chat-telemetry"></div>
</body></html>`;

const MOCK_DASHBOARD_CORE = `
export const state = {
  telemetryWindow: '1d',
  usageSummary: null,
  usageCaps: null,
  telemetrySummary: null,
  runtimeExcellence: null,
  releaseValidation: null,
  releaseDecision: null,
  packageReleaseSnapshot: null,
  selfReviewLatest: null,
  selfReviewHistory: [],
  prioritizedAlerts: null,
  retrievalAlerts: null,
  sessionPackageHistory: [],
  chatTelemetry: [],
};

let _lastRequest = null;
let _requestResponse = {};

export function request(url, opts) {
  _lastRequest = { url, opts };
  return Promise.resolve(_requestResponse);
}

export function setRequestResponse(resp) { _requestResponse = resp; }
export function getLastRequest() { return _lastRequest; }

export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function formatRelativeTime(ts) {
  if (!ts) return '-';
  return 'just now';
}

export function safeIso(ts) { return ts || '-'; }
export function statusBadge(status) { return '<span class="badge">' + (status || '-') + '</span>'; }
export function metricRow(label, value) { return '<div class="metric"><span class="muted">' + label + '</span><span class="mono">' + value + '</span></div>'; }
export function healthDot(score) { return score >= 80 ? '🟢' : score >= 50 ? '🟡' : '🔴'; }
export function safeRenderStep(fn, label) { try { fn(); } catch(e) { console.error(label, e); } }
export function dashboardLog() {}
`;

/* ── Module types ─────────────────────────────────────────────────────────── */

interface TabTelemetryModule {
    refreshUsagePanel(): Promise<void>;
    renderUsagePanel(): void;
    setUsageSort(sort: string): void;
    saveUsageCaps(): Promise<void>;
    clearUsageCaps(): Promise<void>;
    renderWhatChanged(): void;
    renderRuntimeExcellence(): void;
    renderReleaseReadiness(): void;
    renderSelfReview(): void;
    renderRetrievalObservability(): void;
    renderPackageHistory(): void;
    renderChatTelemetry(): void;
    setTelemetryWindow(window: string): Promise<void>;
    deltaLabel(val: number, higherIsBad: boolean): string;
    pct(val: number): string;
}

/* ── Suite ─────────────────────────────────────────────────────────────────── */

describe("tab-telemetry.js — Frontend Unit Tests", function () {
    this.timeout(30_000);

    let tmpDir: string;
    let mod: TabTelemetryModule;
    let dom: JSDOM;
    let mockState: Record<string, any>;
    let mockCore: Record<string, any>;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-tab-telemetry-ui-"));
        writeFileSync(join(tmpDir, "dashboard-core.js"), MOCK_DASHBOARD_CORE, "utf-8");
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-telemetry.js"),
            join(tmpDir, "tab-telemetry.js"),
        );

        dom = new JSDOM(SCAFFOLD_HTML, { url: "http://localhost" });
        (global as any).document = dom.window.document;
        (global as any).window = dom.window;
        Object.defineProperty(global, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
        (global as any).HTMLElement = dom.window.HTMLElement;
        Object.defineProperty(global, "location", { value: dom.window.location, writable: true, configurable: true });
        (global as any).URL = dom.window.URL;
        (global as any).fetch = () => Promise.reject(new Error("fetch not mocked"));

        // Provide a global render() stub (called by setTelemetryWindow)
        (global as any).render = () => {};

        const moduleUrl = pathToFileURL(join(tmpDir, "tab-telemetry.js")).href;
        mod = await import(moduleUrl) as TabTelemetryModule;

        const coreUrl = pathToFileURL(join(tmpDir, "dashboard-core.js")).href;
        mockCore = await import(coreUrl);
        mockState = mockCore.state;
    });

    after(() => {
        delete (global as any).document;
        delete (global as any).window;
        delete (global as any).navigator;
        delete (global as any).HTMLElement;
        delete (global as any).location;
        delete (global as any).URL;
        delete (global as any).fetch;
        delete (global as any).render;
        rmSync(tmpDir, { recursive: true, force: true });
    });

    /** Reset the DOM between tests */
    beforeEach(() => {
        dom.window.document.body.innerHTML = new JSDOM(SCAFFOLD_HTML).window.document.body.innerHTML;
        // Reset state
        mockState.telemetryWindow = "1d";
        mockState.usageSummary = null;
        mockState.usageCaps = null;
        mockState.telemetrySummary = null;
        mockState.runtimeExcellence = null;
        mockState.releaseValidation = null;
        mockState.releaseDecision = null;
        mockState.packageReleaseSnapshot = null;
        mockState.selfReviewLatest = null;
        mockState.selfReviewHistory = [];
        mockState.prioritizedAlerts = null;
        mockState.retrievalAlerts = null;
        mockState.sessionPackageHistory = [];
        mockState.chatTelemetry = [];
    });

    /* ── Utility helpers: deltaLabel / pct ─────────────────────────────────── */

    describe("deltaLabel", () => {
        it("returns ±0 for zero delta", () => {
            const html = mod.deltaLabel(0, false);
            assert.ok(html.includes("±0"), "Should show ±0");
        });

        it("returns green positive delta when higherIsBad=false", () => {
            const html = mod.deltaLabel(5, false);
            assert.ok(html.includes("+5"));
            assert.ok(html.includes("#7ecf7e"), "Positive non-bad should be green");
        });

        it("returns red positive delta when higherIsBad=true", () => {
            const html = mod.deltaLabel(3, true);
            assert.ok(html.includes("+3"));
            assert.ok(html.includes("#ff8d8d"), "Positive bad should be red");
        });

        it("shows negative value without explicit + sign", () => {
            const html = mod.deltaLabel(-2, false);
            assert.ok(html.includes("-2"));
            assert.ok(!html.includes("+-2"));
        });
    });

    describe("pct", () => {
        it("formats 0 as 0.0%", () => {
            assert.strictEqual(mod.pct(0), "0.0%");
        });

        it("formats 0.5 as 50.0%", () => {
            assert.strictEqual(mod.pct(0.5), "50.0%");
        });

        it("formats 0.333 as 33.3%", () => {
            assert.strictEqual(mod.pct(0.333), "33.3%");
        });

        it("formats 1 as 100.0%", () => {
            assert.strictEqual(mod.pct(1), "100.0%");
        });
    });

    /* ── renderUsagePanel ──────────────────────────────────────────────────── */

    describe("renderUsagePanel", () => {
        it("renders cost snapshot with zero values if no data", () => {
            mod.renderUsagePanel();
            const el = dom.window.document.getElementById("usage-cost-panel");
            assert.ok(el!.innerHTML.includes("Cost Snapshot"));
            assert.ok(el!.innerHTML.includes("Requests"));
            assert.ok(el!.innerHTML.includes("$0.000000"));
        });

        it("renders usage data with model table", () => {
            mockState.usageSummary = {
                totalCostUsd: 1.25,
                totalInputTokens: 50000,
                totalOutputTokens: 12000,
                totalRequests: 42,
                sessionCostUsd: 0.5,
                dailyCostUsd: 1.0,
                monthlyCostUsd: 1.25,
                caps: { sessionCap: null, dailyCap: null, monthlyCap: null },
                byModel: [
                    {
                        model: "gpt-4o", label: "GPT-4o", provider: "openai", tier: 5,
                        requests: 30, inputTokens: 40000, outputTokens: 10000,
                        inputPer1M: 2.50, outputPer1M: 10.00, totalCostUsd: 1.00,
                    },
                    {
                        model: "claude-3-haiku", label: "Claude 3 Haiku", provider: "anthropic", tier: 3,
                        requests: 12, inputTokens: 10000, outputTokens: 2000,
                        inputPer1M: 0.25, outputPer1M: 1.25, totalCostUsd: 0.25,
                    },
                ],
            };
            mod.renderUsagePanel();
            const el = dom.window.document.getElementById("usage-cost-panel");
            assert.ok(el!.innerHTML.includes("42"), "Should show total requests");
            assert.ok(el!.innerHTML.includes("$1.25"), "Should show total cost");
            assert.ok(el!.innerHTML.includes("GPT-4o"), "Should show model label");
            assert.ok(el!.innerHTML.includes("Claude 3 Haiku"), "Should show second model");
            assert.ok(el!.innerHTML.includes("openai"), "Should show provider");
            assert.ok(el!.innerHTML.includes("Model Comparison"), "Should have model comparison heading");
        });

        it("shows 'No LLM calls recorded yet' when byModel is empty", () => {
            mockState.usageSummary = {
                totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0,
                caps: { sessionCap: null, dailyCap: null, monthlyCap: null },
                byModel: [],
            };
            mod.renderUsagePanel();
            const el = dom.window.document.getElementById("usage-cost-panel");
            assert.ok(el!.innerHTML.includes("No LLM calls recorded yet"));
        });

        it("shows progress bars when caps are set", () => {
            mockState.usageSummary = {
                totalCostUsd: 0.5, totalInputTokens: 1000, totalOutputTokens: 500, totalRequests: 5,
                sessionCostUsd: 0.3, dailyCostUsd: 0.5, monthlyCostUsd: 0.5,
                caps: { sessionCap: 1.00, dailyCap: 5.00, monthlyCap: 20.00 },
                byModel: [],
            };
            mod.renderUsagePanel();
            const el = dom.window.document.getElementById("usage-cost-panel");
            // Progress bars render percentage widths
            assert.ok(el!.innerHTML.includes("width:"), "Should contain progress bar widths");
            assert.ok(el!.innerHTML.includes("Session"), "Should label session cap");
            assert.ok(el!.innerHTML.includes("Daily"), "Should label daily cap");
            assert.ok(el!.innerHTML.includes("Monthly"), "Should label monthly cap");
        });

        it("renders cost cap input controls", () => {
            mod.renderUsagePanel();
            const el = dom.window.document.getElementById("usage-cost-panel");
            assert.ok(el!.innerHTML.includes("Cost Cap Controls"));
            assert.ok(el!.innerHTML.includes("cap-session"));
            assert.ok(el!.innerHTML.includes("cap-daily"));
            assert.ok(el!.innerHTML.includes("cap-monthly"));
            assert.ok(el!.innerHTML.includes("Save caps"));
            assert.ok(el!.innerHTML.includes("Clear all caps"));
        });

        it("formats large token counts with K/M suffixes", () => {
            mockState.usageSummary = {
                totalCostUsd: 0, totalInputTokens: 1500000, totalOutputTokens: 2500, totalRequests: 1,
                caps: { sessionCap: null, dailyCap: null, monthlyCap: null },
                byModel: [],
            };
            mod.renderUsagePanel();
            const el = dom.window.document.getElementById("usage-cost-panel");
            assert.ok(el!.innerHTML.includes("1.5M"), "1500000 should format as 1.5M");
            assert.ok(el!.innerHTML.includes("2.5K"), "2500 should format as 2.5K");
        });

        it("shows tier labels in model table", () => {
            mockState.usageSummary = {
                totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0,
                caps: { sessionCap: null, dailyCap: null, monthlyCap: null },
                byModel: [
                    { model: "m1", label: "m1", provider: "p", tier: 5, requests: 1, inputTokens: 0, outputTokens: 0, inputPer1M: 0, outputPer1M: 0, totalCostUsd: 0 },
                    { model: "m2", label: "m2", provider: "p", tier: 0, requests: 1, inputTokens: 0, outputTokens: 0, inputPer1M: 0, outputPer1M: 0, totalCostUsd: 0 },
                ],
            };
            mod.renderUsagePanel();
            const el = dom.window.document.getElementById("usage-cost-panel");
            assert.ok(el!.innerHTML.includes("T5 Frontier"), "Tier 5 should show Frontier label");
            assert.ok(el!.innerHTML.includes("Local/Free"), "Tier 0 should show Local/Free label");
        });
    });

    /* ── setUsageSort ──────────────────────────────────────────────────────── */

    describe("setUsageSort", () => {
        it("re-renders with active sort class on the selected button", () => {
            mockState.usageSummary = {
                totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0,
                caps: { sessionCap: null, dailyCap: null, monthlyCap: null },
                byModel: [
                    { model: "a", label: "Cheap", provider: "x", tier: 2, requests: 100, inputTokens: 0, outputTokens: 0, inputPer1M: 0, outputPer1M: 0, totalCostUsd: 0.01 },
                    { model: "b", label: "Expensive", provider: "x", tier: 5, requests: 10, inputTokens: 0, outputTokens: 0, inputPer1M: 10, outputPer1M: 30, totalCostUsd: 5.00 },
                ],
            };
            mod.setUsageSort("power");
            const el = dom.window.document.getElementById("usage-cost-panel");
            // In power sort, higher tier comes first
            const rows = el!.innerHTML;
            const expIdx = rows.indexOf("Expensive");
            const cheapIdx = rows.indexOf("Cheap");
            assert.ok(expIdx < cheapIdx, "Power sort should rank tier 5 before tier 2");
        });

        it("cost sort orders cheapest first", () => {
            mockState.usageSummary = {
                totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0,
                caps: { sessionCap: null, dailyCap: null, monthlyCap: null },
                byModel: [
                    { model: "a", label: "Expensive", provider: "x", tier: 5, requests: 10, inputTokens: 0, outputTokens: 0, inputPer1M: 10, outputPer1M: 30, totalCostUsd: 5.00 },
                    { model: "b", label: "Cheap", provider: "x", tier: 2, requests: 100, inputTokens: 0, outputTokens: 0, inputPer1M: 0, outputPer1M: 0, totalCostUsd: 0.01 },
                ],
            };
            mod.setUsageSort("cost");
            const el = dom.window.document.getElementById("usage-cost-panel");
            const rows = el!.innerHTML;
            const cheapIdx = rows.indexOf("Cheap");
            const expIdx = rows.indexOf("Expensive");
            assert.ok(cheapIdx < expIdx, "Cost sort should rank cheaper model first");
        });
    });

    /* ── renderWhatChanged ────────────────────────────────────────────────── */

    describe("renderWhatChanged", () => {
        it("shows placeholder when no telemetry data", () => {
            mockState.telemetrySummary = null;
            mod.renderWhatChanged();
            const el = dom.window.document.getElementById("telemetry-what-changed");
            assert.ok(el!.innerHTML.includes("No telemetry data available"));
        });

        it("renders event counts and deltas", () => {
            mockState.telemetrySummary = {
                generatedAt: new Date().toISOString(),
                window: { windowLabel: "1d", eventsTotal: 150, failures: 5, approvals: 12, failureRate: 0.033 },
                priorWindow: { windowLabel: "1d", eventsTotal: 100, failures: 3, approvals: 8, failureRate: 0.03 },
                delta: { eventsTotal: 50, failures: 2, approvals: 4, failureRate: 0.003 },
                topOperations: [],
                newSinceLastWindow: true,
            };
            mod.renderWhatChanged();
            const el = dom.window.document.getElementById("telemetry-what-changed");
            assert.ok(el!.innerHTML.includes("150"), "Should show total events");
            assert.ok(el!.innerHTML.includes("5"), "Should show failure count");
            assert.ok(el!.innerHTML.includes("12"), "Should show approval count");
            assert.ok(el!.innerHTML.includes("3.3%"), "Should show failure rate percentage");
            assert.ok(el!.innerHTML.includes("+50"), "Should show event delta");
            assert.ok(el!.innerHTML.includes("New activity since last window"));
        });

        it("renders top operations table", () => {
            mockState.telemetrySummary = {
                generatedAt: new Date().toISOString(),
                window: { windowLabel: "1h", eventsTotal: 50, failures: 2, approvals: 5, failureRate: 0.04 },
                priorWindow: { windowLabel: "1h", eventsTotal: 40, failures: 1, approvals: 4, failureRate: 0.025 },
                delta: { eventsTotal: 10, failures: 1, approvals: 1, failureRate: 0.015 },
                topOperations: [
                    { operation: "chat.send", count: 30, failures: 1 },
                    { operation: "tool.execute", count: 15, failures: 1 },
                    { operation: "browser.navigate", count: 5, failures: 0 },
                ],
                newSinceLastWindow: false,
            };
            mod.renderWhatChanged();
            const el = dom.window.document.getElementById("telemetry-what-changed");
            assert.ok(el!.innerHTML.includes("Top Operations"), "Should have top operations heading");
            assert.ok(el!.innerHTML.includes("chat.send"), "Should list chat.send");
            assert.ok(el!.innerHTML.includes("tool.execute"), "Should list tool.execute");
            assert.ok(el!.innerHTML.includes("browser.navigate"), "Should list browser.navigate");
        });

        it("colors failure counts red when > 0", () => {
            mockState.telemetrySummary = {
                generatedAt: new Date().toISOString(),
                window: { windowLabel: "1d", eventsTotal: 10, failures: 3, approvals: 2, failureRate: 0.3 },
                priorWindow: { windowLabel: "1d", eventsTotal: 5, failures: 1, approvals: 1, failureRate: 0.2 },
                delta: { eventsTotal: 5, failures: 2, approvals: 1, failureRate: 0.1 },
                topOperations: [{ operation: "op1", count: 10, failures: 3 }],
                newSinceLastWindow: false,
            };
            mod.renderWhatChanged();
            const el = dom.window.document.getElementById("telemetry-what-changed");
            assert.ok(el!.innerHTML.includes("#ff8d8d"), "Failure delta should be red (higherIsBad)");
        });

        it("shows correct window label for 7d", () => {
            mockState.telemetryWindow = "7d";
            mockState.telemetrySummary = {
                generatedAt: new Date().toISOString(),
                window: { windowLabel: "7d", eventsTotal: 500, failures: 10, approvals: 50, failureRate: 0.02 },
                priorWindow: { windowLabel: "7d", eventsTotal: 400, failures: 8, approvals: 40, failureRate: 0.02 },
                delta: { eventsTotal: 100, failures: 2, approvals: 10, failureRate: 0 },
                topOperations: [],
                newSinceLastWindow: false,
            };
            mod.renderWhatChanged();
            const el = dom.window.document.getElementById("telemetry-what-changed");
            assert.ok(el!.innerHTML.includes("7 days"), "Should display '7 days' window label");
        });
    });

    /* ── renderRuntimeExcellence ──────────────────────────────────────────── */

    describe("renderRuntimeExcellence", () => {
        it("shows placeholder when data is null", () => {
            mockState.runtimeExcellence = null;
            mod.renderRuntimeExcellence();
            const el = dom.window.document.getElementById("runtime-excellence");
            assert.ok(el!.innerHTML.includes("Runtime excellence snapshot unavailable"));
        });

        it("renders health scores and planner info", () => {
            mockState.runtimeExcellence = {
                scores: { runtimeHealth: 92, memoryConfidence: 85 },
                planner: { priority: "low", nextAction: "Monitor stability", rationale: "All metrics green" },
                selfHealingSuggestions: [],
            };
            mod.renderRuntimeExcellence();
            const el = dom.window.document.getElementById("runtime-excellence");
            assert.ok(el!.innerHTML.includes("92"), "Should show runtime health score");
            assert.ok(el!.innerHTML.includes("85"), "Should show memory confidence score");
            assert.ok(el!.innerHTML.includes("low"), "Should show planner priority");
            assert.ok(el!.innerHTML.includes("Monitor stability"), "Should show next action");
            assert.ok(el!.innerHTML.includes("All metrics green"), "Should show rationale");
        });

        it("colors high priority red", () => {
            mockState.runtimeExcellence = {
                scores: { runtimeHealth: 40, memoryConfidence: 30 },
                planner: { priority: "high", nextAction: "Restart agent", rationale: "Critical failure" },
                selfHealingSuggestions: [],
            };
            mod.renderRuntimeExcellence();
            const el = dom.window.document.getElementById("runtime-excellence");
            assert.ok(el!.innerHTML.includes("#ff8d8d"), "High priority should be red");
        });

        it("colors medium priority yellow", () => {
            mockState.runtimeExcellence = {
                scores: { runtimeHealth: 65, memoryConfidence: 60 },
                planner: { priority: "medium", nextAction: "Review logs", rationale: "Some warnings" },
                selfHealingSuggestions: [],
            };
            mod.renderRuntimeExcellence();
            const el = dom.window.document.getElementById("runtime-excellence");
            assert.ok(el!.innerHTML.includes("#ffd17a"), "Medium priority should be yellow");
        });

        it("renders self-healing suggestions (up to 3)", () => {
            mockState.runtimeExcellence = {
                scores: { runtimeHealth: 50, memoryConfidence: 40 },
                planner: { priority: "high", nextAction: "Fix issues", rationale: "Multiple failures detected" },
                selfHealingSuggestions: [
                    { title: "Restart memory", trigger: "OOM detected", action: "Clear and reload memory" },
                    { title: "Reset router", trigger: "High error rate", action: "Switch to fallback model" },
                    { title: "Reduce concurrency", trigger: "Timeout spike", action: "Lower max parallel ops" },
                    { title: "Fourth suggestion", trigger: "Should not appear", action: "Ignored" },
                ],
            };
            mod.renderRuntimeExcellence();
            const el = dom.window.document.getElementById("runtime-excellence");
            assert.ok(el!.innerHTML.includes("Self-healing candidates"));
            assert.ok(el!.innerHTML.includes("Restart memory"));
            assert.ok(el!.innerHTML.includes("Reset router"));
            assert.ok(el!.innerHTML.includes("Reduce concurrency"));
            assert.ok(!el!.innerHTML.includes("Fourth suggestion"), "Should cap at 3 suggestions");
        });
    });

    /* ── renderReleaseReadiness ───────────────────────────────────────────── */

    describe("renderReleaseReadiness", () => {
        it("shows placeholder when no validation report", () => {
            mockState.releaseValidation = null;
            mod.renderReleaseReadiness();
            const el = dom.window.document.getElementById("release-readiness");
            assert.ok(el!.innerHTML.includes("No release validation artifact found"));
            assert.ok(el!.innerHTML.includes("npm run release:validate"));
        });

        it("renders gate counts and overall status", () => {
            mockState.releaseValidation = {
                generatedAt: new Date().toISOString(),
                passed: true,
                strictMode: true,
                gates: [
                    { id: "g1", label: "Unit Tests", status: "passed" },
                    { id: "g2", label: "Lint", status: "passed" },
                    { id: "g3", label: "Security Scan", status: "failed" },
                    { id: "g4", label: "Manual Review", status: "manual_required" },
                ],
            };
            mod.renderReleaseReadiness();
            const el = dom.window.document.getElementById("release-readiness");
            assert.ok(el!.innerHTML.includes("ready"), "Should show overall status");
            assert.ok(el!.innerHTML.includes("2 pass"), "Should show 2 passed gates");
            assert.ok(el!.innerHTML.includes("1 fail"), "Should show 1 failed gate");
            assert.ok(el!.innerHTML.includes("1 manual"), "Should show 1 manual gate");
            assert.ok(el!.innerHTML.includes("Unit Tests"), "Should list gates");
            assert.ok(el!.innerHTML.includes("Strict mode"));
        });

        it("renders decision recommendation when present", () => {
            mockState.releaseValidation = {
                generatedAt: new Date().toISOString(),
                passed: true,
                strictMode: false,
                gates: [],
            };
            mockState.releaseDecision = {
                recommendation: "GO",
                riskLevel: "low",
            };
            mod.renderReleaseReadiness();
            const el = dom.window.document.getElementById("release-readiness");
            assert.ok(el!.innerHTML.includes("GO"), "Should show GO recommendation");
            assert.ok(el!.innerHTML.includes("low"), "Should show risk level");
            assert.ok(el!.innerHTML.includes("#7ecf7e"), "GO recommendation should be green");
        });

        it("colors NO_GO recommendation red", () => {
            mockState.releaseValidation = {
                generatedAt: new Date().toISOString(),
                passed: false,
                strictMode: true,
                gates: [{ id: "g1", label: "Critical Gate", status: "failed" }],
            };
            mockState.releaseDecision = {
                recommendation: "NO_GO",
                riskLevel: "high",
            };
            mod.renderReleaseReadiness();
            const el = dom.window.document.getElementById("release-readiness");
            assert.ok(el!.innerHTML.includes("NO_GO"));
            assert.ok(el!.innerHTML.includes("#ff8d8d"), "NO_GO should be red");
            assert.ok(el!.innerHTML.includes("not ready"), "Should show not ready");
        });

        it("renders package evidence when snapshot is present", () => {
            mockState.releaseValidation = {
                generatedAt: new Date().toISOString(),
                passed: true,
                strictMode: false,
                gates: [],
            };
            mockState.packageReleaseSnapshot = {
                totalPackages: 5,
                exportedCount: 3,
                completeWithoutExportCount: 1,
                latestExportArtifactPath: "/output/export-2026-04-10.json",
                byStatus: { planned: 0, running: 1, blocked: 0, complete: 4 },
            };
            mod.renderReleaseReadiness();
            const el = dom.window.document.getElementById("release-readiness");
            assert.ok(el!.innerHTML.includes("Package Evidence"));
            assert.ok(el!.innerHTML.includes("5"), "Should show total packages");
            assert.ok(el!.innerHTML.includes("3"), "Should show exported count");
            assert.ok(el!.innerHTML.includes("export-2026-04-10.json"), "Should show export path");
        });

        it("shows package evidence even without release validation", () => {
            mockState.releaseValidation = null;
            mockState.packageReleaseSnapshot = {
                totalPackages: 2,
                exportedCount: 1,
                completeWithoutExportCount: 0,
            };
            mod.renderReleaseReadiness();
            const el = dom.window.document.getElementById("release-readiness");
            assert.ok(el!.innerHTML.includes("Package Evidence"));
        });
    });

    /* ── renderSelfReview ─────────────────────────────────────────────────── */

    describe("renderSelfReview", () => {
        it("shows placeholder when no self-review report", () => {
            mockState.selfReviewLatest = null;
            mod.renderSelfReview();
            const el = dom.window.document.getElementById("self-review");
            assert.ok(el!.innerHTML.includes("No self-review report generated yet"));
        });

        it("renders cadence and metrics", () => {
            mockState.selfReviewLatest = {
                cadence: "hourly",
                generatedAt: new Date().toISOString(),
                metrics: { eventsTotal: 120, failures: 3 },
                recommendations: ["Increase memory buffer"],
            };
            mod.renderSelfReview();
            const el = dom.window.document.getElementById("self-review");
            assert.ok(el!.innerHTML.includes("hourly"), "Should show cadence");
            assert.ok(el!.innerHTML.includes("120"), "Should show events total");
            assert.ok(el!.innerHTML.includes("3"), "Should show failures");
            assert.ok(el!.innerHTML.includes("Increase memory buffer"), "Should show top recommendation");
        });

        it("renders review history table", () => {
            mockState.selfReviewLatest = {
                cadence: "daily",
                generatedAt: new Date().toISOString(),
                metrics: { eventsTotal: 50, failures: 1 },
                recommendations: [],
            };
            mockState.selfReviewHistory = [
                { generatedAt: new Date().toISOString(), cadence: "hourly", metrics: { failures: 0 } },
                { generatedAt: new Date().toISOString(), cadence: "daily", metrics: { failures: 2 } },
            ];
            mod.renderSelfReview();
            const el = dom.window.document.getElementById("self-review");
            assert.ok(el!.innerHTML.includes("Recent review runs"));
            assert.ok(el!.innerHTML.includes("hourly"));
            assert.ok(el!.innerHTML.includes("daily"));
            // Table columns
            assert.ok(el!.innerHTML.includes("When"));
            assert.ok(el!.innerHTML.includes("Cadence"));
            assert.ok(el!.innerHTML.includes("Failures"));
        });
    });

    /* ── renderRetrievalObservability ─────────────────────────────────────── */

    describe("renderRetrievalObservability", () => {
        it("shows 'No alerts' when no data", () => {
            mockState.prioritizedAlerts = null;
            mockState.retrievalAlerts = null;
            mod.renderRetrievalObservability();
            const el = dom.window.document.getElementById("retrieval-alerts");
            assert.ok(el!.innerHTML.includes("No alerts"));
        });

        it("renders prioritized alerts with severity badges", () => {
            mockState.prioritizedAlerts = {
                criticalCount: 1,
                warningCount: 1,
                infoCount: 1,
                alerts: [
                    { severity: "critical", message: "Memory usage exceeds threshold" },
                    { severity: "warning", message: "Response time degrading" },
                    { severity: "info", message: "New model available" },
                ],
            };
            mod.renderRetrievalObservability();
            const el = dom.window.document.getElementById("retrieval-alerts");
            assert.ok(el!.innerHTML.includes("Critical"), "Should show critical badge");
            assert.ok(el!.innerHTML.includes("Warning"), "Should show warning badge");
            assert.ok(el!.innerHTML.includes("Info"), "Should show info badge");
            assert.ok(el!.innerHTML.includes("Memory usage exceeds threshold"));
            assert.ok(el!.innerHTML.includes("Response time degrading"));
            assert.ok(el!.innerHTML.includes("New model available"));
        });

        it("shows summary counts for critical and warning", () => {
            mockState.prioritizedAlerts = {
                criticalCount: 3,
                warningCount: 2,
                infoCount: 5,
                alerts: [{ severity: "critical", message: "test" }],
            };
            mod.renderRetrievalObservability();
            const el = dom.window.document.getElementById("retrieval-alerts");
            assert.ok(el!.innerHTML.includes("3 critical"), "Should show critical count");
            assert.ok(el!.innerHTML.includes("2 warning"), "Should show warning count");
            assert.ok(el!.innerHTML.includes("5 info"), "Should show info count");
        });

        it("truncates alerts at 8 and shows overflow count", () => {
            const alerts = [];
            for (let i = 0; i < 12; i++) {
                alerts.push({ severity: "info", message: `Alert ${i}` });
            }
            mockState.prioritizedAlerts = {
                criticalCount: 0,
                warningCount: 0,
                infoCount: 12,
                alerts,
            };
            mod.renderRetrievalObservability();
            const el = dom.window.document.getElementById("retrieval-alerts");
            assert.ok(el!.innerHTML.includes("Alert 7"), "Should render up to 8th alert");
            assert.ok(!el!.innerHTML.includes("Alert 8"), "Should not render 9th alert");
            assert.ok(el!.innerHTML.includes("+ 4 more alerts"), "Should show overflow count");
        });

        it("falls back to legacy retrievalAlerts array", () => {
            mockState.prioritizedAlerts = null;
            mockState.retrievalAlerts = ["Legacy alert one", "Legacy alert two"];
            mod.renderRetrievalObservability();
            const el = dom.window.document.getElementById("retrieval-alerts");
            assert.ok(el!.innerHTML.includes("Legacy alert one"));
            assert.ok(el!.innerHTML.includes("Legacy alert two"));
        });

        it("truncates legacy alerts at 5", () => {
            mockState.prioritizedAlerts = null;
            mockState.retrievalAlerts = [];
            for (let i = 0; i < 8; i++) {
                mockState.retrievalAlerts.push(`Legacy alert ${i}`);
            }
            mod.renderRetrievalObservability();
            const el = dom.window.document.getElementById("retrieval-alerts");
            assert.ok(el!.innerHTML.includes("Legacy alert 4"), "Should show 5th alert");
            assert.ok(!el!.innerHTML.includes("Legacy alert 5"), "Should not show 6th alert");
            assert.ok(el!.innerHTML.includes("+ 3 more alerts"), "Should show overflow");
        });
    });

    /* ── renderPackageHistory ─────────────────────────────────────────────── */

    describe("renderPackageHistory", () => {
        it("shows placeholder when no history", () => {
            mockState.sessionPackageHistory = [];
            mod.renderPackageHistory();
            const el = dom.window.document.getElementById("package-history");
            assert.ok(el!.innerHTML.includes("No package history yet"));
        });

        it("renders package history table", () => {
            mockState.sessionPackageHistory = [
                { timestamp: new Date().toISOString(), title: "Core Package", packageId: "pkg-001", action: "export", status: "complete", message: "Exported successfully" },
                { timestamp: new Date().toISOString(), title: "UI Kit", packageId: "pkg-002", action: "create", status: "running" },
            ];
            mod.renderPackageHistory();
            const el = dom.window.document.getElementById("package-history");
            assert.ok(el!.innerHTML.includes("Core Package"));
            assert.ok(el!.innerHTML.includes("export"));
            assert.ok(el!.innerHTML.includes("complete"));
            assert.ok(el!.innerHTML.includes("Exported successfully"));
            assert.ok(el!.innerHTML.includes("UI Kit"));
            assert.ok(el!.innerHTML.includes("create"));
            assert.ok(el!.innerHTML.includes("running"));
            // Table headers
            assert.ok(el!.innerHTML.includes("Time"));
            assert.ok(el!.innerHTML.includes("Package"));
            assert.ok(el!.innerHTML.includes("Action"));
            assert.ok(el!.innerHTML.includes("Status"));
        });
    });

    /* ── renderChatTelemetry ─────────────────────────────────────────────── */

    describe("renderChatTelemetry", () => {
        it("shows placeholder when no events", () => {
            mockState.chatTelemetry = [];
            mod.renderChatTelemetry();
            const el = dom.window.document.getElementById("chat-telemetry");
            assert.ok(el!.innerHTML.includes("No chat telemetry events yet"));
        });

        it("renders chat event rows with model and provider", () => {
            mockState.chatTelemetry = [
                {
                    timestamp: new Date().toISOString(),
                    operation: "chat.send",
                    status: "succeeded",
                    details: { model: "gpt-4o", provider: "openai" },
                },
                {
                    timestamp: new Date().toISOString(),
                    operation: "tool.execute",
                    status: "failed",
                    details: { toolName: "browser.navigate", error: "Timeout after 30s" },
                },
            ];
            mod.renderChatTelemetry();
            const el = dom.window.document.getElementById("chat-telemetry");
            assert.ok(el!.innerHTML.includes("chat.send"), "Should show operation");
            assert.ok(el!.innerHTML.includes("succeeded"), "Should show status");
            assert.ok(el!.innerHTML.includes("gpt-4o"), "Should show model");
            assert.ok(el!.innerHTML.includes("openai"), "Should show provider");
            assert.ok(el!.innerHTML.includes("tool.execute"));
            assert.ok(el!.innerHTML.includes("browser.navigate"), "Should show tool name");
            assert.ok(el!.innerHTML.includes("Timeout after 30s"), "Should show error");
            // Table headers
            assert.ok(el!.innerHTML.includes("Time"));
            assert.ok(el!.innerHTML.includes("Operation"));
            assert.ok(el!.innerHTML.includes("Status"));
            assert.ok(el!.innerHTML.includes("Details"));
        });

        it("shows correlation ID when present", () => {
            mockState.chatTelemetry = [
                {
                    timestamp: new Date().toISOString(),
                    operation: "chat.send",
                    status: "succeeded",
                    details: { model: "test", correlationId: "abcdef1234567890abcdef1234567890" },
                },
            ];
            mod.renderChatTelemetry();
            const el = dom.window.document.getElementById("chat-telemetry");
            // The code truncates correlationId to first 24 chars
            assert.ok(el!.innerHTML.includes("abcdef1234567890abcdef12"), "Should show truncated correlation ID");
        });

        it("shows intent when present", () => {
            mockState.chatTelemetry = [
                {
                    timestamp: new Date().toISOString(),
                    operation: "chat.classify",
                    status: "succeeded",
                    details: { intent: "code_review" },
                },
            ];
            mod.renderChatTelemetry();
            const el = dom.window.document.getElementById("chat-telemetry");
            assert.ok(el!.innerHTML.includes("code_review"), "Should show intent");
        });
    });

    /* ── XSS safety ──────────────────────────────────────────────────────── */

    describe("XSS safety", () => {
        it("escapes HTML in model labels", () => {
            mockState.usageSummary = {
                totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0,
                caps: { sessionCap: null, dailyCap: null, monthlyCap: null },
                byModel: [
                    { model: "<script>alert(1)</script>", label: "<img onerror=alert(1)>", provider: "x", tier: 3, requests: 1, inputTokens: 0, outputTokens: 0, inputPer1M: 0, outputPer1M: 0, totalCostUsd: 0 },
                ],
            };
            mod.renderUsagePanel();
            const el = dom.window.document.getElementById("usage-cost-panel");
            assert.ok(!el!.innerHTML.includes("<script>"), "Should escape script tags");
            assert.ok(!el!.innerHTML.includes("<img"), "Should escape img tags");
            assert.ok(el!.innerHTML.includes("&lt;"), "Should contain escaped entities");
        });

        it("escapes HTML in chat telemetry details", () => {
            mockState.chatTelemetry = [
                {
                    timestamp: new Date().toISOString(),
                    operation: "chat.send",
                    status: "ok",
                    details: { model: "<b>bold</b>", error: '"injected<script>alert(1)</script>' },
                },
            ];
            mod.renderChatTelemetry();
            const el = dom.window.document.getElementById("chat-telemetry");
            // No actual <b> or <script> elements should be created in the DOM
            assert.strictEqual(el!.querySelectorAll("b").length, 0, "Should not create <b> element");
            assert.strictEqual(el!.querySelectorAll("script").length, 0, "Should not create <script> element");
            assert.ok(el!.innerHTML.includes("&lt;b&gt;"), "Bold tag should be entity-escaped in text");
        });

        it("escapes HTML in alert messages", () => {
            mockState.prioritizedAlerts = {
                criticalCount: 1, warningCount: 0, infoCount: 0,
                alerts: [{ severity: "critical", message: '<img src=x onerror="alert(1)">' }],
            };
            mod.renderRetrievalObservability();
            const el = dom.window.document.getElementById("retrieval-alerts");
            // No actual <img> element should be created in the DOM
            assert.strictEqual(el!.querySelectorAll("img").length, 0, "Should not create <img> element");
            assert.ok(el!.innerHTML.includes("&lt;img"), "img tag should be entity-escaped");
        });

        it("escapes HTML in self-review recommendations", () => {
            mockState.selfReviewLatest = {
                cadence: "hourly",
                generatedAt: new Date().toISOString(),
                metrics: { eventsTotal: 1, failures: 0 },
                recommendations: ['<script>document.cookie</script>'],
            };
            mod.renderSelfReview();
            const el = dom.window.document.getElementById("self-review");
            assert.ok(!el!.innerHTML.includes("<script>"), "Should escape script in recommendations");
        });

        it("escapes HTML in package history entries", () => {
            mockState.sessionPackageHistory = [
                { timestamp: new Date().toISOString(), title: "<b>XSS</b>", packageId: "p1", action: "test", status: "ok", message: '<script>alert("xss")</script>' },
            ];
            mod.renderPackageHistory();
            const el = dom.window.document.getElementById("package-history");
            assert.ok(!el!.innerHTML.includes("<b>XSS</b>"), "Should escape bold in title");
            assert.ok(!el!.innerHTML.includes("<script>"), "Should escape script in message");
        });
    });
});
