import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardService } from "../dashboard-service.js";
import { IRouteHandler } from "./types.js";
import { DashboardHandler } from "./dashboard-handler.js";
import { SetupHandler } from "./setup-handler.js";
import { ApiHandler } from "./api-handler.js";
import { WikiHandler } from "./wiki-handler.js";
import { AutonomousHandler } from "./autonomous-handler.js";
import { SchedulerHandler } from "./scheduler-handler.js";
import { WorkspaceHandler } from "./workspace-handler.js";
import { TooltipsHandler } from "./tooltips-handler.js";
import { OpenAiCompatHandler } from "./openai-compat-handler.js";
import { IamRouteHandler, isEnterpriseIamEnabled } from "./iam-handler.js";
import { IamAdminRouteHandler } from "./iam-admin-handler.js";
import { ScimRouteHandler, isScimEnabled } from "./scim-handler.js";
import { LoginHandler } from "./login-handler.js";
import { BrowserHandler } from "./browser-handler.js";
import { ComputerHandler } from "./computer-handler.js";
import { AgenticHandler } from "./agentic-handler.js";
import { ChatHandler } from "./chat-handler.js";
import { SettingsHandler } from "./settings-handler.js";
import { LlmHandler } from "./llm-handler.js";
import { DiagnosticsHandler } from "./diagnostics-handler.js";
import { SessionPackageHandler } from "./session-package-handler.js";
import { GuardianHandler } from "./guardian-handler.js";
import { ModelHandler } from "./model-handler.js";
import { TelemetryHandler } from "./telemetry-handler.js";
import { OAuthHandler } from "./oauth-handler.js";
import { UtilitiesHandler } from "./utilities-handler.js";
import { ToolsHandler } from "./tools-handler.js";
import { CacHandler } from "./cac-handler.js";
import { IncubationHandler } from "./incubation-handler.js";
import { PluginsHandler } from "./plugins-handler.js";

export * from "./types.js";
export * from "./dashboard-handler.js";
export * from "./setup-handler.js";
export * from "./api-handler.js";
export * from "./autonomous-handler.js";
export * from "./scheduler-handler.js";
export * from "./workspace-handler.js";
export * from "./tooltips-handler.js";
export * from "./openai-compat-handler.js";
export * from "./iam-handler.js";
export * from "./iam-admin-handler.js";
export * from "./scim-handler.js";
export * from "./login-handler.js";
export * from "./llm-handler.js";
export * from "./diagnostics-handler.js";
export * from "./session-package-handler.js";
export * from "./guardian-handler.js";
export * from "./model-handler.js";
export * from "./telemetry-handler.js";
export * from "./oauth-handler.js";
export * from "./utilities-handler.js";
export * from "./tools-handler.js";
export * from "./cac-handler.js";
export * from "./incubation-handler.js";
export * from "./plugins-handler.js";

export class Router {
  private handlers: IRouteHandler[] = [];

  constructor(iam: IamRouteHandler) {
    this.handlers.push(new DashboardHandler());
    this.handlers.push(new SetupHandler());
    this.handlers.push(new LoginHandler());
    this.handlers.push(new WorkspaceHandler());
    this.handlers.push(new SchedulerHandler());
    this.handlers.push(new TooltipsHandler());
    this.handlers.push(new ApiHandler());
    this.handlers.push(new WikiHandler());
    this.handlers.push(new AutonomousHandler());
    this.handlers.push(new OpenAiCompatHandler());
    this.handlers.push(new BrowserHandler());
    this.handlers.push(new ComputerHandler());
    this.handlers.push(new AgenticHandler());
    this.handlers.push(new ChatHandler());
    this.handlers.push(new SettingsHandler());
    this.handlers.push(new LlmHandler());
    this.handlers.push(new DiagnosticsHandler());
    this.handlers.push(new SessionPackageHandler());
    this.handlers.push(new GuardianHandler());
    this.handlers.push(new ModelHandler());
    this.handlers.push(new TelemetryHandler());
    this.handlers.push(new UtilitiesHandler());
    this.handlers.push(new ToolsHandler());
    this.handlers.push(new CacHandler());
    this.handlers.push(new IncubationHandler());
    this.handlers.push(new OAuthHandler());
    this.handlers.push(new PluginsHandler());

    this.handlers.push(new IamAdminRouteHandler({ iam }));
    this.handlers.push(iam);
    if (isScimEnabled()) {
      this.handlers.push(new ScimRouteHandler({ iamStore: iam.getStore() }));
    }
  }


  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<boolean> {
    // Normalize /api/v1/* → /api/* so handler match() functions work with versioned client URLs.
    // We restore the original URL if no handler matches, so the inline handle() code in
    // dashboard-service.ts still sees the original URL for its own normalization + redirect logic.
    const originalUrl = req.url ?? "";
    if (originalUrl.startsWith("/api/v1/")) {
      (req as any).url = "/api/" + originalUrl.substring("/api/v1/".length);
    }
    for (const handler of this.handlers) {
      if (handler.match(req)) {
        await handler.handle(req, res, service);
        return true;
      }
    }
    // No handler matched — restore original URL for inline handle() processing
    (req as any).url = originalUrl;

    // Backward-compat: redirect unversioned GET /api/<path> to /api/v1/<path> if unhandled
    const method = req.method?.toUpperCase() ?? "GET";
    if (method === "GET" && originalUrl.startsWith("/api/") && !originalUrl.startsWith("/api/v1/")) {
      const redirectedPath = "/api/v1/" + originalUrl.substring("/api/".length);
      res.writeHead(301, {
        "Location": redirectedPath,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(`Redirecting to ${redirectedPath}`);
      return true;
    }

    return false;
  }
}
