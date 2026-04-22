import type { Tool, ToolRequest, ToolResult, GovernanceSchema } from "../tools/types.js";
import type { ToolContract } from "../tools/contracts.js";
import type { ActivityBus } from "../activity/bus.js";

const DASHBOARD_GOVERNANCE: GovernanceSchema = {
  actions: {
    switch_tab: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    show_notification: { minimumRisk: "low", mutating: false, rollbackRequired: false },
  },
};

/**
 * Tool for controlling the Prism Dashboard UI itself.
 * Allows agents to switch tabs, show alerts, or trigger UI refreshes.
 */
export class DashboardControlTool implements Tool {
  readonly name = "dashboard_control";

  readonly contract: ToolContract = {
    version: "1.0.0",
    args: {
      action: { type: "string", required: true, enum: ["switch_tab", "show_notification"] },
      tabId: { type: "string", enum: ["chat", "settings", "tools", "agentic", "computer", "hardware", "browser", "network", "telemetry", "logs", "scheduler", "workspace", "characters"] },
      message: { type: "string" },
      level: { type: "string", enum: ["info", "success", "warning", "error"] },
    },
  };

  readonly governance = DASHBOARD_GOVERNANCE;

  constructor(private readonly activityBus: ActivityBus) {}

  async execute(request: ToolRequest): Promise<ToolResult> {
    const action = String(request.args.action ?? "");
    
    if (action === "switch_tab") {
      const tabId = String(request.args.tabId ?? "");
      if (!tabId) return { ok: false, output: { error: "tabId is required for switch_tab" } };
      
      this.emitUiAction("switch_tab", { tabId });
      return { ok: true, output: { tabSwitched: tabId } };
    }

    if (action === "show_notification") {
      const message = String(request.args.message ?? "");
      const level = String(request.args.level ?? "info");
      if (!message) return { ok: false, output: { error: "message is required for show_notification" } };

      this.emitUiAction("show_notification", { message, level });
      return { ok: true, output: { notified: true } };
    }

    return { ok: false, output: { error: `Unknown dashboard_control action: ${action}` } };
  }

  private emitUiAction(type: string, details: Record<string, unknown>): void {
    if (this.activityBus) {
      this.activityBus.emit({
        sessionId: "system",
        layer: "causal",
        operation: `ui.${type}`,
        status: "succeeded",
        details: { ...details, origin: "DashboardControlTool" },
      });
    }
  }
}
