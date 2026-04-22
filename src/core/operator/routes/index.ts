import type { IncomingMessage, ServerResponse } from "node:http";
import { DashboardService } from "../dashboard-service.js";
import { IRouteHandler } from "./types.js";
import { DashboardHandler } from "./dashboard-handler.js";
import { SetupHandler } from "./setup-handler.js";
import { ApiHandler } from "./api-handler.js";

export * from "./types.js";
export * from "./dashboard-handler.js";
export * from "./setup-handler.js";
export * from "./api-handler.js";

export class Router {
  private handlers: IRouteHandler[] = [];

  constructor() {
    this.handlers.push(new DashboardHandler());
    this.handlers.push(new SetupHandler());
    this.handlers.push(new ApiHandler());
  }


  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<boolean> {
    for (const handler of this.handlers) {
      if (handler.match(req)) {
        await handler.handle(req, res, service);
        return true;
      }
    }
    return false;
  }
}
