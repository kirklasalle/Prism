import { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";

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

    // 1. GET /api/wiki/docs - returns sorted index of available articles
    if (method === "GET" && url === "/api/wiki/docs") {
      if (!existsSync(rootDocsDir)) {
        return this.json(res, 200, { documents: [] });
      }

      try {
        const files = readdirSync(rootDocsDir);
        const docs = files
          .filter(file => file.toLowerCase().endsWith(".md"))
          .map(file => {
            const fullPath = join(rootDocsDir, file);
            const stat = statSync(fullPath);
            
            // Try to extract first # header as Title, fallback to cleaned filename
            let title = file.replace(/\.md$/i, "").replace(/_/g, " ");
            try {
              const preview = readFileSync(fullPath, "utf-8");
              const firstLine = preview.split("\n").find(line => line.trim().startsWith("#"));
              if (firstLine) {
                title = firstLine.replace(/^#+\s?/, "").trim();
              }
            } catch { /* ignore */ }

            return {
              filename: file,
              title: title,
              mtime: stat.mtimeMs
            };
          })
          .sort((a, b) => a.title.localeCompare(b.title));

        return this.json(res, 200, { documents: docs });
      } catch (err) {
        return this.json(res, 500, { error: "Failed to read docs directory index" });
      }
    }

    // 2. GET /api/wiki/content?path=... - returns content of selected article
    if (method === "GET" && url.startsWith("/api/wiki/content")) {
      const parsed = new URL(`http://localhost${url}`);
      const requestedPath = parsed.searchParams.get("path")?.trim() || "";

      if (!requestedPath) {
        return this.json(res, 400, { error: "Parameter 'path' is required" });
      }

      const fullFilePath = resolve(rootDocsDir, requestedPath);
      
      // Security Check: prevent path traversal out of the docs/ directory
      if (!fullFilePath.startsWith(rootDocsDir)) {
        return this.json(res, 403, { error: "Access denied. Requested document lies outside documentation directory." });
      }

      if (!existsSync(fullFilePath)) {
        return this.json(res, 404, { error: "Document not found" });
      }

      try {
        const content = readFileSync(fullFilePath, "utf-8");
        const stat = statSync(fullFilePath);
        
        let title = requestedPath.replace(/\.md$/i, "").replace(/_/g, " ");
        const firstLine = content.split("\n").find(line => line.trim().startsWith("#"));
        if (firstLine) {
          title = firstLine.replace(/^#+\s?/, "").trim();
        }

        return this.json(res, 200, {
          filename: requestedPath,
          title,
          content,
          mtime: stat.mtimeMs
        });
      } catch (err) {
        return this.json(res, 500, { error: "Failed to read document content" });
      }
    }

    this.json(res, 404, { error: "Wiki route not found" });
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }
}
