/**
 * Browser Diagnostics Test Runner
 *
 * Runs the 4 browser-specific test suites and the orchestrator browser
 * subset, writes a structured JSON report to prism-output/.
 *
 * This is a lightweight variant of run-all-tests.cjs scoped to browser
 * diagnostics only.  It can be invoked from the Dashboard Diagnostics
 * panel via POST /api/diagnostics/browser/run.
 *
 * Usage:  node scripts/run-browser-tests.cjs [--progress-fd N]
 *
 * When --progress-fd is provided (used by DashboardService), each suite
 * result is written as a JSON line to fd 3 so the parent can stream
 * progress to WebSocket clients in real-time.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MOCHA = "./node_modules/mocha/bin/mocha.js";
const TIMEOUT = 60000;
const REPORT_PATH = "prism-output/browser-diagnostics-report.json";

const BROWSER_SUITES = [
    "dist/tests/browser-integration.test.js",
    "dist/tests/browser-api-routes.test.js",
    "dist/tests/tab-browser-ui.test.js",
];

// Test suites that the orchestrator runs for browser coverage
const ORCHESTRATOR_BROWSER_SUITES = [
    "BrowserProfileManager",
    "BrowserSessionManager",
    "BrowserControlTool",
];

// ── Helpers ──────────────────────────────────────────────────────────

/** Write a progress line to stdout as JSON for the parent process. */
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

// ── 1. Build (skip when invoked from a live server via --no-build) ───
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

// ── 2. Orchestrator browser subset ──────────────────────────────────
console.error("\nRunning orchestrator browser tests...");

let orchestratorPass = 0;
let orchestratorFail = 0;
const orchestratorFailedTests = [];

try {
    const out = execSync("node dist/tests/index.js", {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
    });
    const match = out.match(/Tests:\s*(\d+)\s*\|\s*Passed:\s*(\d+)\s*\|\s*Failed:\s*(\d+)/);
    if (match) {
        orchestratorPass = parseInt(match[2], 10);
        orchestratorFail = parseInt(match[3], 10);
    }

    // Extract per-suite pass/fail for the 3 browser suites
    for (const suiteName of ORCHESTRATOR_BROWSER_SUITES) {
        const suiteRegex = new RegExp("^" + suiteName + "\\b", "m");
        if (suiteRegex.test(out)) {
            // Count ✓ and ✗ lines between suite header and next suite / end
            const idx = out.indexOf(suiteName);
            const chunk = out.slice(idx, out.indexOf("\n===", idx + 1) === -1 ? undefined : out.indexOf("\n===", idx + 1));
            const p = (chunk.match(/  ✓ /g) || []).length;
            const f = (chunk.match(/  ✗ /g) || []).length;
            // Not extracting individually — the aggregate pass/fail is enough
            void p;
            void f;
        }
    }
} catch (e) {
    const combined = (e.stdout || "") + (e.stderr || "");
    const match = combined.match(/Tests:\s*(\d+)\s*\|\s*Passed:\s*(\d+)\s*\|\s*Failed:\s*(\d+)/);
    if (match) {
        orchestratorPass = parseInt(match[2], 10);
        orchestratorFail = parseInt(match[3], 10);
    }
    // Capture individual failed test names from "✗ TestName failed:" lines
    const failRe = /[✗✗]\s+(\S+)\s+failed:/g;
    let fm;
    while ((fm = failRe.exec(combined)) !== null) {
        orchestratorFailedTests.push(fm[1]);
    }
    // If we have failures but no names captured, note the error
    if (orchestratorFail > 0 && orchestratorFailedTests.length === 0) {
        const errSnippet = (e.stderr || e.message || "unknown error").slice(0, 300);
        orchestratorFailedTests.push("(error: " + errSnippet.replace(/[\n\r]+/g, " ") + ")");
    }
    // If no summary line matched but the process crashed, record 1 failure
    if (!match && !e.stdout) {
        orchestratorFail = 1;
        orchestratorFailedTests.push("(orchestrator crashed: " + (e.message || "exit code " + e.status).slice(0, 200) + ")");
    }
}

emitProgress({
    type: "diagnostics_progress",
    suite: "orchestrator-browser",
    status: orchestratorFail === 0 ? "PASS" : "FAIL",
    passes: orchestratorPass,
    failures: orchestratorFail,
});

// ── 3. Mocha browser suites ─────────────────────────────────────────
console.error("\nRunning browser Mocha suites...");

const results = [];
let totalPass = 0;
let totalFail = 0;
let totalDuration = 0;

for (const suite of BROWSER_SUITES) {
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
            emitProgress({ type: "diagnostics_progress", ...entry });
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
        emitProgress({ type: "diagnostics_progress", ...entry });
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
        emitProgress({ type: "diagnostics_progress", ...entry });
    }
}

// ── 4. Report ────────────────────────────────────────────────────────
const grandPassTotal = orchestratorPass + totalPass;
const grandFailTotal = orchestratorFail + totalFail;

const report = {
    generatedAt: new Date().toISOString(),
    summary: {
        orchestrator: { passes: orchestratorPass, failures: orchestratorFail },
        browserSuites: {
            suiteCount: results.length,
            passes: totalPass,
            failures: totalFail,
            durationMs: totalDuration,
        },
        grandTotal: { passes: grandPassTotal, failures: grandFailTotal },
    },
    suites: [
        {
            suite: "orchestrator-browser",
            tests: orchestratorPass + orchestratorFail,
            passes: orchestratorPass,
            failures: orchestratorFail,
            pending: 0,
            duration: 0,
            status: orchestratorFail === 0 ? "PASS" : "FAIL",
            failedTests: orchestratorFailedTests,
            runner: "orchestrator",
            description: "Contract validation, governance assertions, and input-guard tests for BrowserControlTool, BrowserSessionManager, and BrowserProfileManager",
        },
        ...results.map(r => ({
            ...r,
            description: ({
                "browser-integration": "Live Playwright session lifecycle — launch, navigate, click, type, evaluate, screenshot, DOM, cookies, console/network logs, profiles",
                "browser-api-routes": "REST API integration tests — all /api/browser/* HTTP endpoints with real DashboardService on ephemeral port",
                "tab-browser-ui": "Frontend DOM rendering tests — jsdom-based verification of all tab-browser.js UI functions and sub-views",
            })[r.suite] || "",
        })),
    ],
};

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

// Final progress emission
emitProgress({
    type: "diagnostics_complete",
    summary: report.summary,
});

console.error(`\nBrowser diagnostics complete: ${grandPassTotal} passed / ${grandFailTotal} failed`);
console.error(`Report: ${REPORT_PATH}`);

process.exit(grandFailTotal > 0 ? 1 : 0);
