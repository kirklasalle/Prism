/**
 * Workspace Diagnostics Test Runner
 *
 * Runs workspace-specific test suites (workspace persistence, character
 * accountability, workspace API routes) and writes a structured JSON report.
 *
 * Invoked from the Dashboard Diagnostics panel via
 * POST /api/diagnostics/workspace/run.
 *
 * Usage:  node scripts/run-workspace-tests.cjs [--no-build]
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MOCHA = "./node_modules/mocha/bin/mocha.js";
const TIMEOUT = 60000;
const REPORT_PATH = "prism-output/workspace-diagnostics-report.json";

const WORKSPACE_MOCHA_SUITES = [
    "dist/tests/workspace-api-routes.test.js",
    "dist/tests/tab-workspace-ui.test.js",
    "dist/tests/workspace-state-machine.test.js",
    "dist/tests/workspace-property.test.js",
    "dist/tests/workspace-integrity.test.js",
];

const WORKSPACE_ORCHESTRATOR_SUITES = [
    "WorkspacePersistence",
    "CharacterAccountability",
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

// ── 2. Orchestrator workspace subset ─────────────────────────────────
console.error("\nRunning orchestrator workspace tests...");

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
} catch (e) {
    const combined = (e.stdout || "") + (e.stderr || "");
    const match = combined.match(/Tests:\s*(\d+)\s*\|\s*Passed:\s*(\d+)\s*\|\s*Failed:\s*(\d+)/);
    if (match) {
        orchestratorPass = parseInt(match[2], 10);
        orchestratorFail = parseInt(match[3], 10);
    }
    const failRe = /[✗✗]\s+(\S+)\s+failed:/g;
    let fm;
    while ((fm = failRe.exec(combined)) !== null) {
        orchestratorFailedTests.push(fm[1]);
    }
    if (orchestratorFail > 0 && orchestratorFailedTests.length === 0) {
        const errSnippet = (e.stderr || e.message || "unknown error").slice(0, 300);
        orchestratorFailedTests.push("(error: " + errSnippet.replace(/[\n\r]+/g, " ") + ")");
    }
    if (!match && !e.stdout) {
        orchestratorFail = 1;
        orchestratorFailedTests.push("(orchestrator crashed: " + (e.message || "exit code " + e.status).slice(0, 200) + ")");
    }
}

emitProgress({
    type: "workspace_diagnostics_progress",
    suite: "orchestrator-workspace",
    status: orchestratorFail === 0 ? "PASS" : "FAIL",
    passes: orchestratorPass,
    failures: orchestratorFail,
});

// ── 3. Mocha workspace suites ────────────────────────────────────────
console.error("\nRunning workspace Mocha suites...");

const results = [];
let totalPass = 0;
let totalFail = 0;
let totalDuration = 0;

for (const suite of WORKSPACE_MOCHA_SUITES) {
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
            emitProgress({ type: "workspace_diagnostics_progress", ...entry });
            continue;
        } catch { /* fall through */ }
    }

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
        emitProgress({ type: "workspace_diagnostics_progress", ...entry });
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
        emitProgress({ type: "workspace_diagnostics_progress", ...entry });
    }
}

// ── 4. Report ────────────────────────────────────────────────────────
const grandPassTotal = orchestratorPass + totalPass;
const grandFailTotal = orchestratorFail + totalFail;

const report = {
    generatedAt: new Date().toISOString(),
    summary: {
        orchestrator: { passes: orchestratorPass, failures: orchestratorFail },
        workspaceSuites: {
            suiteCount: results.length,
            passes: totalPass,
            failures: totalFail,
            durationMs: totalDuration,
        },
        grandTotal: { passes: grandPassTotal, failures: grandFailTotal },
    },
    suites: [
        {
            suite: "orchestrator-workspace",
            tests: orchestratorPass + orchestratorFail,
            passes: orchestratorPass,
            failures: orchestratorFail,
            pending: 0,
            duration: 0,
            status: orchestratorFail === 0 ? "PASS" : "FAIL",
            failedTests: orchestratorFailedTests,
            runner: "orchestrator",
            description: "Workspace persistence, character accountability, workspace-hub config, and character seeding tests from the orchestrator suite",
        },
        ...results.map(r => ({
            ...r,
            description: ({
                "workspace-api-routes": "REST API integration tests — all /api/workspace/* HTTP endpoints with real DashboardService on ephemeral port",
                "tab-workspace-ui": "jsdom-based frontend unit tests — Workspace Tab UI rendering, filtering, import history, character panels",
                "workspace-state-machine": "Formal state machine verification — character assignment lifecycle transitions, terminal states, audit completeness",
                "workspace-property": "Property-based (fast-check) fuzz tests — formatFileSize invariants, path traversal, email regex, collision uniqueness",
                "workspace-integrity": "Workspace Integrity Fingerprint (WIF) — hash tree determinism, diff detection, tamper identification",
            })[r.suite] || "",
        })),
    ],
};

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

emitProgress({
    type: "workspace_diagnostics_complete",
    summary: report.summary,
});

console.error(`\nWorkspace diagnostics complete: ${grandPassTotal} passed / ${grandFailTotal} failed`);
console.error(`Report: ${REPORT_PATH}`);

process.exit(grandFailTotal > 0 ? 1 : 0);
