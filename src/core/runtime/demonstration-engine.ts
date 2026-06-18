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
import * as path from "node:path";
import { workspacePath } from "../config/workspace-resolver.js";
import type { ActivityBus } from "../activity/bus.js";
import type { ToolRegistry } from "../tools/registry.js";

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
  category: "self-control" | "browser-control" | "computer-control";
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
  status: "running" | "succeeded" | "failed" | "skipped";
  durationMs: number;
  output?: string;
}

export interface DemoState {
  status: DemoStatus;
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
}

// ── Demo Definitions ─────────────────────────────────────────────────────────

function buildDemoDefinitions(): DemoDefinition[] {
  return [
    // ═══ SELF CONTROL ═══
    {
      id: "self-1", title: "Agent Swarm Deployment", category: "self-control", icon: "🧠",
      description: "Prism spawns a team of agents, organizes them into a swarm, and dispatches a collaborative task.",
      prompts: [{
        id: "swarm_goal", label: "What should the swarm research?",
        description: "Pick a topic for the agent swarm to investigate (demo scope — results are illustrative).",
        options: ["Project architecture analysis", "Code quality assessment", "Security vulnerability scan", "Performance optimization review"],
        defaultValue: "Project architecture analysis",
      }],
      steps: [
        { id: "s1-1", narration: "Spawning 3 specialized agents...", action: "demo:spawn_agents", args: { count: 3 }, automated: true },
        { id: "s1-2", narration: "Creating star-topology swarm...", action: "demo:create_swarm", args: { topology: "star" }, automated: true },
        { id: "s1-3", narration: "Dispatching research task: {{swarm_goal}}", action: "demo:dispatch_swarm", args: { goal: "{{swarm_goal}}" }, automated: true },
        { id: "s1-4", narration: "Switching to Agents tab to show live telemetry...", action: "tab:agentic", args: {}, automated: true },
        { id: "s1-5", narration: "Cleaning up swarm agents...", action: "demo:cleanup_swarm", args: {}, automated: true },
      ],
    },
    {
      id: "self-2", title: "Guardian Health Check", category: "self-control", icon: "🛡️",
      description: "Prism's Guardian agent runs health checks, monitors anomalies, and demonstrates self-healing.",
      prompts: [{
        id: "health_focus", label: "What should Guardian focus on?",
        description: "Choose an area for the Guardian to audit (demo scope).",
        options: ["System resource usage", "Agent pool health", "Tool registry integrity", "Memory subsystem"],
        defaultValue: "System resource usage",
      }],
      steps: [
        { id: "s2-1", narration: "Switching to Agents tab...", action: "tab:agentic", args: {}, automated: true },
        { id: "s2-2", narration: "Running Guardian health check: {{health_focus}}", action: "demo:guardian_check", args: { focus: "{{health_focus}}" }, automated: true },
        { id: "s2-3", narration: "Checking AAB (Anomalous Autonomous Behaviour) ledger...", action: "demo:check_aab", args: {}, automated: true },
        { id: "s2-4", narration: "Switching to Telemetry tab to show event stream...", action: "tab:telemetry", args: {}, automated: true },
      ],
    },
    {
      id: "self-3", title: "Governance Policy Audit", category: "self-control", icon: "⚖️",
      description: "Demonstrates Prism's 3-tier governance: autonomous read → conditional mutation → approval-gated execution.",
      prompts: [{
        id: "audit_file", label: "What file should the audit create?",
        description: "Pick a demo output filename (created in prism-output/).",
        options: ["governance-demo.txt", "policy-audit-report.txt", "compliance-check.txt"],
        defaultValue: "governance-demo.txt",
      }],
      steps: [
        { id: "s3-1", narration: "Tier 1: Autonomous file listing (read-only, no approval)...", action: "tool:file_list", args: { path: "." }, automated: true },
        { id: "s3-2", narration: "Tier 2: Writing {{audit_file}} (mutation with rollback plan)...", action: "tool:file_write", args: { path: "./prism-output/{{audit_file}}", content: "Prism Governance Demo — Tier 2 conditional write.\nTimestamp: {{timestamp}}\n" }, automated: true },
        { id: "s3-3", narration: "Switching to Tools tab to show governance contracts...", action: "tab:tools", args: {}, automated: true },
        { id: "s3-4", narration: "Switching to Logs to show the full audit trail...", action: "tab:logs", args: {}, automated: true },
      ],
    },

    // ═══ BROWSER CONTROL ═══
    {
      id: "browser-1", title: "Web Research", category: "browser-control", icon: "🌐",
      description: "Prism opens a browser, navigates to a page, extracts content, and captures a screenshot.",
      prompts: [{
        id: "research_url", label: "What URL should Prism research?",
        description: "Pick a URL to navigate to (demo scope — safe, public sites only).",
        options: ["https://example.com", "https://httpbin.org", "https://jsonplaceholder.typicode.com", "about:blank"],
        defaultValue: "https://example.com",
      }],
      steps: [
        { id: "b1-1", narration: "Switching to Browser tab...", action: "tab:browser", args: {}, automated: true },
        { id: "b1-2", narration: "Opening browser session...", action: "demo:browser_open", args: {}, automated: true },
        { id: "b1-3", narration: "Navigating to {{research_url}}...", action: "demo:browser_navigate", args: { url: "{{research_url}}" }, automated: true },
        { id: "b1-4", narration: "Extracting accessibility tree (page structure)...", action: "demo:browser_a11y", args: {}, automated: true },
        { id: "b1-5", narration: "Capturing screenshot...", action: "demo:browser_screenshot", args: {}, automated: true },
      ],
    },
    {
      id: "browser-2", title: "Multi-Page Navigation", category: "browser-control", icon: "📑",
      description: "Prism navigates across multiple pages, collecting data from each.",
      prompts: [{
        id: "page_count", label: "How many pages to visit?",
        description: "Choose the number of pages for the multi-page demo.",
        options: ["2 pages", "3 pages", "4 pages"],
        defaultValue: "3 pages",
      }],
      steps: [
        { id: "b2-1", narration: "Opening browser session for multi-page research...", action: "demo:browser_open", args: {}, automated: true },
        { id: "b2-2", narration: "Navigating to page 1: example.com...", action: "demo:browser_navigate", args: { url: "https://example.com" }, automated: true },
        { id: "b2-3", narration: "Capturing page 1 screenshot...", action: "demo:browser_screenshot", args: {}, automated: true },
        { id: "b2-4", narration: "Navigating to page 2: httpbin.org...", action: "demo:browser_navigate", args: { url: "https://httpbin.org" }, automated: true },
        { id: "b2-5", narration: "Capturing page 2 screenshot...", action: "demo:browser_screenshot", args: {}, automated: true },
      ],
    },
    {
      id: "browser-3", title: "Page Interaction", category: "browser-control", icon: "🖱️",
      description: "Prism interacts with page elements — clicking links, reading content, extracting data.",
      prompts: [{
        id: "interact_target", label: "What should Prism interact with?",
        description: "Choose what Prism will do on the page.",
        options: ["Click the main heading", "Extract all links", "Read page metadata", "Capture full page"],
        defaultValue: "Extract all links",
      }],
      steps: [
        { id: "b3-1", narration: "Opening browser session...", action: "demo:browser_open", args: {}, automated: true },
        { id: "b3-2", narration: "Navigating to example.com...", action: "demo:browser_navigate", args: { url: "https://example.com" }, automated: true },
        { id: "b3-3", narration: "Performing interaction: {{interact_target}}...", action: "demo:browser_interact", args: { interaction: "{{interact_target}}" }, automated: true },
        { id: "b3-4", narration: "Capturing result screenshot...", action: "demo:browser_screenshot", args: {}, automated: true },
      ],
    },

    // ═══ COMPUTER CONTROL ═══
    {
      id: "computer-1", title: "System Diagnostics", category: "computer-control", icon: "💻",
      description: "Prism runs system diagnostic commands and compiles a report.",
      prompts: [{
        id: "diag_depth", label: "How deep should the diagnostic go?",
        description: "Choose the diagnostic level (demo scope — safe read-only commands).",
        options: ["Quick (node + hostname)", "Standard (+ OS info + disk)", "Full (+ processes + network)"],
        defaultValue: "Standard (+ OS info + disk)",
      }],
      steps: [
        { id: "c1-1", narration: "Switching to Computer tab...", action: "tab:computer", args: {}, automated: true },
        { id: "c1-2", narration: "Running: node --version", action: "tool:shell_exec", args: { command: "node --version" }, automated: true },
        { id: "c1-3", narration: "Running: hostname", action: "tool:shell_exec", args: { command: "hostname" }, automated: true },
        { id: "c1-4", narration: "Writing diagnostic report...", action: "tool:file_write", args: { path: "./prism-output/demo-diagnostics.txt", content: "Prism System Diagnostic Report\nGenerated: {{timestamp}}\n" }, automated: true },
        { id: "c1-5", narration: "Switching to Logs to show command audit trail...", action: "tab:logs", args: {}, automated: true },
      ],
    },
    {
      id: "computer-2", title: "Workspace File Operations", category: "computer-control", icon: "📁",
      description: "Prism creates, reads, modifies, and manages files in the workspace.",
      prompts: [{
        id: "file_name", label: "What should the demo file be named?",
        description: "Choose a name for the file Prism will create and manipulate.",
        options: ["prism-demo-note.txt", "hello-world.txt", "workspace-test.md", "demo-output.log"],
        defaultValue: "prism-demo-note.txt",
      }],
      steps: [
        { id: "c2-1", narration: "Creating file: {{file_name}}...", action: "tool:file_write", args: { path: "./prism-output/{{file_name}}", content: "Created by Prism Demo Mode\nTimestamp: {{timestamp}}\n" }, automated: true },
        { id: "c2-2", narration: "Reading back the file...", action: "tool:file_read", args: { path: "./prism-output/{{file_name}}" }, automated: true },
        { id: "c2-3", narration: "Listing workspace files...", action: "tool:file_list", args: { path: "./prism-output" }, automated: true },
        { id: "c2-4", narration: "Switching to Workspace tab...", action: "tab:workspace", args: {}, automated: true },
      ],
    },
    {
      id: "computer-3", title: "Batch Execution", category: "computer-control", icon: "⚡",
      description: "Prism executes the canonical start_web.bat and monitors results.",
      prompts: [{
        id: "batch_action", label: "What should Prism do with the batch file?",
        description: "Choose how Prism interacts with start_web.bat.",
        options: ["Inspect contents only", "Inspect and run", "Run and monitor output"],
        defaultValue: "Inspect contents only",
      }],
      steps: [
        { id: "c3-1", narration: "Switching to Computer tab...", action: "tab:computer", args: {}, automated: true },
        { id: "c3-2", narration: "Inspecting start_web.bat contents...", action: "tool:file_read", args: { path: "D:\\Projects\\Prism\\start_web.bat" }, automated: true },
        { id: "c3-3", narration: "Analyzing batch file structure...", action: "demo:analyze_batch", args: {}, automated: true },
        { id: "c3-4", narration: "Switching to Logs tab to show execution trace...", action: "tab:logs", args: {}, automated: true },
      ],
    },
    {
      id: "self-4", title: "Josephine Skills & Self-Healing", category: "self-control", icon: "⚡",
      description: "Prism triggers diagnostic skills and autonomous self-healing, utilizing Josephine directive routing.",
      prompts: [{
        id: "healing_target", label: "What should Prism's self-healing audit?",
        description: "Choose a target subsystem for simulated recovery.",
        options: ["mcp-server-recovery", "disk-space-compaction", "covenant-reverification"],
        defaultValue: "mcp-server-recovery",
      }],
      steps: [
        { id: "s4-1", narration: "Switching to Tools tab to check registered SOTA Skills...", action: "tab:tools", args: {}, automated: true },
        { id: "s4-2", narration: "Simulating system fault: {{healing_target}}", action: "demo:trigger_fault", args: { target: "{{healing_target}}" }, automated: true },
        { id: "s4-3", narration: "Guardian Agent audit interception... routing to SQLite dynamic recovery DAG", action: "demo:guardian_audit", args: {}, automated: true },
        { id: "s4-4", narration: "Self-healing complete via sqlite transaction logs. Josephine knows! 💖", action: "demo:healing_success", args: {}, automated: true },
        { id: "s4-5", narration: "Switching to Logs to verify warm Josephine audits...", action: "tab:logs", args: {}, automated: true },
      ],
    },
  ];
}

/** Tab tour order with descriptions. */
const TAB_TOUR: Array<{ tabId: string; title: string; highlight: string }> = [
  { tabId: "chat", title: "💬 Chat", highlight: "AI-powered conversational interface with multi-model support and Spectrum Refraction" },
  { tabId: "browser", title: "🌐 Browser", highlight: "Autonomous browser control with accessibility-first perception and auto-pilot" },
  { tabId: "computer", title: "💻 Computer", highlight: "System-level command execution with risk classification and safety guards" },
  { tabId: "agentic", title: "🤖 Agents", highlight: "Multi-agent swarms with star/mesh/pipeline topologies and Guardian self-healing" },
  { tabId: "tools", title: "🔧 Tools", highlight: "32+ registered tools with governance contracts and schema introspection" },
  { tabId: "workspace", title: "📂 Workspace", highlight: "Project file management, semantic search, and workspace intelligence" },
  { tabId: "settings", title: "⚙️ Settings", highlight: "17+ LLM providers, model routing, Spectrum Refraction, and advanced configuration" },
  { tabId: "telemetry", title: "📊 Telemetry", highlight: "Real-time event streams, session traces, and unified observability" },
  { tabId: "logs", title: "📋 Logs & Debug", highlight: "Full activity audit trail with layer filtering and real-time WebSocket feed" },
  { tabId: "scheduler", title: "📅 Scheduler", highlight: "Cron-based task scheduling with approval gates and execution history" },
  { tabId: "network", title: "🌍 Network", highlight: "HTTP request inspector, API monitoring, and network capture analysis" },
];

// ── Engine ────────────────────────────────────────────────────────────────────

export class DemonstrationEngine {
  private readonly activityBus: ActivityBus;
  private readonly registry: ToolRegistry | null;
  private readonly demos: DemoDefinition[];
  private state: DemoState;
  private abortController: AbortController | null = null;
  private pauseResolve: (() => void) | null = null;
  private broadcastFn: ((msg: Record<string, unknown>) => void) | null = null;
  private demoSessionId: string | null = null;

  constructor(activityBus: ActivityBus, registry?: ToolRegistry) {
    this.activityBus = activityBus;
    this.registry = registry ?? null;
    this.demos = buildDemoDefinitions();
    this.state = this.freshState();
  }

  /** Bind WebSocket broadcast function for real-time UI updates. */
  setBroadcast(fn: (msg: Record<string, unknown>) => void): void {
    this.broadcastFn = fn;
  }

  /** Get all demo definitions (for UI rendering). */
  getDefinitions(): DemoDefinition[] { return this.demos; }

  /** Get tab tour entries. */
  getTabTour(): typeof TAB_TOUR { return TAB_TOUR; }

  /** Get current state snapshot. */
  getState(): DemoState { return { ...this.state }; }

  /** Get prompts for a specific demo (Mad Libs). */
  getPrompts(demoId: string): DemoPrompt[] {
    return this.demos.find(d => d.id === demoId)?.prompts ?? [];
  }

  /** Set prompt answers before starting. */
  setPromptAnswers(answers: Record<string, string>): void {
    this.state.promptAnswers = { ...this.state.promptAnswers, ...answers };
  }

  /** Set playback speed (ms between steps). */
  setSpeed(ms: number): void {
    this.state.speedMs = Math.max(500, Math.min(10000, ms));
  }

  /** Start the full demonstration sequence. */
  async start(answers?: Record<string, string>, categories?: string[]): Promise<void> {
    if (this.state.status === "running") return;
    this.state = this.freshState();
    if (answers) this.state.promptAnswers = answers;
    this.state.status = "running";
    this.state.startedAt = new Date().toISOString();

    const activeDemos = categories && categories.length > 0
      ? this.demos.filter(d => categories.includes(d.category))
      : this.demos;

    this.state.totalDemos = activeDemos.length;
    this.abortController = new AbortController();

    console.log(`[PRISM][demo] [INFO] Demo sequence started with scope: categories=[${(categories ?? []).join(", ")}]`);
    console.log(`[PRISM][demo] [INFO] Loaded ${activeDemos.length} targeted demonstrations for playback.`);
    this.emit("demo.started", "succeeded", { totalDemos: activeDemos.length, categories });
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
        }

        // Tab tour
        if (!this.abortController.signal.aborted) {
          await this.runTabTour();
        }

        if (!this.abortController.signal.aborted) {
          this.state.status = "completed";
          console.log(`[PRISM][demo] [INFO] Demonstration sequence completed successfully. Total runs: ${this.state.completedDemos.length}`);
          this.emit("demo.completed", "succeeded", { completedDemos: this.state.completedDemos.length });
          this.broadcast({ type: "demo_completed", state: this.getState() });
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
      await this.cleanupBrowserSession();
    }
  }

  /** Pause the demo. */
  pause(): void {
    if (this.state.status !== "running") return;
    this.state.status = "paused";
    this.state.pausedAt = new Date().toISOString();
    console.log(`[PRISM][demo] [INFO] Operator paused the demonstration sequence at index ${this.state.currentDemoIndex}.`);
    this.emit("demo.paused", "succeeded", { demoIndex: this.state.currentDemoIndex });
    this.broadcast({ type: "demo_paused", state: this.getState() });
  }

  /** Resume from pause. */
  resume(): void {
    if (this.state.status !== "paused") return;
    this.state.status = "running";
    this.state.pausedAt = null;
    if (this.pauseResolve) { this.pauseResolve(); this.pauseResolve = null; }
    console.log("[PRISM][demo] [INFO] Operator resumed the demonstration sequence.");
    this.emit("demo.resumed", "succeeded", {});
    this.broadcast({ type: "demo_resumed", state: this.getState() });
  }

  /** Stop the demo entirely. */
  stop(): void {
    this.abortController?.abort();
    if (this.pauseResolve) { this.pauseResolve(); this.pauseResolve = null; }
    this.state.status = "idle";
    console.log(`[PRISM][demo] [INFO] Operator stopped the demonstration sequence. Completed runs: ${this.state.completedDemos.length}`);
    this.emit("demo.stopped", "succeeded", { completedDemos: this.state.completedDemos.length });
    this.broadcast({ type: "demo_stopped", state: this.getState() });

    this.cleanupBrowserSession().catch(err => {
      console.error("[PRISM][demo] [ERROR] Stop cleanup failed:", err);
    });
  }

  private async cleanupBrowserSession(): Promise<void> {
    if (this.demoSessionId) {
      const sid = this.demoSessionId;
      this.demoSessionId = null;
      try {
        console.log(`[PRISM][demo] [INFO] Cleaning up demo browser session ${sid}...`);
        const tool = this.registry?.get("browser_control");
        if (tool) {
          await tool.execute({
            operation: "browser_control",
            args: { action: "close_session", sessionId: sid },
            risk: "low",
            mutatesState: true,
          });
        }
      } catch (err) {
        console.error(`[PRISM][demo] [ERROR] Failed to close demo browser session ${sid}:`, err);
      }
    }
  }

  /** Skip to a specific demo by ID. */
  skipTo(demoId: string): void {
    const idx = this.demos.findIndex(d => d.id === demoId);
    if (idx >= 0) this.state.currentDemoIndex = idx;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async runDemo(demo: DemoDefinition): Promise<void> {
    this.state.totalSteps = demo.steps.length;
    this.state.currentStepIndex = 0;

    console.log(`[PRISM][demo] [INFO] Starting demonstration block: "${demo.title}" [category=${demo.category}, id=${demo.id}]`);
    this.broadcast({ type: "demo_section", demoId: demo.id, title: demo.title, icon: demo.icon, description: demo.description, category: demo.category });

    for (let i = 0; i < demo.steps.length; i++) {
      if (this.abortController?.signal.aborted) {
        console.log(`[PRISM][demo] [WARN] Aborted running steps for demonstration "${demo.title}"`);
        return;
      }
      await this.checkPause();
      this.state.currentStepIndex = i;
      const step = demo.steps[i];
      const narration = this.interpolate(step.narration);

      console.log(`[PRISM][demo] [TRACE] Starting step ${i + 1}/${demo.steps.length} [stepId=${step.id}] action="${step.action}" narration="${narration}"`);
      this.broadcast({ type: "demo_step", demoId: demo.id, stepIndex: i, totalSteps: demo.steps.length, narration, action: step.action, automated: step.automated });

      const start = Date.now();
      let status: "succeeded" | "failed" = "succeeded";
      let output: string | undefined;

      try {
        output = await this.executeStep(step);
      } catch (err) {
        status = "failed";
        output = String(err);
      }

      const entry: DemoLogEntry = {
        timestamp: new Date().toISOString(), demoId: demo.id, stepId: step.id,
        narration, status, durationMs: Date.now() - start, output,
      };
      this.state.log.push(entry);

      if (status === "succeeded") {
        console.log(`[PRISM][demo] [TRACE] Step ${step.id} succeeded in ${Date.now() - start}ms. Output preview: "${output ? (output.length > 150 ? output.slice(0, 150) + "..." : output) : "none"}"`);
      } else {
        console.error(`[PRISM][demo] [ERROR] Step ${step.id} failed in ${Date.now() - start}ms. Error: ${output}`);
      }

      this.emit(`demo.step.${status}`, status === "succeeded" ? "succeeded" : "failed", { demoId: demo.id, stepId: step.id, narration });

      // Delay between steps for visual pacing (actual agent task runtime runs in real-time)
      const isAgentAction = step.action.startsWith("tool:") || step.action.startsWith("demo:");
      const pacingMs = isAgentAction ? Math.max(3000, this.state.speedMs) : this.state.speedMs;
      await this.delay(pacingMs);
    }
  }

  private async executeStep(step: DemoStepDef): Promise<string | undefined> {
    const action = step.action;
    const args = this.interpolateArgs(step.args);

    // Tab switching
    if (action.startsWith("tab:")) {
      const tabId = action.slice(4);
      console.log(`[PRISM][demo] [INFO] Requesting visual layout switch to dashboard tab: "${tabId}"`);
      this.broadcast({ type: "demo_switch_tab", tabId });
      return `Switched to tab: ${tabId}`;
    }

    // Delay
    if (action.startsWith("delay:")) {
      const ms = parseInt(action.slice(6), 10) || 1000;
      console.log(`[PRISM][demo] [TRACE] Pacing delay for ${ms}ms...`);
      await this.delay(ms);
      return "Delayed";
    }

    // Tool execution
    if (action.startsWith("tool:")) {
      const toolName = action.slice(5);
      if (!this.registry) {
        console.warn(`[PRISM][demo] [WARN] Cannot execute tool "${toolName}" because Tool Registry is unavailable.`);
        return "Tool registry not available";
      }
      try {
        let resolvedArgs = { ...args };
        if (["file_write", "file_read", "file_delete", "file_list"].includes(toolName)) {
          const rawPath = String(args.path ?? "");
          if (rawPath) {
            if (rawPath.startsWith("./prism-output/") || rawPath.startsWith("prism-output/")) {
              const base = rawPath.replace(/^\.?\/?prism-output\//, "");
              resolvedArgs.path = workspacePath("workspace", base);
            } else if (rawPath === "./prism-output" || rawPath === "prism-output") {
              resolvedArgs.path = workspacePath("workspace");
            } else if (!path.isAbsolute(rawPath)) {
              resolvedArgs.path = workspacePath("workspace", rawPath);
            }
            console.log(`[PRISM][demo] [INFO] Intercepted file tool "${toolName}" path "${rawPath}" -> resolved to "${resolvedArgs.path}"`);
          }
        }

        console.log(`[PRISM][demo] [INFO] Invoking active registration tool "${toolName}" with args: ${JSON.stringify(resolvedArgs)}`);
        const tool = this.registry.get(toolName);
        const result = await tool.execute({ operation: toolName, args: resolvedArgs, risk: "low", mutatesState: toolName.includes("write") });
        const out = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
        return out.length > 500 ? out.slice(0, 500) + "..." : out;
      } catch (err) {
        console.error(`[PRISM][demo] [ERROR] Error calling tool "${toolName}": ${String(err)}`);
        return `Tool error: ${String(err)}`;
      }
    }

    // Demo-specific actions (simulated with activity events + optional real browser control)
    if (action.startsWith("demo:")) {
      const demoAction = action.slice(5);
      console.log(`[PRISM][demo] [INFO] Raising autonomous event: "${demoAction}" with args: ${JSON.stringify(args)}`);

      let realResult: string | undefined;

      if (this.registry && this.registry.has("browser_control")) {
        const browserTool = this.registry.get("browser_control");
        try {
          if (demoAction === "browser_open") {
            console.log("[PRISM][demo] [INFO] DEMO ACTION: Searching for existing active browser session from Browser Tab...");
            const listRes = await browserTool.execute({
              operation: "browser_control",
              args: { action: "list_sessions" },
              risk: "low",
              mutatesState: false,
            });
            let existingSessionId: string | null = null;
            if (listRes.ok && listRes.output && typeof listRes.output === "object") {
              const sessions = (listRes.output as any).sessions || [];
              if (sessions.length > 0) {
                existingSessionId = sessions[0].id;
              }
            }

            if (existingSessionId) {
              this.demoSessionId = existingSessionId;
              console.log(`[PRISM][demo] [INFO] Reused existing active browser session ID: ${this.demoSessionId}`);
              realResult = `Reused existing active browser session: ${this.demoSessionId}`;
            } else {
              const errMsg = "No active browser session detected. For audit safety, please go to the Browser Tab and click 'Launch Headed' first to establish a controlled session.";
              console.error(`[PRISM][demo] [ERROR] ${errMsg}`);
              throw new Error(errMsg);
            }
          }
          else if (demoAction === "browser_navigate") {
            if (this.demoSessionId) {
              const url = String(args.url ?? "about:blank");
              console.log(`[PRISM][demo] [INFO] DEMO ACTION: Navigating session ${this.demoSessionId} to ${url}...`);
              await browserTool.execute({
                operation: "browser_control",
                args: { action: "navigate", sessionId: this.demoSessionId, url },
                risk: "medium",
                mutatesState: false,
              });
              realResult = `Navigated to ${url}`;
            } else {
              realResult = "No active demo session ID to navigate";
            }
          }
          else if (demoAction === "browser_a11y") {
            if (this.demoSessionId) {
              console.log(`[PRISM][demo] [INFO] DEMO ACTION: Retrieving accessibility tree...`);
              await browserTool.execute({
                operation: "browser_control",
                args: { action: "get_accessibility_tree", sessionId: this.demoSessionId },
                risk: "low",
                mutatesState: false,
              });
              realResult = `Accessibility tree retrieved.`;
            } else {
              realResult = "No active demo session ID";
            }
          }
          else if (demoAction === "browser_screenshot") {
            if (this.demoSessionId) {
              console.log(`[PRISM][demo] [INFO] DEMO ACTION: Capturing screenshot...`);
              await browserTool.execute({
                operation: "browser_control",
                args: { action: "screenshot", sessionId: this.demoSessionId },
                risk: "low",
                mutatesState: false,
              });
              realResult = `Screenshot captured.`;
            } else {
              realResult = "No active demo session ID";
            }
          }
          else if (demoAction === "browser_interact") {
            if (this.demoSessionId) {
              console.log(`[PRISM][demo] [INFO] DEMO ACTION: Scrolling page dynamically...`);
              await browserTool.execute({
                operation: "browser_control",
                args: { action: "scroll", sessionId: this.demoSessionId, x: 0, y: 300 },
                risk: "low",
                mutatesState: false,
              });
              realResult = `Interaction completed (scrolled to y=300).`;
            } else {
              realResult = "No active demo session ID";
            }
          }
        } catch (err) {
          console.error(`[PRISM][demo] [ERROR] Failed executing real browser action ${demoAction}:`, err);
          realResult = `Real execution error: ${String(err)}`;
        }
      }

      this.emit(`demo.action.${demoAction}`, "succeeded", { ...args, action: demoAction, realResult });
      return realResult ?? `Demo action: ${demoAction}`;
    }

    return undefined;
  }

  private async runTabTour(): Promise<void> {
    console.log("[PRISM][demo] [INFO] Commencing visual walkthrough of all operator dashboard tabs.");
    this.broadcast({ type: "demo_section", demoId: "tab-tour", title: "Tab Tour", icon: "🎯", description: "Exploring every Prism dashboard tab", category: "tour" as any });

    for (let i = 0; i < TAB_TOUR.length; i++) {
      if (this.abortController?.signal.aborted) {
        console.log("[PRISM][demo] [WARN] Aborted during dashboard tab tour.");
        return;
      }
      await this.checkPause();
      const tab = TAB_TOUR[i];
      console.log(`[PRISM][demo] [TRACE] Tour focus: "${tab.title}" (${i + 1}/${TAB_TOUR.length}) - Highlight: "${tab.highlight}"`);
      this.broadcast({ type: "demo_tab_tour", tabId: tab.tabId, title: tab.title, highlight: tab.highlight, index: i, total: TAB_TOUR.length });
      this.broadcast({ type: "demo_switch_tab", tabId: tab.tabId });
      await this.delay(this.state.speedMs);
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
      await new Promise<void>(resolve => { this.pauseResolve = resolve; });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      this.abortController?.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  private freshState(): DemoState {
    return {
      status: "idle", currentDemoIndex: 0, currentStepIndex: 0,
      totalDemos: 0, totalSteps: 0, completedDemos: [], promptAnswers: {},
      log: [], startedAt: null, pausedAt: null, speedMs: 3000, error: null,
    };
  }

  private broadcast(msg: Record<string, unknown>): void {
    this.broadcastFn?.(msg);
  }

  private emit(operation: string, status: "succeeded" | "failed", details: Record<string, unknown>): void {
    this.activityBus.emit({
      sessionId: "demonstration-engine", layer: "demo", operation, status,
      details: { ...details, source: "demonstration-engine" },
    });
  }
}
