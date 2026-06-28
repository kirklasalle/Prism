import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";

export class IncubationHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized.startsWith("/api/incubation/");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    const inc = await service.getIncubation();
    if (!inc.enabled) {
      return this.json(res, 503, {
        error: "incubation_disabled",
        message: "Set PRISM_INCUBATION=on to enable Novel Systems prototypes.",
        prototype: true,
      });
    }

    // 1. POST /api/incubation/ccc/compile
    if (method === "POST" && url === "/api/incubation/ccc/compile") {
      try {
        const body = await service.readJsonBody<{
          dag?: { id?: string; name?: string; steps?: unknown[]; fallbacks?: unknown[] };
          profileSegment?: "individual" | "business";
        }>(req);
        if (!body?.dag || !Array.isArray(body.dag.steps)) {
          return this.json(res, 400, { error: "dag.steps required", prototype: true });
        }
        const { INDIVIDUAL_PROFILE: ind, BUSINESS_PROFILE: biz } = await import("../../policy/execution-profiles.js");
        const profile = body.profileSegment === "business" ? biz : ind;
        const dag = {
          id: body.dag.id ?? "ad-hoc",
          name: body.dag.name ?? "ad-hoc",
          steps: body.dag.steps as Array<import("../../runtime/workflow.js").WorkflowStep>,
          fallbacks: (body.dag.fallbacks ?? []) as Array<import("../../runtime/workflow.js").WorkflowFallback>,
        };
        const plan = inc.compiler.compile(dag, { profile, constitution: inc.constitution });
        return this.json(res, 200, { plan, prototype: true });
      } catch (error) {
        return this.json(res, 500, { error: String(error), prototype: true });
      }
    }

    // 2. GET /api/incubation/ccc/constitutions
    if (method === "GET" && url === "/api/incubation/ccc/constitutions") {
      return this.json(res, 200, { constitutions: [inc.constitution], prototype: true });
    }

    // 3. POST /api/incubation/dlma/query
    if (method === "POST" && url === "/api/incubation/dlma/query") {
      try {
        const body = await service.readJsonBody<{ text?: string; k?: number }>(req);
        if (!body?.text) {
          return this.json(res, 400, { error: "text required", prototype: true });
        }
        const result = inc.arbiter.query(body.text, body.k ?? 5);
        return this.json(res, 200, { ...result, prototype: true });
      } catch (error) {
        return this.json(res, 500, { error: String(error), prototype: true });
      }
    }

    // 4. GET /api/incubation/dlma/weights
    if (method === "GET" && url === "/api/incubation/dlma/weights") {
      return this.json(res, 200, { weights: inc.arbiter.getWeights(), prototype: true });
    }

    // 5. POST /api/incubation/shws/propose
    if (method === "POST" && url === "/api/incubation/shws/propose") {
      try {
        const body = await service.readJsonBody<{
          failedStepId?: string;
          dag?: { id?: string; name?: string; steps?: unknown[]; fallbacks?: unknown[] };
          profileSegment?: "individual" | "business";
        }>(req);
        if (!body?.failedStepId || !body?.dag || !Array.isArray(body.dag.steps)) {
          return this.json(res, 400, { error: "failedStepId and dag.steps required", prototype: true });
        }
        const { INDIVIDUAL_PROFILE: ind, BUSINESS_PROFILE: biz } = await import("../../policy/execution-profiles.js");
        const profile = body.profileSegment === "business" ? biz : ind;
        const dag = {
          id: body.dag.id ?? "ad-hoc",
          name: body.dag.name ?? "ad-hoc",
          steps: body.dag.steps as Array<import("../../runtime/workflow.js").WorkflowStep>,
          fallbacks: (body.dag.fallbacks ?? []) as Array<import("../../runtime/workflow.js").WorkflowFallback>,
        };
        const candidate = inc.synthesizer.proposeFallback({
          failedStepId: body.failedStepId,
          dag,
          profile,
          constitution: inc.constitution,
        });
        return this.json(res, 200, { candidate, prototype: true });
      } catch (error) {
        return this.json(res, 500, { error: String(error), prototype: true });
      }
    }

    // 6. GET /api/incubation/shws/recent-syntheses
    if (method === "GET" && url === "/api/incubation/shws/recent-syntheses") {
      return this.json(res, 200, {
        recent: inc.synthesizer.getRecentCandidates(20),
        stats: inc.synthesizer.getStats(),
        prototype: true,
      });
    }

    return this.json(res, 404, { error: "incubation route not found", prototype: true });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
