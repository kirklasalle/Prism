/**
 * Logs & Debug Diagnostics Test Runner
 *
 * Runs the logs-specific test suites (UI rendering + API routes),
 * writes a structured JSON report to prism-output/.
 *
 * Invoked from the Dashboard Diagnostics panel via
 * POST /api/diagnostics/logs/run.
 *
 * Usage:  node scripts/run-logs-tests.cjs [--no-build]
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MOCHA = "./node_modules/mocha/bin/mocha.js";
const TIMEOUT = 60000;
const REPORT_PATH = "prism-output/logs-diagnostics-report.json";

const LOGS_SUITES = [
    "dist/tests/tab-logs-ui.test.js",
    "dist/tests/logs-api-routes.test.js",
];

// ── Helpers ──────────────────────────────────────────────────────────

function emitProgress(payload) {
    try {
        process.stdout.write(JSON.stringify(payload) + "\n");
    } catch { /* ignore */ }
}

function extractJson(output) {
    const statsIdx = output.indexOf('"stats"');
    if (statsIdx < 0) return null;
    let braceIdx = statsIdx;
    while (braceIdx > 0 && output[braceIdx] !== "{") braceIdx--;
    if (output[braceIdx] === "{") return output.slice(braceIdx);
    return null;
}

function parseNodeTestOutput(output) {
    const lines = output.split("\n");
    let passes = 0;
    let failures = 0;
    const failedTests = [];
    let looksLikeNodeTest = false;

    for (const line of lines) {
        if (/^\s*[✓✔✗✘]\s*(Passed|Failed|Total|All tests)[\s:]/i.test(line)) continue;
        if (/^\s*[✓✔]/.test(line)) {
            passes++;
            looksLikeNodeTest = true;
        } else if (/^\s*[✗✘]/.test(line)) {
            failures++;
            looksLikeNodeTest = true;
            const title = line.replace(/^\s*[✗✘]\s*/, "").replace(/\s*\([\d.]+ms\)\s*$/, "").trim();
            if (title) failedTests.push(title);
        } else if (/^▶/.test(line)) {
            looksLikeNodeTest = true;
        }
    }

    const testsMatch = output.match(/^#\s*tests\s+(\d+)/m);
    const passMatch = output.match(/^#\s*pass\s+(\d+)/m);
    const failMatch = output.match(/^#\s*fail\s+(\d+)/m);
    if (testsMatch && passMatch) {
        passes = parseInt(passMatch[1], 10);
        failures = failMatch ? parseInt(failMatch[1], 10) : 0;
        looksLikeNodeTest = true;
    }

    if (!looksLikeNodeTest) return null;
    return { passes, failures, failedTests };
}

// ── 1. Build ─────────────────────────────────────────────────────────
const skipBuild = process.argv.includes("--no-build");
if (!skipBuild) {
    console.error("Building...");
    try {
        execSync("npm run build", { stdio: "inherit" });
    } catch {
        console.error("Build failed — aborting.");
        process.exit(1);
    }
} else {
    console.error("Skipping build (--no-build)...");
}

// ── 2. Mocha logs suites ────────────────────────────────────────────
console.error("\nRunning Logs & Debug Mocha suites...");

const results = [];
let totalPass = 0;
let totalFail = 0;
let totalDuration = 0;

for (const suite of LOGS_SUITES) {
    const name = path.basename(suite, ".test.js");
    const cmd = `node ${MOCHA} "${suite}" --timeout ${TIMEOUT} --reporter json`;

    let stdout = "";
    let exitCode = 0;
    try {
        stdout = execSync(cmd, {
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024,
        });
    } catch (e) {
        stdout = e.stdout || "";
        exitCode = e.status || 1;
    }

    const jsonStr = extractJson(stdout);
    if (jsonStr) {
        try {
            const report = JSON.parse(jsonStr);
            const s = report.stats;
            const failedTitles = (report.failures || []).map((f) => f.fullTitle);
            const entry = {
                suite: name,
                tests: s.tests,
                passes: s.passes,
                failures: s.failures,
                pending: s.pending || 0,
                duration: s.duration,
                status: s.failures === 0 ? "PASS" : "FAIL",
                failedTests: failedTitles,
                runner: "mocha",
            };
            results.push(entry);
            totalPass += s.passes;
            totalFail += s.failures;
            totalDuration += s.duration;
            emitProgress({ type: "logs_diagnostics_progress", ...entry });
            continue;
        } catch { /* fall through */ }
    }

    // Fallback: node:test format
    const ntResult = parseNodeTestOutput(stdout);
    if (ntResult) {
        const total = ntResult.passes + ntResult.failures;
        const entry = {
            suite: name,
            tests: total,
            passes: ntResult.passes,
            failures: ntResult.failures,
            pending: 0,
            duration: 0,
            status: ntResult.failures === 0 ? "PASS" : "FAIL",
            failedTests: ntResult.failedTests,
            runner: "node:test",
        };
        results.push(entry);
        totalPass += ntResult.passes;
        totalFail += ntResult.failures;
        emitProgress({ type: "logs_diagnostics_progress", ...entry });
    } else {
        const entry = {
            suite: name,
            tests: 0,
            passes: 0,
            failures: 1,
            pending: 0,
            duration: 0,
            status: "ERROR",
            error: stdout.slice(0, 300),
        };
        results.push(entry);
        totalFail++;
        emitProgress({ type: "logs_diagnostics_progress", ...entry });
    }
}

// ── 3. Report ────────────────────────────────────────────────────────
const report = {
    generatedAt: new Date().toISOString(),
    summary: {
        logsSuites: {
            suiteCount: results.length,
            passes: totalPass,
            failures: totalFail,
            durationMs: totalDuration,
        },
        grandTotal: { passes: totalPass, failures: totalFail },
    },
    suites: results.map(r => ({
        ...r,
        description: ({
            "tab-logs-ui": "Frontend DOM rendering tests — jsdom-based verification of all tab-logs.js UI functions (events, traces, actions, approvals, action history, tool call log)",
            "logs-api-routes": "REST API integration tests — all /api/events, /api/traces, /api/actions, /api/action-history, /api/approve, /api/deny, /api/logs HTTP endpoints",
        })[r.suite] || "",
    })),
};

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

// Final progress emission
emitProgress({
    type: "logs_diagnostics_complete",
    summary: report.summary,
});

console.error(`\nLogs diagnostics complete: ${totalPass} passed / ${totalFail} failed`);
console.error(`Report: ${REPORT_PATH}`);
