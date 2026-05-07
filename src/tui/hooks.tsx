/**
 * PRISM TUI — Custom React hooks for API polling, WebSocket events, and keyboard input.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useInput, useApp } from "ink";
import type { PrismClient } from "./api/prism-client.js";
import type { PrismWsClient, WsMessage } from "./api/ws-client.js";
import { TAB_SHORTCUTS } from "./theme.js";

/* ------------------------------------------------------------------ */
/*  useApi — poll an API endpoint at an interval                       */
/* ------------------------------------------------------------------ */

export function useApi<T>(
    client: PrismClient,
    fetcher: (c: PrismClient) => Promise<T>,
    intervalMs = 5000,
): { data: T | null; error: string | null; loading: boolean; refresh: () => void } {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    const doFetch = useCallback(async () => {
        try {
            const result = await fetcherRef.current(client);
            if (mountedRef.current) {
                setData(result);
                setError(null);
            }
        } catch (e: unknown) {
            if (mountedRef.current) {
                setError(e instanceof Error ? e.message : String(e));
            }
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [client]);

    useEffect(() => {
        mountedRef.current = true;
        doFetch();
        const timer = setInterval(doFetch, intervalMs);
        return () => {
            mountedRef.current = false;
            clearInterval(timer);
        };
    }, [doFetch, intervalMs]);

    return { data, error, loading, refresh: doFetch };
}

/* ------------------------------------------------------------------ */
/*  useWsEvent — subscribe to a specific WebSocket event type          */
/* ------------------------------------------------------------------ */

export function useWsEvent<T extends WsMessage = WsMessage>(
    wsClient: PrismWsClient,
    eventType: string,
): T | null {
    const [last, setLast] = useState<T | null>(null);

    useEffect(() => {
        const handler = (msg: T) => setLast(msg);
        wsClient.on(eventType, handler);
        return () => {
            wsClient.off(eventType, handler);
        };
    }, [wsClient, eventType]);

    return last;
}

/* ------------------------------------------------------------------ */
/*  useConnection — track WS connection state                          */
/* ------------------------------------------------------------------ */

export function useConnection(wsClient: PrismWsClient): boolean {
    const [connected, setConnected] = useState(wsClient.connected);

    useEffect(() => {
        const handler = (msg: { connected: boolean }) => setConnected(msg.connected);
        wsClient.on("connection", handler);
        return () => {
            wsClient.off("connection", handler);
        };
    }, [wsClient]);

    return connected;
}

/* ------------------------------------------------------------------ */
/*  useTabNavigation — global tab switching via number keys             */
/* ------------------------------------------------------------------ */

export function useTabNavigation(
    setActiveTab: (tabId: string) => void,
    inputEnabled = true,
): void {
    useInput(
        (input, _key) => {
            if (!inputEnabled) return;
            const tabId = TAB_SHORTCUTS[input];
            if (tabId) {
                setActiveTab(tabId);
            }
        },
    );
}

/* ------------------------------------------------------------------ */
/*  useQuit — Ctrl+C / q to exit                                       */
/* ------------------------------------------------------------------ */

export function useQuit(): void {
    const { exit } = useApp();

    useInput((input, key) => {
        if (input === "q" && !key.ctrl && !key.meta) {
            exit();
        }
    });
}

/* ------------------------------------------------------------------ */
/*  useListNavigation — j/k/g/G list scrolling                         */
/* ------------------------------------------------------------------ */

export function useListNavigation(
    length: number,
    inputEnabled = true,
): { selectedIndex: number; setSelectedIndex: (i: number) => void } {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useInput(
        (input, key) => {
            if (!inputEnabled || length === 0) return;
            if (input === "j" || key.downArrow) {
                setSelectedIndex((i) => Math.min(i + 1, length - 1));
            } else if (input === "k" || key.upArrow) {
                setSelectedIndex((i) => Math.max(i - 1, 0));
            } else if (input === "g") {
                setSelectedIndex(0);
            } else if (input === "G") {
                setSelectedIndex(length - 1);
            }
        },
    );

    return { selectedIndex, setSelectedIndex };
}

/* ------------------------------------------------------------------ */
/*  useScrollableLog — append-only log with max buffer                 */
/* ------------------------------------------------------------------ */

export function useScrollableLog(maxLines = 500): {
    lines: string[];
    append: (line: string) => void;
    clear: () => void;
} {
    const [lines, setLines] = useState<string[]>([]);

    const append = useCallback(
        (line: string) =>
            setLines((prev) => {
                const next = [...prev, line];
                return next.length > maxLines ? next.slice(next.length - maxLines) : next;
            }),
        [maxLines],
    );

    const clear = useCallback(() => setLines([]), []);

    return { lines, append, clear };
}
