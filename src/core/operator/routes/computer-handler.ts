import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { workspaceFramebufferDir } from "../../config/workspace-resolver.js";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";

export class ComputerHandler implements IRouteHandler {
  match(req: IncomingMessage): boolean {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    const method = req.method?.toUpperCase() ?? "GET";

    if (pathname.startsWith("/api/network/")) return true;
    if (pathname.startsWith("/api/diagnostics/computer/")) return true;
    if (pathname.startsWith("/api/computer")) return true;
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

    // ── Computer Control API ──
    if (method === "GET" && url === "/api/computer/system-info") {
      const osModule = await import("node:os");
      let gpu: { name: string; vramTotalMb: number; driverVersion: string; cudaVersion: string } | null = null;
      try {
        const { execSync } = await import("node:child_process");
        const nvOut = execSync("nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits", { timeout: 5000, encoding: "utf8" });
        const parts = nvOut.trim().split(",").map((s: string) => s.trim());
        if (parts.length >= 3) {
          let cudaVer = "";
          try {
            const nvFull = execSync("nvidia-smi", { timeout: 5000, encoding: "utf8" });
            const cudaMatch = nvFull.match(/CUDA Version:\s*([\d.]+)/);
            if (cudaMatch) cudaVer = cudaMatch[1];
          } catch (_) { /* no CUDA info */ }
          gpu = { name: parts[0], vramTotalMb: parseInt(parts[1], 10) || 0, driverVersion: parts[2], cudaVersion: cudaVer };
        }
      } catch (_) {
        try {
          const { execSync } = await import("node:child_process");
          const wmicOut = execSync("wmic path Win32_VideoController get Name,AdapterRAM /format:csv", { timeout: 5000, encoding: "utf8" });
          const lines = wmicOut.trim().split(/\r?\n/).filter((l: string) => l.trim() && !l.startsWith("Node"));
          if (lines.length > 0) {
            const cols = lines[0].split(",");
            if (cols.length >= 3) {
              const adapterRam = parseInt(cols[1], 10) || 0;
              gpu = { name: cols[2]?.trim() || "Unknown GPU", vramTotalMb: Math.round(adapterRam / 1048576), driverVersion: "", cudaVersion: "" };
            }
          }
        } catch (_) { /* no GPU info available */ }
      }
      return this.json(res, 200, {
        os: osModule.type() + " " + osModule.release(),
        hostname: osModule.hostname(),
        platform: osModule.platform() + " " + osModule.arch(),
        uptime: Math.floor(osModule.uptime()),
        cpus: osModule.cpus().length,
        totalMemory: osModule.totalmem(),
        freeMemory: osModule.freemem(),
        homeDir: osModule.homedir(),
        nodeVersion: process.version,
        gpu,
      });
    }

    if (method === "GET" && url === "/api/computer/usage") {
      const osModule = await import("node:os");
      let gpuUsage: { vramUsedMb: number; vramTotalMb: number; gpuUtilPct: number; memUtilPct: number; tempC: number } | null = null;
      try {
        const { execSync } = await import("node:child_process");
        const nvOut = execSync("nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu,utilization.memory,temperature.gpu --format=csv,noheader,nounits", { timeout: 3000, encoding: "utf8" });
        const parts = nvOut.trim().split(",").map((s: string) => s.trim());
        if (parts.length >= 5) {
          gpuUsage = { vramUsedMb: parseInt(parts[0], 10) || 0, vramTotalMb: parseInt(parts[1], 10) || 0, gpuUtilPct: parseInt(parts[2], 10) || 0, memUtilPct: parseInt(parts[3], 10) || 0, tempC: parseInt(parts[4], 10) || 0 };
        }
      } catch (_) { /* nvidia-smi not available */ }
      return this.json(res, 200, {
        ramTotal: osModule.totalmem(),
        ramFree: osModule.freemem(),
        gpu: gpuUsage,
      });
    }

    if (method === "POST" && url === "/api/computer/exec") {
      const body = await service.readJsonBody<{ command: string }>(req);
      const cmd = (body.command || "").trim();
      if (!cmd) return this.json(res, 400, { error: "Command is required" });
      const blocked = /rm\s+-rf|del\s+\/[sfq]|format\s+[a-z]:|shutdown|restart|reboot/i;
      if (blocked.test(cmd)) return this.json(res, 403, { error: "Command blocked by safety policy" });
      try {
        const { exec: execCb } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(execCb);
        const result = await execAsync(cmd, { timeout: 15000, maxBuffer: 512 * 1024 });
        service.getFramebufferCapture().captureSingle().catch(() => { });
        return this.json(res, 200, { stdout: result.stdout, stderr: result.stderr });
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message?: string };
        return this.json(res, 200, { stdout: err.stdout || "", stderr: err.stderr || err.message || String(error) });
      }
    }

    if (method === "GET" && url === "/api/computer/screengrab/latest") {
      const latestPath = service.getFramebufferCapture().getLatestPath();
      if (!latestPath) return this.json(res, 404, { error: "No screengrab captured yet" });
      try {
        const data = readFileSync(latestPath);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": data.length, "Cache-Control": "no-store" });
        res.end(data);
        return;
      } catch { return this.json(res, 500, { error: "Failed to read latest screengrab" }); }
    }

    if (method === "POST" && url === "/api/computer/screengrab/capture") {
      try {
        const result = await service.getFramebufferCapture().captureSingle();
        return this.json(res, 200, result);
      } catch (error: unknown) {
        return this.json(res, 500, { error: (error as Error).message ?? "Capture failed" });
      }
    }

    if (method === "POST" && url === "/api/computer/screengrab/burst") {
      const body = await service.readJsonBody<{ fps?: number; duration?: number }>(req);
      try {
        const result = await service.getFramebufferCapture().burstCapture(body.fps, body.duration);
        return this.json(res, 200, result);
      } catch (error: unknown) {
        return this.json(res, 500, { error: (error as Error).message ?? "Burst failed" });
      }
    }

    if (method === "GET" && url === "/api/computer/screengrab/list") {
      return this.json(res, 200, {
        galleryItems: service.getFramebufferCapture().listGalleryItems(),
        files: service.getFramebufferCapture().listScreengrabs(),
        directory: workspaceFramebufferDir(),
      });
    }

    if (method === "POST" && url === "/api/computer/reveal-file") {
      const body = await service.readJsonBody<{ filename?: string }>(req);
      const fname = body?.filename ? String(body.filename).replace(/[/\\:*?"<>|]/g, "") : "";
      const revealPath = fname ? join(workspaceFramebufferDir(), fname) : workspaceFramebufferDir();
      const { exec } = await import("node:child_process");
      exec(`explorer.exe /select,"${revealPath}"`);
      return this.json(res, 200, { ok: true });
    }

    if (method === "GET" && url === "/api/computer/screengrab/diagnostics") {
      const fbDir = workspaceFramebufferDir();
      const checks: { name: string; ok: boolean; detail: string }[] = [];
      checks.push({ name: "Platform", ok: process.platform === "win32", detail: process.platform === "win32" ? "Windows \u2713" : `Non-Windows (${process.platform}) \u2014 PowerShell capture may not work` });
      const dirExists = existsSync(fbDir);
      checks.push({ name: "Capture directory", ok: dirExists, detail: dirExists ? fbDir : `Missing: ${fbDir}` });
      if (dirExists) {
        const allFiles = readdirSync(fbDir).filter(f => f.endsWith(".png") && f !== "latest.png");
        const latestExists = existsSync(join(fbDir, "latest.png"));
        checks.push({ name: "Stored frames", ok: allFiles.length > 0, detail: `${allFiles.length} PNG file(s) in framebuffer directory` });
        checks.push({ name: "Latest frame", ok: latestExists, detail: latestExists ? "latest.png present" : "No latest.png \u2014 capture has not run yet" });
      }
      return this.json(res, 200, { ok: checks.every(c => c.ok), checks });
    }

    if (method === "GET" && url?.startsWith("/api/computer/screengrab/file/")) {
      const rawTail = url.slice("/api/computer/screengrab/file/".length);
      const queryIdx = rawTail.indexOf("?");
      const name = decodeURIComponent(queryIdx >= 0 ? rawTail.slice(0, queryIdx) : rawTail);
      if (!/^[\w\-.]+\.png$/.test(name)) return this.json(res, 400, { error: "Invalid filename" });
      const filePath = join(workspaceFramebufferDir(), name);
      if (!existsSync(filePath)) return this.json(res, 404, { error: "File not found" });
      try {
        const data = readFileSync(filePath);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": data.length, "Cache-Control": "no-store" });
        res.end(data);
        return;
      } catch { return this.json(res, 500, { error: "Failed to read file" }); }
    }

    if (method === "GET" && url === "/api/computer/env-vars") {
      const vars: Array<{ key: string; value: string }> = [];
      const prismVars: Array<{ key: string; value: string }> = [];
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) {
          const entry = { key: k, value: v };
          if (k.startsWith("PRISM_")) prismVars.push(entry);
          else vars.push(entry);
        }
      }
      prismVars.sort((a, b) => a.key.localeCompare(b.key));
      vars.sort((a, b) => a.key.localeCompare(b.key));
      return this.json(res, 200, { prismVars, systemVars: vars });
    }

    if (method === "GET" && url === "/api/computer/devices") {
      const { exec: execCb } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const { fileURLToPath } = await import("node:url");
      const { dirname, join } = await import("node:path");
      const execAsync = promisify(execCb);
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const scriptPath = join(__dirname, "../scripts/device-query.ps1");
      try {
        const result = await execAsync(`powershell -NoProfile -NonInteractive -File "${scriptPath}"`, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        const parsed = JSON.parse(result.stdout.trim());
        const devices: Record<string, Array<{ name: string; status: string; props: Record<string, string> }>> = {};
        for (const [cat, items] of Object.entries(parsed)) {
          devices[cat] = Array.isArray(items) ? items as Array<{ name: string; status: string; props: Record<string, string> }> : items ? [items as { name: string; status: string; props: Record<string, string> }] : [];
        }
        return this.json(res, 200, { devices });
      } catch (e: unknown) {
        const osModule = await import("node:os");
        const cpus = osModule.cpus();
        const nets = osModule.networkInterfaces();
        const devices: Record<string, Array<{ name: string; status: string; props: Record<string, string> }>> = {
          "Processors": cpus.length > 0 ? [{ name: cpus[0]!.model + " (" + cpus.length + " cores)", status: "OK", props: { model: cpus[0]!.model, cores: String(cpus.length), speed: cpus[0]!.speed + " MHz" } }] : [],
          "Network Adapters": Object.entries(nets).map(([name, addrs]) => ({ name, status: "OK", props: { addresses: (addrs || []).map(a => a.address).join(", ") } })),
          "Display Adapters": [],
          "Disk Drives": [],
        };
        return this.json(res, 200, { devices, fallback: true, error: (e as Error).message });
      }
    }

    if (method === "GET" && url.startsWith("/api/computer/devices/properties/")) {
      const parts = url.replace("/api/computer/devices/properties/", "").split("/");
      const category = decodeURIComponent(parts[0] || "");
      const index = parseInt(parts[1] || "0", 10);
      const wmiMapping: Record<string, string> = {
        "Processors": "Win32_Processor",
        "Motherboard": "Win32_BaseBoard",
        "Memory": "Win32_PhysicalMemory",
        "Display Adapters": "Win32_VideoController",
        "Disk Drives": "Win32_DiskDrive",
        "Network Adapters": "Win32_NetworkAdapter",
        "Sound Devices": "Win32_SoundDevice",
        "USB Controllers": "Win32_USBController",
        "USB Devices": "Win32_USBHub",
        "BIOS": "Win32_BIOS",
        "Optical Drives": "Win32_CDROMDrive",
      };
      const wmiClass = wmiMapping[category];
      if (!wmiClass) return this.json(res, 400, { error: "Unknown category" });
      try {
        const { exec: execCb2 } = await import("node:child_process");
        const { promisify: promisify2 } = await import("node:util");
        const execAsync2 = promisify2(execCb2);
        const ps2 = `Get-CimInstance -ClassName ${wmiClass} | Select-Object -Index ${index} | ForEach-Object { $h=@{}; $_.CimInstanceProperties | Where-Object { $_.Value -ne $null } | ForEach-Object { $h[$_.Name]=[string]$_.Value }; $h } | ConvertTo-Json -Compress`;
        const r2 = await execAsync2(`powershell -NoProfile -NonInteractive -Command "${ps2}"`, { timeout: 15000, maxBuffer: 512 * 1024 });
        const props = JSON.parse(r2.stdout.trim() || "{}");
        return this.json(res, 200, { category, index, properties: props });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }

    if (method === "POST" && url === "/api/computer/devices/report") {
      const body = await service.readJsonBody<{ categories?: string[] }>(req);
      const cats = body.categories || [];
      const wmiMapping: Record<string, string> = {
        "Processors": "Win32_Processor", "Motherboard": "Win32_BaseBoard", "Memory": "Win32_PhysicalMemory",
        "Display Adapters": "Win32_VideoController", "Disk Drives": "Win32_DiskDrive", "Network Adapters": "Win32_NetworkAdapter",
        "Sound Devices": "Win32_SoundDevice", "USB Controllers": "Win32_USBController", "USB Devices": "Win32_USBHub",
        "BIOS": "Win32_BIOS", "Optical Drives": "Win32_CDROMDrive",
      };
      const lines: string[] = ["PRISM Device Manager — Hardware Report", "Generated: " + new Date().toISOString(), "═".repeat(60), ""];
      try {
        const { exec: execCb3 } = await import("node:child_process");
        const { promisify: promisify3 } = await import("node:util");
        const execAsync3 = promisify3(execCb3);
        for (const cat of cats) {
          const cls = wmiMapping[cat];
          if (!cls) continue;
          lines.push("── " + cat + " ──");
          try {
            const ps3 = `Get-CimInstance -ClassName ${cls} | ForEach-Object { $h=@{}; $_.CimInstanceProperties | Where-Object { $_.Value -ne $null } | ForEach-Object { $h[$_.Name]=[string]$_.Value }; $h } | ConvertTo-Json -Depth 3 -Compress`;
            const r3 = await execAsync3(`powershell -NoProfile -NonInteractive -Command "${ps3}"`, { timeout: 15000, maxBuffer: 1024 * 1024 });
            const items = JSON.parse("[" + r3.stdout.trim().replace(/}\s*{/g, "},{") + "]");
            const arr = Array.isArray(items) ? items : [items];
            for (let i = 0; i < arr.length; i++) {
              lines.push("  Device " + (i + 1) + ":");
              for (const [k, v] of Object.entries(arr[i] as Record<string, string>)) {
                lines.push("    " + k + ": " + v);
              }
              lines.push("");
            }
          } catch { lines.push("  (query failed)"); lines.push(""); }
        }
        return this.json(res, 200, { report: lines.join("\n") });
      } catch (e: unknown) {
        return this.json(res, 500, { error: (e as Error).message });
      }
    }
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
}
