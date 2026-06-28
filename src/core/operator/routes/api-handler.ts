import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { resolveWorkspaceRoot, writePreferences } from "../../config/workspace-resolver.js";
import { PRISM_VERSION } from "../../version.js";
import {
  DIRECTIVE_SHA256,
  DIRECTIVE_HASH_LAST_GENERATED_AT,
  verifyDirectiveIntegrity,
} from "../../security/directive-integrity.js";
import { probeOptionalDeps, summarizeOptionalDeps } from "../../system/optional-deps.js";
import { resolveProfile, getCachedHardwareSnapshot, fetchHardwareSnapshot, updateCachedHardwareSnapshot } from "../model-capability-matrix.js";
import { generateOpenApiSpec } from "../openapi-generator.js";

export class ApiHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    const method = req.method?.toUpperCase() ?? "GET";
    if (method === "GET" && (
      url === "/api/health" || url === "/health" ||
      url === "/api/health/extended" ||
      url === "/api/status" ||
      url === "/api/system/adapters" ||
      url === "/api/system/hardware" ||
      url === "/api/skills" ||
      pathname === "/api/llre/summary" ||
      url === "/api/openapi.json" ||
      url === "/api/v1/openapi.json" ||
      url === "/api/mcp/servers"
    )) return true;
    if (method === "POST" && (
      url === "/api/mode" ||
      url === "/api/system/shutdown" ||
      /^\/api\/mcp\/servers\/[^/]+\/reconnect$/.test(url)
    )) return true;
    return false;
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    // Normalize /api/v1/* → /api/* for consistent handler matching
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    if (method === "POST" && url === "/api/system/shutdown") {
      console.log("[PRISM][system] [INFO] Received shutdown signal from dashboard operator. Initiating graceful termination...");
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ success: true, message: "Graceful shutdown sequence initialized by operator console." }));
      setTimeout(() => {
        process.kill(process.pid, "SIGTERM");
      }, 500);
      return;
    }

    if (method === "GET" && (rawUrl === "/api/v1/openapi.json" || url === "/api/openapi.json")) {
      this.json(res, 200, generateOpenApiSpec(service.getPort()));
      return;
    }

    if (method === "GET" && url === "/api/mcp/servers") {
      const adapter = service.mcpAdapter;
      if (!adapter) {
        this.json(res, 200, { servers: [], attached: false });
        return;
      }
      this.json(res, 200, {
        servers: adapter.getServerStates(),
        attached: true,
      });
      return;
    }

    if (method === "POST" && /^\/api\/mcp\/servers\/[^/]+\/reconnect$/.test(url)) {
      const adapter = service.mcpAdapter;
      if (!adapter) {
        this.json(res, 503, { error: "MCP adapter not attached" });
        return;
      }
      const name = decodeURIComponent(url.split("/")[4] ?? "");
      if (!name) {
        this.json(res, 400, { error: "Missing server name" });
        return;
      }
      const result = await adapter.forceReconnect(name);
      this.json(res, result.ok ? 200 : 502, result);
      return;
    }

    if (method === "GET" && url === "/api/skills") {
      const skillsEngine = service.getSkillsEngine();
      if (!skillsEngine) {
        this.json(res, 503, { error: "Skills engine not available" });
        return;
      }
      const loaded = skillsEngine.getLoadedSkills();
      const skills = loaded.map(sk => ({
        name: sk.name,
        id: sk.id,
        version: sk.version,
        description: sk.description,
        tags: sk.tags,
        tier: sk.governance?.min_policy_tier || "tier2_conditional",
        workflow: {
          steps: (sk.workflow?.steps || []).map(st => ({
            id: st.id,
            name: st.name,
            tool: st.tools?.join(", ") || "",
            action: st.action
          }))
        },
        group: sk.tags[0] || "General",
        status: "Active",
        trust: "high"
      }));
      this.json(res, 200, { skills });
      return;
    }

    if (method === "GET" && (url === "/api/health" || url === "/health")) {
      const dbOk = this.checkDb(service);
      const providerCount = service.getChatStore().listProviderSettings().length;
      const directive = verifyDirectiveIntegrity();
      const optionalDeps = await probeOptionalDeps();
      const depSummary = summarizeOptionalDeps(optionalDeps);
      const isProduction = (process.env.NODE_ENV ?? "").toLowerCase() === "production";
      const jwtSecretLen = (process.env.PRISM_JWT_SECRET ?? "").length;
      const authDisabled = (process.env.PRISM_AUTH_DISABLED ?? "").toLowerCase() === "true";
      const overallOk = dbOk && directive.valid && (!isProduction || (jwtSecretLen >= 32 && !authDisabled));

      this.json(res, overallOk ? 200 : 503, {
        status: overallOk ? "ok" : "degraded",
        version: PRISM_VERSION,
        uptime: Math.floor(process.uptime()),
        sessionId: service.getRuntimeStatus().sessionId,
        mode: service.getRuntimeStatus().mode,
        nodeEnv: process.env.NODE_ENV ?? "development",
        dependencies: {
          db: dbOk ? "ok" : "unavailable",
          providers: providerCount,
          pending_approvals: service.getApprovalQueue().list().length,
        },
        directive: {
          valid: directive.valid,
          expectedHash: directive.expectedHash,
          currentHash: directive.currentHash,
          hashGeneratedAt: DIRECTIVE_HASH_LAST_GENERATED_AT,
          filePath: directive.filePath,
          error: directive.error ?? null,
        },
        optionalDeps: {
          summary: depSummary,
          modules: optionalDeps,
        },
        security: {
          productionMode: isProduction,
          authDisabled,
          jwtSecretConfigured: jwtSecretLen >= 32,
          jwtSecretLength: jwtSecretLen,
        },
      });
      // Reference DIRECTIVE_SHA256 to ensure the import is retained even if
      // tree-shaking changes downstream — the constant must always load.
      void DIRECTIVE_SHA256;
      return;
    }

    if (method === "GET" && url === "/api/health/extended") {
      // R6-2 — Health widget endpoint. Auth-gated (this handler is mounted
      // behind the dashboard auth chain via the standard route table); the
      // payload exposes per-process counters that the dashboard's Health
      // card polls every 10 s. Public surface stays `/api/health` and
      // `/metrics`.
      const mem = process.memoryUsage();
      const dbSize = this.measureWorkspaceDbSize();
      const status = service.getRuntimeStatus();
      const startedAtMs = Date.parse(status.startedAt);
      const uptimeS = Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) : Math.floor(process.uptime());
      this.json(res, 200, {
        status: "ok",
        version: PRISM_VERSION,
        uptimeS,
        process: {
          heapMb: Math.round((mem.heapUsed / 1_048_576) * 100) / 100,
          heapTotalMb: Math.round((mem.heapTotal / 1_048_576) * 100) / 100,
          rssMb: Math.round((mem.rss / 1_048_576) * 100) / 100,
          externalMb: Math.round((mem.external / 1_048_576) * 100) / 100,
        },
        sessions: service.getChatStore().listSessions().length,
        pendingApprovals: service.getApprovalQueue().list().length,
        dbSizeMb: dbSize,
        nodeEnv: process.env.NODE_ENV ?? "development",
        baseMode: process.env.PRISM_BASE_MODE === "true",
        baseModeAuto: process.env.PRISM_BASE_MODE_AUTO === "true",
      });
      return;
    }

    if (method === "GET" && url === "/api/status") {
      const events = service.getActivityBus().listEvents();
      const principal = service.getIamHandler().resolvePrincipalFromCookie(req);
      const authDisabled = (process.env.PRISM_AUTH_DISABLED ?? "").toLowerCase() === "true";
      const isAdmin = authDisabled || (principal ? principal.roles.includes("admin") : true);

      const allSessions = service.getChatStore().listSessions();
      const chatSessionCount = (!isAdmin && principal)
        ? allSessions.filter(s => s.operatorEmail === principal.email).length
        : allSessions.length;

      this.json(res, 200, {
        ...service.getRuntimeStatus(),
        uptimeSeconds: Math.floor((Date.now() - Date.parse(service.getRuntimeStatus().startedAt)) / 1000),
        pendingApprovals: service.getApprovalQueue().list().length,
        chatSessionCount,
        eventCount: events.length,
        lastEvent: events[events.length - 1] ?? null,
        workspaceRoot: resolveWorkspaceRoot(),
        baseMode: process.env.PRISM_BASE_MODE === "true",
        baseModeAuto: process.env.PRISM_BASE_MODE_AUTO === "true",
        nodeVersion: process.version,
        platform: process.platform + " " + process.arch,
      });
      return;
    }

    if (method === "POST" && url === "/api/mode") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body) as { baseMode?: boolean | "auto" };
          let targetBaseMode = false;
          let isAuto = false;
          let powerMode: "performance" | "eco" | "adaptive" = "performance";

          if (parsed.baseMode === "auto") {
            isAuto = true;
            process.env.PRISM_BASE_MODE_AUTO = "true";
            powerMode = "adaptive";

            // Resolve the current active model from LLM Catalog
            const catalog = await service.getLlmProviders().getCatalog();
            if (catalog.activeModel) {
              const profile = resolveProfile(catalog.activeModel);
              targetBaseMode = profile.locality === "local" && profile.tier <= 2;
            }
          } else {
            isAuto = false;
            process.env.PRISM_BASE_MODE_AUTO = "false";
            targetBaseMode = parsed.baseMode ?? false;
            powerMode = targetBaseMode ? "eco" : "performance";
          }

          process.env.PRISM_BASE_MODE = targetBaseMode ? "true" : "false";
          writePreferences({ powerMode });
          
          console.log(`[PRISM][paradigm] Paradigm dynamically switched by operator. baseMode = ${targetBaseMode} (auto = ${isAuto})`);
          
          const guardian = service.getGuardianAgent();
          if (guardian) {
            guardian.syncModeCatalog();
          }
          
          this.json(res, 200, { ok: true, baseMode: targetBaseMode, auto: isAuto });
        } catch (e: any) {
          this.json(res, 400, { error: e.message || "Invalid payload" });
        }
      });
      return;
    }

    if (method === "GET" && url === "/api/system/adapters") {
      const terminal = service.getTerminalAdapter();
      const container = service.getContainerAdapter();
      this.json(res, 200, {
        terminal: {
          enabled: terminal?.isPtyEnabled() ?? false,
          backend: terminal?.isPtyEnabled() ? "node-pty" : "child_process (fallback)",
        },
        container: {
          enabled: container?.isContainerRuntimeEnabled() ?? false,
          backend: container?.getRuntimeBackend() ?? "in-memory (fallback)",
        }
      });
      return;
    }

    if (method === "GET" && url === "/api/system/hardware") {
      try {
        // Try to refresh the cached hardware snapshot from Ollama
        let snapshot = getCachedHardwareSnapshot();
        if (!snapshot) {
          try {
            snapshot = await fetchHardwareSnapshot("http://localhost:11434");
          } catch {
            // Ollama not available
          }
        }

        let vramTotalMb = snapshot?.totalVramMb ?? 8192;
        if (!snapshot) {
          try {
            const nvOut = execSync("nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits", { timeout: 3000, encoding: "utf8" });
            const total = parseInt(nvOut.trim(), 10);
            if (total) vramTotalMb = total;
          } catch {
            try {
              const wmicOut = execSync("wmic path Win32_VideoController get AdapterRAM /format:csv", { timeout: 3000, encoding: "utf8" });
              const lines = wmicOut.trim().split(/\r?\n/).filter((l: string) => l.trim() && !l.startsWith("Node"));
              if (lines.length > 0) {
                const cols = lines[0].split(",");
                if (cols.length >= 2) {
                  const adapterRam = parseInt(cols[1], 10) || 0;
                  if (adapterRam) vramTotalMb = Math.round(adapterRam / 1048576);
                }
              }
            } catch {
              // fallback
            }
          }
        }

        const loadedModels: Array<{ name: string; sizeBytes: number; vramBytes: number }> = [];

        // 1. Add Ollama models
        if (snapshot?.loadedModels) {
          for (const m of snapshot.loadedModels) {
            loadedModels.push({
              name: m.name,
              sizeBytes: m.sizeBytes,
              vramBytes: m.vramBytes,
            });
          }
        }

        // 2. Add llama.cpp models
        const llamaSupervisor = service.getLlamaSupervisor();
        if (llamaSupervisor) {
          const slots = llamaSupervisor.getSnapshot();
          for (const slot of slots) {
            if (slot.status === "ready" && slot.modelPath) {
              try {
                let sizeBytes = 0;
                if (existsSync(slot.modelPath)) {
                  sizeBytes = statSync(slot.modelPath).size;
                }
                const isGpu = slot.gpuLayers === null || slot.gpuLayers > 0;
                const vramBytes = isGpu ? sizeBytes : 0;
                loadedModels.push({
                  name: slot.modelAlias || basename(slot.modelPath),
                  sizeBytes,
                  vramBytes,
                });
              } catch (_) {}
            }
          }
        }

        // 2b. Add Guardian Agent model if running/active
        const guardianAgent = service.getGuardianAgent();
        if (guardianAgent) {
          const gStatus = guardianAgent.getStatus();
          if (gStatus && (gStatus.state === "running" || gStatus.state === "healing" || gStatus.state === "starting") && gStatus.modelPath) {
            const alias = gStatus.modelAlias || basename(gStatus.modelPath);
            const exists = loadedModels.some(m => m.name === alias);
            if (!exists) {
              try {
                let sizeBytes = 0;
                if (existsSync(gStatus.modelPath)) {
                  sizeBytes = statSync(gStatus.modelPath).size;
                } else {
                  // Fallback estimate for dummy paths
                  sizeBytes = 1.5 * 1024 * 1024 * 1024;
                }
                const isGpu = gStatus.slotInfo?.gpuLayers === undefined || gStatus.slotInfo.gpuLayers === null || gStatus.slotInfo.gpuLayers > 0;
                const vramBytes = isGpu ? sizeBytes : 0;
                loadedModels.push({
                  name: alias,
                  sizeBytes,
                  vramBytes,
                });
              } catch (_) {}
            }
          }
        }

        // 3. Add BitNet.cpp models
        const bitnetSupervisor = service.getBitnetSupervisor();
        if (bitnetSupervisor) {
          const slots = bitnetSupervisor.getSnapshot();
          for (const slot of slots) {
            if (slot.status === "ready" && slot.modelPath) {
              try {
                let sizeBytes = 0;
                if (existsSync(slot.modelPath)) {
                  sizeBytes = statSync(slot.modelPath).size;
                }
                const isGpu = slot.gpuLayers === null || slot.gpuLayers > 0;
                const vramBytes = isGpu ? sizeBytes : 0;
                loadedModels.push({
                  name: slot.modelAlias || basename(slot.modelPath),
                  sizeBytes,
                  vramBytes,
                });
              } catch (_) {}
            }
          }
        }

        const usedVramMb = loadedModels.reduce(
          (sum, m) => sum + m.vramBytes / (1024 * 1024), 0,
        );
        const vramFreeMb = Math.max(0, vramTotalMb - usedVramMb);

        // Update global matrix VRAM cache
        const combinedSnapshot = {
          totalVramMb: vramTotalMb,
          loadedModels,
          estimatedFreeVramMb: vramFreeMb,
        };
        updateCachedHardwareSnapshot(combinedSnapshot);

        this.json(res, 200, {
          gpu: {
            vramTotalMb,
            vramUsedMb: Math.round(usedVramMb * 100) / 100,
            vramFreeMb: Math.round(vramFreeMb * 100) / 100,
            loadedModels: loadedModels.map(m => ({
              name: m.name,
              sizeMb: Math.round(m.sizeBytes / (1024 * 1024)),
              vramMb: Math.round(m.vramBytes / (1024 * 1024)),
            })),
          },
        });
      } catch (error) {
        this.json(res, 500, { error: String(error) });
      }
      return;
    }

    const pathname = url.split("?")[0];
    if (method === "GET" && pathname === "/api/llre/summary") {
      const searchParams = new URL(url, "http://localhost").searchParams;
      const sessionId = searchParams.get("sessionId") ?? "";

      const store = service.getActivityStore();
      if (!store || typeof (store as any).queryLlreTelemetry !== "function") {
        this.json(res, 503, { error: "LLRE activity store interface is not initialized." });
        return;
      }

      try {
        const rows = (store as any).queryLlreTelemetry(sessionId);
        if (!rows || rows.length === 0) {
          this.json(res, 200, {
            teq: 0.0,
            rsi: 0.0,
            csr: 0.0,
            tca: 0.0,
            costUsd: 0.0,
            count: 0
          });
          return;
        }

        let sumTeq = 0;
        let sumRsi = 0;
        let sumCsr = 0;
        let sumTca = 0;
        let sumCost = 0;

        for (const row of rows) {
          sumTeq += row.teq_score;
          sumRsi += row.rsi_score;
          sumCsr += row.csr_score;
          sumTca += row.tca_score;
          sumCost += row.cost_usd;
        }

        this.json(res, 200, {
          teq: sumTeq / rows.length,
          rsi: sumRsi / rows.length,
          csr: sumCsr / rows.length,
          tca: sumTca / rows.length,
          costUsd: sumCost,
          count: rows.length
        });
      } catch (err: any) {
        this.json(res, 500, { error: err.message || "Failed to query telemetry database" });
      }
      return;
    }

    // Fallback for other /api routes if not handled here
    // In a real router, we might have more specific handlers
  }

  private checkDb(service: DashboardService): boolean {
    try {
      service.getChatStore().listSessions();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * R6-2 — Total bytes of all `.db` / `.sqlite` files under the workspace
   * root, returned in MiB (rounded to 2 dp). Best-effort; on any I/O error
   * returns 0 rather than failing the health endpoint.
   */
  private measureWorkspaceDbSize(): number {
    let total = 0;
    try {
      const root = resolveWorkspaceRoot();
      if (!existsSync(root)) return 0;
      const stack: string[] = [root];
      // Bound the walk so a misconfigured workspace root cannot stall the
      // request — 5000 directory entries is far above any realistic PRISM
      // workspace.
      let visited = 0;
      while (stack.length > 0 && visited < 5000) {
        const dir = stack.pop()!;
        let entries: string[] = [];
        try { entries = readdirSync(dir); } catch { continue; }
        for (const name of entries) {
          visited++;
          const full = join(dir, name);
          let st;
          try { st = statSync(full); } catch { continue; }
          if (st.isDirectory()) {
            // Skip well-known noisy subtrees that never hold DB files.
            if (name === "node_modules" || name === ".git") continue;
            stack.push(full);
          } else if (st.isFile() && /\.(db|sqlite|sqlite3)$/i.test(name)) {
            total += st.size;
          }
        }
      }
    } catch {
      return 0;
    }
    return Math.round((total / 1_048_576) * 100) / 100;
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
