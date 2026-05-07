import type { IncomingMessage, ServerResponse } from "node:http";
import { DashboardService } from "../dashboard-service.js";
import { IRouteHandler } from "./types.js";
import { DashboardHandler } from "./dashboard-handler.js";
import { SetupHandler } from "./setup-handler.js";
import { ApiHandler } from "./api-handler.js";
import { SchedulerHandler } from "./scheduler-handler.js";
import { WorkspaceHandler } from "./workspace-handler.js";
import { TooltipsHandler } from "./tooltips-handler.js";
import { OpenAiCompatHandler } from "./openai-compat-handler.js";
import { IamRouteHandler, isEnterpriseIamEnabled } from "./iam-handler.js";
import { IamAdminRouteHandler } from "./iam-admin-handler.js";
import { ScimRouteHandler, isScimEnabled } from "./scim-handler.js";

export * from "./types.js";
export * from "./dashboard-handler.js";
export * from "./setup-handler.js";
export * from "./api-handler.js";
export * from "./scheduler-handler.js";
export * from "./workspace-handler.js";
export * from "./tooltips-handler.js";
export * from "./openai-compat-handler.js";
export * from "./iam-handler.js";
export * from "./iam-admin-handler.js";
export * from "./scim-handler.js";

export class Router {
  private handlers: IRouteHandler[] = [];

  constructor() {
    this.handlers.push(new DashboardHandler());
    this.handlers.push(new SetupHandler());
    this.handlers.push(new WorkspaceHandler());
    this.handlers.push(new SchedulerHandler());
    this.handlers.push(new TooltipsHandler());
    this.handlers.push(new ApiHandler());
    // OpenAI Assistants API compatibility surface (/v1/*). Auth is enforced
    // by the upstream AuthGate before dispatch reaches this handler.
    this.handlers.push(new OpenAiCompatHandler());
    // Enterprise IAM routes (/api/iam/*) — only registered when the
    // PRISM_ENTERPRISE_IAM=on flag is set. The legacy single-admin-token
    // auth path is the only gate when both flags are absent. SCIM
    // shares the IAM store so user/role state is consistent.
    if (isEnterpriseIamEnabled()) {
      const iam = new IamRouteHandler();
      // Admin handler MUST come before the general IAM handler so
      // `/api/iam/admin/*` doesn't fall through to the catch-all
      // `/api/iam/` matcher and 404.
      this.handlers.push(new IamAdminRouteHandler({ iam }));
      this.handlers.push(iam);
      if (isScimEnabled()) {
        this.handlers.push(new ScimRouteHandler({ iamStore: iam.getStore() }));
      }
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
    return false;
  }
}
