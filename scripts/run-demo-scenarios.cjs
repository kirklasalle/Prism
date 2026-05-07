/**
 * PRISM Demo Scenario Diagnostics Runner (CJS)
 *
 * Spawns the demo-scenario-runner TypeScript (compiled) and captures
 * JSON progress lines for dashboard integration.
 *
 * Usage:
 *   node scripts/run-demo-scenarios.cjs
 *   node scripts/run-demo-scenarios.cjs --no-build
 *   node scripts/run-demo-scenarios.cjs --category=A,B
 *   PRISM_EXECUTION_PROFILE=business node scripts/run-demo-scenarios.cjs
 */
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const RUNNER = "dist/src/benchmarks/demo-scenario-runner.js";
const REPORT_PATH = "prism-output/demo-scenario-report.json";
const LOG_PATH = "prism-output/demo-scenario-full.log";

// ── Helpers ──────────────────────────────────────────────────────────

function emitProgress(payload) {
    try {
        process.stdout.write(JSON.stringify(payload) + "\n");
    } catch { /* ignore */ }
}

// ── 1. Build ─────────────────────────────────────────────────────────

const skipBuild = process.argv.includes("--no-build");
if (!skipBuild) {
    console.error("Building...");
    try { execSync("npm run build", { stdio: "inherit" }); }
    catch { console.error("Build failed — aborting."); process.exit(1); }
} else {
    console.error("Skipping build (--no-build)...");
}

// ── 2. Verify compiled runner exists ─────────────────────────────────

if (!fs.existsSync(RUNNER)) {
    console.error(`Compiled runner not found: ${RUNNER}`);
    console.error(`Run 'npm run build' first.`);
    process.exit(1);
}

// ── 3. Pass through arguments ────────────────────────────────────────

const passthrough = process.argv.slice(2).filter(a => a !== "--no-build");

// ── 4. Launch runner ─────────────────────────────────────────────────

console.error(`\nLaunching demo scenario runner...`);
console.error(`  Runner: ${RUNNER}`);
if (passthrough.length) console.error(`  Args: ${passthrough.join(" ")}`);

const child = spawn("node", [RUNNER, ...passthrough], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
});

let stdoutBuffer = "";
let stderrBuffer = "";

child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdoutBuffer += text;

    // Parse JSON progress lines from runner stdout
    const lines = text.split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("{")) {
            try {
                const parsed = JSON.parse(trimmed);
                // Re-emit progress to our own stdout for dashboard WS relay
                emitProgress(parsed);
            } catch {
                // Not JSON — raw output, pass to stderr for human visibility
                process.stderr.write(line + "\n");
            }
        } else {
            // Non-JSON output — human-readable header/separator
            process.stderr.write(line + "\n");
        }
    }
});

child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderrBuffer += text;
    process.stderr.write(text);
});

child.on("close", (code) => {
    // ── 5. Parse report ──────────────────────────────────────────────

    let report = null;
    if (fs.existsSync(REPORT_PATH)) {
        try {
            report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
        } catch (e) {
            console.error(`Failed to parse report: ${e.message}`);
        }
    }

    if (report) {
        emitProgress({
            type: "demo_diagnostics_complete",
            summary: report.summary,
        });

        // Summary output
        console.error(`\n${"=".repeat(60)}`);
        console.error(`Demo Scenario Report: ${REPORT_PATH}`);
        console.error(`Debug Log: ${LOG_PATH}`);
        console.error(`Total: ${report.summary.total} | Passed: ${report.summary.passed} | Failed: ${report.summary.failed} | Skipped: ${report.summary.skipped}`);
        console.error(`Duration: ${(report.summary.durationMs / 1000).toFixed(2)}s`);
        console.error(`${"=".repeat(60)}`);
    } else {
        emitProgress({
            type: "demo_diagnostics_complete",
            summary: { total: 0, passed: 0, failed: 1, skipped: 0, durationMs: 0 },
            error: "Runner failed to produce a report",
        });
        console.error("\nRunner did not produce a report file.");
    }

    process.exit(code ?? 1);
});

child.on("error", (err) => {
    console.error(`Failed to start runner: ${err.message}`);
    emitProgress({
        type: "demo_diagnostics_complete",
        summary: { total: 0, passed: 0, failed: 1, skipped: 0, durationMs: 0 },
        error: err.message,
    });
    process.exit(1);
});
