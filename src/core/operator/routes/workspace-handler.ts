import { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";
import {
    resolveWorkspaceRoot,
    setWorkspaceRoot,
    ensureWorkspaceStructure,
    workspaceCharactersDir,
    getWorkspaceHub,
    setWorkspaceHub,
    seedDefaultCharacters,
} from "../../config/workspace-resolver.js";
import { importCharacter as importCharacterAdapter } from "../../characters/character-import-adapter.js";
import { type CharacterAssignmentFilter } from "../../accountability/character-accountability-store.js";

export class WorkspaceHandler implements IRouteHandler {
    match(req: IncomingMessage): boolean {
        const url = req.url ?? "";
        return url.startsWith("/api/workspace/") || url === "/api/workspace";
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const rawUrl = req.url ?? "";
        const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
        const method = req.method?.toUpperCase() ?? "GET";

        if (method === "GET" && url === "/api/workspace/info") {
            const root = resolveWorkspaceRoot();
            const manifestPath = join(root, "prism-workspace.json");
            let manifest = null;
            if (existsSync(manifestPath)) {
                try {
                    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
                } catch {
                    /* ignore */
                }
            }
            return this.json(res, 200, { workspaceRoot: root, exists: existsSync(root), manifest });
        }

        if (method === "GET" && url === "/api/workspace/hub") {
            return this.json(res, 200, { workspaceHub: getWorkspaceHub() });
        }

        if (method === "POST" && url === "/api/workspace/hub") {
            try {
                const body = await service.readJsonBody<{ workspaceHub?: string }>(req);
                const hub = String(body.workspaceHub ?? "").trim();
                setWorkspaceHub(hub);
                return this.json(res, 200, { ok: true, workspaceHub: hub });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 400, { error: e.message ?? "Failed to set workspace hub" });
            }
        }

        if (method === "GET" && url.startsWith("/api/workspace/characters")) {
            const characters = service.listWorkspaceCharacters();
            return this.json(res, 200, { characters, total: characters.length });
        }

        if (method === "GET" && url.startsWith("/api/workspace/character-assignments")) {
            const parsed = new URL(`http://localhost${url}`);
            const filter: CharacterAssignmentFilter = {};
            const characterId = parsed.searchParams.get("characterId")?.trim();
            const prismUserId = parsed.searchParams.get("prismUserId")?.trim();
            const prismUserEmail = parsed.searchParams.get("prismUserEmail")?.trim();
            const operatorId = parsed.searchParams.get("operatorId")?.trim();

            // Filter assignments to only show the ones belonging to the logged in operator,
            // to fulfill "no other agents should be shown for this login" request.
            const principal = service.getIamHandler().resolvePrincipalFromCookie(req);
            const devEmail = service.getDevIdentity()?.getOperator()?.email ?? "operator@prism.local";
            const currentLoginEmail = principal?.email ?? devEmail;
            const operatorEmail = parsed.searchParams.get("operatorEmail")?.trim() ?? currentLoginEmail;

            const clientId = parsed.searchParams.get("clientId")?.trim();
            const sessionId = parsed.searchParams.get("sessionId")?.trim();
            const executionProfileSegment = parsed.searchParams.get("executionProfileSegment")?.trim();
            const state = parsed.searchParams.get("state")?.trim();
            if (characterId) filter.characterId = characterId;
            if (prismUserId) filter.prismUserId = prismUserId;
            if (prismUserEmail) filter.prismUserEmail = prismUserEmail;
            if (operatorId) filter.operatorId = operatorId;
            if (operatorEmail) filter.operatorEmail = operatorEmail;
            if (clientId) filter.clientId = clientId;
            if (sessionId) filter.sessionId = sessionId;
            if (executionProfileSegment === "individual" || executionProfileSegment === "business") {
                filter.executionProfileSegment = executionProfileSegment;
            }
            if (state === "active" || state === "suspended" || state === "revoked") {
                filter.state = state;
            }
            const cam = service.getCharacterAccountabilityManager();
            const assignments = cam.list(filter);
            const characterIndex = new Map(service.listWorkspaceCharacters().map((c) => [c.id, c]));
            return this.json(res, 200, {
                assignments: assignments.map((a) => ({ ...a, character: characterIndex.get(a.characterId) ?? null })),
                total: assignments.length,
            });
        }

        if (method === "GET" && url.startsWith("/api/workspace/character-audit")) {
            const parsed = new URL(`http://localhost${url}`);
            const characterId = parsed.searchParams.get("characterId")?.trim() ?? "";
            const assignmentId = parsed.searchParams.get("assignmentId")?.trim() ?? "";

            const principal = service.getIamHandler().resolvePrincipalFromCookie(req);
            const devEmail = service.getDevIdentity()?.getOperator()?.email ?? "operator@prism.local";
            const currentLoginEmail = principal?.email ?? devEmail;
            const operatorEmail =
                parsed.searchParams.get("operatorEmail")?.trim().toLowerCase() ?? currentLoginEmail.toLowerCase();
            const limitRaw = Number(parsed.searchParams.get("limit") ?? "20");
            const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;
            const events = service
                .getActivityBus()
                .listEvents()
                .filter((e) => e.operation.startsWith("character_accountability."))
                .filter((e) => !characterId || e.characterId === characterId)
                .filter((e) => !assignmentId || e.assignmentId === assignmentId)
                .filter((e) => !operatorEmail || (e.operatorEmail ?? "").toLowerCase() === operatorEmail)
                .slice()
                .sort((l, r) => String(r.timestamp).localeCompare(String(l.timestamp)))
                .slice(0, limit);
            return this.json(res, 200, { events, total: events.length });
        }

        if (method === "POST" && url === "/api/workspace/character-assign") {
            try {
                const body = await service.readJsonBody<{
                    characterId?: string;
                    prismUserId?: string;
                    prismUserEmail?: string;
                    operatorId?: string;
                    operatorEmail?: string;
                    clientId?: string;
                    sessionId?: string;
                    executionProfile?: string;
                    workspaceHub?: string;
                    operatorPassword?: string;
                }>(req);
                const status = service.getRuntimeStatus();
                const assignment = service.getCharacterAccountabilityManager().assign({
                    characterId: String(body.characterId ?? "").trim(),
                    prismUserId: String(body.prismUserId ?? "").trim(),
                    prismUserEmail: String(body.prismUserEmail ?? "").trim(),
                    operatorId: String(body.operatorId ?? "").trim(),
                    operatorEmail: String(body.operatorEmail ?? "").trim(),
                    clientId: String(body.clientId ?? "dashboard").trim() || "dashboard",
                    sessionId: String(body.sessionId ?? status.sessionId).trim() || status.sessionId,
                    executionProfile:
                        String(body.executionProfile ?? status.executionProfileSegment).trim() ||
                        status.executionProfileSegment,
                    workspaceHub: String(body.workspaceHub ?? getWorkspaceHub()).trim(),
                });

                // Register user in IAM store if a password is provided
                const operatorEmail = String(body.operatorEmail ?? "")
                    .trim()
                    .toLowerCase();
                const operatorPassword = body.operatorPassword ? String(body.operatorPassword).trim() : null;
                if (operatorEmail && operatorPassword) {
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
                            displayName: operatorEmail.split("@")[0] || "Operator",
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

                return this.json(res, 200, { ok: true, assignment });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 400, { error: e.message ?? "Character assignment failed" });
            }
        }

        if (method === "POST" && url === "/api/workspace/character-dispatch") {
            try {
                const body = await service.readJsonBody<{ assignmentId?: string }>(req);
                const assignmentId = String(body.assignmentId ?? "").trim();
                if (!assignmentId) return this.json(res, 400, { error: "assignmentId is required." });
                const assignment = service.getCharacterAccountabilityManager().recordDispatch(assignmentId);
                if (!assignment) return this.json(res, 404, { error: "Active assignment not found." });
                return this.json(res, 200, { ok: true, assignment });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 400, { error: e.message ?? "Dispatch failed" });
            }
        }

        if (method === "POST" && url === "/api/workspace/character-suspend") {
            try {
                const body = await service.readJsonBody<{ assignmentId?: string; reason?: string }>(req);
                const assignmentId = String(body.assignmentId ?? "").trim();
                const reason = String(body.reason ?? "dashboard suspend").trim() || "dashboard suspend";
                if (!assignmentId) return this.json(res, 400, { error: "assignmentId is required." });
                const assignment = service.getCharacterAccountabilityManager().suspend(assignmentId, reason);
                if (!assignment) return this.json(res, 404, { error: "Active assignment not found." });
                return this.json(res, 200, { ok: true, assignment });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 400, { error: e.message ?? "Suspend failed" });
            }
        }

        if (method === "POST" && url === "/api/workspace/character-resume") {
            try {
                const body = await service.readJsonBody<{ assignmentId?: string }>(req);
                const assignmentId = String(body.assignmentId ?? "").trim();
                if (!assignmentId) return this.json(res, 400, { error: "assignmentId is required." });
                const assignment = service.getCharacterAccountabilityManager().resume(assignmentId);
                if (!assignment) return this.json(res, 404, { error: "Suspended assignment not found." });
                return this.json(res, 200, { ok: true, assignment });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 400, { error: e.message ?? "Resume failed" });
            }
        }

        if (method === "POST" && url === "/api/workspace/character-revoke") {
            try {
                const body = await service.readJsonBody<{ assignmentId?: string; reason?: string }>(req);
                const assignmentId = String(body.assignmentId ?? "").trim();
                const reason = String(body.reason ?? "dashboard revoke").trim() || "dashboard revoke";
                if (!assignmentId) return this.json(res, 400, { error: "assignmentId is required." });
                const assignment = service.getCharacterAccountabilityManager().revoke(assignmentId, reason);
                if (!assignment) return this.json(res, 404, { error: "Assignment not found." });
                return this.json(res, 200, { ok: true, assignment });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 400, { error: e.message ?? "Revoke failed" });
            }
        }

        if (method === "POST" && url === "/api/workspace/character-assignment-delete") {
            try {
                const body = await service.readJsonBody<{ assignmentId?: string }>(req);
                const assignmentId = String(body.assignmentId ?? "").trim();
                if (!assignmentId) return this.json(res, 400, { error: "assignmentId is required." });
                const deleted = service.getCharacterAccountabilityManager().deleteAssignment(assignmentId);
                if (!deleted) return this.json(res, 404, { error: "Assignment not found." });
                return this.json(res, 200, { ok: true });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 400, { error: e.message ?? "Delete failed" });
            }
        }

        if (method === "POST" && url === "/api/workspace/character-import") {
            try {
                const body = await service.readJsonBody<{
                    manifest?: unknown;
                    targetProfile?: "individual" | "business";
                    commit?: boolean;
                }>(req);
                if (body.manifest === undefined || body.manifest === null) {
                    return this.json(res, 400, { error: "manifest is required." });
                }
                const targetProfile = body.targetProfile === "business" ? "business" : "individual";
                const result = importCharacterAdapter(body.manifest, targetProfile);
                if (result.errors.length > 0) {
                    return this.json(res, 422, {
                        ok: false,
                        shape: result.shape,
                        errors: result.errors,
                        warnings: result.warnings,
                    });
                }
                if (body.commit) {
                    const dir = workspaceCharactersDir();
                    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                    const destPath = join(dir, `${result.character.name}.json`);
                    if (existsSync(destPath)) {
                        return this.json(res, 409, {
                            ok: false,
                            error: `character_already_exists: ${result.character.name}`,
                            shape: result.shape,
                        });
                    }
                    writeFileSync(destPath, JSON.stringify(result.character, null, 2) + "\n", "utf-8");
                    service.getActivityBus().emit({
                        sessionId: "system",
                        layer: "governance",
                        operation: "character_accountability.character_created",
                        status: "succeeded",
                        characterId: result.character.name,
                        prismUserId: "",
                        prismUserEmail: result.character.defaultEmail ?? "",
                        operatorId: "system",
                        operatorEmail: "",
                        clientId: "dashboard",
                        details: {
                            displayName: result.character.displayName,
                            executionProfile: result.character.executionProfile,
                            maxRiskTier: result.character.maxRiskTier,
                            tags: result.character.tags,
                            path: destPath,
                        },
                    });
                    console.log(
                        `[PRISM][accountability] Custom character created and saved: ${result.character.name} (${result.character.displayName}) at ${destPath}`,
                    );
                    return this.json(res, 201, {
                        ok: true,
                        committed: true,
                        shape: result.shape,
                        warnings: result.warnings,
                        character: result.character,
                        path: destPath,
                    });
                }
                return this.json(res, 200, {
                    ok: true,
                    committed: false,
                    shape: result.shape,
                    warnings: result.warnings,
                    character: result.character,
                });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 400, { error: e.message ?? "Import failed" });
            }
        }

        if (method === "GET" && url === "/api/workspace/files") {
            const root = resolveWorkspaceRoot();
            if (!existsSync(root)) return this.json(res, 200, { root, entries: [] });
            const IGNORED_DIRS = new Set([
                "node_modules",
                ".git",
                ".venv",
                ".venv_guitar",
                ".venv310",
                "__pycache__",
                ".cache",
                ".mypy_cache",
                ".pytest_cache",
                "dist",
                ".turbo",
            ]);
            const MAX_DEPTH = 8;
            const MAX_ENTRIES = 5000;
            const entries: Array<{ name: string; path: string; type: "file" | "dir"; size: number }> = [];
            let truncated = false;
            const walkDir = (dir: string, prefix: string, depth: number): void => {
                if (truncated || depth > MAX_DEPTH) return;
                let items: string[];
                try {
                    items = readdirSync(dir);
                } catch {
                    return;
                }
                for (const item of items) {
                    if (entries.length >= MAX_ENTRIES) {
                        truncated = true;
                        return;
                    }
                    const fullPath = join(dir, item);
                    const relPath = prefix ? prefix + "/" + item : item;
                    try {
                        const st = statSync(fullPath);
                        if (st.isDirectory()) {
                            entries.push({ name: item, path: relPath, type: "dir", size: 0 });
                            if (!IGNORED_DIRS.has(item)) {
                                walkDir(fullPath, relPath, depth + 1);
                            }
                        } else {
                            entries.push({ name: item, path: relPath, type: "file", size: st.size });
                        }
                    } catch {
                        /* skip inaccessible */
                    }
                }
            };
            walkDir(root, "", 0);
            return this.json(res, 200, { root, entries, truncated });
        }

        if (method === "POST" && url === "/api/workspace/open-path") {
            try {
                const payload = await service.readJsonBody<{ path?: string }>(req);
                const p = (payload.path ?? "").trim();
                if (!p) return this.json(res, 400, { error: "Path is required." });
                const { execFile } = await import("node:child_process");
                const { platform: osPlatform } = await import("node:os");
                const platform = osPlatform();
                const bin = platform === "win32" ? "explorer" : platform === "darwin" ? "open" : "xdg-open";
                // execFile with an argument array runs without a shell, so the path
                // cannot break out into command injection.
                execFile(bin, [p], { timeout: 10_000 }, () => {});
                return this.json(res, 200, { ok: true, path: p });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 500, { error: e.message ?? "Failed to open path" });
            }
        }

        // ── File action: download ──────────────────────────────────────────
        if (method === "GET" && url.startsWith("/api/workspace/file/download")) {
            try {
                const parsed = new URL(`http://localhost${url}`);
                const relPath = (parsed.searchParams.get("path") ?? "").trim();
                if (!relPath) return this.json(res, 400, { error: "path is required." });
                if (relPath.includes("..")) return this.json(res, 400, { error: "Path traversal not allowed." });
                const root = resolveWorkspaceRoot();
                const fullPath = join(root, relPath);
                // Confirm the resolved path is still inside the workspace root.
                if (!fullPath.startsWith(root + "/") && !fullPath.startsWith(root + "\\") && fullPath !== root) {
                    return this.json(res, 400, { error: "Path is outside the workspace." });
                }
                if (!existsSync(fullPath)) return this.json(res, 404, { error: "File not found." });
                const stat = statSync(fullPath);
                if (!stat.isFile()) return this.json(res, 400, { error: "Path is not a file." });
                const fileName = relPath.split("/").pop() ?? relPath.split("\\").pop() ?? "download";
                const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
                const textExts = new Set([
                    "txt",
                    "md",
                    "json",
                    "yaml",
                    "yml",
                    "toml",
                    "csv",
                    "log",
                    "ts",
                    "js",
                    "py",
                    "sh",
                    "html",
                    "css",
                    "xml",
                    "ini",
                    "env",
                    "conf",
                ]);
                const mime = textExts.has(ext) ? "text/plain; charset=utf-8" : "application/octet-stream";
                const { readFileSync: rfs } = await import("node:fs");
                const buf = rfs(fullPath);
                res.writeHead(200, {
                    "Content-Type": mime,
                    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
                    "Content-Length": String(buf.length),
                    "Cache-Control": "no-store",
                });
                res.end(buf);
                return;
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 500, { error: e.message ?? "Download failed" });
            }
        }

        // ── File action: delete ────────────────────────────────────────────
        if (method === "DELETE" && url.startsWith("/api/workspace/file/delete")) {
            try {
                const payload = await service.readJsonBody<{ path?: string }>(req);
                const relPath = (payload.path ?? "").trim();
                if (!relPath) return this.json(res, 400, { error: "path is required." });
                if (relPath.includes("..")) return this.json(res, 400, { error: "Path traversal not allowed." });
                const root = resolveWorkspaceRoot();
                const fullPath = join(root, relPath);
                if (!fullPath.startsWith(root + "/") && !fullPath.startsWith(root + "\\") && fullPath !== root) {
                    return this.json(res, 400, { error: "Path is outside the workspace." });
                }
                if (!existsSync(fullPath)) return this.json(res, 404, { error: "File not found." });
                const { rmSync: rm } = await import("node:fs");
                const st = statSync(fullPath);
                if (st.isDirectory()) {
                    rm(fullPath, { recursive: true, force: true });
                } else {
                    rm(fullPath);
                }
                return this.json(res, 200, { ok: true });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 500, { error: e.message ?? "Delete failed" });
            }
        }

        // ── File action: rename ────────────────────────────────────────────
        if (method === "POST" && url === "/api/workspace/file/rename") {
            try {
                const payload = await service.readJsonBody<{ path?: string; newName?: string }>(req);
                const relPath = (payload.path ?? "").trim();
                const newName = (payload.newName ?? "").trim();
                if (!relPath) return this.json(res, 400, { error: "path is required." });
                if (!newName) return this.json(res, 400, { error: "newName is required." });
                if (
                    relPath.includes("..") ||
                    newName.includes("..") ||
                    newName.includes("/") ||
                    newName.includes("\\")
                ) {
                    return this.json(res, 400, { error: "Invalid path or name." });
                }
                const root = resolveWorkspaceRoot();
                const fullPath = join(root, relPath);
                if (!fullPath.startsWith(root + "/") && !fullPath.startsWith(root + "\\") && fullPath !== root) {
                    return this.json(res, 400, { error: "Path is outside the workspace." });
                }
                if (!existsSync(fullPath)) return this.json(res, 404, { error: "File not found." });
                const { renameSync } = await import("node:fs");
                const newFullPath = join(dirname(fullPath), newName);
                if (existsSync(newFullPath))
                    return this.json(res, 409, { error: "A file with that name already exists." });
                renameSync(fullPath, newFullPath);
                const newRelPath = relPath.substring(0, relPath.lastIndexOf("/") + 1) + newName;
                return this.json(res, 200, { ok: true, newPath: newRelPath });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 500, { error: e.message ?? "Rename failed" });
            }
        }

        if (method === "POST" && url === "/api/workspace/open-explorer") {
            const root = resolveWorkspaceRoot();
            try {
                const { execFile } = await import("node:child_process");
                const { platform: osPlatform } = await import("node:os");
                const p = osPlatform();
                const bin = p === "win32" ? "explorer" : p === "darwin" ? "open" : "xdg-open";
                execFile(bin, [root], { timeout: 10_000 }, () => {});
                return this.json(res, 200, { ok: true, path: root });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 500, { error: e.message ?? "Failed to open explorer" });
            }
        }

        if (method === "POST" && url === "/api/workspace/relocate") {
            try {
                const payload = await service.readJsonBody<{ path?: string }>(req);
                const newPath = (payload.path ?? "").trim();
                if (!newPath) return this.json(res, 400, { error: "Path is required." });
                const { isAbsolute } = await import("node:path");
                if (!isAbsolute(newPath)) {
                    return this.json(res, 400, {
                        error: "Path must be absolute (e.g. C:\\Users\\you\\Documents\\MyWorkspace).",
                    });
                }
                const { platform: osPlatform } = await import("node:os");
                const unsafe = this.unsafeRelocationReason(newPath, osPlatform());
                if (unsafe) {
                    return this.json(res, 400, { error: unsafe });
                }
                setWorkspaceRoot(newPath);
                ensureWorkspaceStructure();
                seedDefaultCharacters();
                return this.json(res, 200, { ok: true, workspaceRoot: resolveWorkspaceRoot() });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 500, { error: e.message ?? "Failed to relocate workspace" });
            }
        }

        if (method === "POST" && url === "/api/workspace/import") {
            try {
                const payload = await service.readJsonBody<{
                    mode?: string;
                    fileName?: string;
                    content?: string;
                    targetDir?: string;
                    registeredType?: string;
                    files?: Array<{ name: string; content: string; relativePath?: string }>;
                }>(req);
                const mode = (payload.mode ?? "").trim();
                if (!mode || !["general", "registered", "folder"].includes(mode)) {
                    return this.json(res, 400, { error: "mode must be 'general', 'registered', or 'folder'." });
                }
                const root = resolveWorkspaceRoot();
                const blockedExtensions = [
                    ".exe",
                    ".bat",
                    ".cmd",
                    ".ps1",
                    ".sh",
                    ".msi",
                    ".dll",
                    ".sys",
                    ".com",
                    ".scr",
                    ".vbs",
                    ".jar",
                    ".app",
                ];
                const VALID_TARGET_DIRS = [
                    "config",
                    "artifacts",
                    "data",
                    "data/tasks",
                    "data/notes",
                    "data/email",
                    "data/calendar",
                    "logs",
                    "workspace",
                    "state",
                ];
                const REGISTERED_TYPES: Record<
                    string,
                    { targetDir: string; validate: (parsed: unknown) => string | null }
                > = {
                    "mcp-config": {
                        targetDir: "config",
                        validate: (p: unknown) => {
                            const o = p as Record<string, unknown>;
                            if (!o.mcpServers || typeof o.mcpServers !== "object")
                                return "MCP config must have a 'mcpServers' object.";
                            return null;
                        },
                    },
                    "session-package": {
                        targetDir: "artifacts/packages",
                        validate: (p: unknown) => {
                            const o = p as Record<string, unknown>;
                            if (!o.exportedAt && !o.package)
                                return "Session package must have 'exportedAt' or 'package' field.";
                            return null;
                        },
                    },
                    "tool-contract": {
                        targetDir: "artifacts/contracts",
                        validate: (p: unknown) => {
                            const o = p as Record<string, unknown>;
                            if (!Array.isArray(o.tools)) return "Tool contract must have a 'tools' array.";
                            return null;
                        },
                    },
                    "self-review": {
                        targetDir: "artifacts/self-review",
                        validate: (p: unknown) => {
                            const o = p as Record<string, unknown>;
                            if (!o.generatedAt) return "Self-review report must have a 'generatedAt' field.";
                            return null;
                        },
                    },
                    "task-timeline": {
                        targetDir: "data/tasks",
                        validate: (p: unknown) => {
                            const o = p as Record<string, unknown>;
                            if (!o.timelineId || !Array.isArray(o.tasks))
                                return "Task timeline must have 'timelineId' and 'tasks' array.";
                            return null;
                        },
                    },
                    note: { targetDir: "data/notes", validate: () => null },
                };
                const importHistory = service.getImportHistory();

                // ── Folder import ──
                if (mode === "folder") {
                    const targetDir = (payload.targetDir ?? "").trim();
                    if (!targetDir || !VALID_TARGET_DIRS.includes(targetDir)) {
                        return this.json(res, 400, {
                            error: "targetDir must be one of: " + VALID_TARGET_DIRS.join(", "),
                        });
                    }
                    const files = payload.files;
                    if (!Array.isArray(files) || files.length === 0) {
                        return this.json(res, 400, { error: "No files provided for folder import." });
                    }
                    if (files.length > 500) {
                        return this.json(res, 400, { error: "Folder import limited to 500 files at a time." });
                    }
                    const results: Array<{ name: string; status: string; message: string }> = [];
                    const MAX_FILE_BYTES = 10 * 1024 * 1024;
                    const MAX_AGGREGATE_BYTES = 200 * 1024 * 1024;
                    let aggregateBytes = 0;
                    for (const file of files) {
                        const relPath = (file.relativePath ?? file.name).replace(/\\/g, "/");
                        if (relPath.includes("..")) {
                            results.push({ name: relPath, status: "rejected", message: "Path traversal not allowed." });
                            continue;
                        }
                        const ext = "." + relPath.split(".").pop()?.toLowerCase();
                        if (blockedExtensions.includes(ext)) {
                            results.push({
                                name: relPath,
                                status: "rejected",
                                message: "Executable file types are not allowed.",
                            });
                            continue;
                        }
                        // Reject on estimated size BEFORE decoding into memory.
                        const declaredBytes = this.base64DecodedSize(file.content ?? "");
                        if (declaredBytes > MAX_FILE_BYTES) {
                            results.push({ name: relPath, status: "rejected", message: "File exceeds 10 MB limit." });
                            continue;
                        }
                        if (aggregateBytes + declaredBytes > MAX_AGGREGATE_BYTES) {
                            results.push({
                                name: relPath,
                                status: "rejected",
                                message: "Folder import exceeds 200 MB total limit.",
                            });
                            continue;
                        }
                        try {
                            const buf = Buffer.from(file.content, "base64");
                            if (buf.length > MAX_FILE_BYTES) {
                                results.push({
                                    name: relPath,
                                    status: "rejected",
                                    message: "File exceeds 10 MB limit.",
                                });
                                continue;
                            }
                            if (this.looksExecutable(buf)) {
                                results.push({
                                    name: relPath,
                                    status: "rejected",
                                    message: "Executable content is not allowed.",
                                });
                                continue;
                            }
                            aggregateBytes += buf.length;
                            const fullPath = join(root, targetDir, relPath);
                            const dir = dirname(fullPath);
                            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                            writeFileSync(fullPath, buf);
                            results.push({ name: relPath, status: "imported", message: "OK" });
                        } catch (fe: unknown) {
                            results.push({
                                name: relPath,
                                status: "error",
                                message: (fe as { message?: string }).message ?? "Write failed",
                            });
                        }
                    }
                    const imported = results.filter((r) => r.status === "imported").length;
                    const entry = {
                        id: Date.now().toString(36),
                        timestamp: new Date().toISOString(),
                        mode: "folder",
                        fileName: imported + " files into " + targetDir,
                        targetDir,
                        registeredType: null,
                        status: imported === files.length ? "success" : "partial",
                        message: imported + "/" + files.length + " files imported",
                        size: 0,
                    };
                    importHistory.unshift(entry);
                    if (importHistory.length > 100) importHistory.length = 100;
                    return this.json(res, 200, { ok: true, results, summary: entry });
                }

                // ── General + Registered single-file import ──
                const fileName = (payload.fileName ?? "").trim();
                const content = (payload.content ?? "").trim();
                if (!fileName) return this.json(res, 400, { error: "fileName is required." });
                if (!content) return this.json(res, 400, { error: "content (base64) is required." });
                if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
                    return this.json(res, 400, { error: "fileName must not contain path separators or '..'." });
                }
                // Reject on estimated size BEFORE decoding into memory (DoS guard).
                if (this.base64DecodedSize(content) > 10 * 1024 * 1024) {
                    return this.json(res, 400, { error: "File exceeds 10 MB size limit." });
                }
                const buf = Buffer.from(content, "base64");
                if (buf.length > 10 * 1024 * 1024) {
                    return this.json(res, 400, { error: "File exceeds 10 MB size limit." });
                }
                const ext = "." + fileName.split(".").pop()?.toLowerCase();
                // Executable policy applies to ALL profiles, by extension and by content.
                if (blockedExtensions.includes(ext)) {
                    return this.json(res, 400, { error: "Executable file types are not allowed." });
                }
                if (this.looksExecutable(buf)) {
                    return this.json(res, 400, { error: "Executable content is not allowed." });
                }

                if (mode === "registered") {
                    const rType = (payload.registeredType ?? "").trim();
                    if (!rType || !REGISTERED_TYPES[rType]) {
                        return this.json(res, 400, {
                            error: "registeredType must be one of: " + Object.keys(REGISTERED_TYPES).join(", "),
                        });
                    }
                    const spec = REGISTERED_TYPES[rType]!;
                    let parsed: unknown = null;
                    const isJson = ext === ".json";
                    if (isJson) {
                        try {
                            parsed = JSON.parse(buf.toString("utf-8"));
                        } catch {
                            return this.json(res, 400, { error: "File is not valid JSON." });
                        }
                        const vErr = spec.validate(parsed);
                        if (vErr) return this.json(res, 400, { error: "Validation failed: " + vErr });
                    }
                    const destDir = join(root, spec.targetDir);
                    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
                    let destName = rType === "mcp-config" ? "mcp-settings.json" : fileName;
                    const destPath = join(destDir, destName);
                    if (existsSync(destPath)) {
                        const ts = Date.now().toString(36);
                        const parts = destName.split(".");
                        if (parts.length > 1) {
                            parts[parts.length - 2] += "-" + ts;
                            destName = parts.join(".");
                        } else {
                            destName = destName + "-" + ts;
                        }
                    }
                    writeFileSync(join(destDir, destName), buf);
                    const entry = {
                        id: Date.now().toString(36),
                        timestamp: new Date().toISOString(),
                        mode: "registered",
                        fileName: destName,
                        targetDir: spec.targetDir,
                        registeredType: rType,
                        status: "success",
                        message: "Imported as " + rType + " to " + spec.targetDir + "/" + destName,
                        size: buf.length,
                    };
                    importHistory.unshift(entry);
                    if (importHistory.length > 100) importHistory.length = 100;
                    return this.json(res, 200, { ok: true, entry });
                }

                // ── General import ──
                const targetDir = (payload.targetDir ?? "").trim();
                if (!targetDir || !VALID_TARGET_DIRS.includes(targetDir)) {
                    return this.json(res, 400, { error: "targetDir must be one of: " + VALID_TARGET_DIRS.join(", ") });
                }
                const destDir = join(root, targetDir);
                if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
                let destName = fileName;
                if (existsSync(join(destDir, destName))) {
                    const ts = Date.now().toString(36);
                    const parts = destName.split(".");
                    if (parts.length > 1) {
                        parts[parts.length - 2] += "-" + ts;
                        destName = parts.join(".");
                    } else {
                        destName = destName + "-" + ts;
                    }
                }
                writeFileSync(join(destDir, destName), buf);
                const entry = {
                    id: Date.now().toString(36),
                    timestamp: new Date().toISOString(),
                    mode: "general",
                    fileName: destName,
                    targetDir,
                    registeredType: null,
                    status: "success",
                    message: "Imported to " + targetDir + "/" + destName,
                    size: buf.length,
                };
                importHistory.unshift(entry);
                if (importHistory.length > 100) importHistory.length = 100;
                return this.json(res, 200, { ok: true, entry });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 500, { error: e.message ?? "Import failed" });
            }
        }

        if (method === "GET" && url === "/api/workspace/import/history") {
            return this.json(res, 200, { history: service.getImportHistory() });
        }

        if (method === "GET" && url === "/api/workspace/git-status") {
            const root = resolveWorkspaceRoot();
            try {
                const { execFile: execFileCb } = await import("node:child_process");
                const { promisify } = await import("node:util");
                const execFile = promisify(execFileCb);
                const gitResult = await execFile("git", ["status", "--porcelain"], {
                    cwd: root,
                    timeout: 10_000,
                }).catch(() => null);
                const branchResult = await execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
                    cwd: root,
                    timeout: 5_000,
                }).catch(() => null);
                const remoteResult = await execFile("git", ["remote", "-v"], { cwd: root, timeout: 5_000 }).catch(
                    () => null,
                );
                return this.json(res, 200, {
                    isGitRepo: gitResult !== null,
                    branch: branchResult?.stdout?.trim() ?? null,
                    remote: remoteResult?.stdout?.trim() ?? null,
                    changedFiles: gitResult?.stdout?.trim()?.split("\n").filter(Boolean).length ?? 0,
                });
            } catch {
                return this.json(res, 200, { isGitRepo: false, branch: null, remote: null, changedFiles: 0 });
            }
        }

        this.json(res, 404, { error: "Workspace route not found" });
    }

    private json(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
    }

    /**
     * Rejects workspace-relocation targets that point at a drive/filesystem root
     * or a protected system directory. Prevents pointing the workspace (and the
     * recursive /files enumeration) at arbitrary sensitive locations.
     * Returns an error message string when the target is unsafe, otherwise null.
     */
    private unsafeRelocationReason(target: string, osPlatform: NodeJS.Platform): string | null {
        const norm = target.replace(/[\\/]+$/, "");
        if (osPlatform === "win32") {
            // Drive root: "C:", "C:\", "C:/"
            if (/^[A-Za-z]:$/.test(norm)) return "Cannot use a drive root as the workspace.";
        } else if (norm === "") {
            // POSIX filesystem root "/"
            return "Cannot use the filesystem root as the workspace.";
        }
        const lower = norm.toLowerCase();
        const sep = osPlatform === "win32" ? "\\" : "/";
        const winDeny = ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata"];
        const posixDeny = [
            "/etc",
            "/bin",
            "/sbin",
            "/usr",
            "/boot",
            "/dev",
            "/proc",
            "/sys",
            "/var",
            "/lib",
            "/lib64",
            "/root",
            "/system",
        ];
        const deny = osPlatform === "win32" ? winDeny : posixDeny;
        for (const d of deny) {
            if (lower === d || lower.startsWith(d + sep)) {
                return `Location '${d}' is a protected system directory and cannot be used as the workspace.`;
            }
        }
        return null;
    }

    /**
     * Estimates the decoded byte length of a base64 string without allocating a
     * Buffer, so oversized payloads can be rejected before decoding into memory.
     */
    private base64DecodedSize(b64: string): number {
        const len = b64.length;
        if (len === 0) return 0;
        const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
        return Math.floor(len / 4) * 3 - padding;
    }

    /**
     * Detects common native-executable / script magic bytes so executables can be
     * blocked regardless of file extension (defense against double-extension and
     * extension-stripping bypasses).
     */
    private looksExecutable(buf: Buffer): boolean {
        if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return true; // "MZ" — Windows PE (.exe/.dll)
        if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return true; // ELF
        if (buf.length >= 4 && buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) return true; // Mach-O 64 LE
        if (buf.length >= 4 && buf[0] === 0xce && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) return true; // Mach-O 32 LE
        if (
            buf.length >= 4 &&
            buf[0] === 0xfe &&
            buf[1] === 0xed &&
            buf[2] === 0xfa &&
            (buf[3] === 0xce || buf[3] === 0xcf)
        )
            return true; // Mach-O BE
        if (buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21) return true; // "#!" — shebang script
        return false;
    }
}
