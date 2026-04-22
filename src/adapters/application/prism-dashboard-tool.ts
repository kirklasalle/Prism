import type { Tool, ToolRequest, ToolResult, GovernanceSchema } from "../../core/tools/types.js";
import type { ToolContract } from "../../core/tools/contracts.js";
import type { ActivityBus } from "../../core/activity/bus.js";

const DASHBOARD_GOVERNANCE: GovernanceSchema = {
    actions: {
        navigate_tab:      { minimumRisk: "low", mutating: false, rollbackRequired: false },
        publish_log:       { minimumRisk: "low", mutating: false, rollbackRequired: false },
        emit_telemetry:    { minimumRisk: "low", mutating: false, rollbackRequired: false },
        read_active_tabs:  { minimumRisk: "low", mutating: false, rollbackRequired: false },
        trigger_ui_refresh: { minimumRisk: "low", mutating: false, rollbackRequired: false },
    },
};

export class PrismDashboardControlTool implements Tool {
    readonly name = "prism_dashboard";
    
    readonly contract: ToolContract = {
        version: "1.0.0",
        args: {
            action: {
                type: "string",
                required: true,
                enum: [
                    "navigate_tab",
                    "publish_log",
                    "emit_telemetry",
                    "read_active_tabs",
                    "trigger_ui_refresh",
                ]
            },
            tabName: { type: "string" },
            message: { type: "string" },
            level: { type: "string", enum: ["info", "warn", "error", "debug"] },
            eventName: { type: "string" },
            eventData: { type: "string" },
        }
    };
    
    readonly governance = DASHBOARD_GOVERNANCE;
    
    private activityBus?: ActivityBus;
    private sessionId?: string;
    
    constructor(activityBus?: ActivityBus, sessionId?: string) {
        this.activityBus = activityBus;
        this.sessionId = sessionId;
    }
    
    async execute(request: ToolRequest): Promise<ToolResult> {
        const action = String(request.args.action ?? "").trim();
        
        try {
            switch (action) {
                case "navigate_tab": {
                    const tabName = String(request.args.tabName ?? "");
                    if (!tabName) return { ok: false, output: { error: "tabName is required." } };
                    
                    if (this.activityBus) {
                        this.activityBus.emit({
                            sessionId: this.sessionId || "dashboard",
                            layer: "tool_execution",
                            operation: "navigate",
                            status: "succeeded",
                            details: { tab: tabName, ...request.args }
                        });
                    }
                    
                    return { ok: true, output: { navigatedTo: tabName } };
                }
                
                case "publish_log": {
                    const message = String(request.args.message ?? "");
                    const level = String(request.args.level ?? "info");
                    
                    if (this.activityBus) {
                        this.activityBus.emit({
                            sessionId: this.sessionId || "dashboard",
                            layer: "tool_execution",
                            operation: "log",
                            status: level === "error" ? "failed" : "succeeded",
                            details: { message, level, ...request.args }
                        });
                    }
                    
                    return { ok: true, output: { logged: true, level } };
                }
                
                case "emit_telemetry": {
                    const eventName = String(request.args.eventName ?? "");
                    const eventDataStr = String(request.args.eventData ?? "{}");
                    
                    let eventData: Record<string, unknown> = {};
                    try {
                        eventData = JSON.parse(eventDataStr);
                    } catch (e) {
                        // ignore
                    }
                    
                    if (this.activityBus) {
                        this.activityBus.emit({
                            sessionId: this.sessionId || "dashboard",
                            layer: "tool_execution",
                            operation: `telemetry_${eventName}`,
                            status: "succeeded",
                            details: { eventName, ...eventData, ...request.args }
                        });
                    }
                    
                    return { ok: true, output: { telemetryEmitted: eventName } };
                }
                
                case "read_active_tabs": {
                    // Normally this would query the frontend or a dashboard socket.
                    // For now, we return the known list of tabs built into Prism.
                    const tabs = [
                        "Chat", "Terminal", "Memory", "Network", 
                        "Provider & Models", "Logs & Debug", "Telemetry",
                        "Files", "Web Browser", "Screen & Vision"
                    ];
                    return { ok: true, output: { availableTabs: tabs } };
                }
                
                case "trigger_ui_refresh": {
                    if (this.activityBus) {
                        this.activityBus.emit({
                            sessionId: this.sessionId || "dashboard",
                            layer: "tool_execution",
                            operation: "ui_refresh",
                            status: "succeeded",
                            details: { ...request.args }
                        });
                    }
                    return { ok: true, output: { refreshTriggered: true } };
                }
                
                default:
                    return { ok: false, output: { error: `Unknown prism_dashboard action: "${action}".` } };
            }
        } catch (err: unknown) {
            return { ok: false, output: { error: (err as Error).message ?? "Dashboard operation failed." } };
        }
    }
}
