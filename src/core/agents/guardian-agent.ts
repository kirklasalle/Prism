import { EventEmitter } from "node:events";
import { existsSync, openSync, readSync, closeSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import type { ActivityBus } from "../activity/bus.js";
import type { Tool, ToolRequest, ToolResult } from "../tools/types.js";
import type { LlamaCppSupervisor, LlamaModelSlot } from "../operator/llama-cpp-supervisor.js";
import type { AgentLifecycleTier, AgentState } from "./agent-types.js";
import { verifyDirectiveIntegrity } from "../security/directive-integrity.js";
import type { AABLedgerEntry } from "../runtime/autonomous-agent-loop.js";
import type { CovenantStatus } from "../governance/prism-covenant.js";

// ──────────────────────────────────────────────────────────────────────────────
// Guardian Agent — Permanent autonomous system agent powered by llama.cpp
// ──────────────────────────────────────────────────────────────────────────────

export interface GuardianConfig {
    /** Model alias to use from the llama.cpp supervisor. */
    modelAlias: string;
    /** Path to GGUF model file. */
    modelPath: string;
    /** Authority tier: tier2_conditional (default) escalates destructive ops. */
    authorityTier: "tier1_autonomous" | "tier2_conditional";
    /** Health check interval in ms. Default 30000 (30s). */
    healthCheckIntervalMs: number;
    /** Auto-start the Guardian when Prism boots. Default true. */
    autoStart: boolean;
    /** Context size for the Guardian model. Default 4096. */
    contextSize: number;
    /** Draft model path for speculative decoding (optional). */
    draftModelPath?: string;
    /** GPU layers to offload. null = auto. */
    gpuLayers?: number;
    /** Enable flash attention. */
    flashAttn?: boolean;
    /** Source of the model (e.g. 'workspace', 'ollama', 'workspace-models'). */
    modelSource?: string;
    /** Base URL for dashboard self-calls (default: http://localhost:7070). */
    dashboardBaseUrl?: string;
}

export interface GuardianStatus {
    state: GuardianState;
    modelAlias: string;
    modelPath: string;
    modelSource: string;
    authorityTier: string;
    uptime: number;
    healthChecks: number;
    issuesDetected: number;
    issuesResolved: number;
    lastHealthCheck: string | null;
    lastAction: string | null;
    recentActions: GuardianActionEntry[];
    slotInfo: LlamaModelSlot | null;
}

export interface GuardianActionEntry {
    timestamp: string;
    action: string;
    result: "success" | "failure" | "escalated";
    detail: string;
}

export type GuardianState = "stopped" | "starting" | "waiting" | "running" | "error" | "healing";

export type GuardianTaskCategory = "maintenance" | "security" | "diagnostics" | "monitoring";

export interface GuardianTask {
    id: string;
    name: string;
    category: GuardianTaskCategory;
    intervalMs: number;
    enabled: boolean;
    lastRunAt: string | null;
    lastResult: "success" | "warning" | "failure" | null;
    lastDetail: string | null;
}

const GUARDIAN_TASK_CATALOG: Omit<GuardianTask, "lastRunAt" | "lastResult" | "lastDetail">[] = [
    // Maintenance — every 5 minutes
    { id: "disk_space_check", name: "Disk Space Check", category: "maintenance", intervalMs: 300000, enabled: true },
    { id: "temp_cleanup", name: "Temp File Cleanup", category: "maintenance", intervalMs: 300000, enabled: true },
    { id: "memory_audit", name: "Memory Usage Audit", category: "maintenance", intervalMs: 300000, enabled: true },
    { id: "model_integrity", name: "Model File Integrity", category: "maintenance", intervalMs: 300000, enabled: true },
    // Security — every 10 minutes
    { id: "command_filter_verify", name: "Command Filter Self-Test", category: "security", intervalMs: 600000, enabled: true },
    { id: "env_secrets_scan", name: "Environment Secrets Scan", category: "security", intervalMs: 600000, enabled: true },
    { id: "endpoint_access_audit", name: "Endpoint Accessibility Audit", category: "security", intervalMs: 600000, enabled: true },
    { id: "directive_integrity", name: "Directive Integrity Check", category: "security", intervalMs: 600000, enabled: true },
    // Diagnostics — every 15 minutes
    { id: "knowledge_graph_check", name: "Knowledge Graph Health", category: "diagnostics", intervalMs: 900000, enabled: true },
    { id: "tool_contract_audit", name: "Tool Contract Audit", category: "diagnostics", intervalMs: 900000, enabled: true },
    { id: "agent_health_check", name: "Agent Health Check", category: "diagnostics", intervalMs: 900000, enabled: true },
    // Monitoring — every 2 minutes
    { id: "system_snapshot", name: "System Resource Snapshot", category: "monitoring", intervalMs: 120000, enabled: true },
    { id: "agent_census", name: "Agent Census", category: "monitoring", intervalMs: 120000, enabled: true },
    { id: "log_volume_analysis", name: "Log Volume Analysis", category: "monitoring", intervalMs: 120000, enabled: true },
    // MCP self-heal — every 60s, kick stuck/down servers back up.
    { id: "mcp_health_recovery", name: "MCP Health & Recovery", category: "monitoring", intervalMs: 60000, enabled: true },
    // AAB Ledger — every 30s, check for anomalous autonomous behavior.
    { id: "aab_ledger_monitor", name: "AAB Ledger Monitor", category: "monitoring", intervalMs: 30000, enabled: true },
    // Covenant integrity — every 5 minutes, audit the Sacred Covenant.
    { id: "covenant_audit", name: "Covenant Integrity Audit", category: "security", intervalMs: 300000, enabled: true },
];

const DEFAULT_CONFIG: GuardianConfig = {
    modelAlias: "guardian",
    modelPath: "",
    authorityTier: "tier2_conditional",
    healthCheckIntervalMs: 30000,
    autoStart: true,
    contextSize: 4096,
    flashAttn: true,
};

/**
 * The Guardian Agent is a permanent, always-on agent powered by llama.cpp.
 * It serves as Prism's autonomous operator for system maintenance,
 * self-debugging, protection, and independent operation.
 *
 * Lifecycle: permanent (never auto-reaped)
 * Model: configurable llama.cpp model with optional speculative decoding
 * Authority: tier2_conditional by default (escalates high-risk)
 */
export class GuardianAgent extends EventEmitter {
    readonly lifecycle: AgentLifecycleTier = "permanent";

    private _state: GuardianState = "stopped";
    private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
    private waitingTimer: ReturnType<typeof setInterval> | null = null;
    private startedAt: number = 0;
    private healthChecks: number = 0;
    private issuesDetected: number = 0;
    private issuesResolved: number = 0;
    private lastHealthCheck: string | null = null;
    private lastAction: string | null = null;
    private recentActions: GuardianActionEntry[] = [];
    private config: GuardianConfig;
    private tasks: GuardianTask[] = [];
    private taskTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
    private agentListFn?: () => { agents: Array<{ id: string; state: string; role: string; lifecycle: string }> };
    private logEntriesFn?: () => Array<{ severity: string; timestamp: string }>;
    /** Optional MCP recovery hook — supplies the live adapter at runtime. */
    private mcpAdapterFn?: () => {
        getServerStates: () => Array<{ name: string; state: "connected" | "down" | "retrying" | "failed"; retryCount: number; lastError: string | null }>;
        forceReconnect: (name: string) => Promise<{ ok: boolean; error?: string }>;
    } | null;
    /** Optional AAB ledger accessor — polls the autonomous loop for anomalous entries. */
    private aabLedgerFn?: () => AABLedgerEntry[];
    /** Tracks the last AAB ledger count to detect new entries. */
    private lastAABLedgerCount = 0;
    /** Optional Covenant accessor — runs integrity audits. */
    private covenantFn?: () => CovenantStatus;
    /** Optional Skills Engine for dynamic, multi-step self-healing workflows. */
    private skillsEngine?: any;

    constructor(
        private readonly activityBus: ActivityBus,
        private readonly supervisor: LlamaCppSupervisor,
        private readonly tools: Tool[],
        config?: Partial<GuardianConfig>,
    ) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Base Mode catalog pruning: retain only directive_integrity, mcp_health_recovery, and aab_ledger_monitor
        if (process.env.PRISM_BASE_MODE === "true") {
            const prunedCatalog = GUARDIAN_TASK_CATALOG.filter(t =>
                t.id === "directive_integrity" ||
                t.id === "mcp_health_recovery" ||
                t.id === "aab_ledger_monitor"
            );
            this.tasks = prunedCatalog.map(t => ({ ...t, lastRunAt: null, lastResult: null, lastDetail: null }));
        } else {
            this.tasks = GUARDIAN_TASK_CATALOG.map(t => ({ ...t, lastRunAt: null, lastResult: null, lastDetail: null }));
        }
    }

    get state(): GuardianState {
        return this._state;
    }

    /** Update Guardian configuration at runtime. */
    public configure(update: Partial<GuardianConfig>): void {
        const wasRunning = this._state === "running" || this._state === "waiting";
        if (wasRunning && (update.modelAlias || update.modelPath || update.contextSize)) {
            // Restart needed if model changes
            this.stop();
        }
        this.config = { ...this.config, ...update };
        // When switching to shared mode, don't restart immediately — start() will
        // enter 'waiting' state until a chat model slot becomes available.
        if (wasRunning && this._state === "stopped") {
            void this.start();
        }
    }

    /** Re-prune or expand the tasks catalog at runtime when Base Mode toggles. */
    public syncModeCatalog(): void {
        const wasRunning = this._state === "running";
        if (wasRunning) {
            this.stopTaskRunners();
        }

        if (process.env.PRISM_BASE_MODE === "true") {
            const prunedCatalog = GUARDIAN_TASK_CATALOG.filter(t =>
                t.id === "directive_integrity" ||
                t.id === "mcp_health_recovery" ||
                t.id === "aab_ledger_monitor"
            );
            this.tasks = prunedCatalog.map(t => {
                const old = this.tasks.find(o => o.id === t.id);
                return { ...t, lastRunAt: old ? old.lastRunAt : null, lastResult: old ? old.lastResult : null, lastDetail: old ? old.lastDetail : null };
            });
        } else {
            this.tasks = GUARDIAN_TASK_CATALOG.map(t => {
                const old = this.tasks.find(o => o.id === t.id);
                return { ...t, lastRunAt: old ? old.lastRunAt : null, lastResult: old ? old.lastResult : null, lastDetail: old ? old.lastDetail : null };
            });
        }

        if (wasRunning) {
            this.startTaskRunners();
        }
        this.emitEvent("guardian.config_updated", `Synchronized tasks for Base Mode: ${process.env.PRISM_BASE_MODE === "true"}`);
    }

    /** Start the Guardian Agent. Loads the model into a supervisor slot. */
    public async start(): Promise<void> {
        if (this._state === "running" || this._state === "starting" || this._state === "waiting") return;

        if (!this.config.modelPath) {
            this._state = "error";
            this.emitEvent("guardian.start_failed", "No model path configured");
            return;
        }

        this._state = "starting";
        this.emitEvent("guardian.starting", `Loading model ${this.config.modelAlias}`);

        try {
            let targetPath = this.config.modelPath;
            let targetAlias = this.config.modelAlias;

            if (targetPath === "active-chat-model") {
                const activeSlot = this.supervisor.getSnapshot().find(s => s.status === "ready");
                if (activeSlot) {
                    targetPath = activeSlot.modelPath || "";
                    targetAlias = activeSlot.modelAlias || "shared";
                } else {
                    // No ready slot yet — enter waiting state and poll until one becomes available.
                    this._state = "waiting";
                    this.emitEvent("guardian.waiting", "Waiting for a local chat model slot to become ready. Apply a local model in Provider & Settings first.");
                    this.waitingTimer = setInterval(() => {
                        const readySlot = this.supervisor.getSnapshot().find(s => s.status === "ready");
                        if (readySlot && this._state === "waiting") {
                            if (this.waitingTimer) {
                                clearInterval(this.waitingTimer);
                                this.waitingTimer = null;
                            }
                            this._state = "stopped"; // allow start() to proceed
                            void this.start();
                        }
                    }, 5000);
                    return;
                }
            }

            await this.supervisor.loadModel(
                targetPath,
                targetAlias,
                {
                    ctxSize: this.config.contextSize,
                    draftModelPath: this.config.draftModelPath,
                    gpuLayers: this.config.gpuLayers,
                    flashAttn: this.config.flashAttn,
                },
            );

            this._state = "running";
            this.startedAt = Date.now();
            this.emitEvent("guardian.started", `Guardian active with model ${targetAlias}`);

            // Begin health monitoring loop
            this.healthCheckTimer = setInterval(() => {
                void this.runHealthCheck();
            }, this.config.healthCheckIntervalMs);

            // Begin task runner loops
            this.startTaskRunners();

        } catch (error) {
            this._state = "error";
            this.emitEvent("guardian.start_failed", String(error));
        }
    }

    /** Gracefully stop the Guardian Agent. */
    public stop(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
        if (this.waitingTimer) {
            clearInterval(this.waitingTimer);
            this.waitingTimer = null;
        }
        this.stopTaskRunners();
        this._state = "stopped";
        this.emitEvent("guardian.stopped", "Guardian stopped by operator");
    }

    /** Get a full status snapshot. */
    public getStatus(): GuardianStatus {
        const targetPath = this.config.modelPath === "active-chat-model"
            ? (this.supervisor.getSnapshot().find(s => s.status === "ready")?.modelPath ?? "active-chat-model")
            : this.config.modelPath;

        const targetAlias = this.config.modelPath === "active-chat-model"
            ? (this.supervisor.getSnapshot().find(s => s.status === "ready")?.modelAlias ?? "Shared Chat Model")
            : this.config.modelAlias;

        const slot = this.supervisor.getSnapshot().find(s =>
            s.modelAlias === this.config.modelAlias ||
            (targetPath && s.modelPath === targetPath)
        ) ?? null;

        return {
            state: this._state,
            modelAlias: targetAlias,
            modelPath: this.config.modelPath,
            modelSource: this.config.modelSource || "",
            authorityTier: this.config.authorityTier,
            uptime: this._state === "running" ? Date.now() - this.startedAt : 0,
            healthChecks: this.healthChecks,
            issuesDetected: this.issuesDetected,
            issuesResolved: this.issuesResolved,
            lastHealthCheck: this.lastHealthCheck,
            lastAction: this.lastAction,
            recentActions: this.recentActions.slice(-10),
            slotInfo: slot,
        };
    }

    /** Returns the current config. */
    public getConfig(): GuardianConfig {
        return { ...this.config };
    }

    // ── Health Monitoring ─────────────────────────────────────────────────

    private async runHealthCheck(): Promise<void> {
        if (this._state !== "running") return;

        this.healthChecks++;
        this.lastHealthCheck = new Date().toISOString();

        try {
            // 1. Verify the supervisor slot is still healthy
            const targetPath = this.config.modelPath === "active-chat-model"
                ? (this.supervisor.getSnapshot().find(s => s.status === "ready")?.modelPath ?? "active-chat-model")
                : this.config.modelPath;

            const slot = this.supervisor.getSnapshot().find(s =>
                s.modelAlias === this.config.modelAlias ||
                (targetPath && s.modelPath === targetPath)
            );
            if (!slot || slot.status !== "ready") {
                this.issuesDetected++;
                this.recordAction("health_check", "failure", "Model slot not ready — attempting recovery");
                await this.attemptSelfHeal("model_slot_down");
                return;
            }

            // 2. Check all supervisor slots for any crashed processes
            const allSlots = this.supervisor.getSnapshot();
            const errorSlots = allSlots.filter(s => s.status === "error");
            if (errorSlots.length > 0) {
                this.issuesDetected += errorSlots.length;
                this.recordAction("health_check", "escalated", `${errorSlots.length} slot(s) in error state`);
                this.emitEvent("guardian.issue_detected", `${errorSlots.length} llama-server slot(s) crashed`);
            }

            // 3. Verify tool availability
            const unavailableTools = this.tools.filter(t => {
                try {
                    // Basic contract check
                    return !t.name || !t.contract;
                } catch {
                    return true;
                }
            });
            if (unavailableTools.length > 0) {
                this.emitEvent("guardian.tool_warning", `${unavailableTools.length} tool(s) have incomplete contracts`);
            }

            this.recordAction("health_check", "success", "All systems nominal");
        } catch (error) {
            this.recordAction("health_check", "failure", String(error));
        }
    }

    private async attemptSelfHeal(issue: string): Promise<void> {
        this._state = "healing";
        this.emitEvent("guardian.healing", `Attempting self-heal: ${issue}`);

        try {
            // ── Dynamic Skills-Engine Self-Healing Workflow ───────────────────
            if (this.skillsEngine) {
                const skill = await this.skillsEngine.routeQuery(issue);
                if (skill) {
                    this.emitEvent("guardian.skills_heal.starting", `Dynamic self-healing skill found: ${skill.name} (ID: ${skill.id}). Initiating recovery session...`);
                    try {
                        let session = await this.skillsEngine.createSession(skill.id, "guardian-session");
                        while (session.status === "running") {
                            session = await this.skillsEngine.executeStep(session.sessionId);
                        }
                        if (session.status === "completed") {
                            this.issuesResolved++;
                            this._state = "running";
                            this.recordAction("self_heal", "success", `Recovered via skill ${skill.name}. Josephine knows!`);
                            this.emitEvent("guardian.healed", `[guardian:self-heal] ${skill.name} completed successfully. Josephine knows!`);
                            return;
                        } else {
                            throw new Error(`Self-healing workflow ended with state: ${session.status}`);
                        }
                    } catch (skillErr) {
                        this.emitEvent("guardian.skills_heal.failed", `Skills-engine recovery failed: ${String(skillErr)}. Falling back to default routines...`);
                    }
                }
            }

            if (issue === "model_slot_down") {
                let targetPath = this.config.modelPath;
                let targetAlias = this.config.modelAlias;

                if (targetPath === "active-chat-model") {
                    const activeSlot = this.supervisor.getSnapshot().find(s => s.status === "ready");
                    if (activeSlot) {
                        targetPath = activeSlot.modelPath || "";
                        targetAlias = activeSlot.modelAlias || "shared";
                    }
                }

                // Re-load the model
                await this.supervisor.loadModel(
                    targetPath,
                    targetAlias,
                    {
                        ctxSize: this.config.contextSize,
                        draftModelPath: this.config.draftModelPath,
                        gpuLayers: this.config.gpuLayers,
                        flashAttn: this.config.flashAttn,
                    },
                );
                this.issuesResolved++;
                this._state = "running";
                this.recordAction("self_heal", "success", `Recovered model slot: ${targetAlias}. Josephine knows!`);
                this.emitEvent("guardian.healed", `Model slot recovered: ${targetAlias}. Josephine knows!`);
                return;
            }

            // Unknown issue — cannot self-heal, escalate
            this._state = "running";
            this.recordAction("self_heal", "escalated", `Cannot auto-fix: ${issue}`);
            this.emitEvent("guardian.escalation", `Guardian cannot auto-fix: ${issue}. Operator attention required.`);
        } catch (error) {
            this._state = "error";
            this.recordAction("self_heal", "failure", String(error));
            this.emitEvent("guardian.heal_failed", String(error));
        }
    }

    // ── Tool Execution ────────────────────────────────────────────────────

    /** Execute a tool on behalf of the Guardian (respects authority tier). */
    public async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult | null> {
        const tool = this.tools.find(t => t.name === toolName);
        if (!tool) {
            this.recordAction("tool_exec", "failure", `Tool not found: ${toolName}`);
            return null;
        }

        // Authority check — if tier2, block high-risk tool calls
        if (this.config.authorityTier === "tier2_conditional") {
            const governance = tool.governance;
            const actionKey = String(args.action ?? "");
            const actionRule = governance?.actions[actionKey];
            if (actionRule?.minimumRisk === "high") {
                this.recordAction("tool_exec", "escalated", `High-risk action blocked: ${toolName}.${actionKey}`);
                this.emitEvent("guardian.escalation", `Guardian blocked high-risk: ${toolName}.${actionKey}`);
                return { ok: false, output: { error: "Guardian tier2 authority: high-risk action requires operator approval." } };
            }
        }

        const request: ToolRequest = {
            operation: `guardian.${toolName}`,
            args,
            risk: "low",
            mutatesState: false,
        };

        try {
            const result = await tool.execute(request);
            this.recordAction("tool_exec", result.ok ? "success" : "failure", `${toolName}: ${result.ok ? "ok" : "failed"}`);
            this.lastAction = `${toolName} @ ${new Date().toISOString()}`;
            return result;
        } catch (error) {
            this.recordAction("tool_exec", "failure", `${toolName}: ${String(error)}`);
            return { ok: false, output: { error: String(error) } };
        }
    }

    // ── Task Runner System ────────────────────────────────────────────────

    /** Inject agent-list resolver for agent census task. */
    public setAgentListFn(fn: () => { agents: Array<{ id: string; state: string; role: string; lifecycle: string }> }): void {
        this.agentListFn = fn;
    }

    /** Inject log-entries resolver for log volume analysis task. */
    public setLogEntriesFn(fn: () => Array<{ severity: string; timestamp: string }>): void {
        this.logEntriesFn = fn;
    }

    /** Inject MCP adapter resolver for the mcp_health_recovery task. */
    public setMcpAdapterFn(fn: () => ({
        getServerStates: () => Array<{ name: string; state: "connected" | "down" | "retrying" | "failed"; retryCount: number; lastError: string | null }>;
        forceReconnect: (name: string) => Promise<{ ok: boolean; error?: string }>;
    } | null)): void {
        this.mcpAdapterFn = fn;
    }

    /** Inject AAB ledger accessor for autonomous behavior monitoring. */
    public setAABLedgerFn(fn: () => AABLedgerEntry[]): void {
        this.aabLedgerFn = fn;
    }

    /** Inject Covenant accessor for integrity audits. */
    public setCovenantFn(fn: () => CovenantStatus): void {
        this.covenantFn = fn;
    }

    /** Inject SkillsEngine for autonomous, multi-step custodian skill execution. */
    public setSkillsEngine(engine: any): void {
        this.skillsEngine = engine;
    }

    /** Returns current task catalog with status. */
    public getTaskStatus(): GuardianTask[] {
        return this.tasks.map(t => ({ ...t }));
    }

    /** Toggle a task enabled/disabled by ID. */
    public toggleTask(taskId: string): GuardianTask | null {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return null;
        task.enabled = !task.enabled;
        if (task.enabled && this._state === "running") {
            this.startSingleTaskRunner(task);
        } else if (!task.enabled) {
            const timer = this.taskTimers.get(taskId);
            if (timer) { clearInterval(timer); this.taskTimers.delete(taskId); }
        }
        return { ...task };
    }

    /** Force-run a single task by ID (regardless of interval). */
    public async runTask(taskId: string): Promise<GuardianTask | null> {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return null;
        await this.executeTask(task);
        return { ...task };
    }

    /** Force-run all enabled tasks. */
    public async runAllTasks(): Promise<void> {
        for (const task of this.tasks) {
            if (task.enabled) await this.executeTask(task);
        }
    }

    private startTaskRunners(): void {
        for (const task of this.tasks) {
            if (task.enabled) this.startSingleTaskRunner(task);
        }
        this.emitEvent("guardian.tasks_started", `${this.tasks.filter(t => t.enabled).length} guardian tasks scheduled`);
    }

    private startSingleTaskRunner(task: GuardianTask): void {
        const existing = this.taskTimers.get(task.id);
        if (existing) clearInterval(existing);

        const stagger = Math.random() * 5000;
        setTimeout(() => {
            if (this._state === "running" && task.enabled) void this.executeTask(task);
        }, stagger);

        const timer = setInterval(() => {
            if (this._state === "running" && task.enabled) void this.executeTask(task);
        }, task.intervalMs);
        this.taskTimers.set(task.id, timer);
    }

    private stopTaskRunners(): void {
        for (const [, timer] of this.taskTimers) {
            clearInterval(timer);
        }
        this.taskTimers.clear();
    }

    private async executeTask(task: GuardianTask): Promise<void> {
        try {
            // Check if this task maps to a custodian skill
            const skillId = this.taskToSkillId(task.id);
            if (skillId && this.skillsEngine) {
                const result = await this.executeCustodianSkill(skillId, task);
                task.lastRunAt = new Date().toISOString();
                task.lastResult = result.status;
                task.lastDetail = result.detail;
                this.recordAction(`task.${task.id}`, result.status === "failure" ? "failure" : result.status === "warning" ? "escalated" : "success", result.detail);
                this.emitEvent(`guardian.task.${task.id}`, result.detail);
                return;
            }

            // Fallback to existing task implementation
            const result = await this.runTaskImpl(task.id);
            task.lastRunAt = new Date().toISOString();
            task.lastResult = result.status;
            task.lastDetail = result.detail;
            this.recordAction(`task.${task.id}`, result.status === "failure" ? "failure" : result.status === "warning" ? "escalated" : "success", result.detail);
            this.emitEvent(`guardian.task.${task.id}`, result.detail);
        } catch (error) {
            task.lastRunAt = new Date().toISOString();
            task.lastResult = "failure";
            task.lastDetail = String(error);
            this.recordAction(`task.${task.id}`, "failure", String(error));
            this.emitEvent(`guardian.task.${task.id}`, `Task error: ${String(error)}`);
        }
    }

    private async runTaskImpl(taskId: string): Promise<{ status: "success" | "warning" | "failure"; detail: string }> {
        switch (taskId) {
            case "disk_space_check": return this.taskDiskSpaceCheck();
            case "temp_cleanup": return this.taskTempCleanup();
            case "memory_audit": return this.taskMemoryAudit();
            case "model_integrity": return this.taskModelIntegrity();
            case "command_filter_verify": return this.taskCommandFilterVerify();
            case "env_secrets_scan": return this.taskEnvSecretsScan();
            case "endpoint_access_audit": return this.taskEndpointAccessAudit();
            case "directive_integrity": return this.taskDirectiveIntegrity();
            case "knowledge_graph_check": return this.taskKnowledgeGraphCheck();
            case "tool_contract_audit": return this.taskToolContractAudit();
            case "agent_health_check": return this.taskAgentHealthCheck();
            case "system_snapshot": return this.taskSystemSnapshot();
            case "agent_census": return this.taskAgentCensus();
            case "log_volume_analysis": return this.taskLogVolumeAnalysis();
            case "mcp_health_recovery": return await this.taskMcpHealthRecovery();
            case "aab_ledger_monitor": return this.taskAABLedgerMonitor();
            case "covenant_audit": return this.taskCovenantAudit();
            default: return { status: "failure", detail: `Unknown task: ${taskId}` };
        }
    }

    // ── Maintenance Tasks ─────────────────────────────────────────────────

    private taskDiskSpaceCheck(): { status: "success" | "warning" | "failure"; detail: string } {
        const modelsDir = join(process.cwd(), "models");
        let totalSizeMb = 0;
        if (existsSync(modelsDir)) {
            try {
                const files = readdirSync(modelsDir);
                for (const f of files) {
                    try { totalSizeMb += statSync(join(modelsDir, f)).size / (1024 * 1024); } catch { /* skip */ }
                }
            } catch { /* skip */ }
        }
        const freeMemMb = os.freemem() / (1024 * 1024);
        const totalStr = totalSizeMb >= 1024 ? (totalSizeMb / 1024).toFixed(1) + " GB" : totalSizeMb.toFixed(0) + " MB";
        if (totalSizeMb > 10240) {
            return { status: "warning", detail: `Models directory is ${totalStr} — consider cleanup. Free system memory: ${(freeMemMb / 1024).toFixed(1)} GB` };
        }
        return { status: "success", detail: `Models directory: ${totalStr}. Free memory: ${(freeMemMb / 1024).toFixed(1)} GB` };
    }

    private taskTempCleanup(): { status: "success" | "warning" | "failure"; detail: string } {
        const tmpDir = join(process.cwd(), "tmp");
        if (!existsSync(tmpDir)) return { status: "success", detail: "No tmp/ directory — nothing to clean" };
        let cleaned = 0;
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        try {
            const files = readdirSync(tmpDir);
            for (const f of files) {
                try {
                    const fpath = join(tmpDir, f);
                    const st = statSync(fpath);
                    if (st.isFile() && st.mtimeMs < cutoff) {
                        unlinkSync(fpath);
                        cleaned++;
                    }
                } catch { /* skip locked files */ }
            }
        } catch { /* skip */ }
        return { status: "success", detail: cleaned > 0 ? `Cleaned ${cleaned} stale temp file(s)` : "No stale temp files found" };
    }

    private taskMemoryAudit(): { status: "success" | "warning" | "failure"; detail: string } {
        const usage = process.memoryUsage();
        const rssMb = Math.round(usage.rss / (1024 * 1024));
        const heapMb = Math.round(usage.heapUsed / (1024 * 1024));
        const heapTotalMb = Math.round(usage.heapTotal / (1024 * 1024));
        if (rssMb > 1024) {
            return { status: "warning", detail: `High memory: RSS=${rssMb}MB, Heap=${heapMb}/${heapTotalMb}MB — consider restart` };
        }
        return { status: "success", detail: `RSS=${rssMb}MB, Heap=${heapMb}/${heapTotalMb}MB` };
    }

    private taskModelIntegrity(): { status: "success" | "warning" | "failure"; detail: string } {
        const modelsDir = join(process.cwd(), "models");
        if (!existsSync(modelsDir)) return { status: "success", detail: "No models/ directory" };
        let checked = 0;
        let corrupt = 0;
        try {
            const files = readdirSync(modelsDir).filter(f => f.endsWith(".gguf"));
            for (const f of files) {
                checked++;
                try {
                    const fh = openSync(join(modelsDir, f), "r");
                    const buf = Buffer.alloc(4);
                    readSync(fh, buf, 0, 4, 0);
                    closeSync(fh);
                    if (buf[0] !== 0x47 || buf[1] !== 0x47 || buf[2] !== 0x55 || buf[3] !== 0x46) {
                        corrupt++;
                    }
                } catch { corrupt++; }
            }
        } catch { /* skip */ }
        if (corrupt > 0) {
            return { status: "warning", detail: `${corrupt}/${checked} GGUF file(s) have invalid headers` };
        }
        return { status: "success", detail: `${checked} GGUF file(s) verified — all valid` };
    }

    // ── Security Tasks ────────────────────────────────────────────────────

    private taskCommandFilterVerify(): { status: "success" | "warning" | "failure"; detail: string } {
        const BLOCKED_RE = /\b(rm\s+-rf|del\s+\/[sfq]|format\s+[a-z]:|shutdown|restart|reboot)\b/i;
        const dangerous = ["rm -rf /", "del /s *.*", "format c:", "shutdown", "reboot"];
        const safe = ["dir", "echo hello", "whoami", "node --version"];
        let failedBlocks = 0;
        let failedAllows = 0;
        for (const cmd of dangerous) { if (!BLOCKED_RE.test(cmd)) failedBlocks++; }
        for (const cmd of safe) { if (BLOCKED_RE.test(cmd)) failedAllows++; }
        if (failedBlocks > 0 || failedAllows > 0) {
            return { status: "failure", detail: `Command filter defects: ${failedBlocks} unblocked dangerous, ${failedAllows} false positives` };
        }
        return { status: "success", detail: `Command filter verified: ${dangerous.length} dangerous blocked, ${safe.length} safe allowed` };
    }

    private taskEnvSecretsScan(): { status: "success" | "warning" | "failure"; detail: string } {
        const secretPatterns = [/api[_-]?key/i, /secret[_-]?key/i, /access[_-]?token/i, /auth[_-]?token/i, /private[_-]?key/i];
        const envKeys = Object.keys(process.env);
        const prismKeys = envKeys.filter(k => k.startsWith("PRISM_"));
        const suspectKeys: string[] = [];
        for (const key of envKeys) {
            const val = process.env[key] || "";
            if (val.length > 20 && secretPatterns.some(p => p.test(key))) {
                suspectKeys.push(key);
            }
        }
        if (suspectKeys.length > 0) {
            return { status: "warning", detail: `${suspectKeys.length} env var(s) may contain exposed secrets: ${suspectKeys.join(", ")}. Review and rotate if needed.` };
        }
        return { status: "success", detail: `Scanned ${envKeys.length} env vars (${prismKeys.length} PRISM_*). No exposed secrets detected.` };
    }

    private async taskEndpointAccessAudit(): Promise<{ status: "success" | "warning" | "failure"; detail: string }> {
        const endpoints = ["/api/guardian/status", "/api/models/gguf", "/api/agents"];
        let ok = 0;
        let fail = 0;
        const baseUrl = this.config.dashboardBaseUrl ?? `http://localhost:${process.env.PRISM_DASHBOARD_PORT ?? "7070"}`;
        for (const ep of endpoints) {
            try {
                const resp = await fetch(`${baseUrl}${ep}`);
                if (resp.ok) ok++;
                else fail++;
            } catch { fail++; }
        }
        if (fail > 0) {
            return { status: "warning", detail: `${fail}/${endpoints.length} endpoint(s) unreachable` };
        }
        return { status: "success", detail: `All ${endpoints.length} critical endpoints responsive` };
    }

    private taskDirectiveIntegrity(): { status: "success" | "warning" | "failure"; detail: string } {
        const result = verifyDirectiveIntegrity();
        if (result.valid) {
            return { status: "success", detail: `PAD integrity verified (SHA-256: ${result.currentHash.slice(0, 16)}…)` };
        }
        if (result.error) {
            return { status: "failure", detail: `PAD integrity check failed: ${result.error}` };
        }
        return {
            status: "failure",
            detail: `DIRECTIVE INTEGRITY VIOLATION — Expected: ${result.expectedHash.slice(0, 16)}…, Got: ${result.currentHash.slice(0, 16)}…`,
        };
    }

    // ── Diagnostics Tasks ─────────────────────────────────────────────────

    private taskKnowledgeGraphCheck(): { status: "success" | "warning" | "failure"; detail: string } {
        try {
            const smPath = join(process.cwd(), "dist", "src", "core", "memory", "semantic-memory.js");
            if (!existsSync(smPath)) {
                return { status: "warning", detail: "semantic-memory.js not found in dist/ — build may be needed" };
            }
            return { status: "success", detail: "Knowledge graph module accessible. Full diagnostics available via Tools & Utilities panel." };
        } catch (error) {
            return { status: "failure", detail: `KG probe failed: ${String(error)}` };
        }
    }

    private taskToolContractAudit(): { status: "success" | "warning" | "failure"; detail: string } {
        let total = 0;
        let incomplete = 0;
        const missing: string[] = [];
        for (const tool of this.tools) {
            total++;
            try {
                if (!tool.name || !tool.contract) {
                    incomplete++;
                    missing.push(tool.name || "(unnamed)");
                }
            } catch {
                incomplete++;
                missing.push("(error)");
            }
        }
        if (incomplete > 0) {
            return { status: "warning", detail: `${incomplete}/${total} tool(s) have incomplete contracts: ${missing.slice(0, 5).join(", ")}` };
        }
        return { status: "success", detail: `All ${total} tool contracts complete` };
    }

    private taskAgentHealthCheck(): { status: "success" | "warning" | "failure"; detail: string } {
        if (!this.agentListFn) {
            return { status: "success", detail: "Agent list resolver not configured — skipped" };
        }
        try {
            const data = this.agentListFn();
            const agents = data.agents || [];
            const errorAgents = agents.filter(a => a.state === "error" || a.state === "stopped");
            if (errorAgents.length > 0) {
                return { status: "warning", detail: `${errorAgents.length}/${agents.length} agent(s) in error/stopped state` };
            }
            return { status: "success", detail: `${agents.length} agent(s) healthy` };
        } catch (error) {
            return { status: "failure", detail: `Agent health check failed: ${String(error)}` };
        }
    }

    // ── Monitoring Tasks ──────────────────────────────────────────────────

    private taskSystemSnapshot(): { status: "success" | "warning" | "failure"; detail: string } {
        const cpuCount = os.cpus().length;
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedPct = Math.round((1 - freeMem / totalMem) * 100);
        const uptimeH = Math.round(os.uptime() / 3600 * 10) / 10;
        const detail = `CPU: ${cpuCount} cores, RAM: ${usedPct}% used (${Math.round(freeMem / (1024 * 1024 * 1024) * 10) / 10}GB free), Uptime: ${uptimeH}h`;
        if (usedPct > 90) {
            return { status: "warning", detail: `High memory pressure — ${detail}` };
        }
        return { status: "success", detail };
    }

    private taskAgentCensus(): { status: "success" | "warning" | "failure"; detail: string } {
        if (!this.agentListFn) {
            return { status: "success", detail: "Agent list resolver not configured — skipped" };
        }
        try {
            const data = this.agentListFn();
            const agents = data.agents || [];
            const byState: Record<string, number> = {};
            for (const a of agents) { byState[a.state] = (byState[a.state] || 0) + 1; }
            const ephemeral = agents.filter(a => a.lifecycle === "ephemeral");
            const stale = ephemeral.filter(a => a.state === "idle");
            const summary = Object.entries(byState).map(([s, c]) => `${s}:${c}`).join(", ");
            if (stale.length > 3) {
                return { status: "warning", detail: `${agents.length} agents (${summary}). ${stale.length} idle ephemeral agents — may need reaping` };
            }
            return { status: "success", detail: `${agents.length} agents: ${summary}` };
        } catch (error) {
            return { status: "failure", detail: `Agent census failed: ${String(error)}` };
        }
    }

    private taskLogVolumeAnalysis(): { status: "success" | "warning" | "failure"; detail: string } {
        if (!this.logEntriesFn) {
            return { status: "success", detail: "Log entries resolver not configured — skipped" };
        }
        try {
            const entries = this.logEntriesFn();
            const total = entries.length;
            const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const recent = entries.filter(e => e.timestamp > cutoff);
            const errors = recent.filter(e => e.severity === "error");
            const warnings = recent.filter(e => e.severity === "warning");
            const errorRate = recent.length > 0 ? Math.round(errors.length / recent.length * 100) : 0;
            if (errorRate > 5) {
                return { status: "warning", detail: `High error rate: ${errorRate}% in last 5min (${errors.length} errors, ${warnings.length} warnings, ${recent.length} total recent of ${total} total)` };
            }
            return { status: "success", detail: `${recent.length} entries in last 5min (${errors.length} errors, ${warnings.length} warnings). Total stored: ${total}` };
        } catch (error) {
            return { status: "failure", detail: `Log analysis failed: ${String(error)}` };
        }
    }

    /**
     * Inspect every configured MCP server. Force-reconnect any that are in
     * "down" or "failed" state. Servers in "retrying" are left alone — the
     * adapter's own backoff timer will handle them.
     */
    private async taskMcpHealthRecovery(): Promise<{ status: "success" | "warning" | "failure"; detail: string }> {
        const adapter = this.mcpAdapterFn?.() ?? null;
        if (!adapter) {
            return { status: "success", detail: "MCP adapter not attached — skipped" };
        }
        try {
            const states = adapter.getServerStates();
            if (states.length === 0) {
                return { status: "success", detail: "No MCP servers configured" };
            }
            const down = states.filter(s => s.state === "down" || s.state === "failed");
            if (down.length === 0) {
                return { status: "success", detail: `All ${states.length} MCP server(s) healthy` };
            }
            const recovered: string[] = [];
            const stillDown: string[] = [];
            for (const s of down) {
                this.emitEvent("guardian.healing", `MCP ${s.name} ${s.state} — attempting reconnect`);
                const result = await adapter.forceReconnect(s.name);
                if (result.ok) {
                    recovered.push(s.name);
                    this.issuesResolved++;
                    this.emitEvent("guardian.healed", `MCP ${s.name} recovered`);
                } else {
                    stillDown.push(s.name);
                    this.issuesDetected++;
                }
            }
            if (recovered.length > 0 && stillDown.length === 0) {
                return { status: "success", detail: `Recovered ${recovered.length} MCP server(s): ${recovered.join(", ")}` };
            }
            if (recovered.length > 0) {
                return { status: "warning", detail: `Recovered ${recovered.join(", ")}; still down: ${stillDown.join(", ")}` };
            }
            return { status: "warning", detail: `${stillDown.length} MCP server(s) still down: ${stillDown.join(", ")}` };
        } catch (error) {
            return { status: "failure", detail: `MCP recovery task failed: ${String(error)}` };
        }
    }

    // ── Autonomous Monitoring Tasks ───────────────────────────────────

    /**
     * AAB Ledger Monitor — polls the autonomous loop's AAB ledger for
     * new entries since the last check. When critical anomalies are
     * detected, the Guardian triggers an alert event.
     */
    private taskAABLedgerMonitor(): { status: "success" | "warning" | "failure"; detail: string } {
        if (!this.aabLedgerFn) {
            return { status: "success", detail: "AAB ledger accessor not attached — skipped" };
        }
        try {
            const entries = this.aabLedgerFn();
            const newEntries = entries.slice(this.lastAABLedgerCount);
            this.lastAABLedgerCount = entries.length;

            if (newEntries.length === 0) {
                return { status: "success", detail: `AAB ledger stable — ${entries.length} total entries` };
            }

            const terminations = newEntries.filter(e => e.intervention === "terminate");
            const pauses = newEntries.filter(e => e.intervention === "pause");
            const rateLimits = newEntries.filter(e => e.intervention === "rate_limit");

            if (terminations.length > 0) {
                this.issuesDetected += terminations.length;
                this.emitEvent("guardian.aab.critical", `${terminations.length} autonomous termination(s) detected: ${terminations.map(e => e.description).join("; ")}`);
                return {
                    status: "warning",
                    detail: `${newEntries.length} new AAB entries: ${terminations.length} termination(s), ${pauses.length} pause(s), ${rateLimits.length} rate limit(s)`,
                };
            }

            return {
                status: "success",
                detail: `${newEntries.length} new AAB entries (${pauses.length} pauses, ${rateLimits.length} rate limits). Total: ${entries.length}`,
            };
        } catch (error) {
            return { status: "failure", detail: `AAB ledger monitor failed: ${String(error)}` };
        }
    }

    /**
     * Covenant Integrity Audit — runs the Sacred Covenant's audit()
     * method and reports any violations detected since the last check.
     */
    private taskCovenantAudit(): { status: "success" | "warning" | "failure"; detail: string } {
        if (!this.covenantFn) {
            return { status: "success", detail: "Covenant accessor not attached — skipped" };
        }
        try {
            const status = this.covenantFn();
            const criticalCount = status.violations.filter(v => v.severity === "critical").length;
            const breachCount = status.violations.filter(v => v.severity === "breach").length;

            if (!status.isIntact) {
                this.issuesDetected++;
                this.emitEvent("guardian.covenant.violated", `Covenant integrity VIOLATED — ${criticalCount} critical, ${breachCount} breach violations`);
                return {
                    status: "warning",
                    detail: `Covenant NOT intact — ${criticalCount} critical, ${breachCount} breach, ${status.violations.length} total violations`,
                };
            }

            return {
                status: "success",
                detail: `Covenant intact (v${status.version}, hash: ${status.hash}). ${status.violations.length} advisory violation(s).`,
            };
        } catch (error) {
            return { status: "failure", detail: `Covenant audit failed: ${String(error)}` };
        }
    }

    // ── Internal Helpers ──────────────────────────────────────────────────

    private recordAction(action: string, result: "success" | "failure" | "escalated", detail: string): void {
        const entry: GuardianActionEntry = {
            timestamp: new Date().toISOString(),
            action,
            result,
            detail,
        };
        this.recentActions.push(entry);
        if (this.recentActions.length > 50) {
            this.recentActions = this.recentActions.slice(-50);
        }
        // Mirror action immediately to observers (dashboard, activity bus)
        try {
            this.lastAction = `${entry.action} ${entry.result} @ ${entry.timestamp}`;
            this.emitEvent('guardian.action', `${entry.action} ${entry.result}: ${entry.detail}`);
        } catch (_) { /* best-effort mirror — don't throw on UI emit failures */ }
    }

    private emitEvent(operation: string, detail: string): void {
        this.emit("guardian_event", { operation, detail });
        if (this.activityBus) {
            this.activityBus.emit({
                sessionId: "guardian",
                layer: "agent",
                operation,
                status: operation.includes("fail") || operation.includes("error") ? "failed" : "succeeded",
                details: { detail, modelAlias: this.config.modelAlias, state: this._state },
            });
        }
    }

    /** Map Guardian task IDs to custodian skill IDs. */
    private taskToSkillId(taskId: string): string | null {
        const mapping: Record<string, string> = {
            "disk_space_check": "skill.custodian.disk-space",
            "temp_cleanup": "skill.custodian.disk-space",  // Reuse disk-space skill
            "memory_audit": "skill.custodian.system-snapshot",
            "model_integrity": "skill.custodian.pad-integrity",
            "command_filter_verify": "skill.custodian.command-filter",
            "env_secrets_scan": "skill.custodian.secrets-scan",
            "endpoint_access_audit": "skill.custodian.aab-ledger",
            "directive_integrity": "skill.custodian.covenant-audit",
            "knowledge_graph_check": "skill.custodian.agent-health",
            "tool_contract_audit": "skill.custodian.agent-health",
            "agent_health_check": "skill.custodian.agent-health",
            "system_snapshot": "skill.custodian.system-snapshot",
            "agent_census": "skill.custodian.agent-health",
            "log_volume_analysis": "skill.custodian.agent-health",
            "mcp_health_recovery": "skill.custodian.mcp-health",
            "aab_ledger_monitor": "skill.custodian.aab-ledger",
            "covenant_audit": "skill.custodian.covenant-audit",
        };
        return mapping[taskId] || null;
    }

    /** Execute a custodian skill via SkillsEngine. */
    private async executeCustodianSkill(skillId: string, task: GuardianTask): Promise<{ status: "success" | "warning" | "failure"; detail: string }> {
        if (!this.skillsEngine) {
            return { status: "failure", detail: "SkillsEngine not configured — cannot execute custodian skill" };
        }

        try {
            const skill = await this.skillsEngine.routeQuery(skillId);
            if (!skill) {
                return { status: "failure", detail: `Custodian skill not found: ${skillId}` };
            }

            this.emitEvent("guardian.custodian_skill.starting", `Executing custodian skill: ${skill.name} (ID: ${skill.id})`);

            const session = await this.skillsEngine.createSession({
                skillId: skill.id,
                executor: "guardian",
                accountabilityChain: {
                    characterId: "guardian",
                    operatorId: "guardian",
                    prismUserId: "guardian",
                    operatorEmail: "guardian@prism.local",
                    assignmentId: "guardian-builtin",
                },
            });

            // Execute until complete
            let currentSession = session;
            while (currentSession.status === "running") {
                currentSession = await this.skillsEngine.executeStep(currentSession.sessionId);
            }

            if (currentSession.status === "completed") {
                this.emitEvent("guardian.custodian_skill.completed", `Custodian skill completed: ${skill.name}`);
                return { status: "success", detail: `Custodian skill executed: ${skill.name}` };
            } else {
                return { status: "failure", detail: `Custodian skill ended with state: ${currentSession.status}` };
            }
        } catch (error) {
            this.emitEvent("guardian.custodian_skill.failed", `Custodian skill execution failed: ${String(error)}`);
            return { status: "failure", detail: `Custodian skill error: ${String(error)}` };
        }
    }
}
