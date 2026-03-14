/**
 * Notes Adapter — file-backed note capture, persistence, and extraction tool.
 *
 * Notes are stored as Markdown files in {dataDir}/notes/{noteId}.md.
 * Extracted action items are written alongside as {noteId}.extracted.json.
 * The data directory defaults to prism-data/ and is overridable via PRISM_DATA_DIR.
 *
 * Operations (action arg):
 *   capture  — read existing note content (or return empty); no mutation
 *   persist  — write provided content to the note file
 *   extract  — heuristic extraction of action items and key sections from note
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Data types
// ──────────────────────────────────────────────────────────────────────────────

export interface NoteExtraction {
    noteId: string;
    extractedAt: string;
    actionItems: string[];
    headings: string[];
    wordCount: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function dataDir(): string {
    return join(process.env.PRISM_DATA_DIR ?? "prism-data", "notes");
}

function notePath(dir: string, noteId: string): string {
    return join(dir, `${noteId}.md`);
}

function extractionPath(dir: string, noteId: string): string {
    return join(dir, `${noteId}.extracted.json`);
}

/**
 * Heuristic extraction: find Markdown task items (- [ ] / - [x]) and
 * lines starting with TODO:, headings (# / ##), and count words.
 */
function extractFromContent(noteId: string, content: string): NoteExtraction {
    const lines = content.split("\n");
    const actionItems = lines
        .filter((l) => /^[-*]\s+\[[ x]\]/.test(l) || /^TODO:/i.test(l.trim()))
        .map((l) => l.trim());
    const headings = lines
        .filter((l) => /^#{1,3} /.test(l))
        .map((l) => l.trim());
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    return {
        noteId,
        extractedAt: new Date().toISOString(),
        actionItems,
        headings,
        wordCount,
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool
// ──────────────────────────────────────────────────────────────────────────────

export class NotesExtractTool implements Tool {
    readonly name = "notes_extract";

    constructor(private readonly _dataDir?: string) {}

    async execute(request: ToolRequest): Promise<ToolResult> {
        const args = request.args as {
            action?: string;
            noteId?: string;
            content?: string;
        };

        const action = args.action ?? "";
        const noteId = args.noteId ?? "note-default";
        const dir = this._dataDir ?? dataDir();

        switch (action) {
            case "capture": {
                const path = notePath(dir, noteId);
                const content = existsSync(path) ? readFileSync(path, "utf-8") : "";
                return {
                    ok: true,
                    output: {
                        noteId,
                        content,
                        exists: existsSync(path),
                        charCount: content.length,
                    },
                };
            }

            case "persist": {
                const content = args.content ?? "";
                if (!content) {
                    return { ok: false, output: { error: "content is required for persist action", noteId } };
                }
                mkdirSync(dir, { recursive: true });
                const path = notePath(dir, noteId);
                writeFileSync(path, content, "utf-8");
                return {
                    ok: true,
                    output: { noteId, charCount: content.length, path },
                    sideEffects: [{ type: "file", description: `note persisted: ${path}` }],
                };
            }

            case "extract": {
                const path = notePath(dir, noteId);
                if (!existsSync(path)) {
                    return { ok: false, output: { error: "Note not found — capture or persist first", noteId } };
                }
                const content = readFileSync(path, "utf-8");
                const extraction = extractFromContent(noteId, content);
                mkdirSync(dir, { recursive: true });
                const exPath = extractionPath(dir, noteId);
                writeFileSync(exPath, JSON.stringify(extraction, null, 2), "utf-8");
                return {
                    ok: true,
                    output: extraction as unknown as Record<string, unknown>,
                    sideEffects: [{ type: "file", description: `extraction saved: ${exPath}` }],
                };
            }

            default:
                return { ok: false, output: { error: `Unknown notes action: ${action}` } };
        }
    }
}
