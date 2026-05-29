#!/usr/bin/env node
/**
 * PRISM Public Self-Test and Unified Diagnostics Runner
 * 
 * Executes core integrity checks, fast PTAC smoke tests, and strict release validation.
 * Generates high-fidelity HTML and JSON reports under `prism-output/`.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "prism-output");

function runCommand(name, command) {
    console.log(`\n\x1b[35m[self-test]\x1b[0m Running Phase: \x1b[36m${name}\x1b[0m...`);
    console.log(`\x1b[90m$ ${command}\x1b[0m`);
    const start = performance.now();
    let passed = false;
    let stdout = "";
    let stderr = "";
    let code = 0;

    try {
        stdout = execSync(command, {
            cwd: REPO_ROOT,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, PRISM_ENV_PROFILE: "dev" }
        }).toString();
        passed = true;
    } catch (err) {
        code = err.status ?? 1;
        stdout = err.stdout?.toString() ?? "";
        stderr = err.stderr?.toString() ?? err.message;
    }

    const duration = performance.now() - start;
    console.log(`\x1b[35m[self-test]\x1b[0m Phase \x1b[36m${name}\x1b[0m finished in \x1b[33m${(duration / 1000).toFixed(2)}s\x1b[0m (Status: ${passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"})`);

    return {
        name,
        command,
        passed,
        code,
        durationMs: duration,
        stdout,
        stderr
    };
}

function generateHtmlReport(summary) {
    const theme = {
        bg: "#0B0F19",
        cardBg: "rgba(22, 29, 49, 0.7)",
        border: "rgba(255, 255, 255, 0.08)",
        text: "#E2E8F0",
        textMuted: "#94A3B8",
        cyan: "#06B6D4",
        emerald: "#10B981",
        rose: "#F43F5E",
        yellow: "#EAB308",
        purple: "#8B5CF6"
    };

    const statusBadge = (passed) => passed 
        ? `<span class="badge badge-pass">✔ PASS</span>`
        : `<span class="badge badge-fail">✘ FAIL</span>`;

    const cardHtml = summary.results.map((r, idx) => `
        <div class="card">
            <div class="card-header" onclick="toggleConsole(${idx})">
                <div class="header-left">
                    <span class="step-num">0${idx + 1}</span>
                    <div class="header-info">
                        <h3>${escapeHtml(r.name)}</h3>
                        <span class="duration">${(r.durationMs / 1000).toFixed(2)}s</span>
                    </div>
                </div>
                <div class="header-right">
                    ${statusBadge(r.passed)}
                    <span class="chevron" id="chevron-${idx}">▼</span>
                </div>
            </div>
            <div class="console-wrapper" id="console-${idx}">
                <div class="command-box">$ ${escapeHtml(r.command)}</div>
                <pre class="console-output">${escapeHtml(r.stdout || "No standard output.")}${r.stderr ? `\n\n[ERRORS]\n` + escapeHtml(r.stderr) : ""}</pre>
            </div>
        </div>
    `).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PRISM Public Self-Test Report</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: ${theme.bg};
            color: ${theme.text};
            min-height: 100vh;
            padding: 3rem 1.5rem;
            line-height: 1.5;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        header {
            text-align: center;
            margin-bottom: 3.5rem;
            position: relative;
        }
        header h1 {
            font-size: 2.75rem;
            font-weight: 700;
            background: linear-gradient(135deg, ${theme.cyan}, ${theme.purple});
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.75rem;
            letter-spacing: -0.025em;
        }
        header p {
            color: ${theme.textMuted};
            font-size: 1.125rem;
            font-weight: 400;
        }
        .overview-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 1.5rem;
            margin-bottom: 3rem;
        }
        .stat-card {
            background: ${theme.cardBg};
            border: 1px solid ${theme.border};
            border-radius: 16px;
            padding: 1.5rem;
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
            text-align: center;
        }
        .stat-card h4 {
            font-size: 0.875rem;
            font-weight: 500;
            color: ${theme.textMuted};
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.5rem;
        }
        .stat-card .value {
            font-size: 2rem;
            font-weight: 700;
        }
        .value.pass { color: ${theme.emerald}; }
        .value.fail { color: ${theme.rose}; }
        
        .card-list {
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
        }
        .card {
            background: ${theme.cardBg};
            border: 1px solid ${theme.border};
            border-radius: 16px;
            overflow: hidden;
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.15);
            transition: transform 0.2s ease, border-color 0.2s ease;
        }
        .card:hover {
            transform: translateY(-2px);
            border-color: rgba(255, 255, 255, 0.15);
        }
        .card-header {
            padding: 1.5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }
        .header-left {
            display: flex;
            align-items: center;
            gap: 1.25rem;
        }
        .step-num {
            font-family: 'JetBrains Mono', monospace;
            font-size: 1.125rem;
            font-weight: 600;
            color: ${theme.cyan};
            background: rgba(6, 182, 212, 0.1);
            padding: 0.25rem 0.75rem;
            border-radius: 8px;
        }
        .header-info h3 {
            font-size: 1.25rem;
            font-weight: 600;
            color: ${theme.text};
            margin-bottom: 0.15rem;
        }
        .duration {
            font-size: 0.875rem;
            color: ${theme.textMuted};
            font-family: 'JetBrains Mono', monospace;
        }
        .header-right {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        .badge {
            font-size: 0.875rem;
            font-weight: 600;
            padding: 0.35rem 0.75rem;
            border-radius: 9999px;
            letter-spacing: 0.025em;
        }
        .badge-pass {
            background: rgba(16, 185, 129, 0.12);
            color: ${theme.emerald};
            border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .badge-fail {
            background: rgba(244, 63, 94, 0.12);
            color: ${theme.rose};
            border: 1px solid rgba(244, 63, 94, 0.2);
        }
        .chevron {
            font-size: 0.875rem;
            color: ${theme.textMuted};
            transition: transform 0.3s ease;
        }
        .chevron.active {
            transform: rotate(180deg);
        }
        .console-wrapper {
            display: none;
            border-top: 1px solid ${theme.border};
            background: rgba(10, 10, 15, 0.6);
        }
        .console-wrapper.active {
            display: block;
        }
        .command-box {
            padding: 1rem 1.5rem;
            font-family: 'JetBrains Mono', monospace;
            background: rgba(255, 255, 255, 0.02);
            border-bottom: 1px solid ${theme.border};
            color: ${theme.yellow};
            font-size: 0.875rem;
        }
        .console-output {
            padding: 1.5rem;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.875rem;
            color: #94A3B8;
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 450px;
            overflow-y: auto;
        }
        footer {
            margin-top: 5rem;
            text-align: center;
            color: ${theme.textMuted};
            font-size: 0.875rem;
            border-top: 1px solid ${theme.border};
            padding-top: 2rem;
        }
    </style>
    <script>
        function toggleConsole(idx) {
            const panel = document.getElementById('console-' + idx);
            const chev = document.getElementById('chevron-' + idx);
            if (panel.classList.contains('active')) {
                panel.classList.remove('active');
                chev.classList.remove('active');
            } else {
                panel.classList.add('active');
                chev.classList.add('active');
            }
        }
    </script>
</head>
<body>
    <div class="container">
        <header>
            <h1>PRISM DIAGNOSTIC EXECUTIVE</h1>
            <p>High-Fidelity Automated Quiet Release Self-Test</p>
        </header>

        <div class="overview-grid">
            <div class="stat-card">
                <h4>VERDICT</h4>
                <div class="value ${summary.overallPassed ? "pass" : "fail"}">
                    ${summary.overallPassed ? "PASS" : "FAIL"}
                </div>
            </div>
            <div class="stat-card">
                <h4>TOTAL TIME</h4>
                <div class="value" style="color: ${theme.cyan};">
                    ${(summary.totalDurationMs / 1000).toFixed(2)}s
                </div>
            </div>
            <div class="stat-card">
                <h4>TIMESTAMP</h4>
                <div class="value" style="font-size: 1.125rem; line-height: 2.25rem; font-family: 'JetBrains Mono', monospace; color: ${theme.textMuted};">
                    ${summary.timestamp.slice(0, 19).replace('T', ' ')}
                </div>
            </div>
        </div>

        <div class="card-list">
            ${cardHtml}
        </div>

        <footer>
            <p>PRISM Refraction System • World-Class Quiet Release Program 2026</p>
        </footer>
    </div>
</body>
</html>`;
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function main() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    console.log("==================================================");
    console.log("  PRISM AUTOMATED SELF-TEST EXECUTIVE STARTING    ");
    console.log("==================================================");

    const startTotal = performance.now();
    const results = [];

    // Phase 1: Doctor Checks
    results.push(runCommand("1. Workspace Doctor Check", "npm run doctor"));

    // Phase 2: PTAC Fast Scenarios Check
    results.push(runCommand("2. PTAC Fast Scenarios Smoke", "npm run ptac:fast"));

    // Phase 3: Release strict validation checks
    results.push(runCommand("3. Strict Release Validation Check", "npm run release:validate:strict"));

    const totalDuration = performance.now() - startTotal;
    const overallPassed = results.every(r => r.passed);

    const summary = {
        timestamp: new Date().toISOString(),
        overallPassed,
        totalDurationMs: totalDuration,
        results: results.map(r => ({
            name: r.name,
            command: r.command,
            passed: r.passed,
            code: r.code,
            durationMs: r.durationMs,
            stdout: r.stdout,
            stderr: r.stderr
        }))
    };

    const jsonPath = path.join(OUTPUT_DIR, "self-test-summary.json");
    const htmlPath = path.join(OUTPUT_DIR, "self-test-report.html");

    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf8");
    fs.writeFileSync(htmlPath, generateHtmlReport(summary), "utf8");

    console.log("\n==================================================");
    console.log(`  SELF-TEST COMPLETE: ${overallPassed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}`);
    console.log(`  Total time: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`  JSON Summary: ${jsonPath}`);
    console.log(`  HTML Report:  ${htmlPath}`);
    console.log("==================================================");

    process.exit(overallPassed ? 0 : 1);
}

main();
