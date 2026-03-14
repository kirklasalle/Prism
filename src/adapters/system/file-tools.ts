import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

export class FileReadTool implements Tool {
    readonly name = "file_read";
    readonly contract = {
        version: "1.0.0",
        args: {
            path: { type: "string", required: true },
            encoding: { type: "string" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const filePath = String(request.args.path ?? "");
        const encoding = (request.args.encoding as BufferEncoding | undefined) ?? "utf-8";
        try {
            const content = await fs.readFile(filePath, encoding);
            const stats = await fs.stat(filePath);
            return {
                ok: true,
                output: { path: filePath, content, sizeBytes: stats.size },
            };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err), path: filePath } };
        }
    }
}

export class FileWriteTool implements Tool {
    readonly name = "file_write";
    readonly contract = {
        version: "1.0.0",
        args: {
            path: { type: "string", required: true },
            content: { type: "string", required: true },
            append: { type: "boolean" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const filePath = String(request.args.path ?? "");
        const content = String(request.args.content ?? "");
        const append = Boolean(request.args.append ?? false);
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            if (append) {
                await fs.appendFile(filePath, content, "utf-8");
            } else {
                await fs.writeFile(filePath, content, "utf-8");
            }
            const stats = await fs.stat(filePath);
            return {
                ok: true,
                output: { path: filePath, bytesWritten: stats.size, appended: append },
                sideEffects: [{ type: "file", description: `written: ${filePath}` }],
            };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err), path: filePath } };
        }
    }
}

export class FileDeleteTool implements Tool {
    readonly name = "file_delete";
    readonly contract = {
        version: "1.0.0",
        args: {
            path: { type: "string", required: true },
            recursive: { type: "boolean" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const filePath = String(request.args.path ?? "");
        const recursive = Boolean(request.args.recursive ?? false);
        try {
            await fs.rm(filePath, { recursive });
            return {
                ok: true,
                output: { path: filePath, deleted: true },
                sideEffects: [{ type: "file", description: `deleted: ${filePath}` }],
            };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err), path: filePath } };
        }
    }
}

export class FileListTool implements Tool {
    readonly name = "file_list";
    readonly contract = {
        version: "1.0.0",
        args: {
            path: { type: "string" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const dirPath = String(request.args.path ?? ".");
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            return {
                ok: true,
                output: {
                    path: dirPath,
                    count: entries.length,
                    entries: entries.map((e) => ({ name: e.name, isDir: e.isDirectory() })),
                },
            };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err), path: dirPath } };
        }
    }
}
