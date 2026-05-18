/**
 * PRISM Autonomous Browser Agent — Phase A2B
 *
 * Higher-level agent layer that wraps BrowserSessionManager for
 * autonomous, goal-driven browser operations. Manages perception
 * (accessibility tree + screenshot fallback), action planning,
 * and result evaluation for web-based tasks.
 *
 * Supports simultaneous operation with AutonomousComputerAgent
 * per Kirk's directive for cross-tab parallel execution.
 *
 * Uses the configured Provider & Settings LLM for page understanding
 * and action selection. All actions logged to activity bus.
 */

import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type BrowserAgentStatus = "idle" | "navigating" | "perceiving" | "acting" | "evaluating" | "error";

export interface BrowserAgentAction {
  id: string;
  type: "navigate" | "click" | "type" | "screenshot" | "evaluate" | "scroll" | "wait" | "extract";
  target: string;
  value?: string;
  timestamp: string;
  durationMs: number;
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface BrowserAgentPerception {
  url: string;
  title: string;
  accessibilityTree: string | null;
  screenshotPath: string | null;
  interactiveElements: number;
  timestamp: string;
}

export interface BrowserAgentGoalState {
  goalId: string;
  objective: string;
  status: BrowserAgentStatus;
  currentUrl: string;
  actions: BrowserAgentAction[];
  perceptions: BrowserAgentPerception[];
  startedAt: string;
  lastActionAt: string | null;
}

// ── Agent ────────────────────────────────────────────────────────────────────

export class AutonomousBrowserAgent {
  private readonly activityBus: ActivityBus;
  private goalState: BrowserAgentGoalState | null = null;
  private sessionId: string | null = null;

  constructor(activityBus: ActivityBus) {
    this.activityBus = activityBus;
  }

  /** Initialize a new autonomous browser goal. */
  initGoal(goalId: string, objective: string): BrowserAgentGoalState {
    this.goalState = {
      goalId,
      objective,
      status: "idle",
      currentUrl: "about:blank",
      actions: [],
      perceptions: [],
      startedAt: new Date().toISOString(),
      lastActionAt: null,
    };
    this.emit("bua.goal.initialized", "succeeded", { goalId, objective });
    return this.goalState;
  }

  /**
   * Execute a browser action. Called by the autonomous loop when
   * the LLM selects a browser tool invocation.
   */
  async executeAction(
    type: BrowserAgentAction["type"],
    target: string,
    value?: string,
    sessionManager?: { navigate(id: string, url: string): Promise<unknown>; screenshot(id: string): Promise<unknown>; click(id: string, sel: string): Promise<unknown>; type(id: string, sel: string, text: string): Promise<unknown>; evaluate(id: string, expr: string): Promise<unknown> },
  ): Promise<BrowserAgentAction> {
    if (!this.goalState) throw new Error("No active browser goal");
    this.goalState.status = "acting";
    const actionId = `bua-${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    const action: BrowserAgentAction = {
      id: actionId,
      type,
      target,
      value,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      success: false,
    };

    this.emit("bua.action.started", "succeeded", {
      goalId: this.goalState.goalId, actionId, type, target,
    });

    try {
      if (!sessionManager || !this.sessionId) {
        throw new Error("Browser session not available");
      }

      let result: unknown;
      switch (type) {
        case "navigate":
          result = await sessionManager.navigate(this.sessionId, target);
          this.goalState.currentUrl = target;
          break;
        case "click":
          result = await sessionManager.click(this.sessionId, target);
          break;
        case "type":
          result = await sessionManager.type(this.sessionId, target, value ?? "");
          break;
        case "screenshot":
          result = await sessionManager.screenshot(this.sessionId);
          break;
        case "evaluate":
          result = await sessionManager.evaluate(this.sessionId, target);
          break;
        case "scroll":
          result = await sessionManager.evaluate(this.sessionId, `window.scrollBy(0, ${target})`);
          break;
        case "wait":
          await new Promise(resolve => setTimeout(resolve, Number(target) || 1000));
          result = { waited: Number(target) || 1000 };
          break;
        case "extract":
          result = await sessionManager.evaluate(this.sessionId,
            `document.querySelector('${target}')?.textContent?.trim() ?? null`);
          break;
      }

      action.success = true;
      action.output = result;
      action.durationMs = Date.now() - startTime;
      this.goalState.status = "idle";

      this.emit("bua.action.succeeded", "succeeded", {
        goalId: this.goalState.goalId, actionId, type, target,
        durationMs: action.durationMs,
      });
    } catch (err) {
      action.success = false;
      action.error = String(err);
      action.durationMs = Date.now() - startTime;
      this.goalState.status = "error";

      this.emit("bua.action.failed", "failed", {
        goalId: this.goalState.goalId, actionId, type, target,
        error: String(err), durationMs: action.durationMs,
      });
    }

    this.goalState.actions.push(action);
    this.goalState.lastActionAt = action.timestamp;
    return action;
  }

  /**
   * Capture the current page state for perception (accessibility-first).
   * Uses accessibility tree as primary data source to reduce cost/latency.
   * Falls back to screenshot when accessibility data is insufficient.
   */
  async perceive(
    sessionManager?: { evaluate(id: string, expr: string): Promise<unknown>; screenshot(id: string): Promise<unknown> },
  ): Promise<BrowserAgentPerception> {
    if (!this.goalState) throw new Error("No active browser goal");
    this.goalState.status = "perceiving";

    const perception: BrowserAgentPerception = {
      url: this.goalState.currentUrl,
      title: "",
      accessibilityTree: null,
      screenshotPath: null,
      interactiveElements: 0,
      timestamp: new Date().toISOString(),
    };

    try {
      if (sessionManager && this.sessionId) {
        // Accessibility-first perception (cheaper than vision)
        const treeResult = await sessionManager.evaluate(this.sessionId, `
          (function() {
            const els = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [onclick]');
            const items = [];
            els.forEach((el, i) => {
              if (i >= 100) return;
              const text = (el.textContent || '').trim().slice(0, 80);
              const tag = el.tagName.toLowerCase();
              const role = el.getAttribute('role') || tag;
              const name = el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('id') || '';
              items.push({ index: i, role, tag, text, name });
            });
            return JSON.stringify({
              title: document.title,
              url: location.href,
              interactiveCount: els.length,
              elements: items
            });
          })()
        `);

        if (typeof treeResult === "string") {
          try {
            const parsed = JSON.parse(treeResult) as Record<string, unknown>;
            perception.title = String(parsed.title ?? "");
            perception.interactiveElements = Number(parsed.interactiveCount ?? 0);
            perception.accessibilityTree = treeResult;
          } catch { /* use raw */ }
        }
      }
    } catch {
      // Fallback: attempt screenshot
      try {
        if (sessionManager && this.sessionId) {
          const ssResult = await sessionManager.screenshot(this.sessionId);
          if (ssResult && typeof ssResult === "object" && "path" in (ssResult as Record<string, unknown>)) {
            perception.screenshotPath = String((ssResult as Record<string, unknown>).path);
          }
        }
      } catch { /* best-effort */ }
    }

    this.goalState.perceptions.push(perception);
    this.goalState.status = "idle";

    this.emit("bua.perception.captured", "succeeded", {
      goalId: this.goalState.goalId,
      url: perception.url,
      interactiveElements: perception.interactiveElements,
      hasAccessibilityTree: !!perception.accessibilityTree,
      hasScreenshot: !!perception.screenshotPath,
    });

    return perception;
  }

  /** Bind to an active browser session. */
  bindSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.emit("bua.session.bound", "succeeded", { sessionId });
  }

  /** Get the current goal state. */
  getGoalState(): BrowserAgentGoalState | null { return this.goalState; }

  /** Get the bound session ID. */
  getSessionId(): string | null { return this.sessionId; }

  /** Clear the current goal. */
  clearGoal(): void {
    if (this.goalState) {
      this.emit("bua.goal.cleared", "succeeded", {
        goalId: this.goalState.goalId,
        totalActions: this.goalState.actions.length,
      });
    }
    this.goalState = null;
  }

  /**
   * Execute a browser objective end-to-end using the LLM.
   *
   * This is the high-level autonomous entry point for browser tasks.
   * Flow: perceive page → send to LLM → get action → execute → repeat
   *
   * @param objective - Natural language goal (e.g. "Go to google.com and search for TypeScript")
   * @param generateFn - LLM generation function
   * @param sessionManager - Browser session manager for page interaction
   * @param maxSteps - Maximum number of perceive→act cycles
   */
  async executeObjective(
    objective: string,
    generateFn: (input: {
      message: string;
      conversation: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>;
      systemPrompt: string;
    }) => Promise<{ content: string } | null>,
    sessionManager?: {
      navigate(id: string, url: string): Promise<unknown>;
      screenshot(id: string): Promise<unknown>;
      click(id: string, sel: string): Promise<unknown>;
      type(id: string, sel: string, text: string): Promise<unknown>;
      evaluate(id: string, expr: string): Promise<unknown>;
    },
    maxSteps = 20,
  ): Promise<{ success: boolean; actions: BrowserAgentAction[]; summary: string }> {
    if (!this.goalState) throw new Error("No active browser goal — call initGoal() first");
    if (!sessionManager || !this.sessionId) throw new Error("No browser session bound");

    this.emit("bua.objective.started", "succeeded", {
      goalId: this.goalState.goalId, objective, maxSteps,
    });

    const systemPrompt = `You are an autonomous browser agent. Your task is to achieve the following objective by interacting with a web page.

## Instructions
1. I will show you the current page state (interactive elements, URL, title).
2. You must respond with EXACTLY ONE action in JSON format.
3. Available actions:
   - {"action": "navigate", "url": "https://..."}
   - {"action": "click", "selector": "CSS selector or element description"}
   - {"action": "type", "selector": "CSS selector", "text": "text to type"}
   - {"action": "scroll", "pixels": 300}
   - {"action": "wait", "ms": 1000}
   - {"action": "done", "summary": "What was accomplished"}
4. When the objective is complete, use the "done" action.
5. Be precise with selectors — use IDs, aria-labels, or unique text content.

## Objective
${objective}`;

    const conversation: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }> = [];

    for (let step = 0; step < maxSteps; step++) {
      // 1. Perceive
      const perception = await this.perceive(sessionManager);

      // 2. Build state description for LLM
      const stateMsg = `Step ${step + 1}/${maxSteps}
URL: ${perception.url}
Title: ${perception.title}
Interactive elements: ${perception.interactiveElements}
Page state:
${perception.accessibilityTree ?? "(no accessibility data available)"}`;

      // 3. Ask LLM what to do
      const llmResult = await generateFn({
        message: stateMsg,
        conversation,
        systemPrompt,
      });

      if (!llmResult?.content) {
        this.emit("bua.objective.llm_empty", "failed", {
          goalId: this.goalState.goalId, step,
        });
        break;
      }

      conversation.push({ role: "user", content: stateMsg });
      conversation.push({ role: "assistant", content: llmResult.content });

      // 4. Parse action from LLM response
      let actionJson: Record<string, unknown>;
      try {
        const jsonMatch = llmResult.content.match(/\{[^}]+\}/);
        actionJson = jsonMatch ? JSON.parse(jsonMatch[0]) : { action: "done", summary: llmResult.content };
      } catch {
        actionJson = { action: "done", summary: llmResult.content };
      }

      // 5. Check for completion
      if (actionJson.action === "done") {
        const summary = String(actionJson.summary ?? "Objective completed");
        this.emit("bua.objective.completed", "succeeded", {
          goalId: this.goalState.goalId, steps: step + 1, summary,
        });
        return { success: true, actions: this.goalState.actions, summary };
      }

      // 6. Execute the action
      try {
        switch (actionJson.action) {
          case "navigate":
            await this.executeAction("navigate", String(actionJson.url ?? ""), undefined, sessionManager);
            break;
          case "click":
            await this.executeAction("click", String(actionJson.selector ?? ""), undefined, sessionManager);
            break;
          case "type":
            await this.executeAction("type", String(actionJson.selector ?? ""), String(actionJson.text ?? ""), sessionManager);
            break;
          case "scroll":
            await this.executeAction("scroll", String(actionJson.pixels ?? 300), undefined, sessionManager);
            break;
          case "wait":
            await this.executeAction("wait", String(actionJson.ms ?? 1000), undefined, sessionManager);
            break;
          default:
            this.emit("bua.objective.unknown_action", "failed", {
              goalId: this.goalState.goalId, action: actionJson.action,
            });
        }
      } catch (actionError) {
        // Feed error back to LLM so it can try a different approach
        conversation.push({
          role: "user",
          content: `Action failed with error: ${String(actionError)}. Try a different approach.`,
        });
      }

      // Trim conversation to prevent overflow
      if (conversation.length > 30) {
        conversation.splice(0, conversation.length - 20);
      }
    }

    const summary = `Reached max steps (${maxSteps}) without completing objective`;
    this.emit("bua.objective.max_steps", "failed", {
      goalId: this.goalState.goalId, maxSteps,
    });
    return { success: false, actions: this.goalState?.actions ?? [], summary };
  }

  private emit(operation: string, status: "succeeded" | "failed", details: Record<string, unknown>): void {
    this.activityBus.emit({
      sessionId: this.sessionId ?? "bua-unbound",
      layer: "agent", operation, status,
      details: { ...details, source: "autonomous-browser-agent" },
    });
  }
}
