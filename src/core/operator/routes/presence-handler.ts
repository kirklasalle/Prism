import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { readPreferences, writePreferences } from "../../config/workspace-resolver.js";
import { SmsCommunicationTool } from "../../../adapters/application/sms-adapter.js";

export class PresenceHandler implements IRouteHandler {
    match(req: IncomingMessage): boolean {
        const url = (req.url ?? "").split("?")[0]!;
        const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
        return normalized.startsWith("/api/presence");
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const rawUrl = req.url ?? "";
        const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
        const method = req.method?.toUpperCase() ?? "GET";

        if (method === "GET" && url === "/api/presence") {
            const prefs = readPreferences();
            const presence = prefs?.operatorPresence ?? {
                status: "online",
                autoAway: false,
                autoAwayTimeout: 10,
                smsPhone: "",
                smsCarrier: "att",
            };
            this.json(res, 200, presence);
            return;
        }

        if (method === "POST" && url === "/api/presence") {
            const body = await this.readJson(req);
            const prefs = readPreferences() || { lastModified: "" };
            prefs.operatorPresence = {
                ...(prefs.operatorPresence ?? {
                    autoAway: false,
                    autoAwayTimeout: 10,
                    smsPhone: "",
                    smsCarrier: "att",
                }),
                status: body.status || "online",
            };
            prefs.lastModified = new Date().toISOString();
            writePreferences(prefs);

            if (service.inboundPoller) {
                service.inboundPoller.addLog(
                    `[PRESENCE] Operator presence updated to: ${(body.status || "online").toUpperCase()}`,
                );
            }
            this.json(res, 200, { success: true });
            return;
        }

        if (method === "POST" && url === "/api/presence/auto-away") {
            const body = await this.readJson(req);
            const prefs = readPreferences() || { lastModified: "" };
            prefs.operatorPresence = {
                ...(prefs.operatorPresence ?? { status: "online", smsPhone: "", smsCarrier: "att" }),
                autoAway: !!body.enabled,
                autoAwayTimeout: parseInt(body.timeout, 10) || 10,
            };
            prefs.lastModified = new Date().toISOString();
            writePreferences(prefs);

            if (service.inboundPoller) {
                service.inboundPoller.addLog(
                    `[CONFIG] Auto-Away setting updated to: ${body.enabled ? "ENABLED" : "DISABLED"} (${body.timeout} min)`,
                );
            }
            this.json(res, 200, { success: true });
            return;
        }

        if (method === "POST" && url === "/api/presence/sms-gateway") {
            const body = await this.readJson(req);
            const prefs = readPreferences() || { lastModified: "" };
            prefs.operatorPresence = {
                ...(prefs.operatorPresence ?? { status: "online", autoAway: false, autoAwayTimeout: 10 }),
                smsPhone: body.phone || "",
                smsCarrier: body.carrier || "att",
            };
            prefs.lastModified = new Date().toISOString();
            writePreferences(prefs);

            if (service.inboundPoller) {
                service.inboundPoller.addLog(
                    `[CONFIG] SMS Carrier Gateway configured: ${body.phone} (${body.carrier})`,
                );
            }
            this.json(res, 200, { success: true });
            return;
        }

        if (method === "POST" && url === "/api/presence/test-sms") {
            try {
                const tool = new SmsCommunicationTool(service.getGmailOAuth(), service.getOutlookOAuth());
                const result = await tool.execute({
                    operation: "send_sms",
                    args: {
                        action: "send_sms",
                        message: "PRISM: Operator channels active. Test broadcast successful.",
                    },
                    risk: "low",
                    mutatesState: false,
                });
                if (result.ok) {
                    if (service.inboundPoller) {
                        service.inboundPoller.addLog("[OUTBOUND] Test SMS broadcast successful.");
                    }
                    this.json(res, 200, { success: true, result: result.output });
                } else {
                    if (service.inboundPoller) {
                        service.inboundPoller.addLog(
                            `[ERROR] Test SMS broadcast failed: ${JSON.stringify(result.output)}`,
                        );
                    }
                    this.json(res, 500, { error: result.output });
                }
            } catch (err: any) {
                if (service.inboundPoller) {
                    service.inboundPoller.addLog(`[ERROR] Test SMS broadcast threw: ${err.message}`);
                }
                this.json(res, 500, { error: err.message });
            }
            return;
        }

        if (method === "GET" && url === "/api/presence/logs") {
            const logs = service.inboundPoller ? service.inboundPoller.getLogs() : [];
            this.json(res, 200, { logs });
            return;
        }

        if (method === "DELETE" && url === "/api/presence/logs") {
            if (service.inboundPoller) {
                service.inboundPoller.clearLogs();
            }
            this.json(res, 200, { success: true });
            return;
        }

        this.json(res, 404, { error: "Not found" });
    }

    private json(res: ServerResponse, status: number, data: any): void {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(data, null, 2));
    }

    private async readJson(req: IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            let body = "";
            req.on("data", (chunk) => {
                body += chunk;
            });
            req.on("end", () => {
                try {
                    resolve(JSON.parse(body || "{}"));
                } catch (e) {
                    resolve({});
                }
            });
            req.on("error", reject);
        });
    }
}
