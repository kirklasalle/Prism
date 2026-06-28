/**
 * LLM route handler — extracted from dashboard-service.ts (Phase 2).
 *
 * Handles all /api/llm/* endpoints:
 *   - Provider settings CRUD
 *   - Provider secret management
 *   - Provider health testing
 *   - LLM catalog (session-bound + session-independent)
 *   - Model selection (session + global)
 *   - Config draft/apply/rollback
 *   - Model routing (roles + modalities)
 *   - Model profiles
 *   - Audit trail
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { writePreferences } from "../../config/workspace-resolver.js";

export class LlmHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized.startsWith("/api/llm/");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    // ── Provider Settings ──────────────────────────────────────────────

    if (method === "GET" && url.startsWith("/api/llm/provider-settings")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const providerId = parsed.searchParams.get("providerId")?.trim();
        if (!providerId) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        return this.json(res, 200, await service.getProviderSettings(providerId));
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/provider-settings") {
      try {
        const body = await service.readJsonBody<{
          providerId?: string;
          baseUrl?: string;
          apiKeyHeader?: string;
          models?: string[];
          defaultModel?: string;
        }>(req);
        if (!body.providerId?.trim()) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        const payload = await service.saveProviderSettings(
          body.providerId,
          {
            baseUrl: body.baseUrl ?? null,
            apiKeyHeader: body.apiKeyHeader ?? null,
            models: Array.isArray(body.models) ? body.models : [],
            defaultModel: body.defaultModel ?? null,
          },
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Provider Secrets ───────────────────────────────────────────────

    if (method === "POST" && url === "/api/llm/provider-secret") {
      try {
        const body = await service.readJsonBody<{ providerId?: string; apiKey?: string }>(req);
        if (!body.providerId?.trim()) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        if (!body.apiKey?.trim()) {
          return this.json(res, 400, { error: "apiKey is required." });
        }
        const payload = await service.saveProviderApiKey(
          body.providerId,
          body.apiKey,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "DELETE" && url.startsWith("/api/llm/provider-secret")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const providerId = parsed.searchParams.get("providerId")?.trim();
        if (!providerId) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        const payload = await service.clearProviderApiKey(
          providerId,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Provider Testing ──────────────────────────────────────────────

    if (method === "POST" && url === "/api/llm/provider-test") {
      try {
        const body = await service.readJsonBody<{ providerId?: string; apiKey?: string }>(req);
        if (!body.providerId?.trim()) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        if (body.apiKey?.trim()) {
          await service.saveProviderApiKey(body.providerId, body.apiKey.trim(), "provider-test");
        }
        const result = await service.getLlmProviders().testProvider(body.providerId);
        if (result.ok && result.models.length > 0) {
          const current = await service.getProviderSettings(body.providerId);
          await service.saveProviderSettings(
            body.providerId,
            {
              baseUrl: current.baseUrl ?? null,
              apiKeyHeader: current.apiKeyHeader ?? null,
              models: result.models,
              defaultModel: current.defaultModel ?? null,
            },
            "provider-test",
          );
        }
        return this.json(res, 200, result);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/llm/provider-health") {
      try {
        const results = await service.getLlmProviders().testAllProviders();
        return this.json(res, 200, { providers: results, timestamp: new Date().toISOString() });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Catalog ───────────────────────────────────────────────────────

    // Session-independent provider catalog (for settings tab, no session required)
    if (method === "GET" && url.startsWith("/api/llm/catalog")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const refresh = parsed.searchParams.get("refresh") === "true";
        const catalog = await service.getLlmProviders().getCatalog(undefined, refresh);
        return this.json(res, 200, catalog);
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/llm/providers")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const sessionId = parsed.searchParams.get("sessionId")?.trim();
        if (!sessionId) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        const refresh = parsed.searchParams.get("refresh") === "true";
        const catalog = await service.getSessionLlmCatalog(sessionId, refresh);
        return this.json(res, 200, catalog);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Selection ─────────────────────────────────────────────────────

    if (method === "POST" && url === "/api/llm/select") {
      try {
        const body = await service.readJsonBody<{ sessionId?: string; providerId?: string; model?: string }>(req);
        if (!body.providerId?.trim()) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        const sessionId = body.sessionId?.trim();
        if (sessionId && sessionId !== "system") {
          const catalog = await service.setSessionLlmSelection(
            sessionId,
            body.providerId,
            body.model,
            req.headers["x-prism-source"]?.toString() || "dashboard_api",
          );
          return this.json(res, 200, catalog);
        } else {
          await service.getLlmProviders().setActiveSelection(body.providerId, body.model ?? undefined);
          try {
            writePreferences({
              activeLlmProviderId: body.providerId,
              activeLlmModel: body.model ?? undefined,
            });
          } catch (_) { /* non-fatal */ }
          const catalog = await service.getLlmProviders().getCatalog({
            providerId: body.providerId,
            model: body.model ?? undefined,
          });
          service.getActivityBus().emit({
            sessionId: "system",
            layer: "causal",
            operation: "dashboard.global_llm_selected",
            status: "succeeded",
            details: {
              providerId: body.providerId,
              model: body.model ?? null,
              source: req.headers["x-prism-source"]?.toString() || "dashboard_api",
            },
          });
          return this.json(res, 200, catalog);
        }
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Config State ──────────────────────────────────────────────────

    if (method === "GET" && url.startsWith("/api/llm/config")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const sessionId = parsed.searchParams.get("sessionId")?.trim();
        if (!sessionId) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        return this.json(res, 200, service.getSessionLlmConfigState(sessionId));
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/config/draft") {
      try {
        const body = await service.readJsonBody<{ sessionId?: string; providerId?: string; model?: string }>(req);
        if (!body.sessionId?.trim()) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        if (!body.providerId?.trim()) {
          return this.json(res, 400, { error: "providerId is required." });
        }
        const config = await service.saveSessionLlmConfigDraft(
          body.sessionId,
          body.providerId,
          body.model,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, config);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "DELETE" && url.startsWith("/api/llm/config/draft")) {
      try {
        const parsed = new URL(`http://localhost${url}`);
        const sessionId = parsed.searchParams.get("sessionId")?.trim();
        if (!sessionId) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        return this.json(res, 200, service.discardSessionLlmConfigDraft(sessionId));
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/config/apply") {
      try {
        const body = await service.readJsonBody<{ sessionId?: string }>(req);
        if (!body.sessionId?.trim()) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        const payload = await service.applySessionLlmConfigDraft(
          body.sessionId,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/config/rollback") {
      try {
        const body = await service.readJsonBody<{ sessionId?: string }>(req);
        if (!body.sessionId?.trim()) {
          return this.json(res, 400, { error: "sessionId is required." });
        }
        const payload = await service.rollbackSessionLlmConfig(
          body.sessionId,
          req.headers["x-prism-source"]?.toString() || "dashboard_api",
        );
        return this.json(res, 200, payload);
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // ── Model Routing ─────────────────────────────────────────────────

    if (method === "GET" && url === "/api/llm/routing") {
      try {
        const config = service.getLlmProviders().getRoutingConfig();
        const suggestions = await service.getLlmProviders().suggestRoutingForAllRoles();
        const modalitySuggestions = await service.getLlmProviders().suggestRoutingForAllModalities();
        const modalities = await service.getLlmProviders().getModalitySummary();
        return this.json(res, 200, { config, suggestions, modalitySuggestions, modalities });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/llm/routing") {
      try {
        const body = await service.readJsonBody<any>(req);
        service.getLlmProviders().setRoutingConfig(body);
        const config = service.getLlmProviders().getRoutingConfig();
        return this.json(res, 200, { config });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/llm/routing/suggest")) {
      try {
        const parsedUrl = new URL(url, "http://localhost");
        const providerId = parsedUrl.searchParams.get("providerId") || "";
        const suggestions = await service.getLlmProviders().suggestRoutingForAllRoles(providerId);
        return this.json(res, 200, { suggestions });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Model Profiles ────────────────────────────────────────────────

    if (method === "GET" && url === "/api/llm/model-profiles") {
      try {
        const profiles = await service.getLlmProviders().getModelProfiles();
        return this.json(res, 200, { profiles });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Audit Trail ───────────────────────────────────────────────────
    // Return recent LLM-related activity events as structured audit entries.
    // Accept both versioned and non-versioned URL forms.
    if (method === "GET" && (url === "/api/llm/audit-trail" || rawUrl === "/api/v1/llm/audit-trail")) {
      try {
        // Allow optional sessionId filter and limit
        const parsed = new URL(`http://localhost${rawUrl.startsWith('/api/v1/') ? rawUrl : url}`);
        const sessionId = parsed.searchParams.get("sessionId") || "";
        const limit = Math.min(200, Number(parsed.searchParams.get("limit") || "100"));

        // Pull events from ActivityBus and filter LLM-related operations
        const events = service.getActivityBus().listEvents();
        const candidates = events
          .filter((e) => {
            if (sessionId && e.sessionId !== sessionId) return false;
            // include llm-related events and dashboard.llm_selection audit events
            return (typeof e.operation === 'string' && (e.operation.includes('llm') || e.operation.startsWith('dashboard.llm')));
          })
          .slice(-limit)
          .map((e) => ({ timestamp: e.timestamp, action: e.operation, detail: e.details }));

        return this.json(res, 200, candidates);
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Modalities ────────────────────────────────────────────────────

    if (method === "GET" && url === "/api/llm/modalities") {
      try {
        const modalities = await service.getLlmProviders().getModalitySummary();
        return this.json(res, 200, { modalities });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // Fallback — no route matched within this handler
    this.json(res, 404, { error: "Not found" });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
