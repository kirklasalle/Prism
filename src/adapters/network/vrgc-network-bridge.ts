/**
 * VRGC Network Bridge
 *
 * Bridges the VRGC (Virtually Robotic GitHub Copilot) MCP server's Phase 6
 * web access tools into the PRISM Network Tab for intelligent network
 * operations.
 *
 * Each method wraps a VRGC tool call via HTTP to the MCP server and returns
 * structured results suitable for dashboard rendering.
 *
 * VRGC server: .mcp/impressioncore-vrgc/server_enhanced.py (port 8203)
 */
import http from "node:http";

/** Default VRGC MCP server endpoint. Override with VRGC_PORT env var. */
const VRGC_PORT = parseInt(process.env.VRGC_PORT || "8203", 10);
const VRGC_HOST = process.env.VRGC_HOST || "127.0.0.1";
const REQUEST_TIMEOUT = 30_000;

/* ── Types ───────────────────────────────────────────────────────────── */

export interface VrgcResult<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
}

export interface SecurityScanResult {
    scanType: string;
    target: string;
    headers?: Record<string, string>;
    sslInfo?: { valid: boolean; issuer?: string; expiresAt?: string };
    vulnerabilities?: string[];
    score?: number;
}

export interface PerformanceResult {
    url: string;
    loadTimeMs?: number;
    ttfbMs?: number;
    deviceSimulation?: string;
    metrics?: Record<string, number>;
}

export interface FtpListingResult {
    server: string;
    path: string;
    entries?: { name: string; type: string; size?: number }[];
}

export interface ResearchResult {
    topic: string;
    sources: { title: string; url: string; snippet: string }[];
    summary?: string;
}

/* ── MCP Call Helper ─────────────────────────────────────────────────── */

/**
 * Call a VRGC MCP tool via HTTP JSON-RPC style request.
 * VRGC exposes a simple HTTP API where each tool is a POST endpoint.
 */
function callVrgcTool(
    toolName: string,
    args: Record<string, unknown>,
): Promise<VrgcResult> {
    return new Promise((resolve) => {
        const body = JSON.stringify({ tool: toolName, arguments: args });
        const req = http.request(
            {
                hostname: VRGC_HOST,
                port: VRGC_PORT,
                path: "/call",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                },
                timeout: REQUEST_TIMEOUT,
            },
            (res) => {
                let chunks = "";
                res.on("data", (c) => (chunks += c));
                res.on("end", () => {
                    try {
                        const parsed = JSON.parse(chunks);
                        resolve({ ok: true, data: parsed });
                    } catch {
                        resolve({ ok: false, error: `Invalid JSON from VRGC: ${chunks.slice(0, 200)}` });
                    }
                });
            },
        );
        req.on("error", (err) => {
            resolve({ ok: false, error: `VRGC server unavailable: ${err.message}` });
        });
        req.on("timeout", () => {
            req.destroy();
            resolve({ ok: false, error: "VRGC request timed out" });
        });
        req.write(body);
        req.end();
    });
}

/* ── Public API ──────────────────────────────────────────────────────── */

/**
 * Check if the VRGC MCP server is reachable.
 */
export async function checkVrgcAvailability(): Promise<boolean> {
    const result = await callVrgcTool("vrgc_web_fetch", { url: "http://localhost", extraction_type: "raw" });
    // If we get any response (even an error from the tool), the server is up
    return result.ok || (result.error !== undefined && !result.error.includes("unavailable"));
}

/**
 * Fetch network research context using VRGC's research assistant.
 * Useful for troubleshooting context and documentation lookups.
 */
export async function fetchNetworkResearch(
    topic: string,
    options?: { depth?: "quick" | "standard" | "comprehensive"; sourceTypes?: string[] },
): Promise<VrgcResult<ResearchResult>> {
    const result = await callVrgcTool("vrgc_research_assistant", {
        topic,
        depth: options?.depth ?? "standard",
        source_types: options?.sourceTypes ?? ["documentation", "stackoverflow"],
        output_format: "structured",
    });

    if (!result.ok) return { ok: false, error: result.error };

    const data = result.data as any;
    return {
        ok: true,
        data: {
            topic,
            sources: Array.isArray(data?.sources) ? data.sources : [],
            summary: data?.summary ?? "",
        },
    };
}

/**
 * Run a web security scan against a target URL.
 * Uses VRGC's vrgc_web_security_scan for SSL and header analysis.
 */
export async function runSecurityScan(
    target: string,
    scanType: "basic" | "headers" | "ssl" | "comprehensive" = "comprehensive",
): Promise<VrgcResult<SecurityScanResult>> {
    const result = await callVrgcTool("vrgc_web_security_scan", {
        url: target,
        scan_type: scanType,
        check_certificates: true,
    });

    if (!result.ok) return { ok: false, error: result.error };

    const data = result.data as any;
    return {
        ok: true,
        data: {
            scanType,
            target,
            headers: data?.headers,
            sslInfo: data?.ssl_info,
            vulnerabilities: data?.vulnerabilities ?? [],
            score: data?.security_score,
        },
    };
}

/**
 * Run a web performance test against a URL.
 * Uses VRGC's vrgc_web_performance_test for load time and metrics.
 */
export async function testPerformance(
    url: string,
    options?: { testType?: string; device?: "desktop" | "mobile" | "tablet" },
): Promise<VrgcResult<PerformanceResult>> {
    const result = await callVrgcTool("vrgc_web_performance_test", {
        url,
        test_type: options?.testType ?? "load_time",
        device_simulation: options?.device ?? "desktop",
    });

    if (!result.ok) return { ok: false, error: result.error };

    const data = result.data as any;
    return {
        ok: true,
        data: {
            url,
            loadTimeMs: data?.load_time_ms,
            ttfbMs: data?.ttfb_ms,
            deviceSimulation: options?.device ?? "desktop",
            metrics: data?.metrics,
        },
    };
}

/**
 * List FTP directory contents via VRGC's vrgc_ftp_access tool.
 */
export async function fetchFtpListing(
    server: string,
    path: string = "/",
    passiveMode: boolean = true,
): Promise<VrgcResult<FtpListingResult>> {
    const result = await callVrgcTool("vrgc_ftp_access", {
        server,
        path,
        operation: "list",
        passive_mode: passiveMode,
    });

    if (!result.ok) return { ok: false, error: result.error };

    const data = result.data as any;
    return {
        ok: true,
        data: {
            server,
            path,
            entries: Array.isArray(data?.entries) ? data.entries : [],
        },
    };
}

/**
 * Start monitoring a URL for availability and changes.
 * Uses VRGC's vrgc_web_monitor tool.
 */
export async function monitorEndpoint(
    url: string,
    options?: { checkIntervalMinutes?: number; monitorType?: "content" | "availability" | "structure" },
): Promise<VrgcResult> {
    return callVrgcTool("vrgc_web_monitor", {
        url,
        check_interval: options?.checkIntervalMinutes ?? 5,
        monitor_type: options?.monitorType ?? "availability",
    });
}

/**
 * Perform a web search for network-related information.
 * Uses VRGC's vrgc_web_search with relevant operators.
 */
export async function searchNetworkInfo(
    query: string,
    options?: { resultCount?: number; filterAcademic?: boolean },
): Promise<VrgcResult> {
    return callVrgcTool("vrgc_web_search", {
        query,
        result_count: options?.resultCount ?? 10,
        filter_academic: options?.filterAcademic ?? false,
        search_engines: ["google", "duckduckgo"],
    });
}
