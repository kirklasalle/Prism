import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IRouteHandler } from "./types.js";
import { DashboardService } from "../dashboard-service.js";

export class ComputerHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    const method = req.method?.toUpperCase() ?? "GET";

    if (pathname.startsWith("/api/network/")) return true;
    if (pathname.startsWith("/api/diagnostics/computer/")) return true;
    return false;
  }

  async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
    const rawUrl = req.url ?? "";
    const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
    const method = req.method?.toUpperCase() ?? "GET";

    // 1. GET /api/diagnostics/computer/report
    if (method === "GET" && url === "/api/diagnostics/computer/report") {
      try {
        const reportPath = join(process.cwd(), "prism-output", "computer-diagnostics-report.json");
        if (existsSync(reportPath)) {
          const raw = readFileSync(reportPath, "utf8");
          return this.json(res, 200, JSON.parse(raw));
        }
        return this.json(res, 200, { report: null });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    // 2. GET /api/diagnostics/computer/status
    if (method === "GET" && url === "/api/diagnostics/computer/status") {
      return this.json(res, 200, {
        running: service.computerDiagnosticsRunning,
        lastRunAt: service.computerDiagnosticsLastRunAt,
      });
    }

    // 3. POST /api/diagnostics/computer/run
    if (method === "POST" && url === "/api/diagnostics/computer/run") {
      if (service.computerDiagnosticsRunning) {
        return this.json(res, 409, { error: "Computer diagnostics already running." });
      }
      service.computerDiagnosticsRunning = true;
      this.json(res, 200, { status: "started" });

      const { spawn: spawnChild } = await import("node:child_process");
      const child = spawnChild("node", ["scripts/run-computer-tests.cjs", "--no-build"], {
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
            const msg = { type: "computer_diagnostics_log", source: "stderr", message: line.slice(0, 1024), timestamp: new Date().toISOString() };
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
              if (msg.type === "computer_diagnostics_complete") gotStdoutComplete = true;
              for (const ws of service.wsClients) {
                try { ws.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() })); } catch { /* client gone */ }
              }
            } catch { /* not JSON — ignore */ }
          }
        } catch { /* defensive */ }
      });

      child.on("close", () => {
        try {
          service.computerDiagnosticsRunning = false;
          service.computerDiagnosticsLastRunAt = new Date().toISOString();
          if (!gotStdoutComplete) {
            for (const ws of service.wsClients) {
              try {
                ws.send(JSON.stringify({ type: "computer_diagnostics_complete", timestamp: new Date().toISOString() }));
              } catch { /* client gone */ }
            }
          }
        } catch { /* defensive */ }
      });

      child.on("error", () => {
        service.computerDiagnosticsRunning = false;
      });

      return;
    }

    // 4. GET /api/network/vrgc/status
    if (method === "GET" && url === "/api/network/vrgc/status") {
      try {
        const { checkVrgcAvailability } = await import("../../../adapters/network/vrgc-network-bridge.js");
        const available = await checkVrgcAvailability();
        return this.json(res, 200, { available });
      } catch {
        return this.json(res, 200, { available: false });
      }
    }

    // 5. POST /api/network/vrgc/research
    if (method === "POST" && url === "/api/network/vrgc/research") {
      try {
        const body = await service.readJsonBody<{ topic?: string; depth?: string; sourceTypes?: string[] }>(req);
        if (!body.topic) return this.json(res, 400, { error: "Missing 'topic' field." });
        const { fetchNetworkResearch } = await import("../../../adapters/network/vrgc-network-bridge.js");
        const result = await fetchNetworkResearch(body.topic, {
          depth: (body.depth as "quick" | "standard" | "comprehensive") ?? "standard",
          sourceTypes: body.sourceTypes,
        });
        return this.json(res, result.ok ? 200 : 502, result);
      } catch (err: unknown) {
        return this.json(res, 500, { ok: false, error: (err as Error).message ?? "VRGC research failed" });
      }
    }

    // 6. POST /api/network/vrgc/security-scan
    if (method === "POST" && url === "/api/network/vrgc/security-scan") {
      try {
        const body = await service.readJsonBody<{ target?: string; scanType?: string }>(req);
        if (!body.target) return this.json(res, 400, { error: "Missing 'target' field." });
        const { runSecurityScan } = await import("../../../adapters/network/vrgc-network-bridge.js");
        const result = await runSecurityScan(body.target, (body.scanType as any) ?? "comprehensive");
        return this.json(res, result.ok ? 200 : 502, result);
      } catch (err: unknown) {
        return this.json(res, 500, { ok: false, error: (err as Error).message ?? "VRGC security scan failed" });
      }
    }

    // 7. POST /api/network/vrgc/performance
    if (method === "POST" && url === "/api/network/vrgc/performance") {
      try {
        const body = await service.readJsonBody<{ url?: string; testType?: string; device?: string }>(req);
        if (!body.url) return this.json(res, 400, { error: "Missing 'url' field." });
        const { testPerformance } = await import("../../../adapters/network/vrgc-network-bridge.js");
        const result = await testPerformance(body.url, {
          testType: body.testType,
          device: (body.device as "desktop" | "mobile" | "tablet") ?? "desktop",
        });
        return this.json(res, result.ok ? 200 : 502, result);
      } catch (err: unknown) {
        return this.json(res, 500, { ok: false, error: (err as Error).message ?? "VRGC performance test failed" });
      }
    }

    // 8. POST /api/network/vrgc/ftp
    if (method === "POST" && url === "/api/network/vrgc/ftp") {
      try {
        const body = await service.readJsonBody<{ server?: string; path?: string; passiveMode?: boolean }>(req);
        if (!body.server) return this.json(res, 400, { error: "Missing 'server' field." });
        const { fetchFtpListing } = await import("../../../adapters/network/vrgc-network-bridge.js");
        const result = await fetchFtpListing(body.server, body.path ?? "/", body.passiveMode ?? true);
        return this.json(res, result.ok ? 200 : 502, result);
      } catch (err: unknown) {
        return this.json(res, 500, { ok: false, error: (err as Error).message ?? "VRGC FTP access failed" });
      }
    }

    // 9. GET /api/network/interfaces
    if (method === "GET" && url === "/api/network/interfaces") {
      try {
        const { exec: execCb } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const { platform } = await import("node:os");
        const execP = promisify(execCb);
        const isWin = platform() === "win32";
        const cmd = isWin ? "ipconfig /all" : "ifconfig -a 2>/dev/null || ip addr show";
        const { stdout } = await execP(cmd, { timeout: 10_000 });

        // Parse into interface blocks
        const interfaces: { name: string; details: string }[] = [];
        if (isWin) {
          const blocks = stdout.split(/\r?\n(?=\S.*adapter\s)/i);
          for (const block of blocks) {
            const firstLine = block.split(/\r?\n/)[0]?.trim();
            if (firstLine && firstLine.includes("adapter")) {
              interfaces.push({ name: firstLine.replace(/:$/, ""), details: block.split(/\r?\n/).slice(1).join("\n").trim() });
            }
          }
        } else {
          const blocks = stdout.split(/\r?\n(?=\S)/);
          for (const block of blocks) {
            const firstLine = block.split(/\r?\n/)[0]?.trim();
            if (firstLine) {
              const name = firstLine.split(/[:\s]/)[0] || firstLine;
              interfaces.push({ name, details: block.trim() });
            }
          }
        }
        return this.json(res, 200, { interfaces });
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 500, { error: e.message ?? "Failed to query interfaces" });
      }
    }

    // 10. POST /api/network/exec
    if (method === "POST" && url === "/api/network/exec") {
      try {
        const body = await service.readJsonBody<{ command?: string }>(req);
        const command = String(body.command ?? "").trim();
        if (!command) {
          return this.json(res, 400, { error: "Missing 'command' field." });
        }

        const networkTool = service.tools.find(t => t.name === "network_exec");
        if (!networkTool) {
          return this.json(res, 500, { error: "NetworkTool not registered." });
        }

        const result = await networkTool.execute({ operation: "network_exec", args: { command, timeoutMs: 30_000 }, risk: "low", mutatesState: false });
        const tier = (result.output as Record<string, unknown>)?.tier as string | undefined;
        service.networkCommandHistory.push({ command, tier, ok: result.ok, timestamp: new Date().toISOString() });
        if (result.ok) {
          return this.json(res, 200, result.output);
        } else {
          return this.json(res, 422, result.output);
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        return this.json(res, 500, { error: e.message ?? "network_exec failed" });
      }
    }

    // 11. GET /api/network/telemetry
    if (method === "GET" && url === "/api/network/telemetry") {
      const history = service.networkCommandHistory ?? [];
      const tier1 = history.filter((h: { tier?: string }) => h.tier === "tier1").length;
      const tier2 = history.filter((h: { tier?: string }) => h.tier === "tier2").length;
      const tier3 = history.filter((h: { tier?: string }) => h.tier === "tier3").length;
      const errors = history.filter((h: { ok?: boolean }) => !h.ok).length;
      const last = history.length > 0 ? history[history.length - 1] : null;

      return this.json(res, 200, {
        totalCommands: history.length,
        tier1Count: tier1,
        tier2Count: tier2,
        tier3Count: tier3,
        errorCount: errors,
        lastCommand: last?.command ?? null,
      });
    }
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
