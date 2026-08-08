/**
 * PRISM TUI — Custom React hooks for API polling, WebSocket events, and keyboard input.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useInput, useApp } from "ink";
import type { PrismClient } from "./api/prism-client.js";
import type { PrismWsClient, WsMessage } from "./api/ws-client.js";

/* ------------------------------------------------------------------ */
/*  useApi — poll an API endpoint at an interval                       */
/* ------------------------------------------------------------------ */

export function useApi<T>(
    client: PrismClient,
    fetcher: (c: PrismClient) => Promise<T>,
    intervalMs = 5000,
    options?: { paused?: boolean; backgroundIntervalMs?: number },
): { data: T | null; error: string | null; loading: boolean; refresh: () => void } {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    const paused = options?.paused ?? false;
    const backgroundIntervalMs = options?.backgroundIntervalMs ?? 60000;

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

        // When active: fetch immediately and poll at intervalMs
        // When paused: poll at backgroundIntervalMs (slow background refresh)
        if (!paused) {
            doFetch();
        }

        const activeInterval = paused ? backgroundIntervalMs : intervalMs;
        const timer = setInterval(() => {
            if (mountedRef.current) doFetch();
        }, activeInterval);

        return () => {
            mountedRef.current = false;
            clearInterval(timer);
        };
    }, [doFetch, intervalMs, backgroundIntervalMs, paused]);

    return { data, error, loading, refresh: doFetch };
}

/* ------------------------------------------------------------------ */
/*  useWsEvent — subscribe to a specific WebSocket event type          */
/* ------------------------------------------------------------------ */

export function useWsEvent<T extends WsMessage = WsMessage>(wsClient: PrismWsClient, eventType: string): T | null {
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
/*  useListNavigation — j/k/g/G list scrolling with auto-clamp         */
/* ------------------------------------------------------------------ */

export function useListNavigation(
    length: number,
    inputEnabled = true,
): { selectedIndex: number; setSelectedIndex: (i: number) => void } {
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Clamp selectedIndex when data length changes
    useEffect(() => {
        if (length === 0) {
            setSelectedIndex(0);
        } else if (selectedIndex >= length) {
            setSelectedIndex(length - 1);
        }
    }, [length, selectedIndex]);

    useInput((input, key) => {
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
    });

    return { selectedIndex, setSelectedIndex };
}

/* ------------------------------------------------------------------ */
/*  useSubTabNavigation — [ / ] / Shift+arrows for sub-tab cycling     */
/* ------------------------------------------------------------------ */

export function useSubTabNavigation(
    tabs: string[],
    activeTab: string,
    setActiveTab: (tabId: string) => void,
    inputEnabled = true,
): void {
    useInput((input, key) => {
        if (!inputEnabled || tabs.length <= 1) return;
        const idx = tabs.indexOf(activeTab);
        if (idx < 0) return;

        // ] or Shift+Right → next sub-tab
        if (input === "]" || (key.shift && key.rightArrow)) {
            setActiveTab(tabs[(idx + 1) % tabs.length]!);
            return;
        }
        // [ or Shift+Left → previous sub-tab
        if (input === "[" || (key.shift && key.leftArrow)) {
            setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length]!);
            return;
        }
    });
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

    // Use ref to avoid stale closure issues when passed to effect dependencies
    const appendRef = useRef<(line: string) => void>(() => {});

    const append = useCallback(
        (line: string) =>
            setLines((prev) => {
                const next = [...prev, line];
                return next.length > maxLines ? next.slice(next.length - maxLines) : next;
            }),
        [maxLines],
    );

    // Keep ref in sync
    appendRef.current = append;

    const clear = useCallback(() => setLines([]), []);

    // Expose a stable reference for use in effects
    const stableAppend = useCallback((line: string) => appendRef.current(line), []);

    return { lines, append: stableAppend, clear };
}
