import { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import matter from "gray-matter";
import type { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";

interface DocIndexItem {
    filename: string;
    title: string;
    mtime: number;
    category?: string;
    tags?: string[];
    excerpt?: string;
}

interface WikiMatterFile<T = Record<string, unknown>> {
    content: string;
    data: T;
}

export class WikiHandler implements IRouteHandler {
    match(req: IncomingMessage): boolean {
        const url = req.url ?? "";
        return url.startsWith("/api/wiki/") || url === "/api/wiki";
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const rawUrl = req.url ?? "";
        const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
        const method = req.method?.toUpperCase() ?? "GET";

        const rootDocsDir = resolve(process.cwd(), "docs");

        if (method === "GET" && url === "/api/wiki/docs") {
            if (!existsSync(rootDocsDir)) {
                return this.json(res, 200, { documents: [] });
            }

            try {
                const markdownFiles = this.collectMarkdownFiles(rootDocsDir);
                const docs: DocIndexItem[] = markdownFiles.map((fullPath) => {
                    const stat = statSync(fullPath);
                    const relativePath = relative(rootDocsDir, fullPath).replace(/\\/g, "/");
                    const raw = readFileSync(fullPath, "utf-8");
                    const parsed = matter(raw) as WikiMatterFile<Record<string, unknown>>;
                    const title = this.extractTitle(parsed, relativePath);
                    const { category, tags, excerpt } = this.extractMetadata(parsed);

                    return {
                        filename: relativePath,
                        title,
                        mtime: stat.mtimeMs,
                        category,
                        tags,
                        excerpt,
                    };
                });

                docs.sort((a, b) => a.title.localeCompare(b.title));
                return this.json(res, 200, { documents: docs });
            } catch (err) {
                return this.json(res, 500, { error: "Failed to read docs directory index" });
            }
        }

        if (method === "GET" && url.startsWith("/api/wiki/content")) {
            const parsedUrl = new URL(`http://localhost${url}`);
            const requestedPath = parsedUrl.searchParams.get("path")?.trim() || "";

            if (!requestedPath) {
                return this.json(res, 400, { error: "Parameter 'path' is required" });
            }

            const fullFilePath = resolve(rootDocsDir, requestedPath);
            if (!fullFilePath.startsWith(rootDocsDir)) {
                return this.json(res, 403, {
                    error: "Access denied. Requested document lies outside documentation directory.",
                });
            }

            if (!existsSync(fullFilePath)) {
                return this.json(res, 404, { error: "Document not found" });
            }

            try {
                const raw = readFileSync(fullFilePath, "utf-8");
                const stat = statSync(fullFilePath);
                const parsed = matter(raw) as WikiMatterFile<Record<string, unknown>>;
                const title = this.extractTitle(parsed, requestedPath);

                const markdown = parsed.content;
                const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
                md.use(markdownItAnchor, {
                    slugify: (s: string) => encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, "-")),
                });

                const defaultRender =
                    md.renderer.rules.link_open ||
                    function (tokens: any, idx: number, options: any, env: any, self: any) {
                        return self.renderToken(tokens, idx, options);
                    };

                md.renderer.rules.link_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
                    const token = tokens[idx] as {
                        attrs?: [string, string][];
                        attrSet?: (name: string, value: string) => void;
                    };
                    const hrefAttr = token.attrs?.find(([name]: [string, string]) => name === "href");
                    if (hrefAttr && typeof hrefAttr[1] === "string") {
                        const rewritten = this.rewriteInternalDocLink(hrefAttr[1], requestedPath, rootDocsDir);
                        if (rewritten && token.attrSet) {
                            hrefAttr[1] = "#";
                            token.attrSet("data-doc-path", encodeURIComponent(rewritten));
                            token.attrSet("class", "wiki-internal-link");
                            token.attrSet("data-doc-source", requestedPath);
                        }
                    }
                    return defaultRender(tokens, idx, options, env, self);
                };

                const contentHtml = md.render(markdown);
                return this.json(res, 200, {
                    filename: requestedPath,
                    title,
                    content: markdown,
                    html: contentHtml,
                    mtime: stat.mtimeMs,
                });
            } catch (err) {
                return this.json(res, 500, { error: "Failed to read document content" });
            }
        }

        this.json(res, 404, { error: "Wiki route not found" });
    }

    private collectMarkdownFiles(dir: string): string[] {
        const entries = readdirSync(dir, { withFileTypes: true });
        const results: string[] = [];
        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...this.collectMarkdownFiles(fullPath));
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
                results.push(fullPath);
            }
        }
        return results;
    }

    private extractTitle(parsed: WikiMatterFile<Record<string, unknown>>, relativePath: string): string {
        const frontmatterTitle = parsed.data?.title;
        if (typeof frontmatterTitle === "string" && frontmatterTitle.trim()) {
            return frontmatterTitle.trim();
        }

        const header = parsed.content.split("\n").find((line: string) => line.trim().startsWith("#"));

        if (header) {
            return header.replace(/^#+\s?/, "").trim();
        }

        return relativePath.replace(/\.md$/i, "").replace(/[_-]/g, " ");
    }

    private extractMetadata(parsed: WikiMatterFile<Record<string, unknown>>) {
        const rawTags = parsed.data?.tags;
        const tags = Array.isArray(rawTags)
            ? rawTags
                  .filter((tag): tag is string => typeof tag === "string")
                  .map((tag) => tag.trim())
                  .filter(Boolean)
            : typeof rawTags === "string"
              ? rawTags
                    .split(/[,;]+/)
                    .map((tag) => tag.trim())
                    .filter(Boolean)
              : [];

        const excerpt =
            parsed.content
                .split(/\n\n+/)
                .map((paragraph: string) => paragraph.trim())
                .find((paragraph: string) => paragraph.length > 20)
                ?.replace(/[#_*`>\[\]]/g, "") || "";

        return {
            category: typeof parsed.data?.category === "string" ? parsed.data.category.trim() : undefined,
            tags: tags.length ? tags : undefined,
            excerpt: excerpt || undefined,
        };
    }

    private rewriteInternalDocLink(href: string, currentPath: string, rootDocsDir: string): string | null {
        if (
            !href ||
            href.startsWith("http://") ||
            href.startsWith("https://") ||
            href.startsWith("mailto:") ||
            href.startsWith("data:") ||
            href.startsWith("#") ||
            href.startsWith("//")
        ) {
            return null;
        }

        const [hrefPath, fragment] = href.split("#", 2);
        if (!hrefPath.toLowerCase().endsWith(".md")) {
            return null;
        }

        const currentDir = dirname(currentPath);
        const normalizedPath = normalize(join(currentDir, hrefPath));
        const absoluteTarget = resolve(rootDocsDir, normalizedPath);
        if (!absoluteTarget.startsWith(rootDocsDir)) {
            return null;
        }

        const relativePath = relative(rootDocsDir, absoluteTarget).replace(/\\/g, "/");
        return fragment ? `${relativePath}#${fragment}` : relativePath;
    }

    private json(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
    }
}
