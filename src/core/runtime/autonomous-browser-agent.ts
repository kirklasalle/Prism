/**
 * PRISM Autonomous Browser Agent — Phase A2B (Vision-First Upgrade)
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
 *
 * v0.22 — Vision-First Upgrade:
 * - Multimodal perception: fuses accessibility tree + screenshot into
 *   LlmContentPart[] messages for vision-capable LLMs
 * - Configurable perception scaling (default 500 elements, was 100)
 * - Robust JSON action parser (replaces brittle regex)
 * - Vision-aware system prompt for rich page understanding
 */

import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";
import type { LlmContentPart } from "../operator/llm-provider-manager.js";
import { AgentCheckpointStore } from "./agent-checkpoint-store.js";
import { DsvarResolver } from "./dsvar-resolver.js";
import { GuiRlOptimizer } from "../memory/gui-rl-optimizer.js";
import type { CSHManager } from "../operator/csh-manager.js";

// ── Configuration ────────────────────────────────────────────────────────────

export interface BrowserAgentConfig {
  /** Maximum interactive elements to capture per perception. Default: 500 */
  maxInteractiveElements: number;
  /** Enable multimodal vision (send screenshots as image tokens to LLM). Default: true */
  visionEnabled: boolean;
  /** Vision detail level for image tokens. Default: "low" (512×512 tiles, cost-efficient) */
  visionDetail: "auto" | "low" | "high";
  /** Maximum text length per element in accessibility tree. Default: 120 */
  maxElementTextLength: number;
  /** Maximum conversation history entries before trimming. Default: 40 */
  maxConversationHistory: number;
  /** Maximum perceive→act cycles per objective. Default: 25 */
  maxSteps: number;
}

const DEFAULT_CONFIG: BrowserAgentConfig = {
  maxInteractiveElements: 500,
  visionEnabled: true,
  visionDetail: "low",
  maxElementTextLength: 120,
  maxConversationHistory: 40,
  maxSteps: 25,
};

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
  screenshotBase64: string | null;
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

// ── JSON Extraction Utility ──────────────────────────────────────────────────

/**
 * Robustly extract a JSON object from LLM output.
 * Handles: code fences (```json ... ```), nested braces, multi-line,
 * markdown-wrapped JSON, and plain text with embedded JSON.
 */
function extractJsonFromLlmOutput(text: string): Record<string, unknown> | null {
  // Strategy 1: Look for code-fenced JSON (```json ... ``` or ``` ... ```)
  const codeFenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeFenceMatch) {
    try {
      const parsed = JSON.parse(codeFenceMatch[1].trim());
      if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    } catch { /* try next strategy */ }
  }

  // Strategy 2: Find the outermost balanced braces
  const firstBrace = text.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const candidate = text.slice(firstBrace, i + 1);
            const parsed = JSON.parse(candidate);
            if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
          } catch { /* try continuing to find next potential match */ }
        }
      }
    }
  }

  // Strategy 3: Try parsing the entire text as JSON
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
  } catch { /* not valid JSON */ }

  return null;
}

// ── Prompt Injection Sanitization Utility ──────────────────────────────────────

/**
 * Sanitize page-sourced text content to protect against prompt injection attacks.
 * Strips script/iframe tags, removes data-URIs, and redacts common jailbreak patterns.
 */
function sanitizeTextContent(text: string): string {
  if (!text) return "";

  // 1. Strip script and iframe tags
  let sanitized = text.replace(/<(script|iframe)[^>]*>([\s\S]*?)<\/\1>/gi, "[REDACTED_TAG]");

  // 2. Strip html comments
  sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, "");

  // 3. Strip data-URIs to prevent base64 context stuffing or data exploits
  sanitized = sanitized.replace(/data:[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+;base64,[a-zA-Z0-9+/={},\s\n\r]*/gi, "[REDACTED_DATA_URI]");

  // 4. Strip typical prompt injection triggers/override patterns (case-insensitive)
  const injectionPatterns = [
    /ignore\s+(?:the\s+)?(?:previous|following|all)\s+instructions/gi,
    /system\s+override/gi,
    /developer\s+override/gi,
    /bypass\s+(?:the\s+)?rules/gi,
    /override\s+(?:the\s+)?system/gi,
    /new\s+instruction/gi,
    /you\s+must\s+now/gi,
    /forget\s+(?:your\s+)?instructions/gi,
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, "[REDACTED_INSTRUCTION]");
  }

  return sanitized;
}

// ── Agent ────────────────────────────────────────────────────────────────────

export class AutonomousBrowserAgent {
  private readonly activityBus: ActivityBus;
  private readonly config: BrowserAgentConfig;
  private goalState: BrowserAgentGoalState | null = null;
  private sessionId: string | null = null;
  private cshManager: CSHManager | null = null;
  private readonly checkpointStore: AgentCheckpointStore;
  private readonly guiRlOptimizer: GuiRlOptimizer;

  constructor(activityBus: ActivityBus, config?: Partial<BrowserAgentConfig>) {
    this.activityBus = activityBus;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.checkpointStore = new AgentCheckpointStore();
    this.guiRlOptimizer = new GuiRlOptimizer();
  }

  setCSHManager(cshManager: CSHManager): void {
    this.cshManager = cshManager;
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
          const rawExtract = await sessionManager.evaluate(this.sessionId,
            `document.querySelector('${target}')?.textContent?.trim() ?? null`);
          result = typeof rawExtract === "string" ? sanitizeTextContent(rawExtract) : rawExtract;
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
   * Capture the current page state for multimodal perception.
   *
   * Captures BOTH accessibility tree AND screenshot in parallel.
   * The accessibility tree provides structured interaction data;
   * the screenshot provides visual context for the LLM.
   *
   * Element cap is configurable via `config.maxInteractiveElements` (default 500).
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
      screenshotBase64: null,
      screenshotPath: null,
      interactiveElements: 0,
      timestamp: new Date().toISOString(),
    };

    if (sessionManager && this.sessionId) {
      // ── Parallel capture: accessibility tree + screenshot ──────────
      const elementCap = this.config.maxInteractiveElements;
      const textCap = this.config.maxElementTextLength;

      const a11yPromise = sessionManager.evaluate(this.sessionId, `
        (function() {
          var els = document.querySelectorAll(
            'a, button, input, select, textarea, ' +
            '[role="button"], [role="link"], [role="tab"], [role="menuitem"], ' +
            '[role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], ' +
            '[onclick], [contenteditable="true"]'
          );
          var items = [];
          for (var i = 0; i < Math.min(els.length, ${elementCap}); i++) {
            var el = els[i];
            var rect = el.getBoundingClientRect();
            var text = (el.textContent || '').trim().slice(0, ${textCap});
            var tag = el.tagName.toLowerCase();
            var role = el.getAttribute('role') || tag;
            var name = el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('placeholder') || '';
            var type = el.getAttribute('type') || '';
            var val = '';
            if (tag === 'input' || tag === 'textarea' || tag === 'select') {
              val = (el.value || '').slice(0, 50);
            }
            items.push({
              index: i, role: role, tag: tag, text: text, name: name,
              type: type, value: val, disabled: el.disabled || false,
              visible: rect.width > 0 && rect.height > 0,
              bbox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
            });
          }
          return JSON.stringify({
            title: document.title,
            url: location.href,
            interactiveCount: els.length,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            scrollX: Math.round(window.scrollX),
            scrollY: Math.round(window.scrollY),
            scrollHeight: document.documentElement.scrollHeight,
            elements: items
          });
        })()
      `).catch(() => null);

      const screenshotPromise = this.config.visionEnabled
        ? sessionManager.screenshot(this.sessionId).catch(() => null)
        : Promise.resolve(null);

      const [treeResult, ssResult] = await Promise.all([a11yPromise, screenshotPromise]);

      // ── Process accessibility tree ────────────────────────────────
      if (typeof treeResult === "string") {
        try {
          const parsed = JSON.parse(treeResult) as Record<string, any>;
          perception.title = sanitizeTextContent(String(parsed.title ?? ""));
          perception.url = String(parsed.url ?? perception.url);
          perception.interactiveElements = Number(parsed.interactiveCount ?? 0);

          // Sanitize dynamic page-sourced content in interactive elements
          if (Array.isArray(parsed.elements)) {
            parsed.elements = parsed.elements.map((el: any) => {
              if (el) {
                if (typeof el.text === "string") el.text = sanitizeTextContent(el.text);
                if (typeof el.name === "string") el.name = sanitizeTextContent(el.name);
                if (typeof el.value === "string") el.value = sanitizeTextContent(el.value);
              }
              return el;
            });
          }

          perception.accessibilityTree = JSON.stringify(parsed);
        } catch {
          perception.accessibilityTree = treeResult;
        }
      }

      // ── Process screenshot ────────────────────────────────────────
      if (ssResult) {
        if (Buffer.isBuffer(ssResult)) {
          perception.screenshotBase64 = ssResult.toString("base64");
        } else if (typeof ssResult === "object" && "path" in (ssResult as Record<string, unknown>)) {
          perception.screenshotPath = String((ssResult as Record<string, unknown>).path);
        }
      }
    }

    this.goalState.perceptions.push(perception);
    this.goalState.status = "idle";

    this.emit("bua.perception.captured", "succeeded", {
      goalId: this.goalState.goalId,
      url: perception.url,
      interactiveElements: perception.interactiveElements,
      hasAccessibilityTree: !!perception.accessibilityTree,
      hasScreenshot: !!perception.screenshotBase64 || !!perception.screenshotPath,
      visionEnabled: this.config.visionEnabled,
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

  /** Get the current configuration (read-only). */
  getConfig(): Readonly<BrowserAgentConfig> { return this.config; }

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
   * Flow: perceive page → send to LLM (with vision) → get action → execute → repeat
   *
   * v0.22 — Vision-First: sends multimodal LlmContentPart[] messages combining
   * the accessibility tree (text) with a screenshot (image_url) on every step.
   * Falls back to text-only if screenshot capture fails.
   *
   * @param objective - Natural language goal (e.g. "Go to google.com and search for TypeScript")
   * @param generateFn - LLM generation function (supports multimodal content parts)
   * @param sessionManager - Browser session manager for page interaction
   * @param maxSteps - Maximum number of perceive→act cycles (overrides config)
   */
  private detectRoadblock(perception: BrowserAgentPerception, actionJson: Record<string, unknown> = {}): { detected: boolean; reason: "auth_wall" | "captcha_detected" | "security_violation" | "manual_intervention" | null } {
    if (actionJson.action === "handoff") {
      return { detected: true, reason: (actionJson.reason as any) || "manual_intervention" };
    }

    const urlLower = perception.url.toLowerCase();
    const titleLower = perception.title.toLowerCase();
    const treeLower = (perception.accessibilityTree || "").toLowerCase();

    // 1. CAPTCHA / Cloudflare checks
    const captchaKeywords = [
      "captcha", "recaptcha", "hcaptcha", "cloudflare", "ray-id", "challenge-platform",
      "verify you are human", "verify your identity", "one more step", "security check",
      "ddos protection", "robot check", "are you a robot"
    ];
    if (captchaKeywords.some(kw => urlLower.includes(kw) || titleLower.includes(kw) || treeLower.includes(kw))) {
      return { detected: true, reason: "captcha_detected" };
    }

    // 2. Auth Wall / OAuth Login wall checks
    const oauthKeywords = [
      "login.microsoftonline.com", "accounts.google.com", "github.com/login", "okta.com", "oauth",
      "signin", "sign-in", "authorize"
    ];
    if (oauthKeywords.some(kw => urlLower.includes(kw))) {
      // Make sure we didn't start on a login page intentionally
      if (this.goalState && !this.goalState.objective.toLowerCase().includes("login") &&
          !this.goalState.objective.toLowerCase().includes("sign in")) {
        return { detected: true, reason: "auth_wall" };
      }
    }

    // 3. HTTP 401/403 cues
    const errorKeywords = [
      "401 unauthorized", "403 forbidden", "access denied", "unauthorized access", "permission denied"
    ];
    if (errorKeywords.some(kw => titleLower.includes(kw) || treeLower.includes(kw))) {
      return { detected: true, reason: "security_violation" };
    }

    return { detected: false, reason: null };
  }

  async executeObjective(
    objective: string,
    generateFn: (input: {
      message: string;
      conversation: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string | LlmContentPart[] }>;
      systemPrompt: string;
    }) => Promise<{ content: string } | null>,
    sessionManager?: {
      navigate(id: string, url: string): Promise<unknown>;
      screenshot(id: string): Promise<unknown>;
      click(id: string, sel: string): Promise<unknown>;
      type(id: string, sel: string, text: string): Promise<unknown>;
      evaluate(id: string, expr: string): Promise<unknown>;
    },
    maxSteps?: number,
  ): Promise<{ success: boolean; actions: BrowserAgentAction[]; summary: string }> {
    if (!this.goalState) throw new Error("No active browser goal — call initGoal() first");
    if (!sessionManager || !this.sessionId) throw new Error("No browser session bound");

    const effectiveMaxSteps = maxSteps ?? this.config.maxSteps;

    this.emit("bua.objective.started", "succeeded", {
      goalId: this.goalState.goalId, objective, maxSteps: effectiveMaxSteps,
      visionEnabled: this.config.visionEnabled,
      maxInteractiveElements: this.config.maxInteractiveElements,
    });

    const systemPrompt = buildVisionAwareSystemPrompt(objective, this.config.visionEnabled);

    // ── Checkpoint Resume ────────────────────────────────────────────────────
    const checkpoint = this.checkpointStore.getCheckpoint(this.sessionId);
    let startStep = 0;
    const conversation: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string | LlmContentPart[] }> = [];

    if (checkpoint) {
      this.emit("bua.checkpoint.restored", "succeeded", {
        sessionId: this.sessionId,
        goalId: checkpoint.goalState.goalId,
        stepsExecuted: checkpoint.goalState.actions.length,
      });
      this.goalState = checkpoint.goalState;
      conversation.push(...checkpoint.conversation);
      startStep = checkpoint.goalState.actions.length;
    }

    for (let step = startStep; step < effectiveMaxSteps; step++) {
      // 1. Perceive (accessibility tree + screenshot in parallel)
      const perception = await this.perceive(sessionManager);

      // Heuristic roadblock detection
      let roadblock = this.detectRoadblock(perception);
      if (roadblock.detected) {
        const reason = roadblock.reason || "manual_intervention";
        this.emit("bua.objective.handoff_triggered", "succeeded", {
          goalId: this.goalState.goalId,
          reason,
          url: perception.url,
        });

        if (this.cshManager && typeof (sessionManager as any).getSessionPageAndContext === "function") {
          const handles = (sessionManager as any).getSessionPageAndContext(this.sessionId);
          if (handles) {
            const handoffState = await this.cshManager.serialize(handles.page, handles.context, {
              sessionId: this.sessionId,
              sourceAgentId: "developer",
              targetAgentId: "operator",
              reason: reason,
              objective: this.goalState.objective,
              history: this.goalState.actions.map(a => a.target).filter(Boolean),
              completedSteps: this.goalState.actions.map(a => ({
                action: a.type,
                thought: a.value || "",
                success: a.success
              })),
            });

            this.emit("csh.handoff.initiated", "succeeded", {
              handoffId: handoffState.handoffId,
              sessionId: this.sessionId,
              reason: handoffState.reason,
              targetAgentId: handoffState.targetAgentId,
              timestamp: handoffState.timestamp,
            });

            // Wait/poll for the handoff to be resolved by the operator
            let resolved = false;
            while (!resolved) {
              await new Promise(r => setTimeout(r, 2000));
              const h = this.cshManager.getHandoff(handoffState.handoffId);
              if (!h || h.status === "resolved") {
                resolved = true;
              }
              // Also break if goal is terminated externally
              if (this.goalState.status === "error") {
                break;
              }
            }

            this.emit("bua.objective.resumed", "succeeded", {
              goalId: this.goalState.goalId,
              sessionId: this.sessionId,
            });

            // Reload page context to get fresh state after operator resume
            await handles.page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
            // Re-perceive to get correct screenshot/tree
            continue;
          }
        }
      }

      // 2. Build multimodal state message for LLM
      const stateText = buildStateDescription(perception, step, effectiveMaxSteps, this.guiRlOptimizer);
      const stateContent = buildMultimodalContent(stateText, perception, this.config);

      // 3. Ask LLM what to do
      const llmResult = await generateFn({
        message: typeof stateContent === "string" ? stateContent : "",
        conversation: [
          ...conversation,
          { role: "user", content: stateContent },
        ],
        systemPrompt,
      });

      if (!llmResult?.content) {
        this.emit("bua.objective.llm_empty", "failed", {
          goalId: this.goalState.goalId, step,
        });
        break;
      }

      conversation.push({ role: "user", content: stateContent });
      conversation.push({ role: "assistant", content: llmResult.content });

      // 4. Parse action from LLM response (robust JSON extraction)
      const actionJson = extractJsonFromLlmOutput(llmResult.content)
        ?? { action: "done", summary: llmResult.content };

      this.emit("bua.objective.action_parsed", "succeeded", {
        goalId: this.goalState.goalId, step,
        parsedAction: String(actionJson.action ?? "unknown"),
      });

      // LLM-requested roadblock handoff check
      let llmRoadblock = this.detectRoadblock(perception, actionJson);
      if (llmRoadblock.detected) {
        const reason = llmRoadblock.reason || "manual_intervention";
        this.emit("bua.objective.handoff_triggered", "succeeded", {
          goalId: this.goalState.goalId,
          reason,
          url: perception.url,
        });

        if (this.cshManager && typeof (sessionManager as any).getSessionPageAndContext === "function") {
          const handles = (sessionManager as any).getSessionPageAndContext(this.sessionId);
          if (handles) {
            const handoffState = await this.cshManager.serialize(handles.page, handles.context, {
              sessionId: this.sessionId,
              sourceAgentId: "developer",
              targetAgentId: "operator",
              reason: reason,
              objective: this.goalState.objective,
              history: this.goalState.actions.map(a => a.target).filter(Boolean),
              completedSteps: this.goalState.actions.map(a => ({
                action: a.type,
                thought: a.value || "",
                success: a.success
              })),
            });

            this.emit("csh.handoff.initiated", "succeeded", {
              handoffId: handoffState.handoffId,
              sessionId: this.sessionId,
              reason: handoffState.reason,
              targetAgentId: handoffState.targetAgentId,
              timestamp: handoffState.timestamp,
            });

            // Wait/poll for the handoff to be resolved by the operator
            let resolved = false;
            while (!resolved) {
              await new Promise(r => setTimeout(r, 2000));
              const h = this.cshManager.getHandoff(handoffState.handoffId);
              if (!h || h.status === "resolved") {
                resolved = true;
              }
              // Also break if goal is terminated externally
              if (this.goalState.status === "error") {
                break;
              }
            }

            this.emit("bua.objective.resumed", "succeeded", {
              goalId: this.goalState.goalId,
              sessionId: this.sessionId,
            });

            // Reload page context to get fresh state after operator resume
            await handles.page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
            // Re-perceive to get correct screenshot/tree
            continue;
          }
        }
      }

      // 5. Check for completion
      if (actionJson.action === "done") {
        const summary = String(actionJson.summary ?? "Objective completed");
        this.emit("bua.objective.completed", "succeeded", {
          goalId: this.goalState.goalId, steps: step + 1, summary,
        });
        this.checkpointStore.deleteCheckpoint(this.sessionId);
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
            await this.executeAction("scroll", String(actionJson.pixels ?? actionJson.amount ?? 300), undefined, sessionManager);
            break;
          case "wait":
            await this.executeAction("wait", String(actionJson.ms ?? actionJson.duration ?? 1000), undefined, sessionManager);
            break;
          case "extract":
            await this.executeAction("extract", String(actionJson.selector ?? "body"), undefined, sessionManager);
            break;
          default:
            this.emit("bua.objective.unknown_action", "failed", {
              goalId: this.goalState.goalId, action: actionJson.action,
            });
        }

        // Record successful RL reward
        this.guiRlOptimizer.recordActionOutcome(
          this.sessionId,
          this.goalState.objective,
          String(actionJson.action ?? ""),
          String(actionJson.selector ?? actionJson.url ?? ""),
          true
        );

        // Save Checkpoint after successful action execution
        this.checkpointStore.saveCheckpoint(this.sessionId, this.goalState, conversation);
      } catch (actionError) {
        // Record failed RL penalty reward
        this.guiRlOptimizer.recordActionOutcome(
          this.sessionId,
          this.goalState.objective,
          String(actionJson.action ?? ""),
          String(actionJson.selector ?? actionJson.url ?? ""),
          false,
          String(actionError)
        );

        // Feed error back to LLM so it can try a different approach
        conversation.push({
          role: "user",
          content: `Action "${String(actionJson.action)}" failed with error: ${String(actionError)}. Analyze the error and try a different approach.`,
        });
      }

      // Trim conversation to prevent context window overflow
      if (conversation.length > this.config.maxConversationHistory) {
        // Keep the first 2 messages (initial context) and the most recent messages
        const keepRecent = this.config.maxConversationHistory - 4;
        const trimmedConversation = [
          ...conversation.slice(0, 2),
          { role: "user" as const, content: `[...${conversation.length - keepRecent - 2} earlier steps trimmed for context management...]` },
          ...conversation.slice(-keepRecent),
        ];
        conversation.length = 0;
        conversation.push(...trimmedConversation);
      }
    }

    const summary = `Reached max steps (${effectiveMaxSteps}) without completing objective`;
    this.emit("bua.objective.max_steps", "failed", {
      goalId: this.goalState.goalId, maxSteps: effectiveMaxSteps,
    });
    this.checkpointStore.deleteCheckpoint(this.sessionId);
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

// ── Prompt Builders ──────────────────────────────────────────────────────────

function buildVisionAwareSystemPrompt(objective: string, visionEnabled: boolean): string {
  const visionBlock = visionEnabled
    ? `
You will receive BOTH a structured accessibility tree AND a screenshot image of the current page.
Use the screenshot to understand the visual layout, identify elements, and verify your actions.
Use the accessibility tree for precise element targeting with CSS selectors.
Cross-reference both inputs: if an element is visible in the screenshot but not in the tree,
describe what you see and try alternative selectors.`
    : `
You will receive a structured accessibility tree of the current page.
Use the element indices, roles, tags, and names to identify interactive targets.`;

  return `You are PRISM's autonomous browser agent. You interact with web pages to achieve goals.
${visionBlock}

## Action Format
Respond with EXACTLY ONE action as a JSON object. Do NOT wrap in markdown code fences.

Available actions:
- {"action": "navigate", "url": "https://..."}
- {"action": "click", "selector": "CSS selector targeting the element"}
- {"action": "type", "selector": "CSS selector", "text": "text to type"}
- {"action": "scroll", "pixels": 300}  (positive = down, negative = up)
- {"action": "wait", "ms": 1000}
- {"action": "extract", "selector": "CSS selector to read text from"}
- {"action": "done", "summary": "Describe what was accomplished"}

## Selector Strategy (Priority Order)
1. \`#id\` — most reliable
2. \`[aria-label="..."\]\` — accessibility label
3. \`[name="..."\]\` — form field name
4. \`button:has-text("...")\` — text-based matching
5. \`nth-of-type\` or structural selectors as fallback

## Rules
- Be precise with selectors. Prefer IDs and aria-labels over fragile class names.
- If an action fails, analyze the error and try a different selector or approach.
- When the objective is fully complete, use {"action": "done", "summary": "..."}.
- Each element in the accessibility tree has a bounding box (bbox) with x, y, w, h.
  Elements with w=0 or h=0 are invisible and should not be clicked.
- The "disabled" field indicates if an element cannot be interacted with.
- The "value" field shows the current value of input/textarea/select elements.

## Objective
${objective}`;
}

function buildStateDescription(
  perception: BrowserAgentPerception,
  step: number,
  maxSteps: number,
  guiRlOptimizer?: GuiRlOptimizer,
): string {
  const parts = [
    `[Step ${step + 1}/${maxSteps}]`,
    `URL: ${perception.url}`,
    `Title: ${perception.title}`,
    `Interactive elements: ${perception.interactiveElements}`,
  ];

  if (perception.accessibilityTree) {
    try {
      const parsed = JSON.parse(perception.accessibilityTree);
      parts.push(`Viewport: ${parsed.viewportWidth}×${parsed.viewportHeight}`);
      parts.push(`Scroll: ${parsed.scrollX},${parsed.scrollY} of ${parsed.scrollHeight}px total height`);

      // Dynamic Reinforcement Learning Policy Integration
      if (guiRlOptimizer && parsed.elements && Array.isArray(parsed.elements)) {
        const adviceList: string[] = [];
        for (const el of parsed.elements) {
          try {
            const selector = DsvarResolver.generateResilientSelector(el);
            const advice = guiRlOptimizer.getPolicyAdvice(selector);
            if (advice) {
              adviceList.push(advice);
            }
          } catch {
            // Ignore element-specific selector generation failures
          }
        }
        if (adviceList.length > 0) {
          parts.push("");
          parts.push("=== GUI Reinforcement Learning Policy Advice ===");
          parts.push(adviceList.join("\n"));
        }
      }

      parts.push("");
      parts.push("Accessibility Tree:");
      parts.push(perception.accessibilityTree);
    } catch {
      parts.push("");
      parts.push("Accessibility Tree:");
      parts.push(perception.accessibilityTree);
    }
  } else {
    parts.push("(No accessibility data available — use the screenshot for visual analysis)");
  }

  return parts.join("\n");
}

/**
 * Build multimodal content: text description + optional screenshot image.
 * Returns LlmContentPart[] when vision is enabled and a screenshot is available,
 * otherwise returns a plain string for text-only LLMs.
 */
function buildMultimodalContent(
  stateText: string,
  perception: BrowserAgentPerception,
  config: BrowserAgentConfig,
): string | LlmContentPart[] {
  if (!config.visionEnabled || !perception.screenshotBase64) {
    return stateText;
  }

  // Fused multimodal content: text state + screenshot image
  return [
    { type: "text" as const, text: stateText },
    {
      type: "image_url" as const,
      image_url: {
        url: `data:image/png;base64,${perception.screenshotBase64}`,
        detail: config.visionDetail,
      },
    },
  ];
}

export { extractJsonFromLlmOutput, sanitizeTextContent };
