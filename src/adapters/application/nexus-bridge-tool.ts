/**
 * Nexus Bridge Adapter — bidirectional communication between PRISM and Nexus.
 *
 * Protocol: Structured Thread Protocol (STP) over shared markdown files.
 *
 * Files used:
 *   PRISM thread : D:\Projects\.nexus\bridge\VS_Code\Thread_Active.md
 *   Hotline      : D:\Projects\.nexus\bridge\hotline.md  (broadcast)
 *   Memory       : G:\Users\kirkl\.openclaw\workspace\memory\MEMORY.md
 *   Daily log    : G:\Users\kirkl\.openclaw\workspace\memory\<YYYY-MM-DD>.md
 *
 * Governance:
 *   nexus_check_hotline  — low risk  (read-only)
 *   nexus_read_memory    — low risk  (read-only)
 *   nexus_log_insight    — medium risk (append to memory)
 *   nexus_broadcast      — medium risk (append to shared thread / hotline)
 */
import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Configuration — all paths configurable via environment variables
// ──────────────────────────────────────────────────────────────────────────────

function resolvePaths() {
    return {
        prismThread:
            process.env.NEXUS_PRISM_THREAD ??
            "D:\\Projects\\.nexus\\bridge\\VS_Code\\Thread_Active.md",
        hotline:
            process.env.NEXUS_HOTLINE ??
            "D:\\Projects\\.nexus\\bridge\\hotline.md",
        memoryDir:
            process.env.NEXUS_MEMORY_DIR ??
            "G:\\Users\\kirkl\\.openclaw\\workspace\\memory",
    };
}

function memoryFilePath(dir: string, date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return join(dir, `${y}-${m}-${d}.md`);
}

function memoryMainPath(dir: string): string {
    return join(dir, "MEMORY.md");
}

function stpHeader(subject: string, from = "PRISM"): string {
    const now = new Date();
    const date = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";
    return `\n---\n**Date:** ${date}\n**From:** ${from}\n**To:** Nexus\n**Subject:** ${subject}\n\n`;
}

function safeReadFile(path: string): string {
    try {
        return readFileSync(path, "utf-8");
    } catch (err: unknown) {
        return "";
    }
}

function safeAppend(path: string, content: string): void {
    const dir = dirname(path);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    appendFileSync(path, content, "utf-8");
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool: nexus_check_hotline — read the hotline broadcast file
// ──────────────────────────────────────────────────────────────────────────────

export class NexusCheckHotlineTool implements Tool {
    readonly name = "nexus_check_hotline";
    readonly contract = {
        version: "1.0.0",
        args: {
            maxChars: { type: "number" as const },
        },
    } as const;

    execute(request: ToolRequest): Promise<ToolResult> {
        const paths = resolvePaths();
        const maxChars = Number(request.args.maxChars ?? 4000);

        const content = safeReadFile(paths.hotline);
        const snippet = content.length > maxChars ? content.slice(-maxChars) : content;

        return Promise.resolve({
            ok: true,
            output: {
                path: paths.hotline,
                length: content.length,
                snippet,
                hasContent: content.trim().length > 0,
            },
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool: nexus_read_memory — read Nexus's primary MEMORY.md
// ──────────────────────────────────────────────────────────────────────────────

export class NexusReadMemoryTool implements Tool {
    readonly name = "nexus_read_memory";
    readonly contract = {
        version: "1.0.0",
        args: {
            maxChars: { type: "number" as const },
        },
    } as const;

    execute(request: ToolRequest): Promise<ToolResult> {
        const paths = resolvePaths();
        const maxChars = Number(request.args.maxChars ?? 8000);
        const path = memoryMainPath(paths.memoryDir);

        const content = safeReadFile(path);
        if (!content) {
            return Promise.resolve({
                ok: false,
                output: { error: `Memory file not found or empty: ${path}` },
            });
        }

        const snippet = content.length > maxChars ? content.slice(0, maxChars) : content;

        return Promise.resolve({
            ok: true,
            output: { path, length: content.length, content: snippet },
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool: nexus_log_insight — append to today's Nexus daily memory log
// ──────────────────────────────────────────────────────────────────────────────

export class NexusLogInsightTool implements Tool {
    readonly name = "nexus_log_insight";
    readonly contract = {
        version: "1.0.0",
        args: {
            content: { type: "string" as const, required: true },
            category: { type: "string" as const },
        },
    } as const;

    execute(request: ToolRequest): Promise<ToolResult> {
        const paths = resolvePaths();
        const content = String(request.args.content ?? "").trim();
        const category = String(request.args.category ?? "PRISM Insight");

        if (!content) {
            return Promise.resolve({ ok: false, output: { error: "content is required" } });
        }

        const dailyPath = memoryFilePath(paths.memoryDir, new Date());
        const entry = `\n## ${category}\n\n${content}\n`;

        try {
            safeAppend(dailyPath, entry);
            return Promise.resolve({
                ok: true,
                output: {
                    path: dailyPath,
                    category,
                    charsWritten: entry.length,
                },
                sideEffects: [
                    {
                        type: "file" as const,
                        description: `Appended insight to Nexus daily memory: ${dailyPath}`,
                    },
                ],
            });
        } catch (err: unknown) {
            return Promise.resolve({
                ok: false,
                output: { error: String(err), path: dailyPath },
            });
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool: nexus_broadcast — write an STP message to the bridge thread or hotline
// ──────────────────────────────────────────────────────────────────────────────

export class NexusBroadcastTool implements Tool {
    readonly name = "nexus_broadcast";
    readonly contract = {
        version: "1.0.0",
        args: {
            subject: { type: "string" as const, required: true },
            message: { type: "string" as const, required: true },
            useHotline: { type: "boolean" as const },
        },
    } as const;

    execute(request: ToolRequest): Promise<ToolResult> {
        const paths = resolvePaths();
        const subject = String(request.args.subject ?? "").trim();
        const message = String(request.args.message ?? "").trim();
        const useHotline = Boolean(request.args.useHotline ?? false);

        if (!subject) return Promise.resolve({ ok: false, output: { error: "subject is required" } });
        if (!message) return Promise.resolve({ ok: false, output: { error: "message is required" } });

        const targetPath = useHotline ? paths.hotline : paths.prismThread;
        const entry = stpHeader(subject) + message + "\n";

        try {
            safeAppend(targetPath, entry);
            return Promise.resolve({
                ok: true,
                output: {
                    path: targetPath,
                    subject,
                    charsWritten: entry.length,
                    channel: useHotline ? "hotline" : "prism-thread",
                },
                sideEffects: [
                    {
                        type: "file" as const,
                        description: `STP message sent to Nexus bridge: ${targetPath}`,
                    },
                ],
            });
        } catch (err: unknown) {
            return Promise.resolve({
                ok: false,
                output: { error: String(err), path: targetPath, subject },
            });
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Factory
// ──────────────────────────────────────────────────────────────────────────────

/** Return all four Nexus bridge tools, ready to register in ToolRegistry. */
export function nexusBridgeTools(): Tool[] {
    return [
        new NexusCheckHotlineTool(),
        new NexusReadMemoryTool(),
        new NexusLogInsightTool(),
        new NexusBroadcastTool(),
    ];
}
