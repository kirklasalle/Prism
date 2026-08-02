/**
 * PRISM Demonstration Engine
 *
 * Interactive showcase system with Mad Libs-style prompts.
 * Executes 9 real demonstrations (3 self-control, 3 browser, 3 computer)
 * plus a full tab tour. Interruptible, resumable, with speed control.
 *
 * All actions pipe to ActivityBus for Logs & Debug visibility.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { workspacePath, workspaceLogsDir, resolveWorkspaceRoot } from "../config/workspace-resolver.js";
import type { ActivityBus } from "../activity/bus.js";
import { ToolRegistry } from "../tools/registry.js";
import { builtinTools } from "../tools/builtin-tools.js";
import { defineScenarios } from "../../benchmarks/demo-scenario-runner.js";

function resolveInstallationFile(fileName: string): string {
    let current = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth++) {
        const candidate = path.join(current, fileName);
        if (existsSync(candidate) && existsSync(path.join(current, "package.json"))) return candidate;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    throw new Error(`PRISM installation file not found: ${fileName}`);
}

// ── Types ────────────────────────────────────────────────────────────────────

export type DemoStatus = "idle" | "awaiting_input" | "running" | "paused" | "completed" | "error";

export interface DemoPrompt {
    id: string;
    label: string;
    description: string;
    options: string[];
    defaultValue: string;
}

export interface DemoDefinition {
    id: string;
    title: string;
    category: "self-control" | "browser-control" | "computer-control" | "scenario-suite";
    icon: string;
    description: string;
    prompts: DemoPrompt[];
    steps: DemoStepDef[];
}

export interface DemoStepDef {
    id: string;
    narration: string;
    /** Tool operation or special action like "tab:chat", "delay:2000" */
    action: string;
    /** Args can reference prompt values via {{promptId}} */
    args: Record<string, unknown>;
    automated: boolean;
}

export interface DemoLogEntry {
    timestamp: string;
    demoId: string;
    stepId: string;
    narration: string;
    action?: string;
    args?: Record<string, unknown>;
    status: "running" | "succeeded" | "failed" | "skipped" | "timed_out";
    durationMs: number;
    output?: string;
    screenshotPath?: string;
}

export interface DemoState {
    status: DemoStatus;
    playbackMode: "step-through" | "auto";
    stepTimeoutMs: number;
    currentDemoIndex: number;
    currentStepIndex: number;
    totalDemos: number;
    totalSteps: number;
    completedDemos: string[];
    promptAnswers: Record<string, string>;
    log: DemoLogEntry[];
    startedAt: string | null;
    pausedAt: string | null;
    speedMs: number;
    error: string | null;
    reports?: {
        mdPath: string;
        htmlPath: string;
    };
}

interface DemoOutputPublication {
    sessionId: string;
    title: string;
}

// ── Demo Definitions ─────────────────────────────────────────────────────────

function buildDemoDefinitions(): DemoDefinition[] {
    const baseDefs: DemoDefinition[] = [
        // ═══ SELF CONTROL ═══
        {
            id: "self-1",
            title: "Agent Swarm Deployment",
            category: "self-control",
            icon: "🧠",
            description:
                "Prism spawns a team of agents, organizes them into a swarm, and dispatches a collaborative task.",
            prompts: [
                {
                    id: "swarm_goal",
                    label: "What should the swarm research?",
                    description:
                        "Pick a topic for the agent swarm to investigate (demo scope — results are illustrative).",
                    options: [
                        "Project architecture analysis",
                        "Code quality assessment",
                        "Security vulnerability scan",
                        "Performance optimization review",
                    ],
                    defaultValue: "Project architecture analysis",
                },
            ],
            steps: [
                {
                    id: "s1-1",
                    narration: "Spawning 3 specialized agents...",
                    action: "demo:spawn_agents",
                    args: { count: 3 },
                    automated: true,
                },
                {
                    id: "s1-2",
                    narration: "Creating star-topology swarm...",
                    action: "demo:create_swarm",
                    args: { topology: "star" },
                    automated: true,
                },
                {
                    id: "s1-3",
                    narration: "Dispatching research task: {{swarm_goal}}",
                    action: "demo:dispatch_swarm",
                    args: { goal: "{{swarm_goal}}" },
                    automated: true,
                },
                {
                    id: "s1-4",
                    narration: "Switching to Agents tab to show live telemetry...",
                    action: "tab:agentic",
                    args: {},
                    automated: true,
                },
                {
                    id: "s1-5",
                    narration: "Cleaning up swarm agents...",
                    action: "demo:cleanup_swarm",
                    args: {},
                    automated: true,
                },
            ],
        },
        {
            id: "self-2",
            title: "Guardian Health Check",
            category: "self-control",
            icon: "🛡️",
            description:
                "Prism's Guardian agent runs health checks, monitors anomalies, and demonstrates self-healing.",
            prompts: [
                {
                    id: "health_focus",
                    label: "What should Guardian focus on?",
                    description: "Choose an area for the Guardian to audit (demo scope).",
                    options: [
                        "System resource usage",
                        "Agent pool health",
                        "Tool registry integrity",
                        "Memory subsystem",
                    ],
                    defaultValue: "System resource usage",
                },
            ],
            steps: [
                {
                    id: "s2-1",
                    narration: "Switching to Agents tab...",
                    action: "tab:agentic",
                    args: {},
                    automated: true,
                },
                {
                    id: "s2-2",
                    narration: "Running Guardian health check: {{health_focus}}",
                    action: "demo:guardian_check",
                    args: { focus: "{{health_focus}}" },
                    automated: true,
                },
                {
                    id: "s2-3",
                    narration: "Checking AAB (Anomalous Autonomous Behaviour) ledger...",
                    action: "demo:check_aab",
                    args: {},
                    automated: true,
                },
                {
                    id: "s2-4",
                    narration: "Switching to Telemetry tab to show event stream...",
                    action: "tab:telemetry",
                    args: {},
                    automated: true,
                },
            ],
        },
        {
            id: "self-3",
            title: "Governance Policy Audit",
            category: "self-control",
            icon: "⚖️",
            description:
                "Demonstrates Prism's 3-tier governance: autonomous read → conditional mutation → approval-gated execution.",
            prompts: [
                {
                    id: "audit_file",
                    label: "What file should the audit create?",
                    description: "Pick a demo output filename (created in prism-output/).",
                    options: ["governance-demo.txt", "policy-audit-report.txt", "compliance-check.txt"],
                    defaultValue: "governance-demo.txt",
                },
            ],
            steps: [
                {
                    id: "s3-1",
                    narration: "Tier 1: Autonomous file listing (read-only, no approval)...",
                    action: "tool:file_list",
                    args: { path: "." },
                    automated: true,
                },
                {
                    id: "s3-2",
                    narration: "Tier 2: Writing {{audit_file}} (mutation with rollback plan)...",
                    action: "tool:file_write",
                    args: {
                        path: "./prism-output/{{audit_file}}",
                        content: "Prism Governance Demo — Tier 2 conditional write.\nTimestamp: {{timestamp}}\n",
                    },
                    automated: true,
                },
                {
                    id: "s3-3",
                    narration: "Switching to Tools tab to show governance contracts...",
                    action: "tab:tools",
                    args: {},
                    automated: true,
                },
                {
                    id: "s3-4",
                    narration: "Switching to Logs to show the full audit trail...",
                    action: "tab:logs",
                    args: {},
                    automated: true,
                },
            ],
        },

        // ═══ BROWSER CONTROL ═══
        {
            id: "browser-1",
            title: "Web Research",
            category: "browser-control",
            icon: "🌐",
            description: "Prism opens a browser, navigates to a page, extracts content, and captures a screenshot.",
            prompts: [
                {
                    id: "research_url",
                    label: "What URL should Prism research?",
                    description: "Pick a URL to navigate to (demo scope — safe, public sites only).",
                    options: [
                        "https://example.com",
                        "https://httpbin.org",
                        "https://jsonplaceholder.typicode.com",
                        "about:blank",
                    ],
                    defaultValue: "https://example.com",
                },
            ],
            steps: [
                {
                    id: "b1-1",
                    narration: "Switching to Browser tab...",
                    action: "tab:browser",
                    args: {},
                    automated: true,
                },
                {
                    id: "b1-2",
                    narration: "Launching headed and headless browser sessions for side-by-side verification...",
                    action: "demo:browser_open",
                    args: {},
                    automated: true,
                },
                {
                    id: "b1-3",
                    narration: "Navigating both browser sessions to {{research_url}} and waiting for the page DOM...",
                    action: "demo:browser_navigate",
                    args: { url: "{{research_url}}" },
                    automated: true,
                },
                {
                    id: "b1-4",
                    narration: "Extracting and comparing accessibility trees from both sessions...",
                    action: "demo:browser_a11y",
                    args: {},
                    automated: true,
                },
                {
                    id: "b1-5",
                    narration: "Capturing and saving headed and headless screenshots as execution evidence...",
                    action: "demo:browser_screenshot",
                    args: {},
                    automated: true,
                },
            ],
        },
        {
            id: "browser-2",
            title: "Multi-Page Navigation",
            category: "browser-control",
            icon: "📑",
            description: "Prism navigates across multiple pages, collecting data from each.",
            prompts: [
                {
                    id: "page_count",
                    label: "How many pages to visit?",
                    description: "Choose the number of pages for the multi-page demo.",
                    options: ["2 pages", "3 pages", "4 pages"],
                    defaultValue: "3 pages",
                },
            ],
            steps: [
                {
                    id: "b2-1",
                    narration: "Verifying headed and headless sessions for multi-page research...",
                    action: "demo:browser_open",
                    args: {},
                    automated: true,
                },
                {
                    id: "b2-2",
                    narration: "Navigating to page 1: example.com...",
                    action: "demo:browser_navigate",
                    args: { url: "https://example.com" },
                    automated: true,
                },
                {
                    id: "b2-3",
                    narration: "Capturing page 1 screenshot...",
                    action: "demo:browser_screenshot",
                    args: {},
                    automated: true,
                },
                {
                    id: "b2-4",
                    narration: "Navigating to page 2: example.org...",
                    action: "demo:browser_navigate",
                    args: { url: "https://example.org" },
                    automated: true,
                },
                {
                    id: "b2-5",
                    narration: "Capturing page 2 screenshot...",
                    action: "demo:browser_screenshot",
                    args: {},
                    automated: true,
                },
            ],
        },
        {
            id: "browser-3",
            title: "Page Interaction",
            category: "browser-control",
            icon: "🖱️",
            description: "Prism interacts with page elements — clicking links, reading content, extracting data.",
            prompts: [
                {
                    id: "interact_target",
                    label: "What should Prism interact with?",
                    description: "Choose what Prism will do on the page.",
                    options: ["Click the main heading", "Extract all links", "Read page metadata", "Capture full page"],
                    defaultValue: "Extract all links",
                },
            ],
            steps: [
                {
                    id: "b3-1",
                    narration: "Verifying headed and headless sessions for page interaction...",
                    action: "demo:browser_open",
                    args: {},
                    automated: true,
                },
                {
                    id: "b3-2",
                    narration: "Navigating to example.com...",
                    action: "demo:browser_navigate",
                    args: { url: "https://example.com" },
                    automated: true,
                },
                {
                    id: "b3-3",
                    narration: "Performing interaction: {{interact_target}}...",
                    action: "demo:browser_interact",
                    args: { interaction: "{{interact_target}}" },
                    automated: true,
                },
                {
                    id: "b3-4",
                    narration: "Capturing result screenshot...",
                    action: "demo:browser_screenshot",
                    args: {},
                    automated: true,
                },
            ],
        },

        // ═══ COMPUTER CONTROL ═══
        {
            id: "computer-1",
            title: "System Diagnostics",
            category: "computer-control",
            icon: "💻",
            description: "Prism runs system diagnostic commands and compiles a report.",
            prompts: [
                {
                    id: "diag_depth",
                    label: "How deep should the diagnostic go?",
                    description: "Choose the diagnostic level (demo scope — safe read-only commands).",
                    options: ["Quick (node + hostname)", "Standard (+ OS info + disk)", "Full (+ processes + network)"],
                    defaultValue: "Standard (+ OS info + disk)",
                },
            ],
            steps: [
                {
                    id: "c1-1",
                    narration: "Switching to Computer tab...",
                    action: "tab:computer",
                    args: {},
                    automated: true,
                },
                {
                    id: "c1-2",
                    narration: "Running: node --version",
                    action: "tool:shell_exec",
                    args: { command: "node --version" },
                    automated: true,
                },
                {
                    id: "c1-3",
                    narration: "Running: hostname",
                    action: "tool:shell_exec",
                    args: { command: "hostname" },
                    automated: true,
                },
                {
                    id: "c1-4",
                    narration: "Writing diagnostic report...",
                    action: "tool:file_write",
                    args: {
                        path: "./prism-output/demo-diagnostics.txt",
                        content: "Prism System Diagnostic Report\nGenerated: {{timestamp}}\n",
                    },
                    automated: true,
                },
                {
                    id: "c1-5",
                    narration: "Switching to Logs to show command audit trail...",
                    action: "tab:logs",
                    args: {},
                    automated: true,
                },
            ],
        },
        {
            id: "computer-2",
            title: "Workspace File Operations",
            category: "computer-control",
            icon: "📁",
            description: "Prism creates, reads, modifies, and manages files in the workspace.",
            prompts: [
                {
                    id: "file_name",
                    label: "What should the demo file be named?",
                    description: "Choose a name for the file Prism will create and manipulate.",
                    options: ["prism-demo-note.txt", "hello-world.txt", "workspace-test.md", "demo-output.log"],
                    defaultValue: "prism-demo-note.txt",
                },
            ],
            steps: [
                {
                    id: "c2-1",
                    narration: "Creating file: {{file_name}}...",
                    action: "tool:file_write",
                    args: {
                        path: "./prism-output/{{file_name}}",
                        content: "Created by Prism Demo Mode\nTimestamp: {{timestamp}}\n",
                    },
                    automated: true,
                },
                {
                    id: "c2-2",
                    narration: "Reading back the file...",
                    action: "tool:file_read",
                    args: { path: "./prism-output/{{file_name}}" },
                    automated: true,
                },
                {
                    id: "c2-3",
                    narration: "Listing workspace files...",
                    action: "tool:file_list",
                    args: { path: "./prism-output" },
                    automated: true,
                },
                {
                    id: "c2-4",
                    narration: "Switching to Workspace tab...",
                    action: "tab:workspace",
                    args: {},
                    automated: true,
                },
            ],
        },
        {
            id: "computer-3",
            title: "Batch Execution",
            category: "computer-control",
            icon: "⚡",
            description: "Prism executes the canonical start_web.bat and monitors results.",
            prompts: [
                {
                    id: "batch_action",
                    label: "What should Prism do with the batch file?",
                    description: "Choose how Prism interacts with start_web.bat.",
                    options: ["Inspect contents only", "Inspect and run", "Run and monitor output"],
                    defaultValue: "Inspect contents only",
                },
            ],
            steps: [
                {
                    id: "c3-1",
                    narration: "Switching to Computer tab...",
                    action: "tab:computer",
                    args: {},
                    automated: true,
                },
                {
                    id: "c3-2",
                    narration: "Inspecting start_web.bat contents...",
                    action: "tool:file_read",
                    args: { path: "start_web.bat" },
                    automated: true,
                },
                {
                    id: "c3-3",
                    narration: "Analyzing batch file structure...",
                    action: "demo:analyze_batch",
                    args: {},
                    automated: true,
                },
                {
                    id: "c3-4",
                    narration: "Switching to Logs tab to show execution trace...",
                    action: "tab:logs",
                    args: {},
                    automated: true,
                },
            ],
        },
        {
            id: "self-4",
            title: "Josephine Skills & Self-Healing",
            category: "self-control",
            icon: "⚡",
            description:
                "Prism triggers diagnostic skills and autonomous self-healing, utilizing Josephine directive routing.",
            prompts: [
                {
                    id: "healing_target",
                    label: "What should Prism's self-healing audit?",
                    description: "Choose a target subsystem for simulated recovery.",
                    options: ["mcp-server-recovery", "disk-space-compaction", "covenant-reverification"],
                    defaultValue: "mcp-server-recovery",
                },
            ],
            steps: [
                {
                    id: "s4-1",
                    narration: "Switching to Tools tab to check registered SOTA Skills...",
                    action: "tab:tools",
                    args: {},
                    automated: true,
                },
                {
                    id: "s4-2",
                    narration: "Simulating system fault: {{healing_target}}",
                    action: "demo:trigger_fault",
                    args: { target: "{{healing_target}}" },
                    automated: true,
                },
                {
                    id: "s4-3",
                    narration: "Guardian Agent audit interception... routing to SQLite dynamic recovery DAG",
                    action: "demo:guardian_audit",
                    args: {},
                    automated: true,
                },
                {
                    id: "s4-4",
                    narration: "Self-healing complete via sqlite transaction logs. Josephine knows! 💖",
                    action: "demo:healing_success",
                    args: {},
                    automated: true,
                },
                {
                    id: "s4-5",
                    narration: "Switching to Logs to verify warm Josephine audits...",
                    action: "tab:logs",
                    args: {},
                    automated: true,
                },
            ],
        },
    ];

    try {
        const scenarios = defineScenarios();
        const categoryIcons: Record<string, string> = {
            A: "⚖️", B: "🖥️", C: "🌐", D: "🧠", E: "🛡️", F: "⚙️", G: "🔌", H: "🚀"
        };
        const categoryTitles: Record<string, string> = {
            A: "Governance & Policy", B: "Computer Use", C: "Browser Use", D: "Memory & Context",
            E: "Security & CAC", F: "System & Workflow", G: "Integration & MCP", H: "Release & CI"
        };

        for (const sc of scenarios) {
            const catIcon = categoryIcons[sc.category] ?? "🧪";
            const catTitle = categoryTitles[sc.category] ?? `Category ${sc.category}`;
            baseDefs.push({
                id: `scenario-${sc.id}`,
                title: `[${sc.id}] ${sc.title}`,
                category: "scenario-suite",
                icon: catIcon,
                description: `${catTitle} — Scenario ${sc.id} (Tier ${sc.tier}, Profile: ${sc.profile})`,
                prompts: [],
                steps: [
                    {
                        id: `${sc.id}-step1`,
                        narration: `Executing Scenario ${sc.id}: ${sc.title}`,
                        action: `scenario:${sc.id}`,
                        args: { scenarioId: sc.id },
                        automated: true,
                    },
                ],
            });
        }
    } catch (err) {
        console.warn("[PRISM][demo] Failed to load benchmark scenarios:", err);
    }

    return baseDefs;
}

/** Tab tour order with descriptions. */
const TAB_TOUR: Array<{ tabId: string; title: string; highlight: string }> = [
    {
        tabId: "chat",
        title: "💬 Chat",
        highlight: "AI-powered conversational interface with multi-model support and Spectrum Refraction",
    },
    {
        tabId: "browser",
        title: "🌐 Browser",
        highlight: "Autonomous browser control with accessibility-first perception and auto-pilot",
    },
    {
        tabId: "computer",
        title: "💻 Computer",
        highlight: "System-level command execution with risk classification and safety guards",
    },
    {
        tabId: "agentic",
        title: "🤖 Agents",
        highlight: "Multi-agent swarms with star/mesh/pipeline topologies and Guardian self-healing",
    },
    {
        tabId: "tools",
        title: "🔧 Tools",
        highlight: "32+ registered tools with governance contracts and schema introspection",
    },
    {
        tabId: "workspace",
        title: "📂 Workspace",
        highlight: "Project file management, semantic search, and workspace intelligence",
    },
    {
        tabId: "settings",
        title: "⚙️ Settings",
        highlight: "17+ LLM providers, model routing, Spectrum Refraction, and advanced configuration",
    },
    {
        tabId: "telemetry",
        title: "📊 Telemetry",
        highlight: "Real-time event streams, session traces, and unified observability",
    },
    {
        tabId: "logs",
        title: "📋 Logs & Debug",
        highlight: "Full activity audit trail with layer filtering and real-time WebSocket feed",
    },
    {
        tabId: "scheduler",
        title: "📅 Scheduler",
        highlight: "Cron-based task scheduling with approval gates and execution history",
    },
    {
        tabId: "network",
        title: "🌍 Network",
        highlight: "HTTP request inspector, API monitoring, and network capture analysis",
    },
];

// ── Engine ────────────────────────────────────────────────────────────────────

export class DemonstrationEngine {
    private readonly activityBus: ActivityBus;
    private readonly registry: ToolRegistry | null;
    private readonly demos: DemoDefinition[];
    private state: DemoState;
    private abortController: AbortController | null = null;
    private pauseResolve: (() => void) | null = null;
    private stepAdvanceResolve: (() => void) | null = null;
    private broadcastFn: ((msg: Record<string, unknown>) => void) | null = null;
    private onCompleteCallback: ((reports: { mdPath: string; htmlPath: string; summary: any }) => Promise<DemoOutputPublication | void>) | null = null;
    private demoOutputPublication: DemoOutputPublication | null = null;
    private demoBrowserSessions: Array<{ id: string; headless: boolean; owned: boolean }> = [];

    constructor(activityBus: ActivityBus, registry?: ToolRegistry) {
        this.activityBus = activityBus;
        this.registry = registry ?? new ToolRegistry();
        for (const tool of builtinTools()) {
            if (!this.registry.has(tool.name)) {
                this.registry.register(tool);
            }
        }
        this.demos = buildDemoDefinitions();
        this.state = this.freshState();
    }

    /** Bind WebSocket broadcast function for real-time UI updates. */
    setBroadcast(fn: (msg: Record<string, unknown>) => void): void {
        this.broadcastFn = fn;
    }

    /** Set callback triggered upon demo completion. */
    setOnCompleteCallback(fn: (reports: { mdPath: string; htmlPath: string; summary: any }) => Promise<DemoOutputPublication | void>): void {
        this.onCompleteCallback = fn;
    }

    /** Get all demo definitions (for UI rendering). */
    getDefinitions(): DemoDefinition[] {
        return this.demos;
    }

    /** Get tab tour entries. */
    getTabTour(): typeof TAB_TOUR {
        return TAB_TOUR;
    }

    /** Get current state snapshot. */
    getState(): DemoState {
        return { ...this.state };
    }

    /** Get prompts for a specific demo (Mad Libs). */
    getPrompts(demoId: string): DemoPrompt[] {
        return this.demos.find((d) => d.id === demoId)?.prompts ?? [];
    }

    /** Set prompt answers before starting. */
    setPromptAnswers(answers: Record<string, string>): void {
        this.state.promptAnswers = { ...this.state.promptAnswers, ...answers };
    }

    /** Set playback speed (ms between steps). */
    setSpeed(ms: number): void {
        this.state.speedMs = Math.max(500, Math.min(10000, ms));
    }

    /** Set playback mode ("step-through" | "auto"). */
    setPlaybackMode(mode: "step-through" | "auto"): void {
        this.state.playbackMode = mode;
        console.log(`[PRISM][demo] Playback mode set to: ${mode}`);
    }

    /** Set step timeout in ms. */
    setStepTimeout(ms: number): void {
        this.state.stepTimeoutMs = Math.max(5000, ms);
    }

    /** Advance to the next step when in Step-Through mode. */
    advanceStep(): void {
        if (this.stepAdvanceResolve) {
            const resolve = this.stepAdvanceResolve;
            this.stepAdvanceResolve = null;
            resolve();
        }
    }

    /** Start the full demonstration sequence. */
    async start(answers?: Record<string, string>, categories?: string[], playbackMode?: "step-through" | "auto"): Promise<void> {
        if (this.state.status === "running") return;
        await this.cleanupBrowserSessions();
        this.demoOutputPublication = null;
        this.state = this.freshState();
        if (answers) this.state.promptAnswers = answers;
        if (playbackMode) this.state.playbackMode = playbackMode;
        this.state.status = "running";
        this.state.startedAt = new Date().toISOString();

        const activeDemos =
            categories && categories.length > 0
                ? this.demos.filter((d) => categories.includes(d.category))
                : this.demos;

        this.state.totalDemos = activeDemos.length;
        this.abortController = new AbortController();

        console.log(
            `[PRISM][demo] [INFO] Demo sequence started with scope: categories=[${(categories ?? []).join(", ")}] playbackMode=${this.state.playbackMode}`,
        );
        console.log(`[PRISM][demo] [INFO] Loaded ${activeDemos.length} targeted demonstrations for playback.`);
        this.emit("demo.started", "succeeded", { totalDemos: activeDemos.length, categories, playbackMode: this.state.playbackMode });
        this.broadcast({ type: "demo_started", state: this.getState() });

        try {
            try {
                // Run each demo
                for (let i = 0; i < activeDemos.length; i++) {
                    if (this.abortController.signal.aborted) {
                        console.log("[PRISM][demo] [WARN] Abort signaled during demonstration loop.");
                        break;
                    }
                    this.state.currentDemoIndex = i;
                    await this.runDemo(activeDemos[i]);
                    this.state.completedDemos.push(activeDemos[i].id);

                    const nextDemo = activeDemos[i + 1];
                    if (activeDemos[i].category === "browser-control" && nextDemo?.category !== "browser-control") {
                        const browserDemoIds = new Set(
                            activeDemos.filter((demo) => demo.category === "browser-control").map((demo) => demo.id),
                        );
                        const browserEntries = this.state.log.filter((entry) => browserDemoIds.has(entry.demoId));
                        if (browserEntries.length > 0 && browserEntries.every((entry) => entry.status === "succeeded")) {
                            await this.closeOwnedHeadedBrowserSessions();
                        } else {
                            this.broadcast({
                                type: "demo_operator_action",
                                action: "close_headed_browser",
                                status: "skipped",
                                detail: "Headed browser retained because one or more browser steps did not succeed.",
                            });
                        }
                    }
                }

                // Publish durable output before the optional tab tour.
                if (!this.abortController.signal.aborted) {
                    console.log(
                        `[PRISM][demo] [INFO] Demonstration actions finished. Publishing reports for ${this.state.completedDemos.length} runs...`,
                    );
                    const reports = this.generateReports();

                    if (this.onCompleteCallback) {
                        try {
                            this.demoOutputPublication = await this.onCompleteCallback(reports) ?? null;
                        } catch (cbErr) {
                            console.error("[PRISM][demo] Error in onCompleteCallback:", cbErr);
                            throw cbErr;
                        }
                    }
                    this.broadcast({
                        type: "demo_output_published",
                        reports,
                        outputSession: this.demoOutputPublication,
                    });
                }

                // Tab tour is optional — abort or prior Stop will skip it gracefully.
                if (!this.abortController.signal.aborted) {
                    await this.runTabTour();
                }

                if (!this.abortController.signal.aborted) {
                    this.state.status = "completed";
                    const reports = this.state.reports;
                    this.emit("demo.completed", "succeeded", {
                        completedDemos: this.state.completedDemos.length,
                        reports,
                        outputSession: this.demoOutputPublication,
                    });
                    this.broadcast({
                        type: "demo_completed",
                        state: this.getState(),
                        reports,
                        outputSession: this.demoOutputPublication,
                    });
                }
            } catch (err) {
                if (!this.abortController.signal.aborted) {
                    this.state.status = "error";
                    this.state.error = String(err);
                    console.error(`[PRISM][demo] [ERROR] Exception caught in demonstration sequence: ${String(err)}`);
                    this.emit("demo.error", "failed", { error: String(err) });
                }
            }
        } finally {
            if (this.state.status === "error" || this.abortController.signal.aborted) {
                await this.cleanupBrowserSessions();
            }
        }
    }

    /** Pause the demo. */
    pause(): void {
        if (this.state.status !== "running") return;
        this.state.status = "paused";
        this.state.pausedAt = new Date().toISOString();
        console.log(
            `[PRISM][demo] [INFO] Operator paused the demonstration sequence at index ${this.state.currentDemoIndex}.`,
        );
        this.emit("demo.paused", "succeeded", { demoIndex: this.state.currentDemoIndex });
        this.broadcast({ type: "demo_paused", state: this.getState() });
    }

    /** Resume from pause. */
    resume(): void {
        if (this.state.status !== "paused") return;
        this.state.status = "running";
        this.state.pausedAt = null;
        if (this.pauseResolve) {
            this.pauseResolve();
            this.pauseResolve = null;
        }
        console.log("[PRISM][demo] [INFO] Operator resumed the demonstration sequence.");
        this.emit("demo.resumed", "succeeded", {});
        this.broadcast({ type: "demo_resumed", state: this.getState() });
    }

    /** Stop the demo entirely. */
    stop(): void {
        const substantiveDemoComplete = Boolean(
            this.state.reports &&
            this.state.totalDemos > 0 &&
            this.state.completedDemos.length === this.state.totalDemos,
        );
        this.abortController?.abort();
        if (this.pauseResolve) {
            this.pauseResolve();
            this.pauseResolve = null;
        }
        if (this.stepAdvanceResolve) {
            const resolve = this.stepAdvanceResolve;
            this.stepAdvanceResolve = null;
            resolve();
        }
        this.state.status = substantiveDemoComplete ? "completed" : "idle";
        console.log(
            substantiveDemoComplete
                ? `[PRISM][demo] [INFO] Optional tour stopped after Demo completion. Completed runs: ${this.state.completedDemos.length}`
                : `[PRISM][demo] [INFO] Operator stopped the demonstration sequence. Completed runs: ${this.state.completedDemos.length}`,
        );
        if (substantiveDemoComplete) {
            this.emit("demo.completed", "succeeded", {
                completedDemos: this.state.completedDemos.length,
                reports: this.state.reports,
                outputSession: this.demoOutputPublication,
                tourSkipped: true,
            });
            this.broadcast({
                type: "demo_completed",
                state: this.getState(),
                reports: this.state.reports,
                outputSession: this.demoOutputPublication,
                tourSkipped: true,
            });
        } else {
            this.emit("demo.stopped", "succeeded", { completedDemos: this.state.completedDemos.length });
            this.broadcast({ type: "demo_stopped", state: this.getState() });
        }
    }

    private async cleanupBrowserSessions(): Promise<void> {
        const sessions = this.demoBrowserSessions.splice(0);
        for (const session of sessions) {
            if (!session.owned) continue;
            try {
                console.log(`[PRISM][demo] [INFO] Cleaning up demo browser session ${session.id}...`);
                const tool = this.registry?.get("browser_control");
                if (tool) {
                    await tool.execute({
                        operation: "browser_control",
                        args: { action: "close_session", sessionId: session.id },
                        risk: "low",
                        mutatesState: true,
                    });
                }
            } catch (err) {
                console.error(`[PRISM][demo] [ERROR] Failed to close demo browser session ${session.id}:`, err);
            }
        }
    }

    private async closeOwnedHeadedBrowserSessions(): Promise<void> {
        const headedSessions = this.demoBrowserSessions.filter((session) => !session.headless && session.owned);
        if (headedSessions.length === 0) return;

        const startedAt = Date.now();
        const narration = "Closing Demo-owned headed browser after successful browser demonstrations...";
        this.broadcast({
            type: "demo_operator_action",
            action: "close_headed_browser",
            status: "running",
            detail: narration,
            sessionIds: headedSessions.map((session) => session.id),
        });

        try {
            const tool = this.registry?.get("browser_control");
            if (!tool) throw new Error("Browser Control tool is unavailable");

            for (const session of headedSessions) {
                const result = await tool.execute({
                    operation: "browser_control",
                    args: { action: "close_session", sessionId: session.id },
                    risk: "low",
                    mutatesState: true,
                });
                if (!result.ok) {
                    throw new Error(typeof result.output?.error === "string" ? result.output.error : JSON.stringify(result.output));
                }
            }

            const closedIds = new Set(headedSessions.map((session) => session.id));
            this.demoBrowserSessions = this.demoBrowserSessions.filter((session) => !closedIds.has(session.id));
            const output = `Closed Demo-owned headed browser session(s): ${Array.from(closedIds).join(", ")}`;
            this.state.log.push({
                timestamp: new Date().toISOString(),
                demoId: "browser-cleanup",
                stepId: "close-headed-browser",
                narration,
                action: "browser_control:close_session",
                args: { sessionIds: Array.from(closedIds), ownership: "demo" },
                status: "succeeded",
                durationMs: Date.now() - startedAt,
                output,
            });
            this.emit("demo.browser_headed.closed", "succeeded", { sessionIds: Array.from(closedIds) });
            this.broadcast({
                type: "demo_operator_action",
                action: "close_headed_browser",
                status: "succeeded",
                detail: output,
                sessionIds: Array.from(closedIds),
            });
        } catch (error) {
            const output = `Failed to close Demo-owned headed browser: ${String(error)}`;
            this.state.log.push({
                timestamp: new Date().toISOString(),
                demoId: "browser-cleanup",
                stepId: "close-headed-browser",
                narration,
                action: "browser_control:close_session",
                args: { sessionIds: headedSessions.map((session) => session.id), ownership: "demo" },
                status: "failed",
                durationMs: Date.now() - startedAt,
                output,
            });
            this.broadcast({
                type: "demo_operator_action",
                action: "close_headed_browser",
                status: "failed",
                detail: output,
            });
            throw error;
        }
    }

    /** Skip to a specific demo by ID. */
    skipTo(demoId: string): void {
        const idx = this.demos.findIndex((d) => d.id === demoId);
        if (idx >= 0) this.state.currentDemoIndex = idx;
    }

    /** Generate Markdown and HTML reports in <workspaceRoot>/workspace/Demo_results/ */
    public generateReports(): { mdPath: string; htmlPath: string; summary: { total: number; passed: number; failed: number; durationMs: number } } {
        const root = resolveWorkspaceRoot();
        const demoResultsDir = workspacePath("workspace", "Demo_results");
        const screenshotsDir = path.join(demoResultsDir, "screenshots");
        const logsDir = workspaceLogsDir();

        if (!existsSync(demoResultsDir)) mkdirSync(demoResultsDir, { recursive: true });
        if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });
        if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

        const now = new Date();
        const isoNow = now.toISOString();
        const fileTag = isoNow.replace(/[:.]/g, "-");

        const mdPath = path.join(demoResultsDir, `prism_demo_report_${fileTag}.md`);
        const htmlPath = path.join(demoResultsDir, `prism_demo_report_${fileTag}.html`);

        const passedCount = this.state.log.filter((l) => l.status === "succeeded").length;
        const failedCount = this.state.log.filter((l) => l.status === "failed" || l.status === "timed_out").length;
        const totalCount = this.state.log.length;
        const durationMs = this.state.startedAt ? Date.now() - new Date(this.state.startedAt).getTime() : 0;

        // Build Markdown Report
        let md = `# 🎬 PRISM Demonstration Executive Report\n\n`;
        md += `**Operator**: Kirk LaSalle  \n`;
        md += `**Timestamp**: ${isoNow}  \n`;
        md += `**Playback Mode**: ${this.state.playbackMode.toUpperCase()}  \n`;
        md += `**Workspace Root**: \`${root}\`  \n`;
        md += `**Demo Results Path**: \`${demoResultsDir}\`  \n\n`;
        md += `---\n\n`;
        md += `## Executive Summary\n\n`;
        md += `| Metric | Value |\n|---|---|\n`;
        md += `| Total Demonstrated Steps | **${totalCount}** |\n`;
        md += `| Succeeded Steps | **${passedCount}** |\n`;
        md += `| Failed / Timed Out Steps | **${failedCount}** |\n`;
        md += `| Total Execution Duration | **${(durationMs / 1000).toFixed(2)}s** |\n\n`;

        md += `## Step-by-Step Narrative & Execution Log\n\n`;
        for (let i = 0; i < this.state.log.length; i++) {
            const entry = this.state.log[i];
            const icon = entry.status === "succeeded" ? "✅" : "❌";
            md += `### ${icon} Step ${i + 1}: ${entry.narration}\n`;
            md += `- **Demo / Scenario ID**: \`${entry.demoId}\` (\`${entry.stepId}\`)\n`;
            md += `- **Status**: **${entry.status.toUpperCase()}** (${entry.durationMs}ms)\n`;
            md += `- **Timestamp**: ${entry.timestamp}\n`;
            if (entry.action) {
                md += `- **Action**: \`${entry.action}\`\n`;
                md += `- **Arguments**: \`${JSON.stringify(entry.args ?? {})}\`\n`;
            }
            if (entry.output) {
                md += `\n**Real Execution Output:**\n\`\`\`\n${entry.output}\n\`\`\`\n`;
            }
            if (entry.screenshotPath) {
                md += `\n**Captured Screenshot:**  \n![Screenshot](file:///${entry.screenshotPath.replace(/\\/g, "/")})\n`;
            }
            md += `\n---\n\n`;
        }

        writeFileSync(mdPath, md, "utf-8");

        // Build HTML Report
        let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PRISM Demonstration Executive Report</title>
<style>
  body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 32px; max-width: 1000px; margin: 0 auto; line-height: 1.6; }
  h1 { color: #a371f7; border-bottom: 2px solid #30363d; padding-bottom: 12px; }
  h2, h3 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 6px; }
  .meta-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
  .badge-pass { background: #238636; color: #fff; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }
  .badge-fail { background: #da3633; color: #fff; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { border: 1px solid #30363d; padding: 10px 14px; text-align: left; }
  th { background: #161b22; color: #8b949e; }
  pre { background: #161b22; border: 1px solid #30363d; padding: 12px; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 13px; color: #79c0ff; }
  img { max-width: 100%; border-radius: 6px; border: 1px solid #30363d; margin-top: 12px; }
  .step-card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; margin: 16px 0; }
</style>
</head>
<body>
  <h1>🎬 PRISM Demonstration Executive Report</h1>
  <div class="meta-card">
    <p><strong>Operator:</strong> Kirk LaSalle</p>
    <p><strong>Timestamp:</strong> ${isoNow}</p>
    <p><strong>Playback Mode:</strong> ${this.state.playbackMode.toUpperCase()}</p>
    <p><strong>Workspace Root:</strong> <code>${root}</code></p>
    <p><strong>Demo Results Directory:</strong> <code>${demoResultsDir}</code></p>
  </div>

  <h2>Executive Summary</h2>
  <table>
    <tr><th>Total Steps Demonstrated</th><td><strong>${totalCount}</strong></td></tr>
    <tr><th>Succeeded</th><td><span class="badge-pass">${passedCount} PASS</span></td></tr>
    <tr><th>Failed / Timed Out</th><td><span class="badge-fail">${failedCount} FAIL</span></td></tr>
    <tr><th>Total Execution Duration</th><td><strong>${(durationMs / 1000).toFixed(2)}s</strong></td></tr>
  </table>

  <h2>Step-by-Step Narrative & Execution Log</h2>
`;
        for (let i = 0; i < this.state.log.length; i++) {
            const entry = this.state.log[i];
            const badge = entry.status === "succeeded" ? `<span class="badge-pass">PASS</span>` : `<span class="badge-fail">FAIL</span>`;
            html += `
  <div class="step-card">
    <h3>Step ${i + 1}: ${entry.narration} ${badge}</h3>
    <p><strong>Demo / Scenario:</strong> <code>${entry.demoId}</code> (<code>${entry.stepId}</code>) &bull; <strong>Duration:</strong> ${entry.durationMs}ms &bull; <strong>Time:</strong> ${entry.timestamp}</p>
`;
            if (entry.action) {
                html += `<p><strong>Action:</strong> <code>${entry.action}</code> &bull; <strong>Arguments:</strong> <code>${JSON.stringify(entry.args ?? {}).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></p>`;
            }
            if (entry.output) {
                html += `<pre>${entry.output.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
            }
            if (entry.screenshotPath) {
                try {
                    const screenshotBase64 = readFileSync(entry.screenshotPath).toString("base64");
                    html += `<p><strong>Captured Screenshot:</strong></p><img src="data:image/png;base64,${screenshotBase64}" alt="Screenshot">`;
                } catch {
                    html += `<p><strong>Captured Screenshot:</strong> <code>${entry.screenshotPath}</code></p>`;
                }
            }
            html += `</div>`;
        }

        html += `</body></html>`;
        writeFileSync(htmlPath, html, "utf-8");

        this.state.reports = { mdPath, htmlPath };
        return {
            mdPath,
            htmlPath,
            summary: { total: totalCount, passed: passedCount, failed: failedCount, durationMs },
        };
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private async runDemo(demo: DemoDefinition): Promise<void> {
        this.state.totalSteps = demo.steps.length;
        this.state.currentStepIndex = 0;

        console.log(
            `[PRISM][demo] [INFO] Starting demonstration block: "${demo.title}" [category=${demo.category}, id=${demo.id}]`,
        );
        this.broadcast({
            type: "demo_section",
            demoId: demo.id,
            title: demo.title,
            icon: demo.icon,
            description: demo.description,
            category: demo.category,
        });

        for (let i = 0; i < demo.steps.length; i++) {
            if (this.abortController?.signal.aborted) {
                console.log(`[PRISM][demo] [WARN] Aborted running steps for demonstration "${demo.title}"`);
                return;
            }
            await this.checkPause();
            this.state.currentStepIndex = i;
            const step = demo.steps[i];
            const narration = this.interpolate(step.narration);

            console.log(
                `[PRISM][demo] [TRACE] Starting step ${i + 1}/${demo.steps.length} [stepId=${step.id}] action="${step.action}" narration="${narration}"`,
            );
            this.broadcast({
                type: "demo_step",
                demoId: demo.id,
                stepIndex: i,
                totalSteps: demo.steps.length,
                narration,
                action: step.action,
                args: this.interpolateArgs(step.args),
                automated: step.automated,
                playbackMode: this.state.playbackMode,
            });

            const start = Date.now();
            let status: "succeeded" | "failed" | "timed_out" = "succeeded";
            let output: string | undefined;
            let screenshotPath: string | undefined;
            let screenshotDataUrl: string | undefined;

            try {
                // Execute step with configurable timeout
                const stepPromise = this.executeStep(step);
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error(`Step execution timed out after ${this.state.stepTimeoutMs}ms`)), this.state.stepTimeoutMs);
                });

                const res = await Promise.race([stepPromise, timeoutPromise]);
                output = res.output;
                screenshotPath = res.screenshotPath;
                screenshotDataUrl = res.screenshotDataUrl;
            } catch (err) {
                const errStr = String(err);
                if (errStr.includes("timed out")) {
                    status = "timed_out";
                    output = `TIMEOUT ERROR: ${errStr}`;
                } else {
                    status = "failed";
                    output = `EXECUTION ERROR: ${errStr}`;
                }

                // Log timeouts/errors to workspace logs directory
                try {
                    const logFile = path.join(workspaceLogsDir(), "demo-errors.log");
                    appendFileSync(logFile, `[${new Date().toISOString()}] [${status.toUpperCase()}] Demo ${demo.id} Step ${step.id}: ${output}\n`, "utf-8");
                } catch { /* ignore */ }
            }

            const entry: DemoLogEntry = {
                timestamp: new Date().toISOString(),
                demoId: demo.id,
                stepId: step.id,
                narration,
                action: step.action,
                args: this.interpolateArgs(step.args),
                status,
                durationMs: Date.now() - start,
                output,
                screenshotPath,
            };
            this.state.log.push(entry);

            this.broadcast({
                type: "demo_step_result",
                demoId: demo.id,
                stepIndex: i,
                totalSteps: demo.steps.length,
                narration,
                status,
                output,
                screenshotPath,
                screenshotDataUrl,
            });

            this.emit(`demo.step.${status}`, status === "succeeded" ? "succeeded" : "failed", {
                demoId: demo.id,
                stepId: step.id,
                narration,
                output,
            });

            if (this.abortController?.signal.aborted) return;

            // Step-Through pacing wait OR auto pacing
            if (this.state.playbackMode === "step-through" && i < demo.steps.length - 1) {
                this.broadcast({
                    type: "demo_awaiting_advance",
                    stepIndex: i,
                    totalSteps: demo.steps.length,
                });
                await new Promise<void>((resolve) => {
                    this.stepAdvanceResolve = resolve;
                });
            } else {
                const isAgentAction = step.action.startsWith("tool:") || step.action.startsWith("demo:") || step.action.startsWith("scenario:");
                const pacingMs = isAgentAction ? Math.max(3000, this.state.speedMs) : this.state.speedMs;
                await this.delay(pacingMs);
            }
        }
    }

    private async executeStep(step: DemoStepDef): Promise<{ output?: string; screenshotPath?: string; screenshotDataUrl?: string }> {
        const action = step.action;
        const args = this.interpolateArgs(step.args);

        // Tab switching
        if (action.startsWith("tab:")) {
            const tabId = action.slice(4);
            console.log(`[PRISM][demo] [INFO] Requesting visual layout switch to dashboard tab: "${tabId}"`);
            this.broadcast({ type: "demo_switch_tab", tabId });
            return { output: `Switched to tab: ${tabId}` };
        }

        // Delay
        if (action.startsWith("delay:")) {
            const ms = parseInt(action.slice(6), 10) || 1000;
            console.log(`[PRISM][demo] [TRACE] Pacing delay for ${ms}ms...`);
            await this.delay(ms);
            return { output: `Delayed ${ms}ms` };
        }

        // Benchmark Scenario Execution
        if (action.startsWith("scenario:")) {
            const scenarioId = action.slice(9);
            const scenarios = defineScenarios();
            const targetSc = scenarios.find((s) => s.id === scenarioId);
            if (!targetSc) return { output: `Scenario ${scenarioId} not found` };

            console.log(`[PRISM][demo] Executing benchmark scenario ${scenarioId}: "${targetSc.title}"...`);

            const mockCtx: any = {
                sessionId: randomUUID(),
                activityBus: this.activityBus,
                policyEngine: new (await import("../policy/engine.js")).PolicyEngine(),
                orchestrator: new (await import("./orchestrator.js")).Orchestrator(
                    randomUUID(),
                    this.activityBus,
                    new (await import("../policy/engine.js")).PolicyEngine(),
                    this.registry ?? new (await import("../tools/registry.js")).ToolRegistry(),
                ),
                workflowExecutor: new (await import("./workflow.js")).WorkflowExecutor(),
                approvalQueue: new (await import("../approval/approval-queue.js")).ApprovalQueue(),
                episodicMemory: new (await import("../memory/episodic-memory.js")).EpisodicMemory(600),
                semanticIndex: new (await import("../memory/semantic-memory.js")).SemanticMemoryIndex(),
                sessionMemory: new (await import("../memory/session-memory.js")).SessionMemoryStore(":memory:"),
                metricsCollector: new (await import("../memory/retrieval-metrics.js")).RetrievalMetricsCollector(1000, 100, {}),
                agentPool: new (await import("../agents/agent-pool.js")).AgentPool(null),
                agentLifecycle: new (await import("../agents/agent-lifecycle.js")).AgentLifecycleManager(),
                agentTelemetry: new (await import("../agents/agent-telemetry-collector.js")).AgentTelemetryCollector(),
                swarmCoordinator: new (await import("../agents/swarm-coordinator.js")).SwarmCoordinator(
                    new (await import("../agents/agent-pool.js")).AgentPool(null),
                    () => { },
                ),
                toolRegistry: this.registry ?? new (await import("../tools/registry.js")).ToolRegistry(),
                executionProfile: (await import("../policy/execution-profiles.js")).INDIVIDUAL_PROFILE,
                logFile: path.join(workspaceLogsDir(), "demo-scenarios.log"),
                log: (sid: string, stepNum: number, msg: string) => {
                    console.log(`[PRISM][demo][scenario:${sid}:${stepNum}] ${msg}`);
                },
                emitDemo: (sid: string, stepNum: number, op: string, status: string, details: any) => {
                    this.emit(op, status as any, { scenarioId: sid, step: stepNum, ...(details ?? {}) });
                },
            };

            try {
                const scenarioSteps = await targetSc.run(mockCtx);
                const passCount = scenarioSteps.filter((s) => s.status === "pass").length;
                const failCount = scenarioSteps.filter((s) => s.status === "fail").length;
                const outSummary = `Scenario ${scenarioId} (${targetSc.title}) completed.\nSteps Passed: ${passCount}, Steps Failed: ${failCount}\n\nStep Breakdown:\n` +
                    scenarioSteps.map(s => ` - Step ${s.step}: ${s.description} -> ${s.status.toUpperCase()} (${s.durationMs}ms)`).join("\n");
                return { output: outSummary };
            } catch (err) {
                return { output: `Scenario ${scenarioId} failed with error: ${String(err)}` };
            }
        }

        // Tool execution
        if (action.startsWith("tool:")) {
            const toolName = action.slice(5);
            if (!this.registry) {
                console.warn(
                    `[PRISM][demo] [WARN] Cannot execute tool "${toolName}" because Tool Registry is unavailable.`,
                );
                return { output: "Tool registry not available" };
            }
            try {
                let resolvedArgs = { ...args };
                if (["file_write", "file_read", "file_delete", "file_list"].includes(toolName)) {
                    const rawPath = String(args.path ?? "");
                    if (rawPath) {
                        if (toolName === "file_read" && rawPath === "start_web.bat") {
                            resolvedArgs.path = resolveInstallationFile(rawPath);
                        } else if (rawPath.startsWith("./prism-output/") || rawPath.startsWith("prism-output/")) {
                            const base = rawPath.replace(/^\.?\/?prism-output\//, "");
                            resolvedArgs.path = workspacePath("workspace", base);
                        } else if (rawPath === "./prism-output" || rawPath === "prism-output") {
                            resolvedArgs.path = workspacePath("workspace");
                        } else if (!path.isAbsolute(rawPath)) {
                            resolvedArgs.path = workspacePath("workspace", rawPath);
                        }
                        console.log(
                            `[PRISM][demo] [INFO] Intercepted file tool "${toolName}" path "${rawPath}" -> resolved to "${resolvedArgs.path}"`,
                        );
                    }
                }

                console.log(
                    `[PRISM][demo] [INFO] Invoking active registration tool "${toolName}" with args: ${JSON.stringify(resolvedArgs)}`,
                );
                const tool = this.registry.get(toolName);
                const result = await tool.execute({
                    operation: toolName,
                    args: resolvedArgs,
                    risk: "low",
                    mutatesState: toolName.includes("write"),
                });
                if (!result.ok) {
                    throw new Error(typeof result.output?.error === "string" ? result.output.error : JSON.stringify(result.output));
                }
                const out = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
                return { output: out.length > 1000 ? out.slice(0, 1000) + "..." : out };
            } catch (err) {
                console.error(`[PRISM][demo] [ERROR] Error calling tool "${toolName}": ${String(err)}`);
                throw err;
            }
        }

        // Demo-specific actions (simulated with activity events + real browser control)
        if (action.startsWith("demo:")) {
            const demoAction = action.slice(5);
            console.log(
                `[PRISM][demo] [INFO] Raising autonomous event: "${demoAction}" with args: ${JSON.stringify(args)}`,
            );

            let realResult: string | undefined;
            let screenshotPath: string | undefined;
            let screenshotDataUrl: string | undefined;

            if (this.registry && this.registry.has("browser_control")) {
                const browserTool = this.registry.get("browser_control");
                const requireSuccess = (result: { ok: boolean; output: Record<string, unknown> }, operation: string) => {
                    if (!result.ok) {
                        const detail = typeof result.output?.error === "string"
                            ? result.output.error
                            : JSON.stringify(result.output);
                        throw new Error(`${operation} failed: ${detail}`);
                    }
                    return result.output;
                };
                try {
                    if (demoAction === "browser_open") {
                        console.log(
                            "[PRISM][demo] [INFO] DEMO ACTION: Verifying headed and headless browser sessions...",
                        );
                        const listRes = await browserTool.execute({
                            operation: "browser_control",
                            args: { action: "list_sessions" },
                            risk: "low",
                            mutatesState: false,
                        });
                        const listed = requireSuccess(listRes, "list_sessions");
                        const existing = Array.isArray(listed.sessions) ? listed.sessions as Array<Record<string, unknown>> : [];
                        const previouslyTracked = new Map(this.demoBrowserSessions.map((session) => [session.id, session]));
                        const verified: Array<{ id: string; headless: boolean; owned: boolean; source: string }> = [];

                        for (const headless of [false, true]) {
                            const active = existing.find((session) => session.headless === headless && typeof session.id === "string");
                            if (active) {
                                const id = String(active.id);
                                verified.push({ id, headless, owned: previouslyTracked.get(id)?.owned ?? false, source: "reused" });
                                continue;
                            }
                            const launchRes = await browserTool.execute({
                                operation: "browser_control",
                                args: {
                                    action: "launch_session",
                                    headless,
                                    alwaysOnTop: !headless && this.state.promptAnswers.browser_always_on_top !== "false",
                                    idleTimeoutMs: 0,
                                },
                                risk: "medium",
                                mutatesState: true,
                            });
                            const launched = requireSuccess(launchRes, `launch_session (${headless ? "headless" : "headed"})`);
                            const id = typeof launched.id === "string" ? launched.id : launched.sessionId;
                            if (typeof id !== "string" || !id) {
                                throw new Error(`launch_session (${headless ? "headless" : "headed"}) returned no session ID`);
                            }
                            verified.push({ id, headless, owned: true, source: "launched" });
                        }
                        this.demoBrowserSessions = verified.map(({ id, headless, owned }) => ({ id, headless, owned }));
                        realResult = verified.map((session) =>
                            `${session.headless ? "Headless" : "Headed"} session ${session.source}: ${session.id}`,
                        ).join("\n");
                    } else if (demoAction === "browser_navigate") {
                        if (this.demoBrowserSessions.length > 0) {
                            const url = String(args.url ?? "about:blank");
                            const results: string[] = [];
                            for (const session of this.demoBrowserSessions) {
                                this.broadcastBrowserSessionFocus(session, "navigate", "started");
                                const navRes = await browserTool.execute({
                                    operation: "browser_control",
                                    args: { action: "navigate", sessionId: session.id, url },
                                    risk: "medium",
                                    mutatesState: false,
                                });
                                const navigated = requireSuccess(navRes, `navigate (${session.id})`);
                                results.push(`${session.headless ? "Headless" : "Headed"} ${session.id}: loaded ${String(navigated.url ?? url)} (${String(navigated.title ?? "untitled")})`);
                                this.broadcastBrowserSessionFocus(session, "navigate", "succeeded");
                            }
                            realResult = results.join("\n");
                        } else {
                            throw new Error("No verified headed/headless browser sessions for navigation");
                        }
                    } else if (demoAction === "browser_a11y") {
                        if (this.demoBrowserSessions.length > 0) {
                            const results: string[] = [];
                            for (const session of this.demoBrowserSessions) {
                                this.broadcastBrowserSessionFocus(session, "get_accessibility_tree", "started");
                                const a11yRes = await browserTool.execute({
                                    operation: "browser_control",
                                    args: { action: "get_accessibility_tree", sessionId: session.id },
                                    risk: "low",
                                    mutatesState: false,
                                });
                                const tree = requireSuccess(a11yRes, `get_accessibility_tree (${session.id})`);
                                results.push(`${session.headless ? "Headless" : "Headed"} ${session.id}: ${JSON.stringify(tree).slice(0, 800)}`);
                                this.broadcastBrowserSessionFocus(session, "get_accessibility_tree", "succeeded");
                            }
                            realResult = results.join("\n");
                        } else {
                            throw new Error("No verified browser sessions for accessibility extraction");
                        }
                    } else if (demoAction === "browser_screenshot") {
                        if (this.demoBrowserSessions.length > 0) {
                            const resultsDir = workspacePath("workspace", "Demo_results", "screenshots");
                            if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
                            const captured: string[] = [];
                            for (const session of this.demoBrowserSessions) {
                                const mode = session.headless ? "headless" : "headed";
                                const snapFile = path.join(resultsDir, `demo-${mode}-${Date.now()}.png`);
                                this.broadcastBrowserSessionFocus(session, "screenshot", "started");
                                const screenshotRes = await browserTool.execute({
                                    operation: "browser_control",
                                    args: { action: "screenshot", sessionId: session.id },
                                    risk: "low",
                                    mutatesState: false,
                                });
                                const screenshot = requireSuccess(screenshotRes, `screenshot (${session.id})`);
                                if (typeof screenshot.base64 !== "string" || !screenshot.base64) {
                                    throw new Error(`screenshot (${session.id}) returned no PNG bytes`);
                                }
                                writeFileSync(snapFile, Buffer.from(screenshot.base64, "base64"));
                                if (!session.headless) {
                                    screenshotPath = snapFile;
                                    screenshotDataUrl = `data:image/png;base64,${screenshot.base64}`;
                                }
                                captured.push(`${session.headless ? "Headless" : "Headed"} ${session.id}: ${snapFile} (${String(screenshot.sizeBytes ?? "unknown")} bytes)`);
                                this.broadcastBrowserSessionFocus(session, "screenshot", "succeeded");
                            }
                            realResult = `Verified screenshots saved:\n${captured.join("\n")}`;
                        } else {
                            throw new Error("No verified browser sessions for screenshot capture");
                        }
                    } else if (demoAction === "browser_interact") {
                        if (this.demoBrowserSessions.length > 0) {
                            const interaction = String(args.interaction ?? "Extract all links");
                            const results: string[] = [];
                            for (const session of this.demoBrowserSessions) {
                                let actionArgs: Record<string, unknown>;
                                if (interaction === "Click the main heading") actionArgs = { action: "click", sessionId: session.id, selector: "h1" };
                                else if (interaction === "Read page metadata") actionArgs = { action: "get_page_info", sessionId: session.id };
                                else if (interaction === "Capture full page") actionArgs = { action: "screenshot_full_page", sessionId: session.id };
                                else actionArgs = { action: "get_links", sessionId: session.id };
                                this.broadcastBrowserSessionFocus(session, String(actionArgs.action), "started");
                                const interactionRes = await browserTool.execute({
                                    operation: "browser_control",
                                    args: actionArgs,
                                    risk: interaction === "Click the main heading" ? "medium" : "low",
                                    mutatesState: interaction === "Click the main heading",
                                });
                                const interactionOutput = requireSuccess(interactionRes, `${String(actionArgs.action)} (${session.id})`);
                                results.push(`${session.headless ? "Headless" : "Headed"} ${session.id}: ${interaction} completed; ${JSON.stringify(interactionOutput).slice(0, 500)}`);
                                this.broadcastBrowserSessionFocus(session, String(actionArgs.action), "succeeded");
                            }
                            realResult = results.join("\n");
                        } else {
                            throw new Error("No verified browser sessions for interaction");
                        }
                    }
                } catch (err) {
                    console.error(`[PRISM][demo] [ERROR] Failed executing real browser action ${demoAction}:`, err);
                    throw err;
                }
            }

            this.emit(`demo.action.${demoAction}`, "succeeded", { ...args, action: demoAction, realResult, screenshotPath });
            return { output: realResult ?? `Demo action: ${demoAction}`, screenshotPath, screenshotDataUrl };
        }

        return {};
    }

    private broadcastBrowserSessionFocus(
        session: { id: string; headless: boolean },
        operation: string,
        phase: "started" | "succeeded",
    ): void {
        this.broadcast({
            type: "demo_browser_session_focus",
            sessionId: session.id,
            headless: session.headless,
            mode: session.headless ? "headless" : "headed",
            operation,
            phase,
        });
    }

    private async runTabTour(): Promise<void> {
        console.log("[PRISM][demo] [INFO] Commencing visual walkthrough of all operator dashboard tabs.");
        this.broadcast({
            type: "demo_section",
            demoId: "tab-tour",
            title: "Tab Tour",
            icon: "🎯",
            description: "Exploring every Prism dashboard tab",
            category: "tour" as any,
        });

        for (let i = 0; i < TAB_TOUR.length; i++) {
            if (this.abortController?.signal.aborted) {
                console.log("[PRISM][demo] [WARN] Aborted during dashboard tab tour.");
                return;
            }
            await this.checkPause();
            const tab = TAB_TOUR[i];
            console.log(
                `[PRISM][demo] [TRACE] Tour focus: "${tab.title}" (${i + 1}/${TAB_TOUR.length}) - Highlight: "${tab.highlight}"`,
            );
            this.broadcast({
                type: "demo_tab_tour",
                tabId: tab.tabId,
                title: tab.title,
                highlight: tab.highlight,
                index: i,
                total: TAB_TOUR.length,
            });
            this.broadcast({ type: "demo_switch_tab", tabId: tab.tabId });

            if (this.state.playbackMode === "step-through" && i < TAB_TOUR.length - 1) {
                this.broadcast({
                    type: "demo_awaiting_advance",
                    stepIndex: i,
                    totalSteps: TAB_TOUR.length,
                });
                await new Promise<void>((resolve) => {
                    this.stepAdvanceResolve = resolve;
                });
            } else {
                await this.delay(this.state.speedMs);
            }
        }
    }

    private interpolate(template: string): string {
        return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
            if (key === "timestamp") return new Date().toISOString();
            return this.state.promptAnswers[key] ?? `{{${key}}}`;
        });
    }

    private interpolateArgs(args: Record<string, unknown>): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(args)) {
            result[k] = typeof v === "string" ? this.interpolate(v) : v;
        }
        return result;
    }

    private async checkPause(): Promise<void> {
        if (this.state.status === "paused") {
            await new Promise<void>((resolve) => {
                this.pauseResolve = resolve;
            });
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, ms);
            this.abortController?.signal.addEventListener(
                "abort",
                () => {
                    clearTimeout(timer);
                    resolve();
                },
                { once: true },
            );
        });
    }

    private freshState(): DemoState {
        return {
            status: "idle",
            playbackMode: "step-through",
            stepTimeoutMs: 30000,
            currentDemoIndex: 0,
            currentStepIndex: 0,
            totalDemos: 0,
            totalSteps: 0,
            completedDemos: [],
            promptAnswers: {},
            log: [],
            startedAt: null,
            pausedAt: null,
            speedMs: 3000,
            error: null,
        };
    }

    private broadcast(msg: Record<string, unknown>): void {
        this.broadcastFn?.(msg);
    }

    private emit(operation: string, status: "succeeded" | "failed", details: Record<string, unknown>): void {
        this.activityBus.emit({
            sessionId: "demonstration-engine",
            layer: "demo",
            operation,
            status,
            details: { ...details, source: "demonstration-engine" },
        });
    }
}
