import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import { BrowserControlTool } from "../../../adapters/system/browser-control-tool.js";
import {
  readPreferences,
  writePreferences,
  resolveWorkspaceRoot,
  setWorkspaceRoot,
  ensureWorkspaceStructure,
} from "../../config/workspace-resolver.js";
import {
  resolveProfile,
  fetchHardwareSnapshot,
  updateCachedHardwareSnapshot,
} from "../model-capability-matrix.js";

export class SettingsHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];

    if (pathname.startsWith("/api/preferences")) return true;
    if (pathname.startsWith("/api/setup/")) return true;
    return false;
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    // 1. GET /api/setup/status
    if (method === "GET" && url === "/api/setup/status") {
      const prefs = readPreferences();
      return this.json(res, 200, {
        setupComplete: prefs?.setupComplete ?? false,
        executionProfileSegment: prefs?.executionProfileSegment ?? service.status.executionProfileSegment ?? "individual",
        workspaceRoot: resolveWorkspaceRoot(),
      });
    }

    // 2. GET /api/setup/prerequisites
    if (method === "GET" && url === "/api/setup/prerequisites") {
      const nodeVersion = process.version;
      const nodeMajor = parseInt(nodeVersion.slice(1), 10);
      const checks = [
        {
          id: "node-version",
          label: "Node.js 22+",
          passed: nodeMajor >= 22,
          detail: nodeMajor >= 22 ? `Node.js ${nodeVersion} detected.` : `Node.js ${nodeVersion} detected — version 22+ is required.`,
        },
        {
          id: "workspace-exists",
          label: "Workspace directory exists",
          passed: existsSync(resolveWorkspaceRoot()),
          detail: existsSync(resolveWorkspaceRoot()) ? `Workspace at ${resolveWorkspaceRoot()}` : `Workspace directory does not yet exist at ${resolveWorkspaceRoot()}`,
        },
      ];
      return this.json(res, 200, { checks });
    }

    // 3. POST /api/setup/profile
    if (method === "POST" && url === "/api/setup/profile") {
      try {
        const body = await service.readJsonBody<{ executionProfileSegment?: string }>(req);
        const segment = body.executionProfileSegment?.trim().toLowerCase();
        if (segment !== "individual" && segment !== "business") {
          return this.json(res, 400, { error: "executionProfileSegment must be 'individual' or 'business'." });
        }
        writePreferences({ executionProfileSegment: segment });
        service.status.executionProfileSegment = segment;
        return this.json(res, 200, { executionProfileSegment: segment });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 4. POST /api/setup/workspace
    if (method === "POST" && url === "/api/setup/workspace") {
      try {
        const body = await service.readJsonBody<{ workspaceRoot?: string }>(req);
        const root = body.workspaceRoot?.trim();
        if (!root) {
          return this.json(res, 400, { error: "workspaceRoot is required." });
        }
        if (!join(root, "").startsWith(root)) {
          return this.json(res, 400, { error: "Invalid workspace path." });
        }
        setWorkspaceRoot(root);
        ensureWorkspaceStructure();
        return this.json(res, 200, { workspaceRoot: resolveWorkspaceRoot() });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 5. POST /api/setup/character
    if (method === "POST" && url === "/api/setup/character") {
      try {
        const body = await service.readJsonBody<{ characterId?: string }>(req);
        const characterId = String(body.characterId ?? "").trim();
        if (!characterId) {
          return this.json(res, 400, { error: "characterId is required." });
        }
        const available = service.listWorkspaceCharacters();
        if (!available.some((c) => c.id === characterId)) {
          return this.json(res, 404, { error: `character_not_found: ${characterId}` });
        }
        writePreferences({ defaultCharacterId: characterId, lastUsedCharacterId: characterId });
        return this.json(res, 200, { ok: true, defaultCharacterId: characterId });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 6. POST /api/setup/cac
    if (method === "POST" && url === "/api/setup/cac") {
      try {
        const body = await service.readJsonBody<{
          characterId?: string;
          operatorEmail?: string;
          operatorPassword?: string;
          assistantEmail?: string;
          title?: string;
        }>(req);
        const prefs = readPreferences();
        const characterId = String(body.characterId ?? prefs?.defaultCharacterId ?? "").trim();
        if (!characterId) {
          return this.json(res, 400, {
            error: "no_default_character",
            message: "Run POST /api/setup/character first or provide characterId.",
          });
        }
        const available = service.listWorkspaceCharacters();
        if (!available.some((c) => c.id === characterId)) {
          return this.json(res, 404, { error: `character_not_found: ${characterId}` });
        }
        const operatorEmail = String(body.operatorEmail ?? `operator@prism.local`).trim().toLowerCase();
        const assistantEmail = String(body.assistantEmail ?? `${characterId}@prism.local`).trim();

        // R3 wizard email deny-list check
        const isPlaceholder = /@(prism\.local|example\.(com|org|net))$/i.test(operatorEmail);
        if (isPlaceholder) {
          const err = new Error("Placeholder operator email is not allowed.") as Error & { code?: string };
          err.code = "operator-email-placeholder";
          throw err;
        }

        // If a password is provided, upsert this operator user in IamStore
        const operatorPassword = body.operatorPassword ? String(body.operatorPassword).trim() : null;
        if (operatorPassword) {
          const store = service.getIamHandler().getStore();
          const sha256Hex = (str: string) => createHash("sha256").update(str, "utf-8").digest("hex");
          const passwordHash = sha256Hex(operatorPassword);
          const existing = store.getUserByEmail("default", operatorEmail);
          if (existing) {
            existing.attrs = { ...existing.attrs, passwordHash };
            store.updateUserAttrs(existing.id, existing.attrs);
          } else {
            const newUser = store.createUser({
              tenantId: "default",
              email: operatorEmail,
              displayName: operatorEmail.split('@')[0] || "Operator",
              status: "active",
              attrs: { passwordHash },
            });
            const adminRole = store.getRoleByName("default", "admin");
            if (adminRole) {
              store.addMembership(newUser.id, "default", adminRole.id);
            }
            const operatorRole = store.getRoleByName("default", "operator");
            if (operatorRole) {
              store.addMembership(newUser.id, "default", operatorRole.id);
            }
          }
        }

        const session = service.createChatSession({
          title: body.title ?? "First session",
          characterId,
          operatorEmail,
          assistantEmail,
        });
        try {
          writePreferences({
            cacBootstrapAssignmentId: session.cacAssignmentId ?? undefined,
            lastUsedCharacterId: characterId,
          });
        } catch { /* non-fatal */ }

        // Initialize Computer & Browser Control
        service.getFramebufferCapture().captureSingle().catch(() => { });
        const browserTool = service.tools.find(t => t.name === "browser_control") as BrowserControlTool | undefined;
        if (browserTool) {
          try {
            const profMgr = browserTool.getProfileManager();
            if (profMgr && profMgr.listProfiles().length === 0) {
              profMgr.createProfile({
                prismUserEmail: operatorEmail,
                executionProfileSegment: "individual",
              });
            }
            const mgr = browserTool.getManager();
            if (mgr && mgr.listSessions().length === 0) {
              mgr.launch({ headless: true }).catch(() => { });
            }
          } catch { /* best-effort non-blocking */ }
        }

        return this.json(res, 201, {
          ok: true,
          session,
          cacAssignmentId: session.cacAssignmentId,
        });
      } catch (error) {
        const tagged = error as Error & { code?: string };
        return this.json(res, 400, { error: tagged.message ?? String(error), code: tagged.code });
      }
    }

    // 7. POST /api/setup/complete
    if (method === "POST" && url === "/api/setup/complete") {
      try {
        const principal = service.getIamHandler().resolvePrincipalFromCookie(req);
        const authDisabled = (process.env.PRISM_AUTH_DISABLED ?? "").toLowerCase() === "true";
        const isAdmin = authDisabled || (principal ? (principal.roles.includes("admin") || principal.roles.includes("root")) : true);

        let packages = service.listSessionPackages();
        if (principal) {
          const operatorSessionIds = new Set(
            service.getChatStore().listSessions()
              .filter(s => s.operatorEmail === principal.email || /Initialization Certificate/i.test(s.title || ""))
              .map(s => s.sessionId)
          );
          packages = packages.filter(pkg =>
            pkg.sessionIds.some(sid => operatorSessionIds.has(sid))
          );
        }

        const hasInitializationCertificate = packages.some(pkg =>
          /Initialization Certificate/i.test(pkg.title || "")
        );
        if (!hasInitializationCertificate) {
          return this.json(res, 409, {
            error: "initialization_certificate_required",
            message: "An Initialization Certificate must be created before setup can be completed. " +
              "Complete all wizard steps including certificate generation.",
          });
        }

        writePreferences({ setupComplete: true });

        // Initialize Computer & Browser Control
        service.getFramebufferCapture().captureSingle().catch(() => { });
        const browserTool = service.tools.find(t => t.name === "browser_control") as BrowserControlTool | undefined;
        if (browserTool) {
          try {
            const profMgr = browserTool.getProfileManager();
            if (profMgr && profMgr.listProfiles().length === 0) {
              profMgr.createProfile({
                prismUserEmail: "operator@prism.local",
                executionProfileSegment: "individual",
              });
            }
            const mgr = browserTool.getManager();
            if (mgr && mgr.listSessions().length === 0) {
              mgr.launch({ headless: true }).catch(() => { });
            }
          } catch { /* best-effort non-blocking */ }
        }

        const snapshot = await service.getReadinessSnapshot();
        service.emitReadinessAudit("setup_wizard_complete", snapshot);
        service.getActivityBus().emit({
          sessionId: service.status.sessionId,
          layer: "causal",
          operation: "prism.setup_wizard.complete",
          status: "succeeded",
          details: {
            executionProfileSegment: service.status.executionProfileSegment,
            workspaceRoot: resolveWorkspaceRoot(),
            ready: snapshot.ready,
          },
        });
        return this.json(res, 200, { setupComplete: true, readiness: snapshot });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 8. GET /api/setup/advanced/status
    if (method === "GET" && url === "/api/setup/advanced/status") {
      try {
        const prefs = readPreferences();
        const wsRoot = resolveWorkspaceRoot();

        let routingConfig = null;
        try {
          const routingPath = join(wsRoot, "state", "routing-config.json");
          if (existsSync(routingPath)) {
            routingConfig = JSON.parse(readFileSync(routingPath, "utf-8"));
          }
        } catch { /* ignore */ }

        let guardianStatus = null;
        try {
          guardianStatus = (service as any).guardianAgent?.getStatus?.() ?? null;
        } catch { /* ignore */ }

        let characterAssignments: unknown[] = [];
        try {
          characterAssignments = (service as any).characterAssignments ?? [];
        } catch { /* ignore */ }

        let browserProfiles: unknown[] = [];
        try {
          browserProfiles = (service as any).browserProfiles ?? [];
        } catch { /* ignore */ }

        let scheduledJobs: unknown[] = [];
        try {
          scheduledJobs = (service as any).schedulerEngine?.listSchedules?.() ?? [];
        } catch { /* ignore */ }

        let characters: unknown[] = [];
        try {
          characters = (service as any).getAvailableCharacters?.() ?? [];
        } catch { /* ignore */ }

        let ggufModels: Array<{ name: string; path: string; source: string }> = [];
        try {
          const modelsDir = join(process.cwd(), "models");
          if (existsSync(modelsDir)) {
            const files = readdirSync(modelsDir).filter((f: string) => f.endsWith(".gguf"));
            ggufModels = files.map((f: string) => ({
              name: f.replace(/\.gguf$/, ""),
              path: join(modelsDir, f),
              source: "workspace-models",
            }));
          }
        } catch { /* ignore */ }

        return this.json(res, 200, {
          setupComplete: prefs?.setupComplete ?? false,
          executionProfileSegment: prefs?.executionProfileSegment ?? service.status.executionProfileSegment ?? "individual",
          workspaceRoot: wsRoot,
          routingConfig,
          guardianStatus,
          characterAssignments,
          browserProfiles,
          scheduledJobs,
          characters,
          ggufModels,
        });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 9. POST /api/setup/initialization-session
    if (method === "POST" && url === "/api/setup/initialization-session") {
      try {
        const body = await service.readJsonBody<{ certificate: Record<string, unknown> }>(req);
        const cert = body.certificate ?? {};
        const cac = (cert.cac || {}) as Record<string, unknown>;
        const operatorEmail = typeof cac.operatorEmail === "string" && cac.operatorEmail !== "not set" && cac.operatorEmail !== "not configured"
          ? cac.operatorEmail.trim().toLowerCase()
          : undefined;
        const timestamp = new Date().toISOString();

        const session = service.createChatSession({
          title: "PRISM Initialization Certificate \u2014 " + timestamp,
          allowUnbound: true,
          operatorEmail: operatorEmail || null,
        });

        const certLines: string[] = [
          "# PRISM Initialization Certificate",
          "**Generated:** " + timestamp,
          "**Session:** " + session.sessionId,
          "",
          "## Configuration Summary",
        ];

        const sections: Array<[string, unknown]> = [
          ["Execution Profile", cert.profile],
          ["Workspace", cert.workspace],
          ["Primary LLM Provider", cert.provider],
          ["Model Routing", cert.routing],
          ["Guardian Agent", cert.guardian],
          ["Agentic Control", cert.agents],
          ["Character Accountability (CAC)", cert.cac],
          ["Browser Profile", cert.browserProfile],
          ["Scheduler", cert.scheduler],
          ["Readiness", cert.readiness],
        ];

        for (const [title, data] of sections) {
          certLines.push("");
          certLines.push("### " + title);
          if (data && typeof data === "object") {
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
              const val = typeof v === "object" ? JSON.stringify(v) : String(v ?? "N/A");
              certLines.push("- **" + k + ":** " + val);
            }
          } else {
            certLines.push("- " + String(data ?? "Not configured"));
          }
        }

        certLines.push("");
        certLines.push("---");
        certLines.push("*This certificate is an immutable provenance record of the initial PRISM system configuration.*");

        const certContent = certLines.join("\n");

        service.getChatStore().appendMessage(
          session.sessionId,
          "assistant",
          certContent,
          { source: "initialization_certificate", type: "certificate" },
        );

        const pkg = service.createSessionPackage({
          title: "Initialization Certificate v1.0 \u2014 " + timestamp,
          areaOfInterest: "System Initialization",
          objective: "Immutable provenance record of initial PRISM system configuration",
          successCriteria: "All configuration steps completed and validated",
          sessionIds: [session.sessionId],
          status: "complete",
          source: "setup_wizard_advanced",
        });

        service.getActivityBus().emit({
          sessionId: session.sessionId,
          layer: "causal",
          operation: "prism.initialization_certificate.created",
          status: "succeeded",
          details: {
            packageId: pkg.packageId,
            sessionId: session.sessionId,
            timestamp,
          },
        });

        return this.json(res, 201, {
          sessionId: session.sessionId,
          packageId: pkg.packageId,
          title: session.title,
          timestamp,
        });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 10. POST /api/preferences/ui-mode
    if (method === "POST" && url === "/api/preferences/ui-mode") {
      try {
        const body = await service.readJsonBody<{ mode?: string }>(req);
        const mode = body.mode;
        if (mode !== "simple" && mode !== "advanced") {
          return this.json(res, 400, { error: "mode must be 'simple' or 'advanced'" });
        }
        writePreferences({ uiMode: mode as "simple" | "advanced" });
        return this.json(res, 200, { updated: true, mode });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 11. POST /api/preferences/sshp-redaction
    if (method === "POST" && url === "/api/preferences/sshp-redaction") {
      try {
        const body = await service.readJsonBody<{ enabled?: boolean }>(req);
        const enabled = body.enabled !== false;
        const current = readPreferences() || { lastModified: "" };
        const settings = current.runtimeSettings || {};
        writePreferences({
          runtimeSettings: {
            ...settings,
            sshpRedactionEnabled: enabled,
          }
        });
        return this.json(res, 200, { updated: true, sshpRedactionEnabled: enabled });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }

    // 12. GET /api/preferences/power-mode
    if (method === "GET" && url === "/api/preferences/power-mode") {
      const prefs = readPreferences();
      return this.json(res, 200, { powerMode: prefs?.powerMode || "adaptive" });
    }

    // 13. POST /api/preferences/power-mode
    if (method === "POST" && url === "/api/preferences/power-mode") {
      try {
        const body = await service.readJsonBody<{ powerMode?: string }>(req);
        const mode = body.powerMode || "adaptive";
        if (mode !== "performance" && mode !== "eco" && mode !== "adaptive") {
          return this.json(res, 400, { error: "Invalid powerMode value. Must be 'performance', 'eco', or 'adaptive'." });
        }
        writePreferences({ powerMode: mode as "performance" | "eco" | "adaptive" });

        let targetBaseMode = false;
        let isAuto = false;

        if (mode === "adaptive") {
          isAuto = true;
          process.env.PRISM_BASE_MODE_AUTO = "true";
          const activeModel = service.getLlmProviders().activeModel;
          if (activeModel) {
            const profile = resolveProfile(activeModel);
            targetBaseMode = profile.locality === "local" && profile.tier <= 2;
          }

          try {
            const snapshot = await fetchHardwareSnapshot("http://localhost:11434");
            updateCachedHardwareSnapshot(snapshot);
          } catch {
            // ignore
          }
        } else {
          isAuto = false;
          process.env.PRISM_BASE_MODE_AUTO = "false";
          targetBaseMode = mode === "eco";
        }

        process.env.PRISM_BASE_MODE = targetBaseMode ? "true" : "false";
        console.log(`[PRISM][paradigm] Power mode preference updated to '${mode}'. Setting baseMode=${targetBaseMode} (auto=${isAuto})`);

        const guardian = service.getGuardianAgent();
        if (guardian) {
          guardian.syncModeCatalog();
        }

        return this.json(res, 200, { updated: true, powerMode: mode });
      } catch (error) {
        return this.json(res, 400, { error: String(error) });
      }
    }
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
