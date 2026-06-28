import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { join, basename } from "node:path";
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

export class ModelHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = (req.url ?? "").split("?")[0];
    const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
    return normalized.startsWith("/api/models/");
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    // ── Local GGUF Model Scanning ──────────────────────────────────────
    if (method === "GET" && url === "/api/models/gguf") {
      try {
        console.log(`[PRISM][models] GGUF request: scanning for local models...`);
        const models: Array<{ name: string; path: string; source: string }> = [];
        const searchPaths = [
          { path: join(process.cwd(), "models"), source: "workspace-models" },
          { path: join(homedir(), ".ollama", "models"), source: "ollama" },
        ];

        for (const entry of searchPaths) {
          console.log(`[PRISM][models] Scanning path: ${entry.path}`);
          service.scanForGgufs(entry.path, entry.source, models);
        }

        // Add Ollama API results
        const ollamaModels = await (service as any).fetchOllamaTags();
        for (const om of ollamaModels) {
          models.push({ name: om.name, path: om.name, source: om.source });
        }

        return this.json(res, 200, { models });
      } catch (err: any) {
        return this.json(res, 500, { error: err.message });
      }
    }

    // ── Download Status ────────────────────────────────────────────────
    if (method === "GET" && url === "/api/models/download/status") {
      return this.json(res, 200, { downloads: Array.from(service.getDownloadStatus().values()) });
    }

    // ── Initiate Download ──────────────────────────────────────────────
    if (method === "POST" && url === "/api/models/download") {
      const body = await (service as any).readBody(req);
      const { url: dlUrl, name, mmprojUrl, mmprojName } = JSON.parse(body);
      if (!dlUrl || !name) return this.json(res, 400, { error: "Missing url or name" });

      const modelsDir = join(process.cwd(), "models");
      if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true });

      const modelId = randomUUID();
      service.getDownloadStatus().set(modelId, {
        id: modelId,
        url: dlUrl,
        fileName: name,
        status: "pending",
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        startTime: new Date().toISOString()
      });

      (service as any).downloadFile(modelId, dlUrl, join(modelsDir, name)).catch(() => { });

      if (mmprojUrl && mmprojName) {
        const mmId = randomUUID();
        service.getDownloadStatus().set(mmId, {
          id: mmId,
          url: mmprojUrl,
          fileName: mmprojName,
          status: "pending",
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          startTime: new Date().toISOString()
        });
        (service as any).downloadFile(mmId, mmprojUrl, join(modelsDir, mmprojName)).catch(() => { });
      }

      return this.json(res, 200, { message: "Downloads initiated", modelId });
    }

    // ── Ollama Pull ────────────────────────────────────────────────────
    if (method === "POST" && url === "/api/models/pull") {
      try {
        const body = await service.readJsonBody<{ tag: string }>(req);
        const tag = body?.tag;
        if (!tag || typeof tag !== "string" || !/^[\w.:\/-]+$/.test(tag)) {
          return this.json(res, 400, { error: "Invalid or missing Ollama tag" });
        }
        const pullId = randomUUID();
        service.getDownloadStatus().set(pullId, {
          id: pullId,
          url: `ollama://${tag}`,
          fileName: tag,
          status: "downloading",
          progress: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          startTime: new Date().toISOString(),
        });
        const { exec: execCb } = await import("node:child_process");
        execCb(`ollama pull ${tag}`, { timeout: 600000 }, (err, _stdout, stderr) => {
          const status = service.getDownloadStatus().get(pullId);
          if (!status) return;
          if (err) {
            status.status = "error";
            status.error = stderr?.trim() || err.message;
          } else {
            status.status = "completed";
            status.progress = 100;
          }
        });
        return this.json(res, 200, { message: "Ollama pull initiated", pullId });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Delete Model ───────────────────────────────────────────────────
    if (method === "DELETE" && url === "/api/models/delete") {
      try {
        const body = await service.readJsonBody<{ path: string; source: string }>(req);
        if (!body?.path || !body?.source) {
          return this.json(res, 400, { error: "Missing path or source" });
        }

        const { path: modelPath, source } = body;

        if (source === "ollama") {
          const { exec: execCb } = await import("node:child_process");
          await new Promise((resolve, reject) => {
            execCb(`ollama rm ${modelPath}`, { timeout: 60000 }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr?.trim() || err.message));
              else resolve(stdout);
            });
          });
          return this.json(res, 200, { message: `Ollama model ${modelPath} removed successfully` });
        } else {
          if (!existsSync(modelPath)) {
            return this.json(res, 404, { error: "Model file not found on disk" });
          }
          if (statSync(modelPath).isDirectory()) {
            return this.json(res, 400, { error: "Path is a directory, not a file" });
          }
          unlinkSync(modelPath);
          return this.json(res, 200, { message: `Model file ${basename(modelPath)} deleted successfully` });
        }
      } catch (error: any) {
        return this.json(res, 500, { error: error.message || String(error) });
      }
    }

    // ── Custom Recommended Models ──────────────────────────────────────
    if (method === "GET" && url === "/api/models/recommended") {
      return this.json(res, 200, { custom: service.customRecommendedModels });
    }

    if (method === "POST" && url === "/api/models/recommended") {
      try {
        const body = await service.readJsonBody<{ name: string; fileName: string; path: string; source: string }>(req);
        if (!body?.fileName || !body?.path) {
          return this.json(res, 400, { error: "Missing fileName or path" });
        }
        if (service.customRecommendedModels.some(m => m.fileName === body.fileName)) {
          return this.json(res, 409, { error: "Model already in recommended list" });
        }
        let sizeStr = "unknown";
        try {
          const st = statSync(body.path);
          const gb = st.size / (1024 * 1024 * 1024);
          sizeStr = gb >= 1 ? gb.toFixed(1) + " GB" : (st.size / (1024 * 1024)).toFixed(0) + " MB";
        } catch { /* file may be remote/ollama */ }
        service.customRecommendedModels.push({
          name: body.name || body.fileName.replace(/\.gguf$/i, ""),
          fileName: body.fileName,
          size: sizeStr,
          path: body.path,
          source: body.source || "workspace",
          addedAt: new Date().toISOString(),
        });
        service.saveCustomRecommendedModels();
        return this.json(res, 200, { custom: service.customRecommendedModels });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "DELETE" && url === "/api/models/recommended") {
      try {
        const body = await service.readJsonBody<{ fileName: string }>(req);
        if (!body?.fileName) return this.json(res, 400, { error: "Missing fileName" });
        service.customRecommendedModels = service.customRecommendedModels.filter(m => m.fileName !== body.fileName);
        service.saveCustomRecommendedModels();
        return this.json(res, 200, { custom: service.customRecommendedModels });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    // ── Model Matrix Management ────────────────────────────────────────
    if (method === "GET" && url.startsWith("/api/models/matrix")) {
      try {
        const parsed = new URL(url, "http://localhost");
        const summaryOnly = parsed.searchParams.get("summary") === "true";

        const now = Date.now();
        const cache = service.getModelMatrixCache();
        if (cache && (now - cache.ts) < 30_000 && !summaryOnly) {
          return this.json(res, 200, cache.matrix);
        }

        const startMs = Date.now();
        const matrix = service.getLlmProviders().getFullModelMatrix();
        const dur = Date.now() - startMs;
        if (dur > 500) console.warn(`[PERF] getFullModelMatrix took ${dur}ms`);
        if (summaryOnly) {
          const resp = {
            knownCount: (matrix.known || []).length,
            runtimeCount: (matrix.runtime || []).length,
            deprecatedCount: (matrix.deprecated || []).length,
            promptStrategiesCount: (matrix.promptStrategies || []).length,
          };
          return this.json(res, 200, resp);
        }

        service.setModelMatrixCache({ ts: now, matrix });
        return this.json(res, 200, matrix);
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "PUT" && url === "/api/models/matrix") {
      try {
        const body = await service.readJsonBody<any>(req);
        if (!body.pattern?.trim()) {
          return this.json(res, 400, { error: "pattern is required." });
        }
        service.getLlmProviders().registerModel(body as any);
        service.getChatStore().upsertModelProfile(body as any);
        return this.json(res, 200, { registered: body.pattern });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "POST" && url === "/api/models/matrix/refresh") {
      try {
        const catalog = await service.getLlmProviders().getCatalog(undefined, true);
        const enabledProviders = catalog.providers.filter((p: any) => p.enabled);
        const results: Array<{ providerId: string; known: string[]; unknown: string[]; suggested: number }> = [];
        for (const provider of enabledProviders) {
          try {
            const disc = await service.getLlmProviders().discoverProviderModels(provider.id);
            for (const profile of disc.suggested) {
              service.getChatStore().upsertModelProfile(profile);
            }
            results.push({ providerId: provider.id, known: disc.known, unknown: disc.unknown, suggested: disc.suggested.length });
          } catch {
            results.push({ providerId: provider.id, known: [], unknown: [], suggested: 0 });
          }
        }
        const matrix = service.getLlmProviders().getFullModelMatrix();
        return this.json(res, 200, { refreshed: true, providers: results, matrix });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "DELETE" && url.startsWith("/api/models/matrix/")) {
      try {
        const pattern = decodeURIComponent(url.slice("/api/models/matrix/".length));
        const removed = service.getLlmProviders().removeModel(pattern);
        service.getChatStore().removeModelProfile(pattern);
        return this.json(res, 200, { removed, pattern });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    if (method === "GET" && url.startsWith("/api/models/discover/")) {
      try {
        const providerId = decodeURIComponent(url.slice("/api/models/discover/".length));
        const result = await service.getLlmProviders().discoverProviderModels(providerId);
        return this.json(res, 200, {
          models: result.models,
          known: result.known,
          unknown: result.unknown,
          suggested: result.suggested,
        });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/models/deprecated") {
      try {
        const matrix = service.getLlmProviders().getFullModelMatrix();
        return this.json(res, 200, { deprecated: matrix.deprecated });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    if (method === "GET" && url === "/api/models/prompt-strategies") {
      try {
        const matrix = service.getLlmProviders().getFullModelMatrix();
        return this.json(res, 200, { strategies: matrix.promptStrategies });
      } catch (error) {
        return this.json(res, 500, { error: String(error) });
      }
    }

    this.json(res, 404, { error: "Not found" });
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data, null, 2));
  }
}
