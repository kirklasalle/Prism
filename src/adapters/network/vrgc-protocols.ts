/**
 * VRGC Network Protocols — Executable Implementations
 *
 * Orchestrates VRGC Phase 6 web tools + local network commands into
 * reusable protocol sequences for common network operations use cases.
 *
 * See docs/VRGC_NETWORK_PROTOCOLS.md for full protocol documentation.
 */
import { fetchNetworkResearch, runSecurityScan, testPerformance, monitorEndpoint } from "./vrgc-network-bridge.js";
import { NetworkTool } from "./network-tool.js";

import type { ToolRequest } from "../../core/tools/types.js";

const networkTool = new NetworkTool();

/* ── Shared helpers ──────────────────────────────────────────────────── */

interface ProtocolStep {
    step: string;
    tool: string;
    status: "success" | "error" | "skipped";
    data?: unknown;
    error?: string;
    durationMs?: number;
}

interface ProtocolResult {
    protocol: string;
    steps: ProtocolStep[];
    summary: string;
    completedAt: string;
}

async function execNetworkCmd(command: string): Promise<{ ok: boolean; output: unknown }> {
    const req: ToolRequest = { operation: "network_exec", args: { command, timeoutMs: 15_000 }, risk: "low", mutatesState: false };
    return networkTool.execute(req);
}

function timedStep(step: string, tool: string, fn: () => Promise<unknown>): Promise<ProtocolStep> {
    const start = Date.now();
    return fn()
        .then((data) => ({
            step,
            tool,
            status: "success" as const,
            data,
            durationMs: Date.now() - start,
        }))
        .catch((err) => ({
            step,
            tool,
            status: "error" as const,
            error: String(err),
            durationMs: Date.now() - start,
        }));
}

/* ── Protocol 1: Autonomous Network Troubleshooting ──────────────────── */

export class NetworkTroubleshootingProtocol {
    async diagnose(symptom: string): Promise<ProtocolResult> {
        const steps: ProtocolStep[] = [];

        // Step 1: Research
        steps.push(
            await timedStep("research", "vrgc_research_assistant", async () => {
                const result = await fetchNetworkResearch(symptom, { depth: "standard" });
                return result.ok ? result.data : { error: result.error };
            }),
        );

        // Step 2: Local diagnostics (parallel)
        const diagnosticCmds = ["ipconfig", "ping 127.0.0.1 -n 2", "nslookup localhost"];
        const diagnosticResults = await Promise.all(
            diagnosticCmds.map((cmd) =>
                timedStep(`diagnose:${cmd.split(" ")[0]}`, "network_exec", async () => {
                    const result = await execNetworkCmd(cmd);
                    return result.output;
                }),
            ),
        );
        steps.push(...diagnosticResults);

        // Step 3: Correlate
        const diagnosticSummary = diagnosticResults
            .filter((s) => s.status === "success")
            .map((s) => JSON.stringify(s.data).slice(0, 200))
            .join("\n");

        steps.push(
            await timedStep("correlate", "vrgc_research_assistant", async () => {
                const result = await fetchNetworkResearch(
                    `${symptom}\n\nDiagnostic output:\n${diagnosticSummary}`,
                    { depth: "comprehensive" },
                );
                return result.ok ? result.data : { error: result.error };
            }),
        );

        const failCount = steps.filter((s) => s.status === "error").length;
        return {
            protocol: "network-troubleshooting",
            steps,
            summary: `Troubleshooting complete: ${steps.length} steps, ${failCount} errors. Symptom: "${symptom}"`,
            completedAt: new Date().toISOString(),
        };
    }
}

/* ── Protocol 2: Security Posture Assessment ─────────────────────────── */

export class SecurityAssessmentProtocol {
    async assess(target: string): Promise<ProtocolResult> {
        const steps: ProtocolStep[] = [];

        // Step 1: SSL scan
        steps.push(
            await timedStep("ssl-scan", "vrgc_web_security_scan", async () => {
                const result = await runSecurityScan(target, "ssl");
                return result.ok ? result.data : { error: result.error };
            }),
        );

        // Step 2: Header scan
        steps.push(
            await timedStep("header-scan", "vrgc_web_security_scan", async () => {
                const result = await runSecurityScan(target, "headers");
                return result.ok ? result.data : { error: result.error };
            }),
        );

        // Step 3: CVE lookup
        const hostname = target.replace(/^https?:\/\//, "").split("/")[0];
        steps.push(
            await timedStep("cve-lookup", "vrgc_research_assistant", async () => {
                const result = await fetchNetworkResearch(`CVE vulnerabilities for ${hostname}`, {
                    depth: "comprehensive",
                    sourceTypes: ["documentation"],
                });
                return result.ok ? result.data : { error: result.error };
            }),
        );

        // Step 4: Local verification
        steps.push(
            await timedStep("local-dns", "network_exec", async () => {
                const result = await execNetworkCmd(`nslookup ${hostname}`);
                return result.output;
            }),
        );

        // Step 5: Score computation
        const sslStep = steps[0];
        const headerStep = steps[1];
        const cveStep = steps[2];
        let score = 0;

        if (sslStep.status === "success") {
            const ssl = sslStep.data as any;
            if (ssl?.sslInfo?.valid) score += 25;
        }
        if (headerStep.status === "success") {
            const headers = (headerStep.data as any)?.headers ?? {};
            if (headers["strict-transport-security"]) score += 15;
            if (headers["content-security-policy"]) score += 15;
            if (headers["x-frame-options"]) score += 5;
            if (headers["x-content-type-options"]) score += 5;
            if (headers["referrer-policy"]) score += 5;
            if (headers["permissions-policy"]) score += 5;
        }
        if (cveStep.status === "success") {
            const cves = (cveStep.data as any)?.sources ?? [];
            if (cves.length === 0) score += 25;
        }

        const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

        steps.push({
            step: "score",
            tool: "computed",
            status: "success",
            data: { score, grade, maxScore: 100 },
        });

        return {
            protocol: "security-assessment",
            steps,
            summary: `Security assessment for ${target}: score ${score}/100 (${grade})`,
            completedAt: new Date().toISOString(),
        };
    }
}

/* ── Protocol 3: Performance Baseline ────────────────────────────────── */

export class PerformanceBaselineProtocol {
    async baseline(urls: string[]): Promise<ProtocolResult> {
        const steps: ProtocolStep[] = [];

        for (const url of urls) {
            const hostname = url.replace(/^https?:\/\//, "").split("/")[0];

            // Desktop performance test
            steps.push(
                await timedStep(`perf:desktop:${hostname}`, "vrgc_web_performance_test", async () => {
                    const result = await testPerformance(url, { device: "desktop" });
                    return result.ok ? result.data : { error: result.error };
                }),
            );

            // Mobile performance test
            steps.push(
                await timedStep(`perf:mobile:${hostname}`, "vrgc_web_performance_test", async () => {
                    const result = await testPerformance(url, { device: "mobile" });
                    return result.ok ? result.data : { error: result.error };
                }),
            );

            // Local ping baseline
            steps.push(
                await timedStep(`ping:${hostname}`, "network_exec", async () => {
                    const result = await execNetworkCmd(`ping ${hostname} -n 4`);
                    return result.output;
                }),
            );
        }

        // Set up monitoring for first URL
        if (urls.length > 0) {
            steps.push(
                await timedStep("monitor", "vrgc_web_monitor", async () => {
                    const result = await monitorEndpoint(urls[0], {
                        checkIntervalMinutes: 5,
                        monitorType: "availability",
                    });
                    return result.ok ? result.data : { error: result.error };
                }),
            );
        }

        return {
            protocol: "performance-baseline",
            steps,
            summary: `Performance baseline for ${urls.length} URL(s): ${steps.length} measurements collected`,
            completedAt: new Date().toISOString(),
        };
    }
}
