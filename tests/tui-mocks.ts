/**
 * PRISM TUI — Shared mock factories for unit and integration tests.
 *
 * Provides:
 *   - createMockClient()    — PrismClient-shaped stub (all methods → Promise.resolve)
 *   - createMockWsClient()  — EventEmitter-based PrismWsClient stub
 *   - MOCK_* constants       — Canonical test data for every response type
 */
import { EventEmitter } from "node:events";
import type { PrismClient } from "../src/tui/api/prism-client.js";
import type {
    HealthResponse, SessionInfo, ChatMessage, ToolState, PluginState,
    UtilityState, AgentInfo, SwarmInfo, EventRecord, LlmConfig, SystemInfo,
    NetworkInterface, SchedulerEvent, ProjectInfo, ApprovalItem, ModelProfile,
    AuditEntry, BrowserSessionInfo, WorkspaceFile, CharacterInfo,
    TelemetrySummary, RetrievalCohort, AlertInfo, DiagnosticsReport,
} from "../src/tui/api/prism-client.js";
import type { PrismWsClient } from "../src/tui/api/ws-client.js";

/* ------------------------------------------------------------------ */
/*  Mock data constants                                                */
/* ------------------------------------------------------------------ */

export const MOCK_HEALTH: HealthResponse = { status: "ok" };

export const MOCK_SESSIONS: SessionInfo[] = [
    { id: "s-1", label: "General", createdAt: "2026-04-01T00:00:00Z", messageCount: 3 },
    { id: "s-2", label: "Research", createdAt: "2026-04-02T00:00:00Z", messageCount: 7 },
];

export const MOCK_MESSAGES: ChatMessage[] = [
    { role: "user", content: "Hello", timestamp: "2026-04-01T00:00:01Z" },
    { role: "assistant", content: "Hi there!", timestamp: "2026-04-01T00:00:02Z" },
];

export const MOCK_LLM_CONFIG: LlmConfig = {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.7,
    maxTokens: 4096,
    apiKey: "sk-abc123",
};

export const MOCK_TOOLS: ToolState[] = [
    { name: "readFile", category: "filesystem", description: "Read file contents", riskTier: 1, enabled: true, invocations: 42, successes: 40, failures: 2, avgLatencyMs: 12 },
    { name: "shellExec", category: "system", description: "Execute shell command", riskTier: 3, enabled: true, invocations: 10, successes: 9, failures: 1, avgLatencyMs: 250 },
];

export const MOCK_PLUGINS: PluginState[] = [
    { name: "nexus-bridge", enabled: true, healthy: true, requests: 100, errors: 1, avgResponseMs: 45 },
];

export const MOCK_UTILITIES: UtilityState[] = [
    { name: "lint", lastResult: "pass", runCount: 5, lastRun: "2026-04-10T12:00:00Z" },
];

export const MOCK_AGENTS: AgentInfo[] = [
    { id: "a-1", role: "analyst", tier: "tier2", model: "gpt-4o", status: "running", dispatchCount: 15 },
    { id: "a-2", role: "coder", tier: "tier1", status: "idle", dispatchCount: 3 },
];

export const MOCK_SWARMS: SwarmInfo[] = [
    { id: "sw-1", topology: "star", agentCount: 4, status: "active", createdAt: "2026-04-01T00:00:00Z" },
];

export const MOCK_EVENTS: EventRecord[] = [
    { id: "e-1", type: "tool_invocation", operation: "readFile", timestamp: "2026-04-10T12:00:00Z" },
    { id: "e-2", type: "approval", operation: "shellExec", timestamp: "2026-04-10T12:01:00Z" },
];

export const MOCK_SYSTEM_INFO: SystemInfo = {
    os: "win32", arch: "x64", cpus: 8, totalMemory: 17179869184, freeMemory: 8589934592, uptime: 86400, nodeVersion: "v22.0.0", platform: "win32",
};

export const MOCK_NETWORK_INTERFACES: NetworkInterface[] = [
    { name: "eth0", address: "192.168.1.100", family: "IPv4", mac: "00:11:22:33:44:55", internal: false },
    { name: "lo", address: "127.0.0.1", family: "IPv4", mac: "00:00:00:00:00:00", internal: true },
];

export const MOCK_SCHEDULER_EVENTS: SchedulerEvent[] = [
    { id: "ev-1", title: "Daily standup", start: "2026-04-10T09:00:00Z", category: "meeting", recurring: true, cron: "0 9 * * *" },
];

export const MOCK_PROJECTS: ProjectInfo[] = [
    { id: "p-1", name: "PRISM Core", status: "active", milestones: 3, tasks: 12 },
];

export const MOCK_APPROVALS: ApprovalItem[] = [
    { id: "ap-1", operation: "shellExec", riskTier: 3, status: "pending", requestedAt: "2026-04-10T12:00:00Z" },
];

export const MOCK_MODEL_MATRIX: ModelProfile[] = [
    { id: "m-1", provider: "openai", model: "gpt-4o", tier: 1, modalities: ["text"], deprecated: false },
    { id: "m-2", provider: "anthropic", model: "claude-3", tier: 2, modalities: ["text", "vision"], deprecated: false },
];

export const MOCK_AUDIT_TRAIL: AuditEntry[] = [
    { timestamp: "2026-04-10T12:00:00Z", action: "config_change", detail: { field: "model", oldValue: "gpt-3.5", newValue: "gpt-4o" } },
];

export const MOCK_BROWSER_SESSION: BrowserSessionInfo = {
    active: true, url: "https://example.com", title: "Example", headless: true,
};

export const MOCK_WORKSPACE_FILES: WorkspaceFile[] = [
    { name: "src", path: "/src", isDirectory: true },
    { name: "README.md", path: "/README.md", isDirectory: false, size: 1024 },
];

export const MOCK_CHARACTERS: CharacterInfo[] = [
    { name: "phoenix", displayName: "Phoenix", executionProfile: "business", maxRiskTier: 3, tags: ["general"] },
    { name: "aria", displayName: "Aria", executionProfile: "individual", maxRiskTier: 2, tags: ["creative"] },
];

export const MOCK_TELEMETRY_SUMMARY: TelemetrySummary = {
    totalEvents: 500, errorCount: 3, avgLatencyMs: 25, p95LatencyMs: 48, uptimeSeconds: 86400,
};

export const MOCK_RETRIEVAL_COHORTS: RetrievalCohort[] = [
    { cohortId: "c-1", hitRate: 0.92, coverage: 0.85, novelty: 0.3, utility: 0.88, p95LatencyMs: 42 },
];

export const MOCK_ALERTS: AlertInfo[] = [
    { id: "al-1", priority: "high", metric: "errorRate", threshold: 0.05, currentValue: 0.08, triggeredAt: "2026-04-10T12:00:00Z" },
];

export const MOCK_DIAGNOSTICS_REPORT: DiagnosticsReport = {
    generatedAt: "2026-04-10T12:00:00Z",
    summary: { passed: 9, failed: 0, total: 9 },
};

/* ------------------------------------------------------------------ */
/*  Mock PrismClient                                                   */
/* ------------------------------------------------------------------ */

/**
 * Creates a mock PrismClient where every method returns a resolved
 * promise with canonical mock data. Override individual methods per test.
 */
export function createMockClient(overrides?: Partial<Record<keyof PrismClient, (...args: unknown[]) => unknown>>): PrismClient {
    const base: Record<string, (...args: unknown[]) => unknown> = {
        getHealth: () => Promise.resolve(MOCK_HEALTH),
        getSessions: () => Promise.resolve(MOCK_SESSIONS),
        createSession: () => Promise.resolve(MOCK_SESSIONS[0]!),
        deleteSession: () => Promise.resolve(undefined),
        getMessages: () => Promise.resolve(MOCK_MESSAGES),
        sendChat: () => Promise.resolve({ response: "OK", sessionId: "s-1" }),
        getLlmConfig: () => Promise.resolve(MOCK_LLM_CONFIG),
        setLlmConfig: () => Promise.resolve(MOCK_LLM_CONFIG),
        getModelMatrix: () => Promise.resolve(MOCK_MODEL_MATRIX),
        getAuditTrail: () => Promise.resolve(MOCK_AUDIT_TRAIL),
        getToolsStatus: () => Promise.resolve(MOCK_TOOLS),
        getPluginsStatus: () => Promise.resolve(MOCK_PLUGINS),
        getUtilitiesStatus: () => Promise.resolve(MOCK_UTILITIES),
        testTool: () => Promise.resolve({ result: "pass" }),
        runDiagnostics: () => Promise.resolve({ started: true }),
        getDiagnosticsReport: () => Promise.resolve(MOCK_DIAGNOSTICS_REPORT),
        getDiagnosticsStatus: () => Promise.resolve({ running: false }),
        getAgents: () => Promise.resolve(MOCK_AGENTS),
        spawnAgent: () => Promise.resolve(MOCK_AGENTS[0]!),
        stopAgent: () => Promise.resolve(undefined),
        promoteAgent: () => Promise.resolve(undefined),
        setAgentModel: () => Promise.resolve(undefined),
        getAgentTelemetry: () => Promise.resolve({ totalDispatches: 18, avgLatencyMs: 30 }),
        getCharacters: () => Promise.resolve(MOCK_CHARACTERS),
        getSwarms: () => Promise.resolve(MOCK_SWARMS),
        createSwarm: () => Promise.resolve(MOCK_SWARMS[0]!),
        getSystemInfo: () => Promise.resolve(MOCK_SYSTEM_INFO),
        executeShell: () => Promise.resolve({ stdout: "hello", stderr: "", exitCode: 0 }),
        getDevices: () => Promise.resolve([]),
        captureScreenshot: () => Promise.resolve({ path: "/tmp/ss.png" }),
        getBrowserSession: () => Promise.resolve(MOCK_BROWSER_SESSION),
        launchBrowser: () => Promise.resolve({ active: true }),
        closeBrowser: () => Promise.resolve(undefined),
        navigateBrowser: () => Promise.resolve({ url: "https://example.com" }),
        getBrowserConsole: () => Promise.resolve([]),
        getWorkspaceFiles: () => Promise.resolve(MOCK_WORKSPACE_FILES),
        getWorkspaceGit: () => Promise.resolve({ branch: "main", status: "clean", ahead: 0, behind: 0 }),
        getNetworkInterfaces: () => Promise.resolve(MOCK_NETWORK_INTERFACES),
        getNetworkCommands: () => Promise.resolve([{ name: "ping", platform: "all", riskTier: 1 }]),
        executeNetworkCommand: () => Promise.resolve({ output: "pong", exitCode: 0 }),
        getEvents: () => Promise.resolve(MOCK_EVENTS),
        getTelemetrySummary: () => Promise.resolve(MOCK_TELEMETRY_SUMMARY),
        getRetrievalCohorts: () => Promise.resolve(MOCK_RETRIEVAL_COHORTS),
        getRetrievalAlerts: () => Promise.resolve(MOCK_ALERTS),
        getPendingApprovals: () => Promise.resolve(MOCK_APPROVALS),
        approveItem: () => Promise.resolve(undefined),
        denyItem: () => Promise.resolve(undefined),
        getSchedulerEvents: () => Promise.resolve(MOCK_SCHEDULER_EVENTS),
        createSchedulerEvent: () => Promise.resolve(MOCK_SCHEDULER_EVENTS[0]!),
        deleteSchedulerEvent: () => Promise.resolve(undefined),
        getProjects: () => Promise.resolve(MOCK_PROJECTS),
        getSchedulerTasks: () => Promise.resolve([{ id: "t-1", title: "Fix bug", status: "In Progress", projectId: "p-1" }]),
    };

    // Apply overrides
    if (overrides) {
        for (const [key, fn] of Object.entries(overrides)) {
            base[key] = fn;
        }
    }

    return base as unknown as PrismClient;
}

/* ------------------------------------------------------------------ */
/*  Mock PrismWsClient                                                 */
/* ------------------------------------------------------------------ */

/**
 * Creates a mock PrismWsClient backed by EventEmitter.
 * Extends EventEmitter directly (matching PrismWsClient's inheritance).
 */
class MockWsClient extends EventEmitter {
    private _mockConnected = false;

    get connected() { return this._mockConnected; }

    connect() {
        this._mockConnected = true;
        this.emit("connection", { connected: true });
    }

    disconnect() {
        this._mockConnected = false;
        this.emit("connection", { connected: false });
    }

    simulateMessage(type: string, data: Record<string, unknown> = {}) {
        const msg = { type, ...data };
        this.emit("message", msg);
        this.emit(type, msg);
    }
}

export type MockWsClientType = MockWsClient;

export function createMockWsClient(): PrismWsClient & { simulateMessage: (type: string, data?: Record<string, unknown>) => void; connect: () => void; disconnect: () => void } {
    return new MockWsClient() as unknown as PrismWsClient & { simulateMessage: (type: string, data?: Record<string, unknown>) => void; connect: () => void; disconnect: () => void };
}
