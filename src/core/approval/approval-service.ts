import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ApprovalQueue } from "./approval-queue.js";

/**
 * Lightweight HTTP server that lets Kirk (or automation) approve or deny
 * Tier-3 operations in real time.
 *
 * Endpoints:
 *   GET  /pending          — list all pending approval requests
 *   POST /approve/:id      — approve the operation with :id
 *   POST /deny/:id         — deny the operation with :id
 *   GET  /health           — liveness check
 */
export class ApprovalService {
    private readonly server: Server;

    constructor(
        private readonly queue: ApprovalQueue,
        private readonly port = 7070,
    ) {
        this.server = createServer((req, res) => this.handle(req, res));
    }

    start(): void {
        this.server.listen(this.port, "127.0.0.1", () => {
            console.log(`[APPROVAL SERVICE] Listening at http://localhost:${this.port}`);
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.close((err) => (err ? reject(err) : resolve()));
        });
    }

    private handle(req: IncomingMessage, res: ServerResponse): void {
        const url = req.url ?? "";
        const method = req.method?.toUpperCase() ?? "GET";

        res.setHeader("Content-Type", "application/json");

        if (method === "GET" && url === "/health") {
            return this.json(res, 200, { status: "ok" });
        }

        if (method === "GET" && url === "/pending") {
            return this.json(res, 200, this.queue.list());
        }

        const approveMatch = /^\/approve\/([^/]+)$/.exec(url);
        if (method === "POST" && approveMatch) {
            const ok = this.queue.approve(approveMatch[1]!);
            console.log(`[APPROVAL SERVICE] ${ok ? "Approved" : "Not found"}: ${approveMatch[1]}`);
            return this.json(res, ok ? 200 : 404, { approved: ok });
        }

        const denyMatch = /^\/deny\/([^/]+)$/.exec(url);
        if (method === "POST" && denyMatch) {
            const ok = this.queue.deny(denyMatch[1]!);
            console.log(`[APPROVAL SERVICE] ${ok ? "Denied" : "Not found"}: ${denyMatch[1]}`);
            return this.json(res, ok ? 200 : 404, { denied: ok });
        }

        this.json(res, 404, { error: "Not found" });
    }

    private json(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status);
        res.end(JSON.stringify(body, null, 2));
    }
}
