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

/**
 * Capacity for the per-connection stderr ring buffer. 200 lines is plenty for a
 * full Python traceback (~30 lines) plus a sustained warning stream and keeps
 * worst-case memory under ~80 KB per server.
 */
const STDERR_RING_CAPACITY = 200;

/** Reason a connection ended; drives reconnect policy. */
export type McpExitReason = "crash" | "shutdown";

/** Lightweight, JSON-safe view of a connection's current state. */
export interface McpServerStateView {
    name: string;
    state: "connected" | "down" | "retrying" | "failed";
    toolCount: number;
    retryCount: number;
    nextRetryAt: string | null;
    lastError: string | null;
    stderrTail: string[];
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
    /**
     * Ring buffer of recent stderr lines. Retained for the life of the
     * connection (NOT cleared after handshake) so that operators can inspect
     * post-connect warnings via /api/mcp/servers and reconnects can replay
     * the failure context. Capped at STDERR_RING_CAPACITY lines.
     */
    private stderrBuffer: string[] = [];
    /** True once `disconnect()` is called explicitly (clean shutdown). */
    private explicitDisconnect = false;
    /** Optional listener notified once when the child process exits. */
    private onExitCallback: ((reason: McpExitReason) => void) | null = null;
    private readonly serverName: string;
    private readonly config: McpServerConfig;

    constructor(serverName: string, config: McpServerConfig) {
        this.serverName = serverName;
        this.config = config;
    }

    get isConnected(): boolean {
        return this._isConnected;
    }

    /** The server's configured name (e.g. as it appears in mcp-settings.json). */
    getName(): string {
        return this.serverName;
    }

    /** The original configuration used to spawn the server. */
    getConfig(): Readonly<McpServerConfig> {
        return this.config;
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

        // stderr: append every line (full-fidelity, no truncation) into a
        // ring buffer for the life of the connection. Forward to console.error
        // once the handshake completes; pre-connect lines are surfaced via
        // firstStderrHint() and stderrTail() if connect() throws.
        this.proc.stderr?.on("data", (chunk: Buffer) => {
            const lines = chunk.toString().split(/\r?\n/).filter((l) => l.length > 0);
            for (const line of lines) {
                this.appendStderr(line);
                if (this._isConnected) {
                    console.error(`[MCP:${this.serverName}] stderr: ${line}`);
                }
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
            const wasConnected = this._isConnected;
            this._isConnected = false;
            this.rejectAll(
                new Error(`[MCP:${this.serverName}] Process exited (code=${code ?? "null"})`),
            );
            const reason: McpExitReason = this.explicitDisconnect ? "shutdown" : "crash";
            // Surface the full stderr tail for crashes so operators see the
            // complete traceback rather than just the first 120 chars.
            if (reason === "crash" && wasConnected) {
                const tail = this.stderrTail(20);
                if (tail.length > 0) {
                    console.error(
                        `[MCP:${this.serverName}] stderr tail (${tail.length} line(s)) at exit:\n` +
                            tail.map((l) => `  ${l}`).join("\n"),
                    );
                }
            }
            const cb = this.onExitCallback;
            this.onExitCallback = null;
            if (cb) {
                try { cb(reason); } catch { /* never throw out of an exit handler */ }
            }
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
        // Note: we intentionally retain stderrBuffer across the handshake
        // so that any pre-connect warnings remain visible in /api/mcp/servers.
        console.log(
            `[MCP:${this.serverName}] Connected — ${this._tools.length} tool(s) available`,
        );
    }

    /** Return the list of tools as reported by the server. */
    getTools(): readonly McpToolDescriptor[] {
        return this._tools;
    }

    /**
     * Subscribe to a single exit notification. Replaces any previous callback;
     * cleared automatically once invoked. Used by McpClientAdapter to drive
     * reconnect on crash without coupling McpConnection to the controller.
     */
    onExit(cb: (reason: McpExitReason) => void): void {
        this.onExitCallback = cb;
    }

    /** Return up to `n` most recent stderr lines (oldest first). */
    stderrTail(n: number): string[] {
        if (n <= 0) return [];
        return this.stderrBuffer.slice(Math.max(0, this.stderrBuffer.length - n));
    }

    /** Append one line to the bounded stderr ring buffer. */
    private appendStderr(line: string): void {
        this.stderrBuffer.push(line);
        if (this.stderrBuffer.length > STDERR_RING_CAPACITY) {
            this.stderrBuffer.splice(0, this.stderrBuffer.length - STDERR_RING_CAPACITY);
        }
    }

    /**
     * Return the first non-trivial line from the stderr ring buffer, if any.
     * Used to enrich error messages without dumping a full traceback.
     *
     * If a Python traceback is present, prefer the LAST line containing an
     * "Error:"/"Exception:" pattern (the actual exception) over the first
     * "Traceback (most recent call last):" header — otherwise the operator
     * sees a useless header with no follow-up.
     */
    firstStderrHint(): string {
        const tracebackIdx = this.stderrBuffer.findIndex(
            (l) => l.trimStart().toLowerCase().startsWith("traceback"),
        );
        if (tracebackIdx >= 0) {
            for (let i = this.stderrBuffer.length - 1; i > tracebackIdx; i--) {
                const line = this.stderrBuffer[i]!.trim();
                if (/^[A-Z][A-Za-z0-9_]*(Error|Exception)\b/.test(line)) {
                    return line.slice(0, 200);
                }
            }
            // No identifiable exception line — fall back to last non-blank.
            for (let i = this.stderrBuffer.length - 1; i > tracebackIdx; i--) {
                const line = this.stderrBuffer[i]!.trim();
                if (line) return line.slice(0, 200);
            }
        }
        const meaningfulPrefixes = [
            "error:", "syntaxerror:", "typeerror:", "runtimeerror:",
            "modulenotfounderror:", "importerror:", "valueerror:",
        ];
        for (const line of this.stderrBuffer) {
            const lower = line.trimStart().toLowerCase();
            if (meaningfulPrefixes.some((p) => lower.startsWith(p))) {
                return line.trim().slice(0, 200);
            }
        }
        // Fall back to last non-blank line (often the actual error)
        for (let i = this.stderrBuffer.length - 1; i >= 0; i--) {
            const line = this.stderrBuffer[i]!.trim();
            if (line) return line.slice(0, 200);
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
        this.explicitDisconnect = true;
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
    private readonly entries: Map<string, McpAdapterEntry> = new Map();
    private toolRegistry: ToolRegistry | null = null;

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
        this.toolRegistry = registry;
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
            const entry: McpAdapterEntry = this.entries.get(name) ?? {
                name,
                config,
                conn: null,
                state: "down",
                retryCount: 0,
                nextRetryAt: null,
                lastError: null,
                registeredToolNames: [],
                retryTimer: null,
            };
            this.entries.set(name, entry);
            entry.config = config;
            try {
                const result = await this.connectAndRegister(entry);
                registered.push(...result.registeredNames);
                serverToolCounts[name] = result.toolCount;
            } catch (err: unknown) {
                const conn = entry.conn;
                const stderrHint = conn?.firstStderrHint() ?? "";
                const baseMsg = String(err);
                const hint = stderrHint && !baseMsg.includes(stderrHint)
                    ? ` — ${stderrHint}`
                    : "";
                const fullMsg = `${baseMsg}${hint}`;
                entry.lastError = fullMsg;
                entry.state = "down";
                errors.push({ server: name, error: fullMsg });
                // Surface the FULL stderr (no truncation) so operators see the
                // complete Python traceback that explains the failure.
                if (conn) {
                    const tail = conn.stderrTail(20);
                    if (tail.length > 0) {
                        console.error(
                            `[MCP:${name}] full stderr at startup failure (${tail.length} line(s)):\n` +
                                tail.map((l) => `  ${l}`).join("\n"),
                        );
                    }
                }
            }
        }

        return { registered, errors, serverToolCounts };
    }

    /**
     * Connect (or reconnect) one entry and register its tools. On exit, schedules
     * an exponential-backoff reconnect unless the connection was closed cleanly.
     */
    private async connectAndRegister(
        entry: McpAdapterEntry,
    ): Promise<{ registeredNames: string[]; toolCount: number }> {
        // Tear down any prior tool registrations and drop the old connection.
        this.unregisterEntryTools(entry);
        const conn = new McpConnection(entry.name, entry.config);
        entry.conn = conn;
        entry.state = "retrying";
        try {
            await conn.connect();
        } catch (err) {
            entry.state = "down";
            throw err;
        }
        const registeredNames: string[] = [];
        let toolCount = 0;
        for (const descriptor of conn.getTools()) {
            const proxy = new McpProxyTool(conn, entry.name, descriptor);
            try {
                this.toolRegistry?.register(proxy);
                registeredNames.push(proxy.name);
                toolCount++;
            } catch {
                // Duplicate registration on reconnect is non-fatal.
            }
        }
        entry.registeredToolNames = registeredNames;
        entry.state = "connected";
        entry.retryCount = 0;
        entry.nextRetryAt = null;
        entry.lastError = null;

        conn.onExit((reason) => {
            if (reason === "shutdown") {
                entry.state = "down";
                return;
            }
            entry.state = "down";
            entry.lastError = `Process exited unexpectedly`;
            this.scheduleReconnect(entry);
        });

        return { registeredNames, toolCount };
    }

    /** Schedule an exp-backoff reconnect for one entry. */
    private scheduleReconnect(entry: McpAdapterEntry): void {
        if (entry.retryTimer) {
            clearTimeout(entry.retryTimer);
            entry.retryTimer = null;
        }
        const MAX_ATTEMPTS = 10;
        if (entry.retryCount >= MAX_ATTEMPTS) {
            entry.state = "failed";
            entry.nextRetryAt = null;
            console.error(
                `[MCP:${entry.name}] Reconnect gave up after ${MAX_ATTEMPTS} attempts`,
            );
            return;
        }
        // 1s, 2s, 4s, 8s, 16s, 30s cap.
        const SCHEDULE = [1000, 2000, 4000, 8000, 16000, 30000];
        const delayMs = SCHEDULE[Math.min(entry.retryCount, SCHEDULE.length - 1)]!;
        entry.retryCount++;
        entry.state = "retrying";
        entry.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
        entry.retryTimer = setTimeout(() => {
            entry.retryTimer = null;
            void this.connectAndRegister(entry).catch((err: unknown) => {
                entry.lastError = String(err);
                this.scheduleReconnect(entry);
            });
        }, delayMs);
    }

    /** Force an immediate reconnect attempt for one server (used by Guardian / API). */
    async forceReconnect(name: string): Promise<{ ok: boolean; error?: string }> {
        const entry = this.entries.get(name);
        if (!entry) return { ok: false, error: `Unknown MCP server: ${name}` };
        if (entry.retryTimer) {
            clearTimeout(entry.retryTimer);
            entry.retryTimer = null;
        }
        entry.retryCount = 0;
        entry.nextRetryAt = null;
        try {
            await this.connectAndRegister(entry);
            return { ok: true };
        } catch (err: unknown) {
            entry.lastError = String(err);
            this.scheduleReconnect(entry);
            return { ok: false, error: String(err) };
        }
    }

    /** Unregister tools previously registered for this entry, if the registry supports it. */
    private unregisterEntryTools(entry: McpAdapterEntry): void {
        const reg = this.toolRegistry as unknown as {
            unregister?: (toolName: string) => void;
        } | null;
        if (!reg || typeof reg.unregister !== "function") {
            entry.registeredToolNames = [];
            return;
        }
        for (const toolName of entry.registeredToolNames) {
            try { reg.unregister(toolName); } catch { /* ignore */ }
        }
        entry.registeredToolNames = [];
    }

    /** Return a tool list summary for all currently-connected servers. */
    getConnectedServers(): Array<{ name: string; toolCount: number }> {
        const out: Array<{ name: string; toolCount: number }> = [];
        for (const entry of this.entries.values()) {
            if (entry.state === "connected" && entry.conn) {
                out.push({ name: entry.name, toolCount: entry.conn.getTools().length });
            }
        }
        return out;
    }

    /** Snapshot of every server's current state (for /api/mcp/servers). */
    getServerStates(): McpServerStateView[] {
        const out: McpServerStateView[] = [];
        for (const entry of this.entries.values()) {
            out.push({
                name: entry.name,
                state: entry.state,
                toolCount: entry.conn?.getTools().length ?? 0,
                retryCount: entry.retryCount,
                nextRetryAt: entry.nextRetryAt,
                lastError: entry.lastError,
                stderrTail: entry.conn?.stderrTail(20) ?? [],
            });
        }
        return out;
    }

    /** True if at least one configured server is currently in "down" or "failed". */
    hasUnhealthyServers(): boolean {
        for (const entry of this.entries.values()) {
            if (entry.state === "down" || entry.state === "failed") return true;
        }
        return false;
    }

    /** All configured server names. */
    getServerNames(): string[] {
        return Array.from(this.entries.keys());
    }

    /** Disconnect all server processes. Call on PRISM shutdown. */
    disconnectAll(): void {
        for (const entry of this.entries.values()) {
            if (entry.retryTimer) {
                clearTimeout(entry.retryTimer);
                entry.retryTimer = null;
            }
            entry.conn?.disconnect();
            entry.conn = null;
            entry.state = "down";
        }
        this.entries.clear();
    }
}

interface McpAdapterEntry {
    name: string;
    config: McpServerConfig;
    conn: McpConnection | null;
    state: "connected" | "down" | "retrying" | "failed";
    retryCount: number;
    nextRetryAt: string | null;
    lastError: string | null;
    registeredToolNames: string[];
    retryTimer: ReturnType<typeof setTimeout> | null;
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
