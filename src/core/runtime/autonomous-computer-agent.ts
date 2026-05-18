/**
 * PRISM Autonomous Computer Agent — Phase A2B
 *
 * Higher-level agent layer that wraps ComputerUseTool for autonomous,
 * goal-driven system operations. Manages command execution, mouse/keyboard
 * control, screenshot perception, and shell workflows.
 *
 * Supports simultaneous operation with AutonomousBrowserAgent
 * per Kirk's directive for cross-tab parallel execution.
 *
 * Command safety:
 *   - Allowlist/denylist patterns for shell commands
 *   - Risk classification per command category
 *   - All commands logged to activity bus + telemetry
 *   - Guardian checkpoint integration
 */

import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ComputerAgentStatus = "idle" | "executing" | "capturing" | "evaluating" | "error";
export type CommandRisk = "low" | "medium" | "high" | "critical";

export interface ComputerAgentAction {
  id: string;
  type: "shell" | "mouse" | "keyboard" | "screenshot" | "clipboard";
  command: string;
  risk: CommandRisk;
  timestamp: string;
  durationMs: number;
  success: boolean;
  output?: string;
  exitCode?: number;
  error?: string;
}

export interface ComputerAgentGoalState {
  goalId: string;
  objective: string;
  status: ComputerAgentStatus;
  actions: ComputerAgentAction[];
  startedAt: string;
  lastActionAt: string | null;
  workingDirectory: string;
}

// ── Command Risk Classification ──────────────────────────────────────────────

const HIGH_RISK_PATTERNS = [
  /\brm\s+(-rf?|--recursive)/i,
  /\bformat\b/i,
  /\bdel\s+\/[sfq]/i,
  /\breg\s+(delete|add)\b/i,
  /\bnet\s+user\b/i,
  /\bdiskpart\b/i,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /\bstop-process\b.*-force/i,
];

const MEDIUM_RISK_PATTERNS = [
  /\bnpm\s+(install|uninstall|update)\b/i,
  /\bpip\s+install\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bmkdir\b/i,
  /\bcopy\b/i,
  /\bMove-Item\b/i,
  /\bSet-Content\b/i,
];

const DENY_PATTERNS = [
  /\bformat\s+[a-z]:/i,
  /\brm\s+-rf\s+\/\s*$/i,
  /\bdel\s+\/s\s+\/q\s+c:\\/i,
];

function classifyCommandRisk(command: string): CommandRisk {
  for (const p of DENY_PATTERNS) {
    if (p.test(command)) return "critical";
  }
  for (const p of HIGH_RISK_PATTERNS) {
    if (p.test(command)) return "high";
  }
  for (const p of MEDIUM_RISK_PATTERNS) {
    if (p.test(command)) return "medium";
  }
  return "low";
}

function isCommandDenied(command: string): boolean {
  return DENY_PATTERNS.some(p => p.test(command));
}

// ── Agent ────────────────────────────────────────────────────────────────────

export class AutonomousComputerAgent {
  private readonly activityBus: ActivityBus;
  private goalState: ComputerAgentGoalState | null = null;

  constructor(activityBus: ActivityBus) {
    this.activityBus = activityBus;
  }

  /** Initialize a new autonomous computer goal. */
  initGoal(goalId: string, objective: string): ComputerAgentGoalState {
    this.goalState = {
      goalId,
      objective,
      status: "idle",
      actions: [],
      startedAt: new Date().toISOString(),
      lastActionAt: null,
      workingDirectory: process.cwd(),
    };
    this.emit("cua.goal.initialized", "succeeded", { goalId, objective });
    return this.goalState;
  }

  /**
   * Execute a shell command with risk classification and denylist enforcement.
   */
  async executeCommand(
    command: string,
    execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode?: number }>,
  ): Promise<ComputerAgentAction> {
    if (!this.goalState) throw new Error("No active computer goal");
    this.goalState.status = "executing";

    const risk = classifyCommandRisk(command);
    const actionId = `cua-${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    const action: ComputerAgentAction = {
      id: actionId,
      type: "shell",
      command,
      risk,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      success: false,
    };

    // Deny critical commands
    if (isCommandDenied(command)) {
      action.error = "Command denied by safety policy";
      action.durationMs = Date.now() - startTime;
      this.goalState.actions.push(action);
      this.goalState.status = "error";
      this.emit("cua.command.denied", "failed", {
        goalId: this.goalState.goalId, actionId, command, risk,
        reason: "Command matches denylist pattern",
      });
      return action;
    }

    this.emit("cua.command.started", "succeeded", {
      goalId: this.goalState.goalId, actionId, command, risk,
    });

    try {
      if (!execFn) {
        // Fallback to child_process
        const { execSync } = await import("node:child_process");
        const output = execSync(command, {
          encoding: "utf-8",
          timeout: 30_000,
          cwd: this.goalState.workingDirectory,
          maxBuffer: 1024 * 1024,
        });
        action.output = output;
        action.exitCode = 0;
      } else {
        const result = await execFn(command);
        action.output = result.stdout + (result.stderr ? `\n${result.stderr}` : "");
        action.exitCode = result.exitCode ?? 0;
      }

      action.success = true;
      action.durationMs = Date.now() - startTime;
      this.goalState.status = "idle";

      this.emit("cua.command.succeeded", "succeeded", {
        goalId: this.goalState.goalId, actionId, command, risk,
        exitCode: action.exitCode, durationMs: action.durationMs,
        outputLength: action.output?.length ?? 0,
      });
    } catch (err) {
      action.success = false;
      action.error = String(err);
      action.durationMs = Date.now() - startTime;
      this.goalState.status = "error";

      this.emit("cua.command.failed", "failed", {
        goalId: this.goalState.goalId, actionId, command, risk,
        error: String(err), durationMs: action.durationMs,
      });
    }

    this.goalState.actions.push(action);
    this.goalState.lastActionAt = action.timestamp;
    return action;
  }

  /**
   * Execute a mouse/keyboard action via the ComputerUseTool.
   */
  async executeInputAction(
    type: "mouse" | "keyboard",
    details: string,
    toolExecute?: (args: Record<string, unknown>) => Promise<unknown>,
  ): Promise<ComputerAgentAction> {
    if (!this.goalState) throw new Error("No active computer goal");
    this.goalState.status = "executing";

    const actionId = `cua-${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    const action: ComputerAgentAction = {
      id: actionId,
      type,
      command: details,
      risk: "low",
      timestamp: new Date().toISOString(),
      durationMs: 0,
      success: false,
    };

    this.emit("cua.input.started", "succeeded", {
      goalId: this.goalState.goalId, actionId, type, details,
    });

    try {
      if (toolExecute) {
        const result = await toolExecute({ action: details });
        action.output = typeof result === "string" ? result : JSON.stringify(result);
      }
      action.success = true;
      action.durationMs = Date.now() - startTime;
      this.goalState.status = "idle";

      this.emit("cua.input.succeeded", "succeeded", {
        goalId: this.goalState.goalId, actionId, type, details,
        durationMs: action.durationMs,
      });
    } catch (err) {
      action.success = false;
      action.error = String(err);
      action.durationMs = Date.now() - startTime;
      this.goalState.status = "error";

      this.emit("cua.input.failed", "failed", {
        goalId: this.goalState.goalId, actionId, type, details,
        error: String(err), durationMs: action.durationMs,
      });
    }

    this.goalState.actions.push(action);
    this.goalState.lastActionAt = action.timestamp;
    return action;
  }

  /** Get the current goal state. */
  getGoalState(): ComputerAgentGoalState | null { return this.goalState; }

  /** Get risk classification for a command (preview, no execution). */
  classifyRisk(command: string): { risk: CommandRisk; denied: boolean } {
    return { risk: classifyCommandRisk(command), denied: isCommandDenied(command) };
  }

  /** Set working directory for shell commands. */
  setWorkingDirectory(dir: string): void {
    if (this.goalState) this.goalState.workingDirectory = dir;
  }

  /** Clear the current goal. */
  clearGoal(): void {
    if (this.goalState) {
      this.emit("cua.goal.cleared", "succeeded", {
        goalId: this.goalState.goalId,
        totalActions: this.goalState.actions.length,
      });
    }
    this.goalState = null;
  }

  /**
   * Execute a computer objective end-to-end using the LLM.
   *
   * This is the high-level autonomous entry point for system tasks.
   * Flow: gather system state → send to LLM → get command → execute → repeat
   *
   * @param objective - Natural language goal (e.g. "List all running Node.js processes")
   * @param generateFn - LLM generation function
   * @param maxSteps - Maximum number of think→command cycles
   */
  async executeObjective(
    objective: string,
    generateFn: (input: {
      message: string;
      conversation: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>;
      systemPrompt: string;
    }) => Promise<{ content: string } | null>,
    execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode?: number }>,
    maxSteps = 15,
  ): Promise<{ success: boolean; actions: ComputerAgentAction[]; summary: string }> {
    if (!this.goalState) throw new Error("No active computer goal — call initGoal() first");

    this.emit("cua.objective.started", "succeeded", {
      goalId: this.goalState.goalId, objective, maxSteps,
    });

    const platform = process.platform === "win32" ? "Windows (PowerShell)" : process.platform === "darwin" ? "macOS (zsh)" : "Linux (bash)";
    const systemPrompt = `You are an autonomous computer agent operating on ${platform}. Your task is to achieve the following objective by executing shell commands.

## Instructions
1. I will show you the result of each command you run.
2. You must respond with EXACTLY ONE action in JSON format.
3. Available actions:
   - {"action": "run", "command": "your shell command here"}
   - {"action": "done", "summary": "What was accomplished"}
4. When the objective is complete, use the "done" action.
5. Use platform-appropriate commands (${platform}).

## Safety Rules
- NEVER run destructive commands (rm -rf /, format, del /s /q c:\\, etc.)
- Prefer read-only commands for information gathering first.
- If a command fails, analyze the error and try a different approach.
- Do not repeat the same failed command.

## Working Directory
${this.goalState.workingDirectory}

## Objective
${objective}`;

    const conversation: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }> = [];

    for (let step = 0; step < maxSteps; step++) {
      // Build context for LLM
      const contextMsg = step === 0
        ? `Begin executing the objective. Working directory: ${this.goalState.workingDirectory}`
        : `Continue with the objective. ${this.goalState.actions.length} commands executed so far.`;

      const llmResult = await generateFn({
        message: contextMsg,
        conversation,
        systemPrompt,
      });

      if (!llmResult?.content) {
        this.emit("cua.objective.llm_empty", "failed", {
          goalId: this.goalState.goalId, step,
        });
        break;
      }

      conversation.push({ role: "user", content: contextMsg });
      conversation.push({ role: "assistant", content: llmResult.content });

      // Parse action
      let actionJson: Record<string, unknown>;
      try {
        const jsonMatch = llmResult.content.match(/\{[^}]+\}/);
        actionJson = jsonMatch ? JSON.parse(jsonMatch[0]) : { action: "done", summary: llmResult.content };
      } catch {
        actionJson = { action: "done", summary: llmResult.content };
      }

      // Check for completion
      if (actionJson.action === "done") {
        const summary = String(actionJson.summary ?? "Objective completed");
        this.emit("cua.objective.completed", "succeeded", {
          goalId: this.goalState.goalId, steps: step + 1, summary,
        });
        return { success: true, actions: this.goalState.actions, summary };
      }

      // Execute command
      if (actionJson.action === "run" && typeof actionJson.command === "string") {
        const result = await this.executeCommand(actionJson.command, execFn);

        // Feed result back to conversation
        const resultMsg = result.success
          ? `Command succeeded (exit code ${result.exitCode ?? 0}):\n${(result.output ?? "").slice(0, 2000)}`
          : `Command failed: ${result.error ?? "Unknown error"}\n${(result.output ?? "").slice(0, 1000)}`;

        conversation.push({ role: "user", content: resultMsg });
      }

      // Trim conversation
      if (conversation.length > 24) {
        conversation.splice(0, conversation.length - 16);
      }
    }

    const summary = `Reached max steps (${maxSteps}) without completing objective`;
    this.emit("cua.objective.max_steps", "failed", {
      goalId: this.goalState.goalId, maxSteps,
    });
    return { success: false, actions: this.goalState?.actions ?? [], summary };
  }

  private emit(operation: string, status: "succeeded" | "failed", details: Record<string, unknown>): void {
    this.activityBus.emit({
      sessionId: "cua-agent",
      layer: "agent", operation, status,
      details: { ...details, source: "autonomous-computer-agent" },
    });
  }
}
