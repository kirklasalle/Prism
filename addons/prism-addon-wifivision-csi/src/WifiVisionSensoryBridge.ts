import { type CSIPresenceFrame, type CSIFrameCallback } from './types';

/**
 * WifiVisionSensoryBridge
 * Manages real-time WebSocket connection to the WifiVision sub-GHz RF sensing hub.
 */
export class WifiVisionSensoryBridge {
    private ws: WebSocket | null = null;
    private serverUrl: string;
    private listeners: Set<CSIFrameCallback> = new Set();
    private reconnectTimer: any = null;
    private isConnected: boolean = false;
    private lastFrame: CSIPresenceFrame | null = null;

    constructor(serverUrl: string = "ws://localhost:8000/ws/csi_presence") {
        this.serverUrl = serverUrl;
    }

    public connect(): void {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        try {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = () => {
                this.isConnected = true;
                console.log("[WifiVision-CSI] Connected to RF sensory stream at", this.serverUrl);
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const frame: CSIPresenceFrame = JSON.parse(event.data);
                    this.lastFrame = frame;
                    this.notifyListeners(frame);
                } catch (e) {
                    console.warn("[WifiVision-CSI] Failed to parse CSI frame:", e);
                }
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                console.log("[WifiVision-CSI] Disconnected from stream. Reconnecting in 3s...");
                this.scheduleReconnect();
            };

            this.ws.onerror = (err) => {
                console.error("[WifiVision-CSI] WebSocket error:", err);
                this.ws?.close();
            };
        } catch (e) {
            console.error("[WifiVision-CSI] Connection attempt failed:", e);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (!this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, 3000);
        }
    }

    public subscribe(callback: CSIFrameCallback): () => void {
        this.listeners.add(callback);
        if (this.lastFrame) {
            callback(this.lastFrame);
        }
        return () => this.listeners.delete(callback);
    }

    private notifyListeners(frame: CSIPresenceFrame): void {
        this.listeners.forEach((callback) => {
            try {
                callback(frame);
            } catch (e) {
                console.error("[WifiVision-CSI] Error in subscriber callback:", e);
            }
        });
    }

    public getLastFrame(): CSIPresenceFrame | null {
        return this.lastFrame;
    }

    public getIsConnected(): boolean {
        return this.isConnected;
    }

    public disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }
}
