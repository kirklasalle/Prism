/**
 * MCP Client Adapter — connects PRISM to any MCP server via JSON-RPC 2.0 stdio transport.
 *
 * Each tool discovered on a connected server is registered as a McpProxyTool in
 * PRISM's ToolRegistry and governed by the PolicyEngine like any native tool.
 *
 * Usage via McpClientAdapter.loadAndRegister():
 *   const adapter = new McpClientAdapter();
 *   const { registered, errors } = await adapter.loadAndRegister(settingsPath, registry);
 *   // Call adapter.disconnectAll() on shutdown
 *
 * Configure via .mcp/mcp-settings.json (same schema as VS Code MCP settings).
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import type { ToolRegistry } from "../../core/tools/registry.js";

// ──────────────────────────────────────────────────────────────────────────────
// Configuration types  (mirrors .mcp/mcp-settings.json schema)
// ──────────────────────────────────────────────────────────────────────────────

export interface McpServerConfig {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    /** Override per-server call timeout in ms (default: 30 000) */
    timeoutMs?: number;
}

export interface McpServerSettings {
    mcpServers: Record<string, McpServerConfig>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal JSON-RPC 2.0 types
// ──────────────────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: number;
    method: string;
    params?: unknown;
}

interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
}

interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number | string;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

interface McpToolDescriptor {
    name: string;
    description?: string;
    inputSchema?: {
        type?: string;
        properties?: Record<string, { type?: string; description?: string }>;
        required?: string[];
    };
}

interface McpContentItem {
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
}

interface McpCallResult {
    content?: McpContentItem[];
    isError?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// McpConnection — manages one stdio-connected MCP server process
// ──────────────────────────────────────────────────────────────────────────────

export class McpConnection {
    private proc: ReturnType<typeof spawn> | null = null;
    private nextId = 1;
    private pendingRequests = new Map<
        number,
        {
            resolve: (v: JsonRpcResponse) => void;
            reject: (e: Error) => void;
            timer: ReturnType<typeof setTimeout>;
        }
    >();
    private _isConnected = false;
    private _tools: McpToolDescriptor[] = [];
    /** Stderr lines buffered during the connection handshake. */
    private stderrBuffer: string[] = [];
    private readonly serverName: string;
    private readonly config: McpServerConfig;

    constructor(serverName: string, config: McpServerConfig) {
        this.serverName = serverName;
        this.config = config;
    }

    get isConnected(): boolean {
        return this._isConnected;
    }

    /**
     * Spawn the MCP server process, perform initialization handshake,
     * and discover available tools via tools/list.
     */
    async connect(): Promise<void> {
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined) env[k] = v;
        }
        for (const [k, v] of Object.entries(this.config.env ?? {})) {
            env[k] = v;
        }

        this.proc = spawn(this.config.command, this.config.args ?? [], {
            cwd: this.config.cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
        });

        if (!this.proc.stdout || !this.proc.stdin) {
            throw new Error(`[MCP:${this.serverName}] Failed to open stdio pipes`);
        }

        // stderr: buffer lines until the handshake completes.
        // Once connected, forward lines normally for runtime diagnostics.
        // If connect() throws, only the first meaningful line is surfaced.
        this.proc.stderr?.on("data", (chunk: Buffer) => {
            const lines = chunk.toString().split("\n").filter(Boolean);
            if (this._isConnected) {
                for (const line of lines) {
                    console.error(`[MCP:${this.serverName}] stderr: ${line}`);
                }
            } else {
                this.stderrBuffer.push(...lines);
            }
        });

        const rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
        rl.on("line", (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
                const msg = JSON.parse(trimmed) as JsonRpcResponse;
                if (msg.id !== undefined && msg.id !== null) {
                    const pending = this.pendingRequests.get(msg.id as number);
                    if (pending) {
                        clearTimeout(pending.timer);
                        this.pendingRequests.delete(msg.id as number);
                        pending.resolve(msg);
                    }
                }
                // Notifications (no id) are silently discarded
            } catch {
                // Non-JSON lines (startup banners etc.) are ignored
            }
        });

        this.proc.on("error", (err: Error) => {
            this._isConnected = false;
            this.rejectAll(new Error(`[MCP:${this.serverName}] Process error: ${err.message}`));
        });

        this.proc.on("exit", (code: number | null) => {
            this._isConnected = false;
            this.rejectAll(
                new Error(`[MCP:${this.serverName}] Process exited (code=${code ?? "null"})`),
            );
        });

        // Step 1: initialize
        const initResp = await this.sendRequest("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            clientInfo: { name: "prism", version: "1.0.0" },
        });
        if (initResp.error) {
            throw new Error(
                `[MCP:${this.serverName}] Initialize failed: ${initResp.error.message}`,
            );
        }

        // Step 2: send initialized notification (no response expected)
        this.sendNotification("notifications/initialized");

        // Step 3: discover tools
        const toolsResp = await this.sendRequest("tools/list", {});
        if (toolsResp.error) {
            throw new Error(
                `[MCP:${this.serverName}] tools/list failed: ${toolsResp.error.message}`,
            );
        }
        const result = toolsResp.result as { tools?: McpToolDescriptor[] } | undefined;
        this._tools = result?.tools ?? [];

        this._isConnected = true;
        this.stderrBuffer = []; // discard pre-connect noise now that we're healthy
        console.log(
            `[MCP:${this.serverName}] Connected — ${this._tools.length} tool(s) available`,
        );
    }

    /** Return the list of tools as reported by the server. */
    getTools(): readonly McpToolDescriptor[] {
        return this._tools;
    }

    /**
     * Return the first non-trivial line from the pre-connect stderr buffer, if any.
     * Used to enrich error messages without dumping a full traceback.
     */
    firstStderrHint(): string {
        // Skip generic Python header lines; find the first real error line.
        const meaningfulPrefixes = ["error:", "syntaxerror:", "typeerror:", "runtimeerror:",
            "modulenotfounderror:", "importerror:", "valueerror:", "traceback"];
        for (const line of this.stderrBuffer) {
            const lower = line.trimStart().toLowerCase();
            if (meaningfulPrefixes.some((p) => lower.startsWith(p))) {
                return line.trim().slice(0, 120);
            }
        }
        // Fall back to last non-blank line (often the actual error)
        for (let i = this.stderrBuffer.length - 1; i >= 0; i--) {
            const line = this.stderrBuffer[i]!.trim();
            if (line) return line.slice(0, 120);
        }
        return "";
    }

    /** Execute a tool call on this MCP server. */
    async callTool(toolName: string, toolArgs: Record<string, unknown>): Promise<McpCallResult> {
        if (!this._isConnected) {
            throw new Error(`[MCP:${this.serverName}] Not connected`);
        }
        const resp = await this.sendRequest("tools/call", {
            name: toolName,
            arguments: toolArgs,
        });
        if (resp.error) {
            throw new Error(
                `[MCP:${this.serverName}] Tool "${toolName}" error: ${resp.error.message}`,
            );
        }
        return (resp.result ?? {}) as McpCallResult;
    }

    /** Gracefully terminate the server process and reject all pending requests. */
    disconnect(): void {
        this.rejectAll(new Error(`[MCP:${this.serverName}] Disconnected`));
        this._isConnected = false;
        try {
            this.proc?.kill();
        } catch {
            // Ignore kill errors
        }
        this.proc = null;
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private sendNotification(method: string, params?: unknown): void {
        if (!this.proc?.stdin?.writable) return;
        const msg: JsonRpcNotification = { jsonrpc: "2.0", method };
        if (params !== undefined) msg.params = params;
        this.proc.stdin.write(JSON.stringify(msg) + "\n");
    }

    private sendRequest(method: string, params: unknown): Promise<JsonRpcResponse> {
        const id = this.nextId++;
        const timeoutMs = this.config.timeoutMs ?? 30_000;
        return new Promise<JsonRpcResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`[MCP:${this.serverName}] Timeout on "${method}" (id=${id})`));
            }, timeoutMs);

            this.pendingRequests.set(id, { resolve, reject, timer });

            const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
            if (!this.proc?.stdin?.writable) {
                clearTimeout(timer);
                this.pendingRequests.delete(id);
                reject(new Error(`[MCP:${this.serverName}] stdin not writable`));
                return;
            }
            this.proc.stdin.write(JSON.stringify(msg) + "\n");
        });
    }

    private rejectAll(error: Error): void {
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// McpProxyTool — wraps one MCP tool as a PRISM Tool
// ──────────────────────────────────────────────────────────────────────────────

export class McpProxyTool implements Tool {
    readonly name: string;
    // Dynamic schema — skip static contract validation
    readonly contract = undefined;

    private readonly connection: McpConnection;
    private readonly mcpToolName: string;
    readonly mcpDescription: string;
    readonly mcpInputSchema: McpToolDescriptor["inputSchema"];
    readonly serverName: string;

    constructor(
        connection: McpConnection,
        serverName: string,
        descriptor: McpToolDescriptor,
    ) {
        // Prefix with mcp_ and sanitize to alphanumeric + underscore
        this.name = `mcp_${descriptor.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
        this.mcpToolName = descriptor.name;
        this.mcpDescription = descriptor.description ?? "";
        this.mcpInputSchema = descriptor.inputSchema;
        this.serverName = serverName;
        this.connection = connection;
    }

    async execute(request: ToolRequest): Promise<ToolResult> {
        try {
            const mcpResult = await this.connection.callTool(
                this.mcpToolName,
                request.args,
            );

            // Flatten MCP content array to a unified output
            const output = formatMcpResult(mcpResult);

            return {
                ok: !mcpResult.isError,
                output,
                sideEffects: [
                    {
                        type: "network" as const,
                        description: `MCP call: ${this.serverName}/${this.mcpToolName}`,
                    },
                ],
            };
        } catch (err: unknown) {
            return {
                ok: false,
                output: { error: String(err), server: this.serverName, tool: this.mcpToolName },
            };
        }
    }
}

/** Flatten an MCP content array into a structured output record. */
function formatMcpResult(result: McpCallResult): Record<string, unknown> {
    const items = result.content ?? [];
    if (items.length === 0) return { result: null };
    if (items.length === 1 && items[0]!.type === "text") {
        const text = items[0]!.text ?? "";
        // Try to parse JSON for structured data passthrough
        try {
            const parsed = JSON.parse(text) as unknown;
            return typeof parsed === "object" && parsed !== null
                ? (parsed as Record<string, unknown>)
                : { result: parsed };
        } catch {
            return { result: text };
        }
    }
    // Multiple items or non-text: return as array
    return {
        content: items.map((item) => ({
            type: item.type,
            ...(item.text !== undefined ? { text: item.text } : {}),
            ...(item.data !== undefined ? { data: item.data, mimeType: item.mimeType } : {}),
        })),
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// McpClientAdapter — loads mcp-settings.json, connects servers, registers tools
// ──────────────────────────────────────────────────────────────────────────────

export interface McpLoadResult {
    registered: string[];
    errors: Array<{ server: string; error: string }>;
    serverToolCounts: Record<string, number>;
}

export interface McpLoadOptions {
    /**
     * Allowlist of server names to connect to.
     * If omitted, all servers in the config file are connected.
     */
    serverNames?: string[];
}

export class McpClientAdapter {
    private readonly connections: Array<{ name: string; conn: McpConnection }> = [];

    /**
     * Read an mcp-settings.json file, spawn each configured server,
     * discover its tools, and register them all into the given ToolRegistry.
     *
     * Errors on individual servers are collected and returned — they do NOT
     * prevent other servers from loading.
     */
    async loadAndRegister(
        settingsPath: string,
        registry: ToolRegistry,
        options: McpLoadOptions = {},
    ): Promise<McpLoadResult> {
        const settings = loadSettings(settingsPath);

        const registered: string[] = [];
        const errors: Array<{ server: string; error: string }> = [];
        const serverToolCounts: Record<string, number> = {};

        let serverEntries = Object.entries(settings.mcpServers);
        if (options.serverNames && options.serverNames.length > 0) {
            const allowlist = new Set(options.serverNames);
            serverEntries = serverEntries.filter(([name]) => allowlist.has(name));
        }

        for (const [name, config] of serverEntries) {
            const conn = new McpConnection(name, config);
            try {
                await conn.connect();
                let toolCount = 0;
                for (const descriptor of conn.getTools()) {
                    const proxy = new McpProxyTool(conn, name, descriptor);
                    try {
                        registry.register(proxy);
                        registered.push(proxy.name);
                        toolCount++;
                    } catch (err: unknown) {
                        errors.push({
                            server: name,
                            error: `register "${descriptor.name}": ${String(err)}`,
                        });
                    }
                }
                serverToolCounts[name] = toolCount;
                this.connections.push({ name, conn });
            } catch (err: unknown) {
                // Attach the first non-empty stderr line (e.g. "SyntaxError: …" or
                // "ModuleNotFoundError: …") so the caller's single warn line is informative.
                const stderrHint = conn.firstStderrHint();
                const baseMsg = String(err);
                const hint = stderrHint && !baseMsg.includes(stderrHint)
                    ? ` — ${stderrHint}`
                    : "";
                errors.push({ server: name, error: `${baseMsg}${hint}` });
            }
        }

        return { registered, errors, serverToolCounts };
    }

    /** Return a tool list summary for all connected servers. */
    getConnectedServers(): Array<{ name: string; toolCount: number }> {
        return this.connections.map(({ name, conn }) => ({
            name,
            toolCount: conn.getTools().length,
        }));
    }

    /** Disconnect all server processes. Call on PRISM shutdown. */
    disconnectAll(): void {
        for (const { conn } of this.connections) {
            conn.disconnect();
        }
        this.connections.length = 0;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function loadSettings(settingsPath: string): McpServerSettings {
    let raw: string;
    try {
        raw = readFileSync(settingsPath, "utf-8");
    } catch (err: unknown) {
        throw new Error(`Cannot read MCP settings at "${settingsPath}": ${String(err)}`);
    }
    try {
        return JSON.parse(raw) as McpServerSettings;
    } catch (err: unknown) {
        throw new Error(`Invalid JSON in MCP settings at "${settingsPath}": ${String(err)}`);
    }
}
