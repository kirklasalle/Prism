/**
 * Frontend Unit Tests for tab-agentic.js — DOM rendering logic.
 *
 * Uses jsdom to provide a minimal browser-like environment, then loads
 * tab-agentic.js with a mocked dashboard-core.js so we can test:
 *   - renderGuardianPanel (guardian status rendering & model dropdown)
 *   - renderAgentList (agent cards with stop/promote/demote buttons)
 *   - renderSubAgentTree (ASCII tree hierarchy)
 *   - renderSwarmTopology (swarm cards with topology labels)
 *   - renderAgentTelemetry (5 metric cards, error-rate coloring)
 *
 * Run: mocha dist/tests/tab-agentic-ui.test.js --timeout 30000
 */
import { describe, it, before, after, beforeEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

type JSDOMInstance = InstanceType<typeof JSDOM>;

/* ── Global DOM scaffold ──────────────────────────────────────────────── */

const SCAFFOLD_HTML = `<!DOCTYPE html><html><body>
<!-- Guardian Panel -->
<div id="guardian-panel-container"></div>
<span id="guardianAgent-collapse-icon"></span>
<div id="guardianAgent-collapsible"></div>

<!-- Agent Management -->
<div id="agent-list-container"></div>
<span id="agentMgmt-collapse-icon"></span>
<div id="agentMgmt-collapsible"></div>

<!-- Sub-Agent Tree -->
<div id="sub-agent-tree-container"></div>
<span id="subAgent-collapse-icon"></span>
<div id="subAgent-collapsible"></div>

<!-- Swarm Topology -->
<div id="swarm-topology-container"></div>
<span id="swarmControl-collapse-icon"></span>
<div id="swarmControl-collapsible"></div>

<!-- Hardware Swarm -->
<div id="hardware-swarm-panel"></div>
<span id="hardwareSwarm-collapse-icon"></span>
<div id="hardwareSwarm-collapsible"></div>

<!-- Agent Telemetry -->
<div id="agent-telemetry-container"></div>
<span id="agentTelemetry-collapse-icon"></span>
<div id="agentTelemetry-collapsible"></div>

<!-- Model selection & download buttons -->
<select id="guardian-model-select"></select>
<button id="download-recommended-btn"></button>
<button id="scan-models-btn"></button>
</body></html>`;

const MOCK_DASHBOARD_CORE = `
export const state = {
  guardianStatus: null,
  localGgufModels: [],
  agentData: null,
};
export function request(url, opts) { return Promise.resolve({}); }
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export function dashboardLog() {}
export function formatUptime(secs) {
  if (secs < 60) return Math.round(secs) + 's';
  if (secs < 3600) return Math.round(secs / 60) + 'm';
  return Math.round(secs / 3600) + 'h';
}
`;

/* ── Module types ─────────────────────────────────────────────────────── */

interface TabAgenticModule {
    renderGuardianPanel(): void;
    renderAgentList(): void;
    renderSubAgentTree(): void;
    renderSwarmTopology(): void;
    renderAgentTelemetry(): void;
}

/* ── Suite ────────────────────────────────────────────────────────────── */

describe("tab-agentic.js — Frontend Unit Tests", function () {
    this.timeout(30_000);

    let tmpDir: string;
    let mod: TabAgenticModule;
    let dom: JSDOMInstance;
    let mockState: Record<string, any>;

    let savedURL: unknown;
    let savedFetch: unknown;

    before(async () => {
        savedURL = (global as any).URL;
        savedFetch = (global as any).fetch;
        tmpDir = mkdtempSync(join(tmpdir(), "prism-tab-agentic-ui-"));
        writeFileSync(join(tmpDir, "dashboard-core.js"), MOCK_DASHBOARD_CORE, "utf-8");
        copyFileSync(
            join(process.cwd(), "src", "core", "operator", "public", "tab-agentic.js"),
            join(tmpDir, "tab-agentic.js"),
        );

        dom = new JSDOM(SCAFFOLD_HTML, { url: "http://localhost" });
        (global as any).document = dom.window.document;
        (global as any).window = dom.window;
        Object.defineProperty(global, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
        (global as any).HTMLElement = dom.window.HTMLElement;
        Object.defineProperty(global, "location", { value: dom.window.location, writable: true, configurable: true });
        (global as any).URL = dom.window.URL;
        (global as any).fetch = () => Promise.reject(new Error("fetch not mocked"));
        // Mock prompt/alert for launchNewAgent/createSwarm
        (global as any).prompt = () => null;
        (global as any).alert = () => { };

        const moduleUrl = pathToFileURL(join(tmpDir, "tab-agentic.js")).href;
        mod = await import(moduleUrl) as TabAgenticModule;

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
        delete (global as any).prompt;
        delete (global as any).alert;
        rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        dom.window.document.body.innerHTML = new JSDOM(SCAFFOLD_HTML).window.document.body.innerHTML;
        mockState.guardianStatus = null;
        mockState.localGgufModels = [];
        mockState.agentData = null;
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  renderGuardianPanel
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("renderGuardianPanel", () => {
        it("shows unavailable message when guardianStatus is null", () => {
            mockState.guardianStatus = null;
            mod.renderGuardianPanel();
            const el = dom.window.document.getElementById("guardian-panel-container");
            assert.ok(el!.innerHTML.includes("Guardian status unavailable"));
        });

        it("renders guardian status with state, model, uptime, health checks", () => {
            mockState.guardianStatus = {
                state: "running",
                modelAlias: "guardian-test",
                modelPath: "/models/test.gguf",
                modelSource: "workspace-models",
                authorityTier: "tier2_conditional",
                uptime: 60000,
                healthChecks: 5,
                issuesDetected: 2,
                issuesResolved: 1,
                lastHealthCheck: new Date().toISOString(),
                lastAction: null,
                recentActions: [],
                slotInfo: null,
            };
            mod.renderGuardianPanel();
            const el = dom.window.document.getElementById("guardian-panel-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("running"), "should show state");
            assert.ok(html.includes("guardian-test"), "should show model alias");
            assert.ok(html.includes("5"), "should show health check count");
            assert.ok(html.includes("2"), "should show issues detected");
            assert.ok(html.includes("1"), "should show issues resolved");
        });

        it("shows Stop button when guardian is running", () => {
            mockState.guardianStatus = {
                state: "running",
                modelAlias: "g",
                modelPath: "/m.gguf",
                modelSource: "",
                authorityTier: "tier2_conditional",
                uptime: 1000,
                healthChecks: 0,
                issuesDetected: 0,
                issuesResolved: 0,
                lastHealthCheck: null,
                lastAction: null,
                recentActions: [],
                slotInfo: null,
            };
            mod.renderGuardianPanel();
            const el = dom.window.document.getElementById("guardian-panel-container");
            assert.ok(el!.innerHTML.includes("stopGuardian"), "should have Stop button onclick");
        });

        it("shows Start button (disabled) when guardian is stopped with no model", () => {
            mockState.guardianStatus = {
                state: "stopped",
                modelAlias: "",
                modelPath: "",
                modelSource: "",
                authorityTier: "tier2_conditional",
                uptime: 0,
                healthChecks: 0,
                issuesDetected: 0,
                issuesResolved: 0,
                lastHealthCheck: null,
                lastAction: null,
                recentActions: [],
                slotInfo: null,
            };
            mod.renderGuardianPanel();
            const el = dom.window.document.getElementById("guardian-panel-container");
            assert.ok(el!.innerHTML.includes("startGuardian"), "should have Start button onclick");
            assert.ok(el!.innerHTML.includes("disabled"), "Start button should be disabled without model");
        });

        it("populates model dropdown from localGgufModels", () => {
            mockState.localGgufModels = [
                { name: "test-model.gguf", path: "/models/test-model.gguf", source: "workspace-models" },
                { name: "ollama-model", path: "ollama:qwen2.5", source: "ollama" },
            ];
            mockState.guardianStatus = {
                state: "stopped",
                modelAlias: "",
                modelPath: "",
                modelSource: "",
                authorityTier: "tier2_conditional",
                uptime: 0,
                healthChecks: 0,
                issuesDetected: 0,
                issuesResolved: 0,
                lastHealthCheck: null,
                lastAction: null,
                recentActions: [],
                slotInfo: null,
            };
            mod.renderGuardianPanel();
            const el = dom.window.document.getElementById("guardian-panel-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("test-model.gguf"), "should list first model");
            assert.ok(html.includes("ollama-model"), "should list second model");
            assert.ok(html.includes("workspace-models"), "should show source");
            assert.ok(html.includes("ollama"), "should show ollama source");
        });

        it("renders recent guardian actions when present", () => {
            mockState.guardianStatus = {
                state: "running",
                modelAlias: "g",
                modelPath: "/m.gguf",
                modelSource: "",
                authorityTier: "tier2_conditional",
                uptime: 5000,
                healthChecks: 3,
                issuesDetected: 1,
                issuesResolved: 1,
                lastHealthCheck: new Date().toISOString(),
                lastAction: "health_check",
                recentActions: [
                    { timestamp: new Date().toISOString(), action: "health_check", result: "success", detail: "All systems OK" },
                    { timestamp: new Date().toISOString(), action: "repair", result: "escalated", detail: "Escalated to operator" },
                ],
                slotInfo: null,
            };
            mod.renderGuardianPanel();
            const el = dom.window.document.getElementById("guardian-panel-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("All systems OK"), "should show action detail");
            assert.ok(html.includes("success"), "should show success result");
            assert.ok(html.includes("escalated"), "should show escalated result");
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  renderAgentList
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("renderAgentList", () => {
        it("shows placeholder when no agents", () => {
            mockState.agentData = null;
            mod.renderAgentList();
            const el = dom.window.document.getElementById("agent-list-container");
            assert.ok(el!.innerHTML.includes("No agents running"));
        });

        it("shows placeholder when agents array is empty", () => {
            mockState.agentData = { agents: [], swarms: [], telemetry: {} };
            mod.renderAgentList();
            const el = dom.window.document.getElementById("agent-list-container");
            assert.ok(el!.innerHTML.includes("No agents running"));
        });

        it("renders agent cards with name, role, and action buttons", () => {
            mockState.agentData = {
                agents: [
                    { id: "chat", name: "Chat Agent", role: "chat", status: "running", tasksCompleted: 10 },
                    { id: "coder", name: "Coder Agent", role: "coder", status: "error", tasksCompleted: 3 },
                ],
                swarms: [],
                telemetry: {},
            };
            mod.renderAgentList();
            const el = dom.window.document.getElementById("agent-list-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("Chat Agent"), "should show agent name");
            assert.ok(html.includes("Coder Agent"), "should show second agent");
            assert.ok(html.includes("chat"), "should show role");
            assert.ok(html.includes("coder"), "should show role");
            assert.ok(html.includes("10 tasks"), "should show task count");
            assert.ok(html.includes("stopAgent"), "should have stop button");
            assert.ok(html.includes("promoteAgent"), "should have promote button");
            assert.ok(html.includes("demoteAgent"), "should have demote button");
        });

        it("shows correct status colors", () => {
            mockState.agentData = {
                agents: [
                    { id: "a1", name: "A1", role: "chat", status: "running", tasksCompleted: 0 },
                    { id: "a2", name: "A2", role: "chat", status: "error", tasksCompleted: 0 },
                ],
                swarms: [],
                telemetry: {},
            };
            mod.renderAgentList();
            const el = dom.window.document.getElementById("agent-list-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("#7ecf7e"), "running should be green");
            assert.ok(html.includes("#ff8d8d"), "error should be red");
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  renderSubAgentTree
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("renderSubAgentTree", () => {
        it("shows placeholder when no agents", () => {
            mockState.agentData = null;
            mod.renderSubAgentTree();
            const el = dom.window.document.getElementById("sub-agent-tree-container");
            assert.ok(el!.innerHTML.includes("Agent hierarchy will appear"));
        });

        it("renders orchestrator root with agent tree nodes", () => {
            mockState.agentData = {
                agents: [
                    { id: "chat", name: "Chat", role: "chat" },
                    { id: "coder", name: "Coder", role: "coder" },
                ],
                swarms: [],
                telemetry: {},
            };
            mod.renderSubAgentTree();
            const el = dom.window.document.getElementById("sub-agent-tree-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("Orchestrator"), "should show orchestrator root");
            assert.ok(html.includes("Chat"), "should show first agent");
            assert.ok(html.includes("Coder"), "should show second agent");
            // Should use tree branch characters
            assert.ok(html.includes("\u2514") || html.includes("\u251C"), "should use tree branch chars");
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  renderSwarmTopology
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("renderSwarmTopology", () => {
        it("shows placeholder when no swarms", () => {
            mockState.agentData = null;
            mod.renderSwarmTopology();
            const el = dom.window.document.getElementById("swarm-topology-container");
            assert.ok(el!.innerHTML.includes("No swarms configured"));
        });

        it("renders swarm cards with name, topology, agent count, status", () => {
            mockState.agentData = {
                agents: [],
                swarms: [
                    { id: "sw1", name: "Analysis Swarm", topology: "mesh", agentCount: 4, status: "running" },
                    { id: "sw2", name: "Pipeline", topology: "pipeline", agentCount: 3, status: "completed" },
                ],
                telemetry: {},
            };
            mod.renderSwarmTopology();
            const el = dom.window.document.getElementById("swarm-topology-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("Analysis Swarm"), "should show swarm name");
            assert.ok(html.includes("mesh"), "should show mesh topology");
            assert.ok(html.includes("pipeline"), "should show pipeline topology");
            assert.ok(html.includes("4 agents"), "should show agent count");
            assert.ok(html.includes("running"), "should show status");
            assert.ok(html.includes("completed"), "should show completed status");
        });
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  renderAgentTelemetry
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("renderAgentTelemetry", () => {
        it("renders 5 metric cards with zero values when no telemetry", () => {
            mockState.agentData = null;
            mod.renderAgentTelemetry();
            const el = dom.window.document.getElementById("agent-telemetry-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("Active Agents"), "should have Active Agents card");
            assert.ok(html.includes("Tasks Completed"), "should have Tasks Completed card");
            assert.ok(html.includes("Error Rate"), "should have Error Rate card");
            assert.ok(html.includes("Avg Response"), "should have Avg Response card");
            assert.ok(html.includes("Total Dispatches"), "should have Total Dispatches card");
            assert.ok(html.includes("0%"), "error rate should be 0%");
        });

        it("renders correct values from telemetry data", () => {
            mockState.agentData = {
                agents: [],
                swarms: [],
                telemetry: {
                    activeAgents: 3,
                    tasksCompleted: 42,
                    tasksFailed: 8,
                    avgResponseMs: 250,
                    totalDispatches: 50,
                },
            };
            mod.renderAgentTelemetry();
            const el = dom.window.document.getElementById("agent-telemetry-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("3"), "should show 3 active agents");
            assert.ok(html.includes("42"), "should show 42 tasks completed");
            assert.ok(html.includes("250ms"), "should show avg response time");
            assert.ok(html.includes("50"), "should show total dispatches");
        });

        it("colors error rate red when above 10%", () => {
            mockState.agentData = {
                agents: [],
                swarms: [],
                telemetry: {
                    activeAgents: 1,
                    tasksCompleted: 5,
                    tasksFailed: 5,
                    avgResponseMs: 100,
                    totalDispatches: 10,
                },
            };
            mod.renderAgentTelemetry();
            const el = dom.window.document.getElementById("agent-telemetry-container");
            const html = el!.innerHTML;
            // 50% error rate should trigger red (#ff8d8d)
            assert.ok(html.includes("#ff8d8d"), "error rate >10% should be red");
            assert.ok(html.includes("50%"), "should show 50% error rate");
        });

        it("uses accent color for error rate at or below 10%", () => {
            mockState.agentData = {
                agents: [],
                swarms: [],
                telemetry: {
                    activeAgents: 1,
                    tasksCompleted: 95,
                    tasksFailed: 5,
                    avgResponseMs: 100,
                    totalDispatches: 100,
                },
            };
            mod.renderAgentTelemetry();
            const el = dom.window.document.getElementById("agent-telemetry-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("5%"), "should show 5% error rate");
            // 5% error rate should use accent color, not red
            // The error rate card's value div should contain var(--accent). 
            // We check that #ff8d8d does NOT appear in the error rate context
            // (note: it may appear elsewhere for other elements, so we check the 5% is not red)
            const errorRateSection = html.split("Error Rate")[1]?.split("Avg Response")[0] || "";
            assert.ok(!errorRateSection.includes("#ff8d8d"), "5% error rate should not be red");
        });

        it("shows dash for avg response when zero", () => {
            mockState.agentData = {
                agents: [],
                swarms: [],
                telemetry: {
                    activeAgents: 0,
                    tasksCompleted: 0,
                    tasksFailed: 0,
                    avgResponseMs: 0,
                    totalDispatches: 0,
                },
            };
            mod.renderAgentTelemetry();
            const el = dom.window.document.getElementById("agent-telemetry-container");
            const html = el!.innerHTML;
            assert.ok(html.includes("\u2014"), "should show dash for zero avg response");
        });
    });
});
