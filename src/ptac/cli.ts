/**
 * PTAC CLI entrypoint.
 *
 * Invoked via:
 *   npm run ptac:sandbox -- [--suite=fast|full|demo] [--scenario=<id>] [...]
 *   npm run ptac:host    -- --i-understand-host-control [--scenario=<id>] [...]
 *
 * Flags:
 *   --profile=sandbox|host        execution profile (default sandbox)
 *   --suite=fast|full|demo|custom which preset to run (default fast)
 *   --scenario=<id>               run a single scenario (repeatable)
 *   --tag=<tag>                   filter by scenario tag (repeatable)
 *   --dashboard=<url>             dashboard base URL (default http://localhost:7070)
 *   --auth-token=<token>          bearer token sent with every request
 *   --output=<dir>                run output dir (default ${PRISM_DATA_DIR}/ptac)
 *   --i-understand-host-control   required for --profile=host
 *   --idle-timeout=<seconds>      override watchdog (host profile)
 *
 * Exit codes:
 *   0  all selected scenarios passed
 *   1  one or more scenarios failed
 *   2  configuration error (e.g. host profile without confirmation)
 *   3  no scenarios matched the filter
 */

import { join } from "node:path";
import { listScenarios } from "./scenario-registry.js";
import { PtacOrchestrator } from "./orchestrator.js";
import type { PtacProfile, PtacRunRequest, PtacScenario, PtacSuite } from "./types.js";

// Side-effect import: triggers each scenario file's `registerScenario(...)`
// call. The registry must be populated before `parseArgs` filters on it.
import "./index.js";

interface CliArgs {
    profile: PtacProfile;
    suite: PtacSuite;
    scenarioIds: string[];
    tags: string[];
    dashboard: string;
    authToken?: string;
    outputDir: string;
    hostConfirmed: boolean;
    idleTimeoutS?: number;
    demoRecording: boolean;
    recordVideo: boolean;
    recordVideoFps?: number;
}

function parseArgs(argv: string[]): CliArgs {
    const get = (name: string): string | undefined => {
        const eq = argv.find((a) => a.startsWith(`--${name}=`));
        if (eq) return eq.slice(name.length + 3);
        const i = argv.indexOf(`--${name}`);
        if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
        return undefined;
    };
    const all = (name: string): string[] =>
        argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));

    const profile = (get("profile") ?? "sandbox") as PtacProfile;
    if (profile !== "sandbox" && profile !== "host") {
        throw new Error(`--profile must be "sandbox" or "host" (got "${profile}")`);
    }
    const suite = (get("suite") ?? "fast") as PtacSuite;
    if (!["fast", "full", "demo", "custom", "osworld"].includes(suite)) {
        throw new Error(`--suite must be one of fast|full|demo|custom|osworld (got "${suite}")`);
    }
    const dataDir = process.env.PRISM_PTAC_OUTPUT_DIR
        ?? (process.env.PRISM_DATA_DIR ? join(process.env.PRISM_DATA_DIR, "ptac") : join(process.cwd(), "prism-output", "ptac"));
    return {
        profile,
        suite,
        scenarioIds: all("scenario"),
        tags: all("tag"),
        dashboard: get("dashboard") ?? "http://localhost:7070",
        authToken: get("auth-token"),
        outputDir: get("output") ?? dataDir,
        hostConfirmed: argv.includes("--i-understand-host-control"),
        idleTimeoutS: get("idle-timeout") ? Number(get("idle-timeout")) : undefined,
        demoRecording: argv.includes("--demo-recording"),
        recordVideo: argv.includes("--record-video"),
        recordVideoFps: get("record-video-fps") ? Number(get("record-video-fps")) : undefined,
    };
}

function selectScenarios(args: CliArgs): readonly PtacScenario[] {
    if (args.scenarioIds.length > 0) {
        const all = listScenarios();
        const map = new Map(all.map((s) => [s.id, s]));
        const missing = args.scenarioIds.filter((id) => !map.has(id));
        if (missing.length > 0) {
            throw new Error(`unknown scenario ids: ${missing.join(", ")}`);
        }
        return args.scenarioIds.map((id) => map.get(id)!);
    }
    const filtered = listScenarios({ suite: args.suite });
    if (args.tags.length === 0) return filtered;
    return filtered.filter((s) => args.tags.every((t) => (s.tags ?? []).includes(t)));
}

async function main(): Promise<number> {
    let args: CliArgs;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`[ptac] config error: ${(err as Error).message}`);
        return 2;
    }

    if (args.profile === "host" && !args.hostConfirmed) {
        console.error(
            "[ptac] --profile=host requires --i-understand-host-control. The host profile " +
            "drives real keyboard/mouse input on your desktop. Use --profile=sandbox unless " +
            "you intend to run a live demo with the operator present.",
        );
        return 2;
    }

    // --record-video opt-in dual gate: requires PRISM_PTAC_SAFE=1 AND
    // PRISM_PTAC_RECORD_VIDEO=1. Mirrors the computer-use safety gate and
    // ensures recording only happens on operator-prepared hosts.
    if (args.recordVideo) {
        if (process.env.PRISM_PTAC_SAFE !== "1" || process.env.PRISM_PTAC_RECORD_VIDEO !== "1") {
            console.error(
                "[ptac] --record-video requires both PRISM_PTAC_SAFE=1 and " +
                "PRISM_PTAC_RECORD_VIDEO=1 to be set in the environment. " +
                "These dual gates ensure the host is prepared and the operator " +
                "explicitly opted in to recording artefacts being written to disk.",
            );
            return 2;
        }
    }

    const scenarios = selectScenarios(args);
    if (scenarios.length === 0) {
        console.error(
            `[ptac] no scenarios matched suite=${args.suite}` +
            (args.tags.length > 0 ? ` tags=[${args.tags.join(",")}]` : "") +
            ". Production scenarios are added per docs/PRISM_FULL_AUDIT_2026_Q3_AND_PTAC_PLAN.md.",
        );
        return 3;
    }

    // Preflight connectivity check and optional auto-start
    let isReachable = false;
    try {
        const res = await globalThis.fetch(`${args.dashboard}/api/health`);
        if (res.ok) {
            isReachable = true;
        }
    } catch {
        // Not reachable
    }

    let childServerProcess: any = null;
    if (!isReachable) {
        console.log(`[ptac] Target dashboard at ${args.dashboard} is not reachable.`);
        console.log(`[ptac] Attempting to auto-start local dashboard server...`);

        try {
            const { spawn } = await import("node:child_process");
            const env = {
                ...process.env,
                PRISM_MODE: "server",
                PRISM_DASHBOARD_PORT: "7070",
                PRISM_AUTH_DISABLED: "true",
            };
            childServerProcess = spawn(process.execPath, ["dist/src/index.js"], {
                env,
                stdio: "ignore",
                detached: false,
            });

            console.log(`[ptac] Waiting for dashboard server to bind to port...`);
            for (let i = 0; i < 120; i++) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                try {
                    const res = await globalThis.fetch(`${args.dashboard}/api/health`);
                    if (res.ok) {
                        isReachable = true;
                        console.log(`[ptac] Auto-started server successfully bound to port.`);
                        break;
                    }
                } catch {
                    // Continue polling
                }
            }
        } catch (err) {
            console.warn(`[ptac] Failed to spawn auto-start process: ${(err as Error).message}`);
        }

        if (!isReachable) {
            console.error(
                `\n[ptac] [ERROR] Target dashboard server at ${args.dashboard} is not running and auto-start timed out.\n` +
                `Please ensure the server is started before running PTAC:\n` +
                `  On Windows:  start_web.bat\n` +
                `  On Unix:     ./start_web.sh\n`
            );
            if (childServerProcess) {
                try {
                    childServerProcess.kill();
                } catch {}
            }
            return 1;
        }
    }

    console.log(
        `[ptac] starting profile=${args.profile} suite=${args.suite} ` +
        `scenarios=${scenarios.length} dashboard=${args.dashboard}`,
    );

    const request: PtacRunRequest = {
        profile: args.profile,
        suite: args.suite,
        scenarioIds: args.scenarioIds.length > 0 ? args.scenarioIds : undefined,
        outputDir: args.outputDir,
        dashboardBaseUrl: args.dashboard,
        authToken: args.authToken,
        hostConfirmed: args.hostConfirmed,
        idleTimeoutS: args.idleTimeoutS,
        demoRecording: args.demoRecording,
        recordVideo: args.recordVideo,
        recordVideoFps: args.recordVideoFps,
    };

    let exitCode = 1;
    try {
        const orchestrator = new PtacOrchestrator();
        const result = await orchestrator.run(request, scenarios);

        console.log(`[ptac] run ${result.runId}: ${result.status.toUpperCase()}`);
        console.log(`[ptac] report: ${result.reportHtmlPath}`);
        exitCode = result.status === "passed" ? 0 : 1;
    } finally {
        if (childServerProcess) {
            console.log(`[ptac] Stopping auto-started local dashboard server...`);
            try {
                childServerProcess.kill();
            } catch (err) {
                console.warn(`[ptac] Failed to stop auto-started server process: ${(err as Error).message}`);
            }
        }
    }
    return exitCode;
}

main().then(
    (code) => process.exit(code),
    (err) => {
        console.error(`[ptac] FATAL: ${(err as Error).stack ?? String(err)}`);
        process.exit(1);
    },
);
