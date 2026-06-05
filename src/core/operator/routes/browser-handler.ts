import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IRouteHandler } from "./types.js";
import { DashboardService } from "../dashboard-service.js";
import { BrowserControlTool } from "../../../adapters/system/browser-control-tool.js";

export class BrowserHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    const method = req.method?.toUpperCase() ?? "GET";

    if (pathname.startsWith("/api/browser/")) return true;
    if (pathname.startsWith("/api/diagnostics/browser/")) return true;
    return false;
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    const browserTool = service.tools.find(t => t.name === "browser_control") as BrowserControlTool | undefined;
    const mgr = browserTool?.getManager();
    const profMgr = browserTool?.getProfileManager();

    // 1. GET /api/browser/sessions
    if (method === "GET" && url === "/api/browser/sessions") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      const sessions = mgr.listSessions();
      return this.json(res, 200, { sessions: sessions.map((s: any) => ({ ...s, sessionId: s.id } as Record<string, unknown>)) });
    }

    // 2. GET /api/browser/profiles
    if (method === "GET" && url === "/api/browser/profiles") {
      if (!profMgr) return this.json(res, 503, { error: "Browser profile manager not available." });
      return this.json(res, 200, { profiles: profMgr.listProfiles() });
    }

    // 3. POST /api/browser/profiles
    if (method === "POST" && url === "/api/browser/profiles") {
      if (!profMgr) return this.json(res, 503, { error: "Browser profile manager not available." });
      try {
        const body = await service.readJsonBody<{
          email?: string;
          prismUserEmail?: string;
          segment?: string;
          executionProfileSegment?: string;
          displayName?: string;
          assignmentId?: string;
        }>(req);
        const email = (body.email || body.prismUserEmail || "").trim();
        const segment = (body.segment || body.executionProfileSegment || "individual").trim();
        if (!email) return this.json(res, 400, { error: "email is required." });
        if (segment !== "individual" && segment !== "business") {
          return this.json(res, 400, { error: "segment must be 'individual' or 'business'." });
        }
        const profile = profMgr.createProfile({
          prismUserEmail: email,
          executionProfileSegment: segment as "individual" | "business",
          displayName: body.displayName || undefined,
          assignmentId: body.assignmentId || undefined,
        });
        return this.json(res, 201, { ok: true, profile });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 4. GET /api/browser/diagnostics
    if (method === "GET" && url === "/api/browser/diagnostics") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      const diag = await mgr.diagnostics();
      return this.json(res, 200, diag);
    }

    // 5. POST /api/browser/launch
    if (method === "POST" && url === "/api/browser/launch") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      try {
        const body = await service.readJsonBody<{ headless?: boolean; profileId?: string; sessionId?: string }>(req);
        const session = await mgr.launch(body);
        return this.json(res, 200, { session: { ...session, sessionId: session.id } });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 6. DELETE /api/browser/sessions/:id
    const sessionsDeleteMatch = /^\/api\/browser\/sessions\/([^/]+)$/.exec(url);
    if (sessionsDeleteMatch && method === "DELETE") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      try {
        const sessionId = decodeURIComponent(sessionsDeleteMatch[1]!);
        await mgr.closeSession(sessionId);
        return this.json(res, 200, { ok: true });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 7. POST /api/browser/navigate
    if (method === "POST" && url === "/api/browser/navigate") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      try {
        const body = await service.readJsonBody<{ sessionId: string; url: string }>(req);
        if (!body.sessionId) return this.json(res, 400, { error: "sessionId required." });
        if (!body.url) return this.json(res, 400, { error: "url required." });

        const audit = await service.sshpInterceptor.auditAction("navigate", body);
        if (!audit.allowed) {
          return this.json(res, 403, { error: "SSHP_COVENANT_BLOCKED", message: audit.reason });
        }

        const result = await mgr.navigate(body.sessionId, body.url);
        return this.json(res, 200, result);
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 8. GET /api/browser/screenshot/:id
    const screenshotMatch = /^\/api\/browser\/screenshot\/([^/]+)$/.exec(url);
    if (screenshotMatch && method === "GET") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      try {
        const sessionId = decodeURIComponent(screenshotMatch[1]!);
        let buf = await mgr.screenshot(sessionId);

        if (service.sshpInterceptor.isEnabled()) {
          const handles = mgr.getSessionPageAndContext(sessionId);
          if (handles && handles.page) {
            const sensitiveSelectorMatches = [
              'input[type="password"]',
              'input[autocomplete*="cc-"]',
              'input[autocomplete*="ssn"]',
              'input[autocomplete*="card"]',
              'input[name*="pass"]',
              'input[name*="card"]',
              'input[name*="cvv"]',
              'input[name*="ssn"]',
              'input[name*="secret"]',
              'input[name*="token"]',
              'input[name*="apikey"]',
              'input[name*="api-key"]',
              'input[id*="pass"]',
              'input[id*="card"]',
              'input[id*="cvv"]',
              'input[id*="ssn"]',
              'input[id*="secret"]',
              'input[id*="token"]',
              'input[id*="apikey"]',
              'input[id*="api-key"]',
            ];
            const rects = await handles.page.evaluate((selectors: string[]) => {
              const results: Array<{ x: number; y: number; width: number; height: number }> = [];
              for (const selector of selectors) {
                const elms = document.querySelectorAll(selector);
                for (const el of elms) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    results.push({
                      x: rect.left + window.scrollX,
                      y: rect.top + window.scrollY,
                      width: rect.width,
                      height: rect.height
                    });
                  }
                }
              }
              return results;
            }, sensitiveSelectorMatches);

            buf = await service.sshpInterceptor.redactScreenshot(buf, rects);
          }
        }

        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buf.length });
        res.end(buf);
        return;
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 9. POST /api/browser/click
    if (method === "POST" && url === "/api/browser/click") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      try {
        const body = await service.readJsonBody<{ sessionId: string; selector: string }>(req);
        if (!body.sessionId) return this.json(res, 400, { error: "sessionId required." });
        if (!body.selector) return this.json(res, 400, { error: "selector required." });

        const audit = await service.sshpInterceptor.auditAction("click", body);
        if (!audit.allowed) {
          return this.json(res, 403, { error: "SSHP_COVENANT_BLOCKED", message: audit.reason });
        }

        await mgr.click(body.sessionId, body.selector);
        return this.json(res, 200, { ok: true });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 10. POST /api/browser/type
    if (method === "POST" && url === "/api/browser/type") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      try {
        const body = await service.readJsonBody<{ sessionId: string; selector: string; text: string }>(req);
        if (!body.sessionId) return this.json(res, 400, { error: "sessionId required." });
        if (!body.selector) return this.json(res, 400, { error: "selector required." });

        const audit = await service.sshpInterceptor.auditAction("type", body);
        if (!audit.allowed) {
          return this.json(res, 403, { error: "SSHP_COVENANT_BLOCKED", message: audit.reason });
        }

        await mgr.type(body.sessionId, body.selector, body.text ?? "");
        return this.json(res, 200, { ok: true });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 11. POST /api/browser/evaluate
    if (method === "POST" && url === "/api/browser/evaluate") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      try {
        const body = await service.readJsonBody<{ sessionId: string; expression: string }>(req);
        if (!body.sessionId) return this.json(res, 400, { error: "sessionId required." });
        if (!body.expression) return this.json(res, 400, { error: "expression required." });

        const audit = await service.sshpInterceptor.auditAction("evaluate", body);
        if (!audit.allowed) {
          return this.json(res, 403, { error: "SSHP_COVENANT_BLOCKED", message: audit.reason });
        }

        const value = await mgr.evaluate(body.sessionId, body.expression);
        return this.json(res, 200, { result: value });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 12. GET /api/diagnostics/browser/report
    if (method === "GET" && url === "/api/diagnostics/browser/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "browser-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    // 13. GET /api/diagnostics/browser/status
    if (method === "GET" && url === "/api/diagnostics/browser/status") {
      return this.json(res, 200, {
        running: service.diagnosticsRunning,
        lastRunAt: service.diagnosticsLastRunAt,
      });
    }

    // 14. POST /api/diagnostics/browser/run
    if (method === "POST" && url === "/api/diagnostics/browser/run") {
      if (service.diagnosticsRunning) {
        return this.json(res, 409, { error: "Diagnostics already running." });
      }
      service.diagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-browser-tests.cjs", "--no-build"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let gotStdoutComplete = false;
      const stderrNoiseRe = /^\s*(at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)|^\s*$/;

      let stderrBuf = "";
      child.stderr!.on("data", (chunk: Buffer) => {
        try {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() || "";
          for (const line of lines) {
            if (stderrNoiseRe.test(line)) continue;
            const msg = { type: "diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
            for (const ws of service.wsClients) {
              try { ws.send(JSON.stringify(msg)); } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      let stdoutBuf = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        try {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "diagnostics_complete") gotStdoutComplete = true;
              for (const ws of service.wsClients) {
                try {
                  ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() }));
                } catch { /* client gone */ }
              }
            } catch { /* not JSON — ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          service.diagnosticsRunning = false;
          service.diagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of service.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        service.diagnosticsRunning = false;
      });

      return;
    }

    // 15. GET /api/browser/console-logs/:id
    const consoleMatch = /^\/api\/browser\/console-logs\/([^/]+)$/.exec(url);
    if (consoleMatch && method === "GET") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      const sessionId = decodeURIComponent(consoleMatch[1]!);
      return this.json(res, 200, { logs: mgr.getConsoleLogs(sessionId) });
    }

    // 16. GET /api/browser/network-log/:id
    const networkMatch = /^\/api\/browser\/network-log\/([^/]+)$/.exec(url);
    if (networkMatch && method === "GET") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      const sessionId = decodeURIComponent(networkMatch[1]!);
      return this.json(res, 200, { log: mgr.getNetworkLog(sessionId) });
    }

    // 17. GET /api/browser/dom-snapshot/:id
    const domMatch = /^\/api\/browser\/dom-snapshot\/([^/]+)$/.exec(url);
    if (domMatch && method === "GET") {
      if (!mgr) return this.json(res, 503, { error: "Browser tool not available." });
      try {
        const sessionId = decodeURIComponent(domMatch[1]!);
        let html = await mgr.domSnapshot(sessionId);
        html = service.sshpInterceptor.sanitizeDom(html);
        return this.json(res, 200, { dom: html });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }

    // 18. DELETE /api/browser/profiles/:id
    const profilesDeleteMatch = /^\/api\/browser\/profiles\/([^/]+)$/.exec(url);
    if (profilesDeleteMatch && method === "DELETE") {
      if (!profMgr) return this.json(res, 503, { error: "Browser profile manager not available." });
      try {
        const profileId = decodeURIComponent(profilesDeleteMatch[1]!);
        profMgr.deleteProfile(profileId);
        return this.json(res, 200, { ok: true });
      } catch (err) {
        return this.json(res, 500, { error: String(err) });
      }
    }
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
