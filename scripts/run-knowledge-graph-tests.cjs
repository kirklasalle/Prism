/**
 * UKS Knowledge Graph Diagnostics Test Runner
 *
 * Runs knowledge-graph-specific test suites (node:test and Mocha) and
 * writes a structured JSON report to prism-output/.
 *
 * Modelled after run-agent-tests.cjs.
 *
 * Usage:  node scripts/run-knowledge-graph-tests.cjs [--no-build]
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MOCHA = "./node_modules/mocha/bin/mocha.js";
const TIMEOUT = 90000;
const REPORT_PATH = "prism-output/knowledge-graph-diagnostics-report.json";

// node:test suites (individual invocation with --test-force-exit)
const NODE_TEST_SUITES = [
    { file: "dist/tests/semantic-memory-diagnostics.test.js", name: "semantic-memory-diagnostics", description: "SemanticMemoryIndex — ingestion, querying, edge cases, performance, and ActivitySubscriber compliance" },
    { file: "dist/tests/semantic-query-tool.test.js", name: "semantic-query-tool", description: "MemoryQueryTool & SemanticQueryTool — contract validation, mode switching, all memory subsystem integration" },
    { file: "dist/tests/neo4j-query-tool.test.js", name: "neo4j-query-tool", description: "Neo4jQueryTool — graceful degradation, contract validation, Cypher injection safety" },
];

// Mocha suites
const MOCHA_SUITES = [
    { file: "dist/tests/knowledge-graph-integration.test.js", name: "knowledge-graph-integration", description: "KG lifecycle — semantic memory round-trips, MCP UKS bridge artifacts, MemoryQueryTool execution, performance targets" },
    { file: "dist/tests/knowledge-graph-integrity.test.js", name: "knowledge-graph-integrity", description: "KG integrity — graph persistence, SQLite schema, episodic memory boundaries, cross-module coherence" },
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
        if (/^\s*[✓✔]/.test(line)) { passes++; looksLikeNodeTest = true; }
        else if (/^\s*[✗✘]/.test(line)) {
            failures++; looksLikeNodeTest = true;
            const title = line.replace(/^\s*[✗✘]\s*/, "").replace(/\s*\([\d.]+ms\)\s*$/, "").trim();
            if (title) failedTests.push(title);
        } else if (/^▶/.test(line)) { looksLikeNodeTest = true; }
    }

    const testsMatch = output.match(/ℹ tests\s+(\d+)/);
    const passMatch = output.match(/ℹ pass\s+(\d+)/);
    const failMatch = output.match(/ℹ fail\s+(\d+)/);
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
    try { execSync("npm run build", { stdio: "inherit" }); }
    catch { console.error("Build failed — aborting."); process.exit(1); }
} else {
    console.error("Skipping build (--no-build)...");
}

// ── 2. node:test suites ──────────────────────────────────────────────
console.error("\nRunning knowledge-graph node:test suites...");

const results = [];
let totalPass = 0;
let totalFail = 0;

for (const suite of NODE_TEST_SUITES) {
    const cmd = `node --test --test-force-exit "${suite.file}"`;
    let stdout = "";
    try {
        stdout = execSync(cmd, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: TIMEOUT });
    } catch (e) {
        stdout = (e.stdout || "") + (e.stderr || "");
    }

    const ntResult = parseNodeTestOutput(stdout);
    if (ntResult) {
        const total = ntResult.passes + ntResult.failures;
        const entry = {
            suite: suite.name, tests: total, passes: ntResult.passes,
            failures: ntResult.failures, pending: 0, duration: 0,
            status: ntResult.failures === 0 ? "PASS" : "FAIL",
            failedTests: ntResult.failedTests, runner: "node:test",
            description: suite.description,
        };
        results.push(entry);
        totalPass += ntResult.passes;
        totalFail += ntResult.failures;
        emitProgress({ type: "knowledge_graph_diagnostics_progress", ...entry });
    } else {
        const entry = {
            suite: suite.name, tests: 0, passes: 0, failures: 1,
            pending: 0, duration: 0, status: "ERROR",
            error: stdout.slice(0, 300), description: suite.description,
        };
        results.push(entry);
        totalFail++;
        emitProgress({ type: "knowledge_graph_diagnostics_progress", ...entry });
    }
}

// ── 3. Mocha suites ──────────────────────────────────────────────────
console.error("\nRunning knowledge-graph Mocha suites...");

let mochaTotalDuration = 0;

for (const suite of MOCHA_SUITES) {
    const cmd = `node ${MOCHA} "${suite.file}" --timeout ${TIMEOUT} --reporter json`;
    let stdout = "";
    try {
        stdout = execSync(cmd, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
        stdout = e.stdout || "";
    }

    const jsonStr = extractJson(stdout);
    if (jsonStr) {
        try {
            const report = JSON.parse(jsonStr);
            const s = report.stats;
            const failedTitles = (report.failures || []).map((f) => f.fullTitle);
            const entry = {
                suite: suite.name, tests: s.tests, passes: s.passes,
                failures: s.failures, pending: s.pending || 0,
                duration: s.duration, status: s.failures === 0 ? "PASS" : "FAIL",
                failedTests: failedTitles, runner: "mocha",
                description: suite.description,
            };
            results.push(entry);
            totalPass += s.passes;
            totalFail += s.failures;
            mochaTotalDuration += s.duration;
            emitProgress({ type: "knowledge_graph_diagnostics_progress", ...entry });
            continue;
        } catch { /* fall through */ }
    }

    // Fallback: try parsing as node:test
    const ntResult = parseNodeTestOutput(stdout);
    if (ntResult) {
        const total = ntResult.passes + ntResult.failures;
        const entry = {
            suite: suite.name, tests: total, passes: ntResult.passes,
            failures: ntResult.failures, pending: 0, duration: 0,
            status: ntResult.failures === 0 ? "PASS" : "FAIL",
            failedTests: ntResult.failedTests, runner: "node:test",
            description: suite.description,
        };
        results.push(entry);
        totalPass += ntResult.passes;
        totalFail += ntResult.failures;
        emitProgress({ type: "knowledge_graph_diagnostics_progress", ...entry });
    } else {
        const entry = {
            suite: suite.name, tests: 0, passes: 0, failures: 1,
            pending: 0, duration: 0, status: "ERROR",
            error: stdout.slice(0, 300), description: suite.description,
        };
        results.push(entry);
        totalFail++;
        emitProgress({ type: "knowledge_graph_diagnostics_progress", ...entry });
    }
}

// ── 4. Report ────────────────────────────────────────────────────────
const report = {
    generatedAt: new Date().toISOString(),
    summary: {
        knowledgeGraphSuites: {
            suiteCount: results.length,
            passes: totalPass,
            failures: totalFail,
            durationMs: mochaTotalDuration,
        },
        grandTotal: { passes: totalPass, failures: totalFail },
    },
    suites: results,
};

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

emitProgress({
    type: "knowledge_graph_diagnostics_complete",
    summary: report.summary,
});

console.error(`\nKnowledge Graph diagnostics complete: ${totalPass} passed / ${totalFail} failed`);
console.error(`Report: ${REPORT_PATH}`);

process.exit(totalFail > 0 ? 1 : 0);
