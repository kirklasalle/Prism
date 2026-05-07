import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardService } from "../dashboard-service.js";

export interface IRouteHandler {
  match(req: IncomingMessage): boolean;
  handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void>;
}

export interface RouteContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body?: any;
}
