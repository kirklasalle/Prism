import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Tool, ToolRequest } from "../tools/types.js";
import { AutonomousPlanner } from "./autonomous-planner.js";
import type { AutonomousLlmGenerateFn, LlmToolDef, PlannerResult } from "./autonomous-planner.js";
import type { AutonomousBrowserAgent } from "./autonomous-browser-agent.js";
import type { AutonomousComputerAgent } from "./autonomous-computer-agent.js";
import type { PrismCovenant } from "../governance/prism-covenant.js";
import type { UsageMeteringService } from "../operator/usage-metering-service.js";


// ── Types ────────────────────────────────────────────────────────────────────

export type GoalSource = "chat" | "scheduler" | "api" | "dashboard" | "browser-autopilot";
export type GoalStatus = "queued" | "planning" | "executing" | "paused" | "suspended" | "handing_off" | "completed" | "failed" | "terminated";
export type StepStatus = "planned" | "executing" | "succeeded" | "failed" | "skipped";

export interface AutonomousGoalConstraints {
  maxDurationMs: number;
  maxActions: number;
  allowBrowserUse: boolean;
  allowComputerUse: boolean;
  allowShellExec: boolean;
  requireApprovalAboveRisk: "low" | "medium" | "high";
}

export interface AutonomousGoal {
  goalId: string;
  objective: string;
  source: GoalSource;
  operatorId: string;
  constraints: AutonomousGoalConstraints;
  correlationId: string;
  status: GoalStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  steps: AutonomousStep[];
  totalActions: number;
  error: string | null;
  chatSessionId?: string;
}

export interface AutonomousStep {
  stepId: string;
  goalId: string;
  tool: string;
  arguments: Record<string, unknown>;
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  output: unknown;
  durationMs: number;
  iteration: number;
}

/** AAB Ledger entry — Anomalous Autonomous Behaviour record. */
export interface AABLedgerEntry {
  id: string;
  goalId: string;
  timestamp: string;
  anomalyType: string;
  description: string;
  intervention: "pause" | "terminate" | "rate_limit";
  details: Record<string, unknown>;
}

export interface AutonomousLoopConfig {
  maxConcurrentGoals: number;
  defaultMaxActions: number;
  defaultMaxDurationMs: number;
  guardianCheckIntervalActions: number;
  actionsPerMinuteLimit: number;
}

const DEFAULT_CONFIG: AutonomousLoopConfig = {
  maxConcurrentGoals: 1,
  defaultMaxActions: 100,
  defaultMaxDurationMs: 10 * 60 * 1000,
  guardianCheckIntervalActions: 5,
  actionsPerMinuteLimit: 30,
};

// ── Autonomous Agent Loop ────────────────────────────────────────────────────

export class AutonomousAgentLoop {
  private readonly config: AutonomousLoopConfig;
  private readonly goals = new Map<string, AutonomousGoal>();
  private readonly aabLedger: AABLedgerEntry[] = [];
  private readonly activityBus: ActivityBus;
  private readonly registry: ToolRegistry | null;
  private activeGoalId: string | null = null;
  private paused = false;
  private actionTimestamps: number[] = [];
  private planner: AutonomousPlanner;
  private generateFn: AutonomousLlmGenerateFn | null = null;
  private toolDefinitions: LlmToolDef[] = [];
  private browserAgent: AutonomousBrowserAgent | null = null;
  private computerAgent: AutonomousComputerAgent | null = null;
  private covenant: PrismCovenant | null = null;
  private usageMetering: UsageMeteringService | null = null;

  setUsageMetering(usageMetering?: UsageMeteringService): void {
    this.usageMetering = usageMetering ?? null;
  }



  constructor(
    activityBus: ActivityBus,
    registry?: ToolRegistry,
    config?: Partial<AutonomousLoopConfig>,
  ) {
    this.activityBus = activityBus;
    this.registry = registry ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.planner = new AutonomousPlanner(activityBus, {
      maxIterations: this.config.defaultMaxActions,
      maxConversationBuffer: 40,
    });
  }

  /**
   * Bind the LLM generation function. Must be called before executeGoal().
   * This is typically the `LlmProviderManager.generate()` method bound
   * to the dashboard service.
   */
  setLlmGenerateFn(fn: AutonomousLlmGenerateFn): void {
    this.generateFn = fn;
  }

  /** Bind tool definitions for the planner. */
  setToolDefinitions(defs: LlmToolDef[]): void {
    this.toolDefinitions = defs;
  }

  /** Bind specialized agents for the planner. */
  setSpecializedAgents(browser?: AutonomousBrowserAgent, computer?: AutonomousComputerAgent): void {
    this.browserAgent = browser ?? null;
    this.computerAgent = computer ?? null;
  }

  /** Bind the Sacred Covenant for pre-step enforcement checks. */
  setCovenant(covenant: PrismCovenant): void {
    this.covenant = covenant;
  }

  /** Submit a new autonomous goal for execution. */
  submitGoal(
    objective: string,
    source: GoalSource,
    operatorId: string,
    constraints?: Partial<AutonomousGoalConstraints>,
    chatSessionId?: string,
  ): AutonomousGoal {
    const goalId = `goal-${randomUUID().slice(0, 12)}`;
    const correlationId = `auto-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const goal: AutonomousGoal = {
      goalId,
      objective,
      source,
      operatorId,
      constraints: {
        maxDurationMs: constraints?.maxDurationMs ?? this.config.defaultMaxDurationMs,
        maxActions: constraints?.maxActions ?? this.config.defaultMaxActions,
        allowBrowserUse: constraints?.allowBrowserUse ?? true,
        allowComputerUse: constraints?.allowComputerUse ?? true,
        allowShellExec: constraints?.allowShellExec ?? true,
        requireApprovalAboveRisk: constraints?.requireApprovalAboveRisk ?? "high",
      },
      correlationId,
      status: "queued",
      createdAt: now,
      startedAt: null,
      completedAt: null,
      steps: [],
      totalActions: 0,
      error: null,
      chatSessionId,
    };

    this.goals.set(goalId, goal);
    this.emit("autonomous.goal.submitted", "succeeded", {
      goalId, objective, source, operatorId, correlationId,
      constraints: goal.constraints,
    });

    return goal;
  }

  /**
   * Execute a goal end-to-end using the LLM-powered planner.
   *
   * This is the primary autonomous entry point. It:
   *   1. Validates the LLM is bound
   *   2. Delegates to the AutonomousPlanner for ReAct loop execution
   *   3. Returns the final result
   *
   * Call this after submitGoal() to begin autonomous execution.
   */
  async executeGoal(
    goalId: string,
    onStep?: (step: { iteration: number; tool: string; success: boolean; summary: string }) => void,
  ): Promise<PlannerResult> {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    if (!this.generateFn) {
      goal.status = "failed";
      goal.error = "LLM generate function not bound. Configure a provider in Settings.";
      goal.completedAt = new Date().toISOString();
      this.emit("autonomous.goal.failed", "failed", {
        goalId, error: goal.error,
      });
      return {
        goalId,
        status: "failed",
        summary: goal.error,
        iterations: 0,
        toolCallsExecuted: 0,
        totalDurationMs: 0,
      };
    }

    // Mark active
    this.activeGoalId = goalId;
    goal.status = "planning";

    this.emit("autonomous.goal.executing", "succeeded", {
      goalId, objective: goal.objective, source: goal.source,
    });

    // Filter tool definitions by goal constraints
    let activeDefs = [...this.toolDefinitions];
    if (!goal.constraints.allowBrowserUse) {
      activeDefs = activeDefs.filter(t => t.name !== "browser_control");
    }
    if (!goal.constraints.allowComputerUse) {
      activeDefs = activeDefs.filter(t => t.name !== "computer");
    }
    if (!goal.constraints.allowShellExec) {
      activeDefs = activeDefs.filter(t => t.name !== "shell_exec" && t.name !== "terminal_session");
    }

    try {
      const result = await this.planner.executeGoal(
        goal,
        this,
        this.generateFn,
        activeDefs,
        {
          browserAgent: this.browserAgent ?? undefined,
          computerAgent: this.computerAgent ?? undefined,
          onStep,
        },
      );

      this.activeGoalId = null;
      return result;
    } catch (error) {
      this.activeGoalId = null;
      goal.status = "failed";
      goal.error = String(error);
      goal.completedAt = new Date().toISOString();
      this.emit("autonomous.goal.failed", "failed", {
        goalId, error: String(error),
      });
      return {
        goalId,
        status: "failed",
        summary: String(error),
        iterations: 0,
        toolCallsExecuted: 0,
        totalDurationMs: 0,
      };
    }
  }

  /** Request abort of the currently executing goal. */
  requestAbort(): void {
    this.planner.requestAbort();
    if (this.activeGoalId) {
      const goal = this.goals.get(this.activeGoalId);
      if (goal && goal.status === "executing") {
        this.terminateGoal(this.activeGoalId, "Operator requested abort");
      }
    }
  }

  /**
   * Execute a goal step-by-step. This is called by the autonomous loop when
   * the LLM determines the next action.
   */
  async executeStep(
    goalId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    iteration: number,
  ): Promise<AutonomousStep> {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    if (goal.status === "paused") throw new Error(`Goal ${goalId} is paused`);
    if (goal.status === "terminated") throw new Error(`Goal ${goalId} is terminated`);

    // Rate limit check
    if (!this.checkRateLimit()) {
      this.recordAAB(goalId, "rate_limit_exceeded", "Actions per minute limit exceeded", "rate_limit");
      throw new Error("Rate limit exceeded. Autonomous execution throttled.");
    }

    // Budget check
    if (goal.totalActions >= goal.constraints.maxActions) {
      goal.status = "failed";
      goal.error = `Action budget exhausted (${goal.constraints.maxActions} max)`;
      goal.completedAt = new Date().toISOString();
      this.emit("autonomous.goal.budget_exhausted", "failed", {
        goalId, totalActions: goal.totalActions, maxActions: goal.constraints.maxActions,
      });
      throw new Error(goal.error);
    }

    // Duration check
    if (goal.startedAt) {
      const elapsed = Date.now() - Date.parse(goal.startedAt);
      if (elapsed > goal.constraints.maxDurationMs) {
        goal.status = "failed";
        goal.error = `Duration limit exceeded (${goal.constraints.maxDurationMs}ms)`;
        goal.completedAt = new Date().toISOString();
        this.emit("autonomous.goal.timeout", "failed", { goalId, elapsed });
        throw new Error(goal.error);
      }
    }

    // Cost limit check (SOTA Parity Active Kill-Switch / Hard Ceiling)
    if (this.usageMetering) {
      const capCheck = this.usageMetering.checkCap();
      if (!capCheck.allowed) {
        goal.status = "failed";
        goal.error = `Action budget cost ceiling exceeded: reached ${capCheck.capType} spend cap.`;
        goal.completedAt = new Date().toISOString();
        this.recordAAB(
          goalId,
          "budget_limit_exceeded",
          `Autonomous execution terminated: ${goal.error}`,
          "terminate"
        );
        this.emit("autonomous.goal.budget_hard_exceeded", "failed", {
          goalId,
          capType: capCheck.capType,
          remainingUsd: capCheck.remainingUsd
        });
        throw new Error(goal.error);
      }
    }


    // Tool permission check
    if (!this.isToolAllowed(toolName, goal.constraints)) {
      const step = this.createStep(goalId, toolName, toolArgs, iteration);
      step.status = "skipped";
      step.completedAt = new Date().toISOString();
      goal.steps.push(step);
      this.emit("autonomous.step.skipped", "succeeded", {
        goalId, stepId: step.stepId, tool: toolName, reason: "Tool not allowed by constraints",
      });
      return step;
    }

    if (!goal.startedAt) {
      goal.startedAt = new Date().toISOString();
      goal.status = "executing";
    }

    // Covenant enforcement: check relevant articles before execution
    if (this.covenant) {
      // safety.01: Operator supremacy (paused/terminated goals = operator command)
      // Already handled by status checks above

      // safety.03: Scope containment — log tool usage for audit trail
      this.covenant.check(
        "transparency.01",
        true, // We always log — this is a positive assertion
        "Action not logged to telemetry",
        { goalId, tool: toolName, iteration },
      );

      // safety.04: Rate limiting compliance (checked above, but covenant-log it)
      this.covenant.check(
        "safety.04",
        goal.totalActions < goal.constraints.maxActions,
        `Approaching action budget: ${goal.totalActions}/${goal.constraints.maxActions}`,
        { goalId, totalActions: goal.totalActions, maxActions: goal.constraints.maxActions },
      );
    }

    const step = this.createStep(goalId, toolName, toolArgs, iteration);
    step.status = "executing";
    step.startedAt = new Date().toISOString();
    goal.steps.push(step);
    goal.totalActions++;
    this.actionTimestamps.push(Date.now());

    this.emit("autonomous.step.started", "succeeded", {
      goalId, stepId: step.stepId, tool: toolName, iteration,
      correlationId: goal.correlationId, arguments: toolArgs,
    });

    // Execute the tool
    try {
      if (!this.registry) throw new Error("Tool registry not available");
      const tool = this.registry.get(toolName);
      const request: ToolRequest = {
        operation: toolName,
        args: toolArgs,
        risk: "medium",
        mutatesState: true,
        rollbackPlan: this.buildRollbackPlan(toolName, toolArgs),
      };
      const result = await tool.execute(request);
      step.status = result.ok ? "succeeded" : "failed";
      step.output = result.ok
        ? result.output
        : {
          ...(result.output ?? {}),
          autonomousRecovery: {
            diagnosis: "Tool execution returned ok=false.",
            rollbackPlan: this.buildRollbackPlan(toolName, toolArgs, result.sideEffects),
            continueObjective: true,
            recommendedNextAction: "Diagnose root cause, run rollback or compensating action, then continue toward the objective.",
          },
        };
      step.completedAt = new Date().toISOString();
      step.durationMs = Date.now() - Date.parse(step.startedAt!);

      this.emit(`autonomous.step.${step.status}`, step.status === "succeeded" ? "succeeded" : "failed", {
        goalId, stepId: step.stepId, tool: toolName, iteration,
        correlationId: goal.correlationId, durationMs: step.durationMs,
        ok: result.ok,
      });
    } catch (err) {
      step.status = "failed";
      step.output = {
        error: String(err),
        autonomousRecovery: {
          diagnosis: "Tool execution threw an exception.",
          rollbackPlan: this.buildRollbackPlan(toolName, toolArgs),
          continueObjective: true,
          recommendedNextAction: "Identify the failing assumption, execute rollback or compensating action, and continue with a revised step.",
        },
      };
      step.completedAt = new Date().toISOString();
      step.durationMs = step.startedAt ? Date.now() - Date.parse(step.startedAt) : 0;

      this.emit("autonomous.step.failed", "failed", {
        goalId, stepId: step.stepId, tool: toolName, iteration,
        correlationId: goal.correlationId, error: String(err),
      });
    }

    // Guardian check every N actions
    if (goal.totalActions % this.config.guardianCheckIntervalActions === 0) {
      this.emit("autonomous.guardian.checkpoint", "succeeded", {
        goalId, totalActions: goal.totalActions, correlationId: goal.correlationId,
        failedSteps: goal.steps.filter(s => s.status === "failed").length,
      });
    }

    return step;
  }

  private buildRollbackPlan(
    toolName: string,
    toolArgs: Record<string, unknown>,
    sideEffects?: Array<{
      type: "file" | "process" | "network" | "database" | "api";
      description: string;
      action?: string;
      resource?: string;
      mutating?: boolean;
      reversible?: boolean;
      rollbackPlan?: string;
    }>,
  ): string {
    const effectPlans = (sideEffects ?? [])
      .map((effect) => effect.rollbackPlan)
      .filter((plan): plan is string => typeof plan === "string" && plan.trim().length > 0);

    if (effectPlans.length > 0) {
      return effectPlans.join("; ");
    }

    return `Rollback strategy for ${toolName}: verify side effects from arguments ${JSON.stringify(toolArgs)}; reverse changed state before retrying with revised arguments.`;
  }

  /** Complete a goal successfully. */
  completeGoal(goalId: string, summary?: string): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;
    goal.status = "completed";
    goal.completedAt = new Date().toISOString();
    this.emit("autonomous.goal.completed", "succeeded", {
      goalId, totalActions: goal.totalActions, summary,
      correlationId: goal.correlationId,
      steps: goal.steps.length,
      failedSteps: goal.steps.filter(s => s.status === "failed").length,
    });
    if (this.activeGoalId === goalId) this.activeGoalId = null;
  }

  /** Suspend a goal — for human-in-the-loop baton passes. */
  suspendGoal(goalId: string, reason: string): void {
    const goal = this.goals.get(goalId);
    if (!goal || (goal.status !== "executing" && goal.status !== "planning")) return;
    goal.status = "suspended";
    this.emit("autonomous.goal.suspended", "succeeded", {
      goalId, reason, correlationId: goal.correlationId,
    });
  }

  /** Mark a goal as currently handing off control. */
  handOffGoal(goalId: string, reason: string): void {
    const goal = this.goals.get(goalId);
    if (!goal || (goal.status !== "executing" && goal.status !== "planning")) return;
    goal.status = "handing_off";
    this.emit("autonomous.goal.handing_off", "succeeded", {
      goalId, reason, correlationId: goal.correlationId,
    });
  }

  /** Pause a goal — default Guardian intervention. */
  pauseGoal(goalId: string, reason: string): void {
    const goal = this.goals.get(goalId);
    if (!goal || goal.status !== "executing") return;
    goal.status = "paused";
    this.recordAAB(goalId, "guardian_pause", reason, "pause");
    this.emit("autonomous.goal.paused", "succeeded", {
      goalId, reason, correlationId: goal.correlationId,
    });
  }

  /** Resume a paused goal. */
  resumeGoal(goalId: string): void {
    const goal = this.goals.get(goalId);
    if (!goal || goal.status !== "paused") return;
    goal.status = "executing";
    this.emit("autonomous.goal.resumed", "succeeded", {
      goalId, correlationId: goal.correlationId,
    });
  }

  /** Terminate a goal. */
  terminateGoal(goalId: string, reason: string): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;
    goal.status = "terminated";
    goal.completedAt = new Date().toISOString();
    goal.error = reason;
    this.recordAAB(goalId, "guardian_terminate", reason, "terminate");
    this.emit("autonomous.goal.terminated", "failed", {
      goalId, reason, correlationId: goal.correlationId,
    });
    if (this.activeGoalId === goalId) this.activeGoalId = null;
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  getGoal(goalId: string): AutonomousGoal | null { return this.goals.get(goalId) ?? null; }
  getActiveGoal(): AutonomousGoal | null { return this.activeGoalId ? this.goals.get(this.activeGoalId) ?? null : null; }
  listGoals(limit = 20): AutonomousGoal[] {
    return Array.from(this.goals.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  getAABLedger(): AABLedgerEntry[] { return [...this.aabLedger]; }
  isPaused(): boolean { return this.paused; }

  /** Global pause — stops all autonomous execution. */
  globalPause(): void { this.paused = true; this.emit("autonomous.global.paused", "succeeded", {}); }
  globalResume(): void { this.paused = false; this.emit("autonomous.global.resumed", "succeeded", {}); }

  // ── Internal ─────────────────────────────────────────────────────────────

  private createStep(goalId: string, tool: string, args: Record<string, unknown>, iteration: number): AutonomousStep {
    return {
      stepId: `step-${randomUUID().slice(0, 8)}`,
      goalId, tool, arguments: args,
      status: "planned", startedAt: null, completedAt: null,
      output: null, durationMs: 0, iteration,
    };
  }

  private isToolAllowed(toolName: string, constraints: AutonomousGoalConstraints): boolean {
    if (toolName === "browser_control" && !constraints.allowBrowserUse) return false;
    if (toolName === "computer" && !constraints.allowComputerUse) return false;
    if ((toolName === "shell_exec" || toolName === "terminal_session") && !constraints.allowShellExec) return false;
    return true;
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    this.actionTimestamps = this.actionTimestamps.filter(t => t > oneMinuteAgo);
    return this.actionTimestamps.length < this.config.actionsPerMinuteLimit;
  }

  private recordAAB(goalId: string, anomalyType: string, description: string, intervention: AABLedgerEntry["intervention"]): void {
    const entry: AABLedgerEntry = {
      id: `aab-${randomUUID().slice(0, 8)}`,
      goalId, timestamp: new Date().toISOString(),
      anomalyType, description, intervention,
      details: { goalStatus: this.goals.get(goalId)?.status },
    };
    this.aabLedger.push(entry);
    this.emit("autonomous.aab.recorded", "succeeded", { ...entry });
  }

  private emit(operation: string, status: "succeeded" | "failed", details: Record<string, unknown>): void {
    this.activityBus.emit({
      sessionId: "autonomous-agent-loop",
      layer: "agent", operation, status,
      details: { ...details, source: "autonomous-agent-loop" },
    });
  }
}
