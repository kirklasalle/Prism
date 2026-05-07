/**
 * Consolidated test runner — runs orchestrator + all Mocha suites,
 * prints a summary table, and writes a JSON report.
 *
 * Usage:  node scripts/run-all-tests.js
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MOCHA = "./node_modules/mocha/bin/mocha.js";
const TIMEOUT = 60000;
const REPORT_PATH = "prism-output/mocha-test-report.json";

const SUITES = [
  "dist/tests/terminal-session-adapter.test.js",
  "dist/tests/container-sandbox-adapter.test.js",
  "dist/tests/tool-contract-extractor.test.js",
  "dist/tests/profile-parity.test.js",
  "dist/tests/business-trust-validator.test.js",
  "dist/tests/event-lineage-telemetry.test.js",
  "dist/tests/agent-pool.test.js",
  "dist/tests/mcp-client-tool.test.js",
  "dist/tests/nexus-bridge-tool.test.js",
  "dist/tests/parallel-execution.test.js",
  "dist/tests/model-capability-matrix.test.js",
  "dist/tests/plugin-pack-validator.test.js",
  "dist/tests/task-decomposer.test.js",
  "dist/tests/browser-integration.test.js",
  "dist/tests/browser-api-routes.test.js",
  "dist/tests/tab-browser-ui.test.js",
  "dist/tests/computer-control.test.js",
];

// ── 1. Build ─────────────────────────────────────────────────────────
console.log("Building...\n");
try {
  execSync("npm run build", { stdio: "inherit" });
} catch {
  console.error("Build failed — aborting.");
  process.exit(1);
}

// ── 2. Orchestrator tests ────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║         PRISM Orchestrator Tests (index.js)         ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

let orchestratorPass = 0;
let orchestratorFail = 0;
try {
  const out = execSync("node dist/tests/index.js", {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  console.log(out);
  const match = out.match(/Tests:\s*(\d+)\s*\|\s*Passed:\s*(\d+)\s*\|\s*Failed:\s*(\d+)/);
  if (match) {
    orchestratorPass = parseInt(match[2], 10);
    orchestratorFail = parseInt(match[3], 10);
  }
} catch (e) {
  // The orchestrator logs to stderr for approval timeout — that's expected
  if (e.stdout) {
    console.log(e.stdout);
    const match = e.stdout.match(/Tests:\s*(\d+)\s*\|\s*Passed:\s*(\d+)\s*\|\s*Failed:\s*(\d+)/);
    if (match) {
      orchestratorPass = parseInt(match[2], 10);
      orchestratorFail = parseInt(match[3], 10);
    }
  }
}

// ── 3. Mocha suites ─────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║              PRISM Mocha Test Suites                ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

const results = [];
let totalPass = 0;
let totalFail = 0;
let totalPending = 0;
let totalDuration = 0;

function extractJson(output) {
  // The Mocha JSON reporter outputs formatted JSON like:
  //   {\n  "stats": { ... }\n  "tests": [...]\n}
  // But test suites may also console.log before it.
  // Strategy: find the last standalone '{' on its own line that precedes '"stats"'.
  const statsIdx = output.indexOf('"stats"');
  if (statsIdx < 0) return null;
  // Walk backwards from "stats" to find the opening brace
  let braceIdx = statsIdx;
  while (braceIdx > 0 && output[braceIdx] !== "{") braceIdx--;
  if (output[braceIdx] === "{") return output.slice(braceIdx);
  return null;
}

/**
 * Fallback parser for suites that use node:test runner internally.
 * These output lines like:  ✓ test name (1.234ms)  /  ✗ test name
 * Returns { passes, failures, failedTests } or null if it doesn't look
 * like node:test output.
 */
function parseNodeTestOutput(output) {
  const lines = output.split("\n");
  let passes = 0;
  let failures = 0;
  const failedTests = [];
  let looksLikeNodeTest = false;

  for (const line of lines) {
    // Skip summary lines that suites print themselves (e.g. "✓ Passed: 25", "✗ Failed: 0")
    if (/^\s*[✓✔✗✘]\s*(Passed|Failed|Total|All tests)[\s:]/i.test(line)) continue;

    // node:test uses unicode ✓ (U+2713) and ✗ (U+2717), or sometimes # tests / # pass / # fail
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

  // Also check for the summary line: "# tests N", "# pass N", "# fail N"
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

for (const suite of SUITES) {
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
      results.push({
        suite: name,
        tests: s.tests,
        passes: s.passes,
        failures: s.failures,
        pending: s.pending || 0,
        duration: s.duration,
        status: s.failures === 0 ? "PASS" : "FAIL",
        failedTests: failedTitles,
      });
      totalPass += s.passes;
      totalFail += s.failures;
      totalPending += s.pending || 0;
      totalDuration += s.duration;

      const icon = s.failures === 0 ? "✓" : "✗";
      const color = s.failures === 0 ? "\x1b[32m" : "\x1b[31m";
      console.log(
        `  ${color}${icon}\x1b[0m  ${name.padEnd(35)} ${String(s.passes).padStart(3)}/${String(s.tests).padStart(3)} passed   ${String(s.duration).padStart(6)}ms`
      );
      if (failedTitles.length > 0) {
        failedTitles.forEach((t) => console.log(`      \x1b[31m→ ${t}\x1b[0m`));
      }
      continue;
    } catch {
      // JSON parse failed — fall through to ERROR
    }
  }

  // Fallback: try parsing node:test output format (▶ ✓ ✗)
  const ntResult = parseNodeTestOutput(stdout);
  if (ntResult) {
    results.push({
      suite: name,
      tests: ntResult.passes + ntResult.failures,
      passes: ntResult.passes,
      failures: ntResult.failures,
      pending: 0,
      duration: 0,
      status: ntResult.failures === 0 ? "PASS" : "FAIL",
      failedTests: ntResult.failedTests,
      runner: "node:test",
    });
    totalPass += ntResult.passes;
    totalFail += ntResult.failures;

    const icon = ntResult.failures === 0 ? "✓" : "✗";
    const color = ntResult.failures === 0 ? "\x1b[32m" : "\x1b[31m";
    const total = ntResult.passes + ntResult.failures;
    console.log(
      `  ${color}${icon}\x1b[0m  ${name.padEnd(35)} ${String(ntResult.passes).padStart(3)}/${String(total).padStart(3)} passed   \x1b[90m(node:test)\x1b[0m`
    );
    if (ntResult.failedTests.length > 0) {
      ntResult.failedTests.forEach((t) => console.log(`      \x1b[31m→ ${t}\x1b[0m`));
    }
  } else {
    results.push({
      suite: name,
      tests: 0,
      passes: 0,
      failures: 1,
      pending: 0,
      duration: 0,
      status: "ERROR",
      error: stdout.slice(0, 300),
    });
    totalFail++;
    console.log(`  \x1b[31m✗\x1b[0m  ${name.padEnd(35)}   ERROR (exit ${exitCode})`);
  }
}

// ── 4. Report ────────────────────────────────────────────────────────
const grandPassTotal = orchestratorPass + totalPass;
const grandFailTotal = orchestratorFail + totalFail;

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║                   TEST SUMMARY                      ║");
console.log("╠══════════════════════════════════════════════════════╣");
console.log(`║  Orchestrator:  ${String(orchestratorPass).padStart(4)} passed / ${String(orchestratorFail).padStart(3)} failed          ║`);
console.log(`║  Test suites:   ${String(totalPass).padStart(4)} passed / ${String(totalFail).padStart(3)} failed          ║`);
console.log(`║  Pending:       ${String(totalPending).padStart(4)}                               ║`);
console.log(`║  Duration:      ${(totalDuration / 1000).toFixed(1).padStart(6)}s                           ║`);
console.log("╠══════════════════════════════════════════════════════╣");
console.log(`║  GRAND TOTAL:   ${String(grandPassTotal).padStart(4)} passed / ${String(grandFailTotal).padStart(3)} failed          ║`);
console.log("╚══════════════════════════════════════════════════════╝");

if (grandFailTotal > 0) {
  console.log("\n\x1b[31m  FAILURES:\x1b[0m");
  results
    .filter((r) => r.failures > 0)
    .forEach((r) => {
      console.log(`    ${r.suite}:`);
      (r.failedTests || []).forEach((t) => console.log(`      → ${t}`));
      if (r.error) console.log(`      error: ${r.error.slice(0, 150)}`);
    });
}

// ── 5. Write JSON report ─────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    orchestrator: { passes: orchestratorPass, failures: orchestratorFail },
    mocha: {
      suites: results.length,
      passes: totalPass,
      failures: totalFail,
      pending: totalPending,
      durationMs: totalDuration,
    },
    grandTotal: { passes: grandPassTotal, failures: grandFailTotal },
  },
  suites: results,
};

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
console.log(`\nReport saved to: ${REPORT_PATH}`);

process.exit(grandFailTotal > 0 ? 1 : 0);
