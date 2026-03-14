import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

export class HttpRequestTool implements Tool {
    readonly name = "http_request";
    readonly contract = {
        version: "1.0.0",
        args: {
            url: { type: "string", required: true },
            method: {
                type: "string",
                enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
            },
            headers: { type: "object" },
            body: { type: "object" },
            timeoutMs: { type: "number" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const url = String(request.args.url ?? "");
        const method = String(request.args.method ?? "GET").toUpperCase();
        const headers = (request.args.headers ?? {}) as Record<string, string>;
        const body = request.args.body;
        const timeoutMs = Number(request.args.timeoutMs ?? 30_000);

        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return { ok: false, output: { error: "URL must use http:// or https://" } };
        }

        try {
            const response = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json", ...headers },
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(timeoutMs),
            });

            const text = await response.text();
            let parsed: unknown = text;
            try { parsed = JSON.parse(text); } catch { /* keep as string */ }

            return {
                ok: response.ok,
                output: {
                    status: response.status,
                    statusText: response.statusText,
                    body: parsed,
                    headers: Object.fromEntries(response.headers.entries()),
                },
                sideEffects: [
                    { type: "network", description: `${method} ${url} → ${response.status}` },
                ],
            };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err), url, method } };
        }
    }
}
