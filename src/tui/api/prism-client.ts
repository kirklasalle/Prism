/**
 * PRISM TUI — Typed HTTP API client for the PRISM Dashboard service.
 * Connects to the running PRISM server (default localhost:7070).
 */
import http from "node:http";

export interface PrismClientOptions {
    baseUrl: string;
    timeout?: number;
}

/* ------------------------------------------------------------------ */
/*  Shared response types                                              */
/* ------------------------------------------------------------------ */

export interface HealthResponse {
    status: string;
}

export interface SessionInfo {
    id: string;
    label: string;
    createdAt: string;
    messageCount: number;
}

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp?: string;
    tokenUsage?: { prompt: number; completion: number; total: number };
}

export interface ToolState {
    name: string;
    category: string;
    description: string;
    riskTier: number;
    enabled: boolean;
    invocations: number;
    successes: number;
    failures: number;
    avgLatencyMs: number;
    lastInvoked?: string;
    lastError?: string;
}

export interface PluginState {
    name: string;
    enabled: boolean;
    healthy: boolean;
    requests: number;
    errors: number;
    avgResponseMs: number;
    lastChecked?: string;
}

export interface UtilityState {
    name: string;
    lastResult?: string;
    runCount: number;
    lastRun?: string;
}

export interface AgentInfo {
    id: string;
    role: string;
    tier: string;
    model?: string;
    status: string;
    idleSince?: string;
    dispatchCount: number;
}

export interface SwarmInfo {
    id: string;
    topology: string;
    agentCount: number;
    status: string;
    createdAt: string;
}

export interface EventRecord {
    id: string;
    type: string;
    operation: string;
    timestamp: string;
    detail?: Record<string, unknown>;
}

export interface LlmConfig {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    apiKey?: string;
}

export interface SystemInfo {
    os: string;
    arch: string;
    cpus: number;
    totalMemory: number;
    freeMemory: number;
    uptime: number;
    nodeVersion: string;
    platform: string;
}

export interface NetworkInterface {
    name: string;
    address: string;
    family: string;
    mac: string;
    internal: boolean;
}

export interface SchedulerEvent {
    id: string;
    title: string;
    start: string;
    end?: string;
    category: string;
    recurring?: boolean;
    cron?: string;
}

export interface ProjectInfo {
    id: string;
    name: string;
    status: string;
    milestones: number;
    tasks: number;
}

export interface DiagnosticsReport {
    generatedAt: string;
    summary: Record<string, unknown>;
    suites?: Array<Record<string, unknown>>;
}

export interface ApprovalItem {
    id: string;
    operation: string;
    riskTier: number;
    status: string;
    requestedAt: string;
    detail?: Record<string, unknown>;
}

export interface ModelProfile {
    id: string;
    provider: string;
    model: string;
    tier: number;
    modalities: string[];
    deprecated: boolean;
}

export interface AuditEntry {
    timestamp: string;
    action: string;
    detail: Record<string, unknown>;
}

export interface BrowserSessionInfo {
    active: boolean;
    url?: string;
    title?: string;
    headless: boolean;
}

export interface WorkspaceFile {
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number;
}

export interface CharacterInfo {
    name: string;
    displayName: string;
    executionProfile: string;
    maxRiskTier: number;
    tags: string[];
}

export interface TelemetrySummary {
    totalEvents: number;
    errorCount: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    uptimeSeconds: number;
}

export interface RetrievalCohort {
    cohortId: string;
    hitRate: number;
    coverage: number;
    novelty: number;
    utility: number;
    p95LatencyMs: number;
}

export interface AlertInfo {
    id: string;
    priority: string;
    metric: string;
    threshold: number;
    currentValue: number;
    triggeredAt: string;
}

/* ------------------------------------------------------------------ */
/*  Setup Wizard types                                                 */
/* ------------------------------------------------------------------ */

export interface SetupStatus {
    setupComplete: boolean;
    executionProfileSegment: string;
    workspaceRoot: string;
}

export interface PrerequisiteCheck {
    id: string;
    label: string;
    passed: boolean;
    detail: string;
}

export interface SetupPrerequisites {
    checks: PrerequisiteCheck[];
}

/* ------------------------------------------------------------------ */
/*  HTTP Client                                                        */
/* ------------------------------------------------------------------ */

export class PrismClient {
    private baseUrl: string;
    private timeout: number;

    constructor(opts?: Partial<PrismClientOptions>) {
        this.baseUrl = opts?.baseUrl ?? "http://localhost:7070";
        this.timeout = opts?.timeout ?? 10_000;
    }

    /* ---- low-level ---- */

    private request<T>(method: string, path: string, body?: unknown): Promise<T> {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const payload = body ? JSON.stringify(body) : undefined;
            const req = http.request(
                url,
                {
                    method,
                    headers: {
                        "Content-Type": "application/json",
                        ...(payload ? { "Content-Length": Buffer.byteLength(payload).toString() } : {}),
                    },
                    timeout: this.timeout,
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk: Buffer) => (data += chunk.toString()));
                    res.on("end", () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                resolve(data ? (JSON.parse(data) as T) : ({} as T));
                            } catch {
                                resolve(data as unknown as T);
                            }
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        }
                    });
                },
            );
            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy();
                reject(new Error(`Request timeout: ${method} ${path}`));
            });
            if (payload) req.write(payload);
            req.end();
        });
    }

    private get<T>(path: string): Promise<T> {
        return this.request<T>("GET", path);
    }
    private post<T>(path: string, body?: unknown): Promise<T> {
        return this.request<T>("POST", path, body);
    }
    private del<T>(path: string): Promise<T> {
        return this.request<T>("DELETE", path);
    }

    /* ---- Health ---- */
    getHealth(): Promise<HealthResponse> {
        return this.get("/api/health");
    }

    /* ---- Chat & Sessions ---- */
    getSessions(): Promise<SessionInfo[]> {
        return this.get("/api/sessions");
    }
    createSession(label?: string): Promise<SessionInfo> {
        return this.post("/api/sessions", { label });
    }
    deleteSession(id: string): Promise<void> {
        return this.del(`/api/sessions/${encodeURIComponent(id)}`);
    }
    getMessages(sessionId: string): Promise<ChatMessage[]> {
        return this.get(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
    }
    sendChat(message: string, sessionId?: string): Promise<{ response: string; sessionId: string }> {
        return this.post("/api/chat", { message, sessionId });
    }

    /* ---- LLM Configuration ---- */
    getLlmConfig(): Promise<LlmConfig> {
        return this.get("/api/llm/config");
    }
    setLlmConfig(config: Partial<LlmConfig>): Promise<LlmConfig> {
        return this.post("/api/llm/config", config);
    }
    getModelMatrix(): Promise<ModelProfile[]> {
        return this.get("/api/models/matrix");
    }
    getAuditTrail(): Promise<AuditEntry[]> {
        return this.get("/api/llm/audit-trail");
    }

    /* ---- Tools & Plugins ---- */
    getToolsStatus(): Promise<ToolState[]> {
        return this.get("/api/tools/status");
    }
    getPluginsStatus(): Promise<PluginState[]> {
        return this.get("/api/plugins/status");
    }
    getUtilitiesStatus(): Promise<UtilityState[]> {
        return this.get("/api/utilities/status");
    }
    testTool(name: string): Promise<{ result: string }> {
        return this.post(`/api/tools/${encodeURIComponent(name)}/test`);
    }

    /* ---- Diagnostics ---- */
    runDiagnostics(suite: string): Promise<{ started: boolean }> {
        return this.post(`/api/diagnostics/${encodeURIComponent(suite)}/run`);
    }
    getDiagnosticsReport(suite: string): Promise<DiagnosticsReport> {
        return this.get(`/api/diagnostics/${encodeURIComponent(suite)}/report`);
    }
    getDiagnosticsStatus(suite: string): Promise<{ running: boolean }> {
        return this.get(`/api/diagnostics/${encodeURIComponent(suite)}/status`);
    }

    /* ---- Agents ---- */
    getAgents(): Promise<AgentInfo[]> {
        return this.get("/api/agents");
    }
    spawnAgent(role: string, tier?: string, model?: string): Promise<AgentInfo> {
        return this.post("/api/agents/spawn", { role, tier, model });
    }
    stopAgent(id: string): Promise<void> {
        return this.post(`/api/agents/${encodeURIComponent(id)}/stop`);
    }
    promoteAgent(id: string): Promise<AgentInfo> {
        return this.post(`/api/agents/${encodeURIComponent(id)}/promote`);
    }
    setAgentModel(id: string, model: string): Promise<AgentInfo> {
        return this.post(`/api/agents/${encodeURIComponent(id)}/model`, { model });
    }
    getAgentTelemetry(): Promise<Record<string, unknown>> {
        return this.get("/api/agents/telemetry");
    }
    getCharacters(): Promise<CharacterInfo[]> {
        return this.get("/api/characters");
    }

    /* ---- Swarms ---- */
    getSwarms(): Promise<SwarmInfo[]> {
        return this.get("/api/swarms");
    }
    createSwarm(topology: string, agents: string[]): Promise<SwarmInfo> {
        return this.post("/api/swarms", { topology, agents });
    }

    /* ---- Computer Control ---- */
    getSystemInfo(): Promise<SystemInfo> {
        return this.get("/api/computer/system-info");
    }
    executeShell(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        return this.post("/api/computer/shell", { command });
    }
    getDevices(): Promise<Array<Record<string, unknown>>> {
        return this.get("/api/computer/devices");
    }
    captureScreenshot(): Promise<{ path: string }> {
        return this.post("/api/computer/screenshot");
    }

    /* ---- Browser Control ---- */
    getBrowserSession(): Promise<BrowserSessionInfo> {
        return this.get("/api/browser/session");
    }
    launchBrowser(headless?: boolean): Promise<BrowserSessionInfo> {
        return this.post("/api/browser/launch", { headless });
    }
    closeBrowser(): Promise<void> {
        return this.post("/api/browser/close");
    }
    navigateBrowser(url: string): Promise<{ title: string; url: string }> {
        return this.post("/api/browser/navigate", { url });
    }
    getBrowserConsole(): Promise<Array<{ level: string; message: string; timestamp: string }>> {
        return this.get("/api/browser/console");
    }

    /* ---- Workspace ---- */
    getWorkspaceFiles(path?: string): Promise<WorkspaceFile[]> {
        const q = path ? `?path=${encodeURIComponent(path)}` : "";
        return this.get(`/api/workspace/files${q}`);
    }
    getWorkspaceGit(): Promise<Record<string, unknown>> {
        return this.get("/api/workspace/git");
    }

    /* ---- Network ---- */
    getNetworkInterfaces(): Promise<NetworkInterface[]> {
        return this.get("/api/network/interfaces");
    }
    getNetworkCommands(): Promise<Array<{ name: string; tier: number; platform: string; description: string }>> {
        return this.get("/api/network/commands");
    }
    executeNetworkCommand(command: string): Promise<{ output: string }> {
        return this.post("/api/network/execute", { command });
    }

    /* ---- Telemetry & Events ---- */
    getEvents(limit?: number, operation?: string): Promise<EventRecord[]> {
        const params = new URLSearchParams();
        if (limit) params.set("limit", String(limit));
        if (operation) params.set("operation", operation);
        const q = params.toString();
        return this.get(`/api/events${q ? `?${q}` : ""}`);
    }
    getTelemetrySummary(): Promise<TelemetrySummary> {
        return this.get("/api/telemetry/summary");
    }
    getRetrievalCohorts(): Promise<RetrievalCohort[]> {
        return this.get("/api/retrieval/cohorts");
    }
    getRetrievalAlerts(): Promise<AlertInfo[]> {
        return this.get("/api/retrieval/alerts");
    }

    /* ---- Approval Queue ---- */
    getPendingApprovals(): Promise<ApprovalItem[]> {
        return this.get("/api/approval/pending");
    }
    approveItem(id: string): Promise<void> {
        return this.post(`/api/approval/${encodeURIComponent(id)}/approve`);
    }
    denyItem(id: string): Promise<void> {
        return this.post(`/api/approval/${encodeURIComponent(id)}/deny`);
    }

    /* ---- Scheduler ---- */
    getSchedulerEvents(): Promise<SchedulerEvent[]> {
        return this.get("/api/scheduler/events");
    }
    createSchedulerEvent(event: Partial<SchedulerEvent>): Promise<SchedulerEvent> {
        return this.post("/api/scheduler/events", event);
    }
    deleteSchedulerEvent(id: string): Promise<void> {
        return this.del(`/api/scheduler/events/${encodeURIComponent(id)}`);
    }
    getProjects(): Promise<ProjectInfo[]> {
        return this.get("/api/scheduler/projects");
    }
    getSchedulerTasks(): Promise<Array<Record<string, unknown>>> {
        return this.get("/api/scheduler/tasks");
    }

    /* ---- Setup Wizard ---- */
    getSetupStatus(): Promise<SetupStatus> {
        return this.get("/api/setup/status");
    }
    getSetupPrerequisites(): Promise<SetupPrerequisites> {
        return this.get("/api/setup/prerequisites");
    }
    postSetupProfile(segment: string): Promise<{ executionProfileSegment: string }> {
        return this.post("/api/setup/profile", { executionProfileSegment: segment });
    }
    postSetupWorkspace(root: string): Promise<{ workspaceRoot: string }> {
        return this.post("/api/setup/workspace", { workspaceRoot: root });
    }
    postSetupComplete(): Promise<{ setupComplete: boolean; readiness: Record<string, unknown> }> {
        return this.post("/api/setup/complete");
    }
}
