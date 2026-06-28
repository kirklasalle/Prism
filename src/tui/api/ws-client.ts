/**
 * PRISM TUI — WebSocket client with auto-reconnect and typed events.
 */
import WebSocket from "ws";
import { EventEmitter } from "node:events";

export interface WsClientOptions {
    url: string;
    reconnectIntervalMs?: number;
    maxReconnectMs?: number;
}

export type WsEventType =
    | "ui_action"
    | "guardian_event"
    | "tool_state"
    | "plugin_state"
    | "utility_state"
    | "diagnostics_progress"
    | "diagnostics_complete"
    | "diagnostics_log"
    | "agent_diagnostics_progress"
    | "agent_diagnostics_complete"
    | "computer_diagnostics_progress"
    | "computer_diagnostics_complete"
    | "browser_diagnostics_progress"
    | "browser_diagnostics_complete"
    | "knowledge_graph_diagnostics_progress"
    | "knowledge_graph_diagnostics_complete"
    | "workspace_diagnostics_progress"
    | "workspace_diagnostics_complete"
    | "network_diagnostics_progress"
    | "network_diagnostics_complete"
    | "telemetry_diagnostics_progress"
    | "telemetry_diagnostics_complete"
    | "logs_diagnostics_progress"
    | "logs_diagnostics_complete"
    | "scheduler_diagnostics_progress"
    | "scheduler_diagnostics_complete"
    | "scheduler_action_fired"
    | "activity_event"
    | "chat_token"
    | "chat_complete"
    | "approval_update"
    | "connection"
    | "error";

export interface WsMessage {
    type: WsEventType | string;
    [key: string]: unknown;
}

export class PrismWsClient extends EventEmitter {
    private url: string;
    private reconnectInterval: number;
    private maxReconnect: number;
    private ws: WebSocket | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private currentDelay: number;
    private intentionalClose = false;
    private _connected = false;
    private token: string | null = null;
    private cookie: string | null = null;

    constructor(opts?: Partial<WsClientOptions>) {
        super();
        const port = opts?.url ? new URL(opts.url).port : "7070";
        this.url = opts?.url ?? `ws://localhost:${port}/ws`;
        this.reconnectInterval = opts?.reconnectIntervalMs ?? 3000;
        this.maxReconnect = opts?.maxReconnectMs ?? 30_000;
        this.currentDelay = this.reconnectInterval;
    }

    setUrl(url: string): void {
        this.url = url;
    }

    setToken(token: string | null): void {
        this.token = token;
    }

    setCookie(cookie: string | null): void {
        this.cookie = cookie;
    }

    get connected(): boolean {
        return this._connected;
    }

    connect(): void {
        if (this.ws) return;
        this.intentionalClose = false;
        this._tryConnect();
    }

    disconnect(): void {
        this.intentionalClose = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._connected = false;
    }

    private _tryConnect(): void {
        try {
            const options: any = {};
            const headers: Record<string, string> = {};
            if (this.token) {
                headers["Authorization"] = `Bearer ${this.token}`;
            }
            if (this.cookie) {
                headers["Cookie"] = this.cookie;
            }
            if (Object.keys(headers).length > 0) {
                options.headers = headers;
            }
            this.ws = new WebSocket(this.url, options);
        } catch {
            this._scheduleReconnect();
            return;
        }

        this.ws.on("open", () => {
            this._connected = true;
            this.currentDelay = this.reconnectInterval;
            this.emit("connection", { connected: true });
        });

        this.ws.on("message", (raw: WebSocket.RawData) => {
            try {
                const msg = JSON.parse(raw.toString()) as WsMessage;
                this.emit("message", msg);
                if (msg.type) {
                    this.emit(msg.type, msg);
                }
            } catch {
                // ignore malformed messages
            }
        });

        this.ws.on("close", () => {
            this._connected = false;
            this.ws = null;
            this.emit("connection", { connected: false });
            if (!this.intentionalClose) {
                this._scheduleReconnect();
            }
        });

        this.ws.on("error", () => {
            // close event will handle reconnect
            this._connected = false;
        });
    }

    private _scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._tryConnect();
        }, this.currentDelay);
        this.currentDelay = Math.min(this.currentDelay * 1.5, this.maxReconnect);
    }
}
