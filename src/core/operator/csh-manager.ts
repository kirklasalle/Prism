import { randomUUID } from "node:crypto";

export interface CognitiveHandoffState {
  handoffId: string;
  sessionId: string;
  sourceAgentId: string;
  targetAgentId: "guardian" | "operator" | "developer" | "security";
  timestamp: string;
  storageState: {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
    }>;
    origins: Array<{
      origin: string;
      localStorage: Array<{ key: string; value: string }>;
    }>;
  };
  sessionStorage: Record<string, string>;
  history: string[];
  activeUrl: string;
  activeTitle: string;
  viewportDimensions: { width: number; height: number };
  reasoningContext: {
    objective: string;
    completedSteps: Array<{
      action: string;
      thought: string;
      success: boolean;
    }>;
    agentMemoryKeys: Record<string, any>;
    activePlanDagJson: string;
  };
  status: "pending" | "resolved" | "expired";
  reason: "auth_wall" | "captcha_detected" | "security_violation" | "manual_intervention";
}

/**
 * CSHManager manages the packaging, serialization, and restoration of Playwright
 * browser sessions and agent cognitive states. Implements the CSH "Baton Pass" protocol.
 */
export class CSHManager {
  private handoffs = new Map<string, CognitiveHandoffState>();

  /**
   * Serializes a running Playwright page and browser context into a portable handoff state.
   */
  async serialize(
    page: any,
    context: any,
    options: {
      sessionId: string;
      sourceAgentId: string;
      targetAgentId: CognitiveHandoffState["targetAgentId"];
      reason: CognitiveHandoffState["reason"];
      objective?: string;
      history?: string[];
      completedSteps?: CognitiveHandoffState["reasoningContext"]["completedSteps"];
      agentMemoryKeys?: Record<string, any>;
      activePlanDagJson?: string;
    }
  ): Promise<CognitiveHandoffState> {
    const handoffId = `handoff-${randomUUID().slice(0, 8)}`;
    
    // 1. Capture standard storage state (cookies + localStorage)
    const storageState = await context.storageState();

    // 2. Capture sessionStorage via dynamic in-page evaluation
    let sessionStorage: Record<string, string> = {};
    try {
      sessionStorage = await page.evaluate(() => {
        const store: Record<string, string> = {};
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key) {
            store[key] = window.sessionStorage.getItem(key) ?? "";
          }
        }
        return store;
      });
    } catch (err) {
      console.warn("[PRISM][csh] Failed to extract sessionStorage:", err);
    }

    // 3. Capture viewport dimensions
    let viewportWidth = 1280;
    let viewportHeight = 800;
    try {
      const vp = page.viewportSize();
      if (vp) {
        viewportWidth = vp.width;
        viewportHeight = vp.height;
      }
    } catch { /* ignored */ }

    // 4. Capture current URL and Title
    const activeUrl = page.url();
    let activeTitle = "";
    try {
      activeTitle = await page.title();
    } catch { /* ignored */ }

    const state: CognitiveHandoffState = {
      handoffId,
      sessionId: options.sessionId,
      sourceAgentId: options.sourceAgentId,
      targetAgentId: options.targetAgentId,
      timestamp: new Date().toISOString(),
      storageState,
      sessionStorage,
      history: options.history ?? [activeUrl],
      activeUrl,
      activeTitle,
      viewportDimensions: { width: viewportWidth, height: viewportHeight },
      reasoningContext: {
        objective: options.objective ?? "",
        completedSteps: options.completedSteps ?? [],
        agentMemoryKeys: options.agentMemoryKeys ?? {},
        activePlanDagJson: options.activePlanDagJson ?? "{}",
      },
      status: "pending",
      reason: options.reason,
    };

    this.handoffs.set(handoffId, state);
    return state;
  }

  /**
   * Restores a serialized handoff state into a live Playwright page and browser context.
   */
  async deserialize(
    handoffId: string,
    page: any,
    context: any
  ): Promise<CognitiveHandoffState> {
    const state = this.handoffs.get(handoffId);
    if (!state) {
      throw new Error(`CSH Handoff state "${handoffId}" not found.`);
    }

    // 1. Clear existing cookies and add serialized cookies
    await context.clearCookies();
    if (state.storageState.cookies && state.storageState.cookies.length > 0) {
      await context.addCookies(state.storageState.cookies);
    }

    // 2. Restore localStorage and sessionStorage by navigating to the target origin first
    if (state.activeUrl && state.activeUrl !== "about:blank") {
      await page.goto(state.activeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Restore localStorage for target origins
      if (state.storageState.origins && state.storageState.origins.length > 0) {
        await page.evaluate((origins: any[]) => {
          for (const orig of origins) {
            if (window.location.origin === orig.origin) {
              window.localStorage.clear();
              for (const item of orig.localStorage) {
                window.localStorage.setItem(item.key, item.value);
              }
            }
          }
        }, state.storageState.origins);
      }

      // Restore sessionStorage
      if (state.sessionStorage && Object.keys(state.sessionStorage).length > 0) {
        await page.evaluate((sessionStore: Record<string, string>) => {
          window.sessionStorage.clear();
          for (const [key, value] of Object.entries(sessionStore)) {
            window.sessionStorage.setItem(key, value);
          }
        }, state.sessionStorage);
      }

      // Final reload to ensure page consumes the restored localStorage/sessionStorage states
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    }

    state.status = "resolved";
    return state;
  }

  /**
   * Retrieves a pending handoff by ID.
   */
  getHandoff(handoffId: string): CognitiveHandoffState | undefined {
    return this.handoffs.get(handoffId);
  }

  /**
   * Retrieves all pending handoffs currently awaiting operator intervention.
   */
  getPendingHandoffs(): CognitiveHandoffState[] {
    return Array.from(this.handoffs.values()).filter((h) => h.status === "pending");
  }

  /**
   * Cleans up resolved or expired handoffs.
   */
  clearHandoff(handoffId: string): void {
    this.handoffs.delete(handoffId);
  }
}
