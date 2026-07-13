import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import fs from "node:fs";
import path from "node:path";
import { getLoadedAddons, validateAddonManifest } from "../../addons/index.js";
import {
    readPreferences,
    writePreferences,
    workspacePath,
    resolveWorkspaceRoot,
    resolveAddonsDir,
} from "../../config/workspace-resolver.js";

export class AddonsHandler implements IRouteHandler {
    match(req: IncomingMessage): boolean {
        const url = req.url ?? "";
        const pathname = url.split("?")[0];
        const method = req.method?.toUpperCase() ?? "GET";

        if (pathname === "/api/addons/status" && method === "GET") return true;
        if (pathname === "/api/addons/toggle" && method === "POST") return true;
        if (pathname === "/api/addons/install" && method === "POST") return true;
        if (pathname === "/api/addons/delete" && method === "POST") return true;
        if (pathname === "/api/addons/learn" && method === "POST") return true;
        if (pathname === "/api/addons/settings" && (method === "GET" || method === "POST")) return true;

        return false;
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const url = req.url ?? "";
        const pathname = url.split("?")[0];
        const method = req.method?.toUpperCase() ?? "GET";

        // 1. GET /api/addons/status
        if (method === "GET" && pathname === "/api/addons/status") {
            try {
                const addonsDir = resolveAddonsDir();
                const loaded = getLoadedAddons();
                const disabled = readPreferences()?.disabledAddons || [];
                const resultList: any[] = [];
                const processedIds = new Set<string>();

                // Scan directory on disk
                if (fs.existsSync(addonsDir)) {
                    const entries = fs.readdirSync(addonsDir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (!entry.isDirectory()) continue;
                        if (entry.name.startsWith(".")) continue;

                        const addonPath = path.join(addonsDir, entry.name);
                        const manifestPath = path.join(addonPath, "addon.manifest.json");
                        if (!fs.existsSync(manifestPath)) continue;

                        try {
                            const manifestContent = fs.readFileSync(manifestPath, "utf-8");
                            const manifest = JSON.parse(manifestContent);
                            const validation = validateAddonManifest(manifest);
                            const id = manifest.id || entry.name;
                            processedIds.add(id);

                            const mem = loaded.find((a) => a.manifest.id === id);
                            const isSuspended = disabled.includes(id);

                            let state = "unloaded";
                            if (mem) {
                                state = mem.state;
                            } else {
                                state = "pending_restart";
                            }

                            if (isSuspended && state === "active") {
                                state = "pending_restart";
                            } else if (!isSuspended && state === "suspended") {
                                state = "pending_restart";
                            }

                            resultList.push({
                                id,
                                name: manifest.name || entry.name,
                                version: manifest.version || "0.0.0",
                                description: manifest.description || "",
                                author: manifest.author?.name || "unknown",
                                license: manifest.license || "unknown",
                                state,
                                trust: manifest.trust || "unsigned",
                                hasSignoff: !!manifest.governanceCouncilSignoff,
                                signoffId: manifest.governanceCouncilSignoff?.signatureId || null,
                                path: addonPath,
                                manifest,
                                validationErrors: validation.errors,
                                validationWarnings: validation.warnings,
                                enabled: !isSuspended,
                            });
                        } catch (err) {
                            resultList.push({
                                id: entry.name,
                                name: entry.name,
                                version: "0.0.0",
                                description: `Failed to load: ${(err as Error).message}`,
                                author: "unknown",
                                license: "unknown",
                                state: "error",
                                trust: "unsigned",
                                hasSignoff: false,
                                path: addonPath,
                                validationErrors: [`Failed to read manifest: ${(err as Error).message}`],
                                validationWarnings: [],
                                enabled: !disabled.includes(entry.name),
                            });
                        }
                    }
                }

                // Scan memory registry for items deleted from disk
                for (const mem of loaded) {
                    if (processedIds.has(mem.manifest.id)) continue;
                    resultList.push({
                        id: mem.manifest.id,
                        name: mem.manifest.name,
                        version: mem.manifest.version,
                        description: mem.manifest.description,
                        author: (mem.manifest.author as any)?.name || "unknown",
                        license: mem.manifest.license,
                        state: "pending_delete",
                        trust: mem.manifest.trust,
                        hasSignoff: !!mem.manifest.governanceCouncilSignoff,
                        path: mem.rootPath,
                        manifest: mem.manifest,
                        validationErrors: [],
                        validationWarnings: [],
                        enabled: !disabled.includes(mem.manifest.id),
                    });
                }

                return this.json(res, 200, { addons: resultList });
            } catch (err) {
                return this.json(res, 500, { error: String(err) });
            }
        }

        // 2. POST /api/addons/toggle
        if (method === "POST" && pathname === "/api/addons/toggle") {
            try {
                const body = await service.readJsonBody<{ id: string; enabled?: boolean }>(req);
                if (!body.id) {
                    return this.json(res, 400, { error: "Addon ID is required" });
                }
                const prefs = readPreferences() || { lastModified: "" };
                const disabled = prefs.disabledAddons || [];
                const currentEnabled = !disabled.includes(body.id);
                const targetEnabled = typeof body.enabled === "boolean" ? body.enabled : !currentEnabled;

                let nextDisabled = [...disabled];
                if (targetEnabled) {
                    nextDisabled = nextDisabled.filter((id) => id !== body.id);
                } else {
                    if (!nextDisabled.includes(body.id)) {
                        nextDisabled.push(body.id);
                    }
                }
                writePreferences({ disabledAddons: nextDisabled });

                service.getActivityBus().emit({
                    sessionId: "addons-manager",
                    layer: "governance",
                    operation: "toggle_addon",
                    status: "succeeded",
                    details: { addonId: body.id, enabled: targetEnabled },
                });

                const logMsg = `[${new Date().toISOString()}] Toggled Add-on ${body.id}: ${targetEnabled ? "ENABLED" : "DISABLED"}. Restart required.\n`;
                fs.appendFileSync(workspacePath("logs", "addons.log"), logMsg, "utf-8");

                return this.json(res, 200, {
                    success: true,
                    id: body.id,
                    enabled: targetEnabled,
                    message: "Add-on preference updated. Server restart required to apply changes.",
                });
            } catch (err) {
                return this.json(res, 500, { error: String(err) });
            }
        }

        // 3. POST /api/addons/install
        if (method === "POST" && pathname === "/api/addons/install") {
            try {
                const body = await service.readJsonBody<{
                    sourceType: "git" | "zip" | "local";
                    pathOrUrl: string;
                }>(req);

                if (!body.sourceType || !body.pathOrUrl) {
                    return this.json(res, 400, { error: "sourceType and pathOrUrl are required" });
                }

                const addonsDir = resolveAddonsDir();
                if (!fs.existsSync(addonsDir)) {
                    fs.mkdirSync(addonsDir, { recursive: true });
                }

                const tempDirName = `addon-temp-${Date.now()}`;
                const tempPath = path.join(addonsDir, tempDirName);

                if (fs.existsSync(tempPath)) {
                    fs.rmSync(tempPath, { recursive: true, force: true });
                }
                fs.mkdirSync(tempPath, { recursive: true });

                const { execFileSync } = await import("node:child_process");

                if (body.sourceType === "local") {
                    const localPath = path.resolve(body.pathOrUrl);
                    if (!fs.existsSync(localPath)) {
                        fs.rmSync(tempPath, { recursive: true, force: true });
                        return this.json(res, 400, { error: `Local path does not exist: ${body.pathOrUrl}` });
                    }
                    fs.cpSync(localPath, tempPath, { recursive: true });
                } else if (body.sourceType === "git") {
                    try {
                        execFileSync("git", ["clone", body.pathOrUrl, tempPath], { stdio: "pipe" });
                    } catch (err: any) {
                        fs.rmSync(tempPath, { recursive: true, force: true });
                        return this.json(res, 400, { error: `Git clone failed: ${err.stderr || err.message}` });
                    }
                } else if (body.sourceType === "zip") {
                    try {
                        const tempZip = path.join(addonsDir, `${tempDirName}.zip`);
                        execFileSync(
                            "powershell",
                            [
                                "-NoProfile",
                                "-NonInteractive",
                                "-Command",
                                "& { Invoke-WebRequest -Uri $args[0] -OutFile $args[1] }",
                                body.pathOrUrl,
                                tempZip,
                            ],
                            { stdio: "pipe" },
                        );

                        execFileSync(
                            "powershell",
                            [
                                "-NoProfile",
                                "-NonInteractive",
                                "-Command",
                                "& { Expand-Archive -Path $args[0] -DestinationPath $args[1] -Force }",
                                tempZip,
                                tempPath,
                            ],
                            { stdio: "pipe" },
                        );

                        if (fs.existsSync(tempZip)) {
                            fs.rmSync(tempZip, { force: true });
                        }
                    } catch (err: any) {
                        fs.rmSync(tempPath, { recursive: true, force: true });
                        return this.json(res, 400, { error: `ZIP download or extraction failed: ${err.message}` });
                    }
                }

                let actualAddonPath = tempPath;
                let manifestPath = path.join(actualAddonPath, "addon.manifest.json");

                if (!fs.existsSync(manifestPath)) {
                    const entries = fs.readdirSync(tempPath, { withFileTypes: true });
                    const subdirs = entries.filter((e) => e.isDirectory());
                    let found = false;
                    for (const subdir of subdirs) {
                        const subManifest = path.join(tempPath, subdir.name, "addon.manifest.json");
                        if (fs.existsSync(subManifest)) {
                            actualAddonPath = path.join(tempPath, subdir.name);
                            manifestPath = subManifest;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        fs.rmSync(tempPath, { recursive: true, force: true });
                        return this.json(res, 400, { error: "No addon.manifest.json found in the package." });
                    }
                }

                let manifest: any;
                try {
                    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
                } catch (err: any) {
                    fs.rmSync(tempPath, { recursive: true, force: true });
                    return this.json(res, 400, { error: `Invalid JSON in addon.manifest.json: ${err.message}` });
                }

                const validation = validateAddonManifest(manifest);
                if (!validation.valid) {
                    fs.rmSync(tempPath, { recursive: true, force: true });
                    return this.json(res, 422, {
                        error: "Manifest validation failed",
                        errors: validation.errors,
                        warnings: validation.warnings,
                    });
                }

                const targetAddonDir = path.join(addonsDir, manifest.id);
                if (fs.existsSync(targetAddonDir)) {
                    const backupDir = path.join(addonsDir, ".backup", `${manifest.id}-${Date.now()}`);
                    fs.mkdirSync(path.dirname(backupDir), { recursive: true });
                    fs.renameSync(targetAddonDir, backupDir);
                    console.log(`[addons-manager] Backed up existing addon ${manifest.id} to ${backupDir}`);
                }

                fs.mkdirSync(path.dirname(targetAddonDir), { recursive: true });
                fs.renameSync(actualAddonPath, targetAddonDir);

                if (fs.existsSync(tempPath)) {
                    fs.rmSync(tempPath, { recursive: true, force: true });
                }

                service.getActivityBus().emit({
                    sessionId: "addons-manager",
                    layer: "governance",
                    operation: "install_addon",
                    status: "succeeded",
                    details: { addonId: manifest.id, name: manifest.name, version: manifest.version },
                });

                const logMsg = `[${new Date().toISOString()}] Installed Add-on: ${manifest.name} (${manifest.id}) v${manifest.version}. Restart required to boot.\n`;
                fs.appendFileSync(workspacePath("logs", "addons.log"), logMsg, "utf-8");

                return this.json(res, 201, {
                    success: true,
                    id: manifest.id,
                    name: manifest.name,
                    version: manifest.version,
                    message: "Add-on installed successfully. Server restart required to load.",
                });
            } catch (err: any) {
                return this.json(res, 500, { error: err.message });
            }
        }

        // 4. POST /api/addons/delete
        if (method === "POST" && pathname === "/api/addons/delete") {
            try {
                const body = await service.readJsonBody<{ id: string }>(req);
                if (!body.id) {
                    return this.json(res, 400, { error: "Addon ID is required" });
                }

                const addonsDir = resolveAddonsDir();
                const targetAddonDir = this.resolveAddonDirById(addonsDir, body.id);

                if (!targetAddonDir) {
                    return this.json(res, 404, { error: `Addon directory not found: ${body.id}` });
                }

                const backupDir = path.join(addonsDir, ".backup", `${body.id}-${Date.now()}`);
                fs.mkdirSync(path.dirname(backupDir), { recursive: true });
                fs.renameSync(targetAddonDir, backupDir);

                service.getActivityBus().emit({
                    sessionId: "addons-manager",
                    layer: "governance",
                    operation: "delete_addon",
                    status: "succeeded",
                    details: { addonId: body.id, backupDir },
                });

                const logMsg = `[${new Date().toISOString()}] Deleted Add-on: ${body.id}. Moved to backup: ${backupDir}. Restart required to unload.\n`;
                fs.appendFileSync(workspacePath("logs", "addons.log"), logMsg, "utf-8");

                return this.json(res, 200, {
                    success: true,
                    id: body.id,
                    message: "Add-on moved to backup. Server restart required to unload.",
                });
            } catch (err: any) {
                return this.json(res, 500, { error: err.message });
            }
        }

        // 5. POST /api/addons/learn
        if (method === "POST" && pathname === "/api/addons/learn") {
            let targetAddonId = "";
            try {
                const body = await service.readJsonBody<{ id: string }>(req);
                if (!body.id) {
                    return this.json(res, 400, { error: "Addon ID is required" });
                }
                targetAddonId = body.id;

                const addonsDir = resolveAddonsDir();
                const targetAddonDir = this.resolveAddonDirById(addonsDir, body.id);

                if (!targetAddonDir) {
                    return this.json(res, 404, { error: `Add-on not found or has no manifest: ${body.id}` });
                }

                const manifestPath = path.join(targetAddonDir, "addon.manifest.json");

                const manifestContent = fs.readFileSync(manifestPath, "utf-8");
                const manifest = JSON.parse(manifestContent);

                service.getActivityBus().emit({
                    sessionId: "addons-manager",
                    layer: "governance",
                    operation: "learn_addon",
                    status: "started",
                    details: { addonId: body.id, name: manifest.name },
                });

                const systemPrompt = `You are the PRISM SOTA Knowledge and Skills Integrator.
Your task is to analyze a newly installed Add-on, generate Markdown documentation for the PRISM Wiki, and create a SOTA skill definition JSON file for use and support of the Add-on.

The Add-on details are:
ID: ${manifest.id}
Name: ${manifest.name}
Description: ${manifest.description}
Integration Points: ${JSON.stringify(manifest.integrationPoints, null, 2)}
Dependencies: ${JSON.stringify(manifest.dependencies, null, 2)}

You MUST generate:
1. A Markdown documentation file containing an overview, configuration guide, and integration details.
2. A JSON skill definition following the PRISM standard.

Respond ONLY with a JSON object in the following format:
{
  "documentationMarkdown": "markdown content here...",
  "skillDefinition": {
     "id": "prism.skill.addon_${manifest.id.replace(/[^a-zA-Z0-9_]/g, "_")}",
     "version": "1.0.0",
     "name": "Use ${manifest.name} Add-on",
     "description": "Guides the agent on how to use and interact with the ${manifest.name} Add-on.",
     "tags": ["addon", "${manifest.id}"],
     "governance": {
        "min_policy_tier": "tier-2",
        "required_approvals": [],
        "covenant_rules": [
           "Follow all PRISM standards for ${manifest.name} integration."
        ]
     },
     "triad_templates": {
        "left_hemisphere": "Evaluate current system state and clearances for: {query}",
        "right_hemisphere": "Draft integration plans or instructions for: {query}",
        "main_hemisphere": "Coordinate integration using the ${manifest.name} Add-on: {query}"
     },
     "workflow": {
        "steps": [
           {
              "id": "evaluate_integration",
              "name": "Evaluate Add-on Integration",
              "tools": [],
              "action": "Check active integration status and clearances for ${manifest.id}.",
              "transitions": {
                 "success": "execute_task",
                 "failed": "evaluate_integration"
              }
           },
           {
              "id": "execute_task",
              "name": "Execute Add-on Command",
              "tools": [],
              "action": "Use the integration points defined by ${manifest.id} to satisfy {query}.",
              "transitions": {
                 "success": "completed",
                 "failed": "evaluate_integration"
              }
           },
           {
              "id": "completed",
              "name": "Task Completed",
              "tools": [],
              "action": "Log outcome and notify the operator.",
              "transitions": {
                 "success": "completed",
                 "failed": "completed"
              }
           }
        ]
     }
  }
}`;

                const response = await service.getLlmProviders().generate({
                    message: "Please analyze the Add-on and generate the documentation and skill JSON.",
                    conversation: [],
                    systemPrompt: systemPrompt,
                });

                if (!response || !response.content) {
                    throw new Error("No response content received from the LLM provider.");
                }

                const startIdx = response.content.indexOf("{");
                const endIdx = response.content.lastIndexOf("}");
                if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
                    throw new Error("Failed to parse LLM response as JSON.");
                }

                const result = JSON.parse(response.content.substring(startIdx, endIdx + 1));

                const docsAddonsDir = path.join(process.cwd(), "docs", "addons");
                if (!fs.existsSync(docsAddonsDir)) {
                    fs.mkdirSync(docsAddonsDir, { recursive: true });
                }
                const docPath = path.join(docsAddonsDir, `${body.id}.md`);
                fs.writeFileSync(docPath, result.documentationMarkdown, "utf-8");

                const skillsDir = path.join(resolveWorkspaceRoot(), "skills");
                if (!fs.existsSync(skillsDir)) {
                    fs.mkdirSync(skillsDir, { recursive: true });
                }
                const skillPath = path.join(skillsDir, `addon-${body.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-skill.json`);
                fs.writeFileSync(skillPath, JSON.stringify(result.skillDefinition, null, 2), "utf-8");

                const skillsEngine = service.getSkillsEngine();
                if (skillsEngine) {
                    skillsEngine.loadAllSkills();
                }

                service.getActivityBus().emit({
                    sessionId: "addons-manager",
                    layer: "governance",
                    operation: "learn_addon",
                    status: "succeeded",
                    details: { addonId: body.id, docPath, skillPath },
                });

                const logMsg = `[${new Date().toISOString()}] Successfully learned Add-on: ${body.id}. Generated doc: ${docPath}, skill: ${skillPath}.\n`;
                fs.appendFileSync(workspacePath("logs", "addons.log"), logMsg, "utf-8");

                return this.json(res, 200, {
                    success: true,
                    id: body.id,
                    docPath,
                    skillPath,
                    message: "Add-on learned successfully. Documentation generated and skill registered.",
                });
            } catch (err: any) {
                service.getActivityBus().emit({
                    sessionId: "addons-manager",
                    layer: "governance",
                    operation: "learn_addon",
                    status: "failed",
                    details: { addonId: targetAddonId, error: err.message },
                });
                return this.json(res, 500, { error: err.message });
            }
        }

        // 6. GET /api/addons/settings
        if (method === "GET" && pathname === "/api/addons/settings") {
            try {
                const searchParams = new URL(url, "http://localhost").searchParams;
                const id = searchParams.get("id");
                if (!id) {
                    return this.json(res, 400, { error: "Missing addon id parameter" });
                }

                const prefs = readPreferences();
                const settings = prefs?.addonSettings?.[id] || {
                    autostart: true,
                    logLevel: "info",
                    threadMode: "worker",
                    mcpPort: id === "prism.addon.vrgc-robotics" ? 8203 : 8000,
                    customEnvironment: {},
                };

                return this.json(res, 200, settings);
            } catch (err: any) {
                return this.json(res, 500, { error: err.message });
            }
        }

        // 7. POST /api/addons/settings
        if (method === "POST" && pathname === "/api/addons/settings") {
            try {
                const body = await service.readJsonBody<{ id: string; settings: Record<string, any> }>(req);
                if (!body || !body.id) {
                    return this.json(res, 400, { error: "Missing addon id in body" });
                }

                const prefs = readPreferences() || { lastModified: "" };
                const currentSettings = prefs.addonSettings || {};
                currentSettings[body.id] = {
                    ...currentSettings[body.id],
                    ...body.settings,
                };

                writePreferences({ addonSettings: currentSettings });

                return this.json(res, 200, {
                    success: true,
                    message: "Settings saved successfully",
                    settings: currentSettings[body.id],
                });
            } catch (err: any) {
                return this.json(res, 500, { error: err.message });
            }
        }

        return this.json(res, 404, { error: "Not found", path: url });
    }

    /**
     * Resolves a manifest ID (e.g. "prism.addon.vrgc-robotics") to the actual
     * addon directory on disk (e.g. "D:\\Projects\\Prism\\addons\\prism-addon-vrgc-robotics").
     * The directory name and the manifest ID may differ, so we scan all addon
     * directories and read each manifest to find the match.
     */
    private resolveAddonDirById(addonsDir: string, id: string): string | null {
        // Fast path: try using the ID directly as a directory name
        const directPath = path.join(addonsDir, id);
        const directManifest = path.join(directPath, "addon.manifest.json");
        if (fs.existsSync(directManifest)) {
            try {
                const m = JSON.parse(fs.readFileSync(directManifest, "utf-8"));
                if (m.id === id) return directPath;
            } catch {
                /* fall through to scan */
            }
        }

        // Slow path: scan all addon directories
        if (!fs.existsSync(addonsDir)) return null;
        const entries = fs.readdirSync(addonsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
            const candidatePath = path.join(addonsDir, entry.name);
            const candidateManifest = path.join(candidatePath, "addon.manifest.json");
            if (!fs.existsSync(candidateManifest)) continue;
            try {
                const m = JSON.parse(fs.readFileSync(candidateManifest, "utf-8"));
                if ((m.id || entry.name) === id) return candidatePath;
            } catch {
                /* skip unreadable manifests */
            }
        }
        return null;
    }

    private json(res: ServerResponse, status: number, data: any): void {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(data));
    }
}
