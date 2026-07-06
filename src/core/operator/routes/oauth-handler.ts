import type { IncomingMessage, ServerResponse } from "node:http";
import { IRouteHandler } from "./types.js";
import type { DashboardService } from "../dashboard-service.js";

export class OAuthHandler implements IRouteHandler {
    match(req: IncomingMessage): boolean {
        const url = (req.url ?? "").split("?")[0];
        const normalized = url.startsWith("/api/v1/") ? "/api/" + url.substring("/api/v1/".length) : url;
        return normalized.startsWith("/api/auth/gmail") || normalized.startsWith("/api/auth/outlook");
    }

    async handle(req: IncomingMessage, res: ServerResponse, service: DashboardService): Promise<void> {
        const rawUrl = req.url ?? "";
        const url = rawUrl.startsWith("/api/v1/") ? "/api/" + rawUrl.substring("/api/v1/".length) : rawUrl;
        const method = req.method?.toUpperCase() ?? "GET";

        // ── Gmail OAuth ────────────────────────────────────────────────────
        if (method === "GET" && url === "/api/auth/gmail/authorize") {
            try {
                const authUrl = await service.getGmailOAuth().getAuthorizationUrl();
                this.json(res, 200, { authUrl });
            } catch (err: unknown) {
                this.json(res, 503, { error: (err as Error).message });
            }
            return;
        }

        if (method === "GET" && url.startsWith("/api/auth/gmail/callback")) {
            const parsed = new URL(url, "http://localhost");
            const code = parsed.searchParams.get("code");
            if (!code) {
                this.json(res, 400, { error: "Missing code parameter" });
                return;
            }
            const result = await service.getGmailOAuth().exchangeCode(code);
            this.html(res, "gmail", !!result.connected);
            return;
        }

        if (method === "GET" && url === "/api/auth/gmail/status") {
            const status = await service.getGmailOAuth().getStatus();
            this.json(res, 200, status);
            return;
        }

        if (method === "DELETE" && url === "/api/auth/gmail/disconnect") {
            await service.getGmailOAuth().disconnect();
            this.json(res, 200, { disconnected: true });
            return;
        }

        // ── Outlook OAuth ──────────────────────────────────────────────────
        if (method === "GET" && url === "/api/auth/outlook/authorize") {
            try {
                const authUrl = await service.getOutlookOAuth().getAuthorizationUrl();
                this.json(res, 200, { authUrl });
            } catch (err: unknown) {
                this.json(res, 503, { error: (err as Error).message });
            }
            return;
        }

        if (method === "GET" && url.startsWith("/api/auth/outlook/callback")) {
            const parsed = new URL(url, "http://localhost");
            const code = parsed.searchParams.get("code");
            if (!code) {
                this.json(res, 400, { error: "Missing code parameter" });
                return;
            }
            const result = await service.getOutlookOAuth().exchangeCode(code);
            this.html(res, "outlook", !!result.connected);
            return;
        }

        if (method === "GET" && url === "/api/auth/outlook/status") {
            const status = await service.getOutlookOAuth().getStatus();
            this.json(res, 200, status);
            return;
        }

        if (method === "DELETE" && url === "/api/auth/outlook/disconnect") {
            await service.getOutlookOAuth().disconnect();
            this.json(res, 200, { disconnected: true });
            return;
        }

        this.json(res, 404, { error: "Not found" });
    }

    private html(res: ServerResponse, provider: string, connected: boolean): void {
        const providerName = provider === "gmail" ? "Gmail" : "Outlook";
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PRISM Connection Status</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0b14;
      --card-bg: rgba(20, 20, 35, 0.65);
      --border: rgba(124, 241, 200, 0.25);
      --text: #c7d2fe;
      --accent: #7cf1c8;
      --shadow: rgba(0, 0, 0, 0.4);
    }
    .failed {
      --border: rgba(248, 113, 113, 0.25);
      --accent: #f87171;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      overflow: hidden;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 12px 40px var(--shadow);
      text-align: center;
      max-width: 400px;
      width: 80%;
      transform: translateY(20px);
      opacity: 0;
      animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes slideUp {
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    .icon {
      font-size: 48px;
      margin-bottom: 20px;
      display: inline-block;
      animation: pulse 2s infinite alternate;
    }
    @keyframes pulse {
      0% { transform: scale(1); }
      100% { transform: scale(1.1); }
    }
    h2 {
      margin: 0 0 12px 0;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #fff;
    }
    p {
      color: #8e8eb2;
      font-size: 15px;
      margin: 0 0 28px 0;
      line-height: 1.5;
    }
    button {
      background: var(--accent);
      color: #0b0b14;
      border: none;
      padding: 12px 28px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
      transition: all 0.2s ease;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    }
    button:active {
      transform: translateY(0);
    }
  </style>
</head>
<body>
  <div class="card ${connected ? "" : "failed"}">
    <div class="icon">${connected ? "⚡" : "❌"}</div>
    <h2>${connected ? "Connection Successful" : "Connection Failed"}</h2>
    <p>${connected ? `PRISM is now connected to your ${providerName} account. You may safely close this window.` : `We could not establish a connection to your ${providerName} account. Please try again.`}</p>
    <button onclick="window.close()">Close Window</button>
  </div>
  <script>
    if (${connected}) {
      setTimeout(function() {
        window.close();
      }, 1500);
    }
  </script>
</body>
</html>`;

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(html);
    }

    private json(res: ServerResponse, status: number, data: any): void {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(data, null, 2));
    }
}
