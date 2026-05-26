import { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
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
                try { manifest = JSON.parse(readFileSync(manifestPath, "utf-8")); } catch { /* ignore */ }
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
            const operatorEmail = parsed.searchParams.get("operatorEmail")?.trim();
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
            const operatorEmail = parsed.searchParams.get("operatorEmail")?.trim().toLowerCase() ?? "";
            const limitRaw = Number(parsed.searchParams.get("limit") ?? "20");
            const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;
            const events = service.getActivityBus()
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
                    characterId?: string; prismUserId?: string; prismUserEmail?: string;
                    operatorId?: string; operatorEmail?: string; clientId?: string;
                    sessionId?: string; executionProfile?: string; workspaceHub?: string;
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
                    executionProfile: String(body.executionProfile ?? status.executionProfileSegment).trim() || status.executionProfileSegment,
                    workspaceHub: String(body.workspaceHub ?? getWorkspaceHub()).trim(),
                });
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
                    return this.json(res, 422, { ok: false, shape: result.shape, errors: result.errors, warnings: result.warnings });
                }
                if (body.commit) {
                    const dir = workspaceCharactersDir();
                    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                    const destPath = join(dir, `${result.character.name}.json`);
                    if (existsSync(destPath)) {
                        return this.json(res, 409, { ok: false, error: `character_already_exists: ${result.character.name}`, shape: result.shape });
                    }
                    writeFileSync(destPath, JSON.stringify(result.character, null, 2) + "\n", "utf-8");
                    return this.json(res, 201, { ok: true, committed: true, shape: result.shape, warnings: result.warnings, character: result.character, path: destPath });
                }
                return this.json(res, 200, { ok: true, committed: false, shape: result.shape, warnings: result.warnings, character: result.character });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 400, { error: e.message ?? "Import failed" });
            }
        }

        if (method === "GET" && url === "/api/workspace/files") {
            const root = resolveWorkspaceRoot();
            if (!existsSync(root)) return this.json(res, 200, { root, entries: [] });
            const walkDir = (dir: string, prefix: string): Array<{ name: string; path: string; type: "file" | "dir"; size: number }> => {
                const results: Array<{ name: string; path: string; type: "file" | "dir"; size: number }> = [];
                let items: string[];
                try { items = readdirSync(dir); } catch { return results; }
                for (const item of items) {
                    const fullPath = join(dir, item);
                    const relPath = prefix ? prefix + "/" + item : item;
                    try {
                        const st = statSync(fullPath);
                        if (st.isDirectory()) {
                            results.push({ name: item, path: relPath, type: "dir", size: 0 });
                            results.push(...walkDir(fullPath, relPath));
                        } else {
                            results.push({ name: item, path: relPath, type: "file", size: st.size });
                        }
                    } catch { /* skip inaccessible */ }
                }
                return results;
            };
            return this.json(res, 200, { root, entries: walkDir(root, "") });
        }

        if (method === "POST" && url === "/api/workspace/open-path") {
            try {
                const payload = await service.readJsonBody<{ path?: string }>(req);
                const p = (payload.path ?? "").trim();
                if (!p) return this.json(res, 400, { error: "Path is required." });
                const { exec: execCb } = await import("node:child_process");
                const { platform: osPlatform } = await import("node:os");
                const platform = osPlatform();
                const cmd = platform === "win32" ? `explorer "${p}"` : platform === "darwin" ? `open "${p}"` : `xdg-open "${p}"`;
                execCb(cmd, { timeout: 10_000 }, () => { });
                return this.json(res, 200, { ok: true, path: p });
            } catch (err: unknown) {
                const e = err as { message?: string };
                return this.json(res, 500, { error: e.message ?? "Failed to open path" });
            }
        }

        if (method === "POST" && url === "/api/workspace/open-explorer") {
            const root = resolveWorkspaceRoot();
            try {
                const { exec: execCb } = await import("node:child_process");
                const { platform: osPlatform } = await import("node:os");
                const p = osPlatform();
                const cmd = p === "win32" ? `explorer "${root}"` : p === "darwin" ? `open "${root}"` : `xdg-open "${root}"`;
                execCb(cmd, { timeout: 10_000 }, () => { });
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
                    return this.json(res, 400, { error: "Path must be absolute (e.g. C:\\Users\\you\\Documents\\MyWorkspace)." });
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
                    mode?: string; fileName?: string; content?: string;
                    targetDir?: string; registeredType?: string;
                    files?: Array<{ name: string; content: string; relativePath?: string }>;
                }>(req);
                const mode = (payload.mode ?? "").trim();
                if (!mode || !["general", "registered", "folder"].includes(mode)) {
                    return this.json(res, 400, { error: "mode must be 'general', 'registered', or 'folder'." });
                }
                const root = resolveWorkspaceRoot();
                const profile = service.getRuntimeStatus().executionProfileSegment || "individual";
                const blockedExtensions = [".exe", ".bat", ".cmd", ".ps1", ".sh", ".msi", ".dll", ".sys"];
                const VALID_TARGET_DIRS = ["config", "artifacts", "data", "data/tasks", "data/notes", "data/email", "data/calendar", "characters", "logs", "workspace", "state"];
                const REGISTERED_TYPES: Record<string, { targetDir: string; validate: (parsed: unknown) => string | null }> = {
                    character: {
                        targetDir: "characters",
                        validate: (p: unknown) => {
                            const o = p as Record<string, unknown>;
                            if (!o.name || typeof o.name !== "string") return "Character must have a 'name' field.";
                            if (!o.systemPrompt && !o.persona) return "Character must have a 'systemPrompt' or 'persona' field.";
                            return null;
                        },
                    },
                    "mcp-config": {
                        targetDir: "config",
                        validate: (p: unknown) => {
                            const o = p as Record<string, unknown>;
                            if (!o.mcpServers || typeof o.mcpServers !== "object") return "MCP config must have a 'mcpServers' object.";
                            return null;
                        },
                    },
                    "session-package": {
                        targetDir: "artifacts/packages",
                        validate: (p: unknown) => {
                            const o = p as Record<string, unknown>;
                            if (!o.exportedAt && !o.package) return "Session package must have 'exportedAt' or 'package' field.";
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
                            if (!o.timelineId || !Array.isArray(o.tasks)) return "Task timeline must have 'timelineId' and 'tasks' array.";
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
                        return this.json(res, 400, { error: "targetDir must be one of: " + VALID_TARGET_DIRS.join(", ") });
                    }
                    const files = payload.files;
                    if (!Array.isArray(files) || files.length === 0) {
                        return this.json(res, 400, { error: "No files provided for folder import." });
                    }
                    if (files.length > 500) {
                        return this.json(res, 400, { error: "Folder import limited to 500 files at a time." });
                    }
                    const results: Array<{ name: string; status: string; message: string }> = [];
                    for (const file of files) {
                        const relPath = (file.relativePath ?? file.name).replace(/\\/g, "/");
                        if (relPath.includes("..")) {
                            results.push({ name: relPath, status: "rejected", message: "Path traversal not allowed." });
                            continue;
                        }
                        const ext = "." + relPath.split(".").pop()?.toLowerCase();
                        if (profile === "business" && blockedExtensions.includes(ext)) {
                            results.push({ name: relPath, status: "rejected", message: "Executable blocked by business profile." });
                            continue;
                        }
                        try {
                            const buf = Buffer.from(file.content, "base64");
                            if (buf.length > 10 * 1024 * 1024) {
                                results.push({ name: relPath, status: "rejected", message: "File exceeds 10 MB limit." });
                                continue;
                            }
                            const fullPath = join(root, targetDir, relPath);
                            const dir = dirname(fullPath);
                            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                            writeFileSync(fullPath, buf);
                            results.push({ name: relPath, status: "imported", message: "OK" });
                        } catch (fe: unknown) {
                            results.push({ name: relPath, status: "error", message: (fe as { message?: string }).message ?? "Write failed" });
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
                const buf = Buffer.from(content, "base64");
                if (buf.length > 10 * 1024 * 1024) {
                    return this.json(res, 400, { error: "File exceeds 10 MB size limit." });
                }
                const ext = "." + fileName.split(".").pop()?.toLowerCase();
                if (profile === "business" && blockedExtensions.includes(ext)) {
                    return this.json(res, 400, { error: "Executable file types are blocked under Business profile policy." });
                }

                if (mode === "registered") {
                    const rType = (payload.registeredType ?? "").trim();
                    if (!rType || !REGISTERED_TYPES[rType]) {
                        return this.json(res, 400, { error: "registeredType must be one of: " + Object.keys(REGISTERED_TYPES).join(", ") });
                    }
                    const spec = REGISTERED_TYPES[rType]!;
                    let parsed: unknown = null;
                    const isJson = ext === ".json";
                    if (isJson) {
                        try { parsed = JSON.parse(buf.toString("utf-8")); } catch {
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
                const { exec: execCb } = await import("node:child_process");
                const { promisify } = await import("node:util");
                const exec = promisify(execCb);
                const gitResult = await exec("git status --porcelain", { cwd: root, timeout: 10_000 }).catch(() => null);
                const branchResult = await exec("git rev-parse --abbrev-ref HEAD", { cwd: root, timeout: 5_000 }).catch(() => null);
                const remoteResult = await exec("git remote -v", { cwd: root, timeout: 5_000 }).catch(() => null);
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
}
