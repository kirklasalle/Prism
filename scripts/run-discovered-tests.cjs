#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const distTestsRoot = path.join(repoRoot, "dist", "tests");
const reportPath = path.join(repoRoot, "prism-output", "test-discovery-report.json");
const readmePath = path.join(repoRoot, "README.md");

const args = new Set(process.argv.slice(2));
const shouldBuild = !args.has("--no-build");
const listOnly = args.has("--list");
const includeE2E = args.has("--include-e2e");

function listTestFiles(root) {
    const out = [];
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop();
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            if (!entry.name.endsWith(".test.js")) {
                continue;
            }
            const rel = path.relative(repoRoot, full).replaceAll("\\", "/");
            if (!includeE2E && rel.startsWith("dist/tests/e2e/")) {
                continue;
            }
            out.push(rel);
        }
    }
    out.sort();
    return out;
}

function classify(files) {
    const node = [];
    const mocha = [];
    for (const rel of files) {
        const abs = path.join(repoRoot, rel);
        const src = fs.readFileSync(abs, "utf8");
        if (/from\s+["']node:test["']|require\(["']node:test["']\)/.test(src)) {
            node.push(rel);
        } else {
            mocha.push(rel);
        }
    }
    return { node, mocha };
}

function chunk(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function runNodeTests(files) {
    let passes = 0;
    let failures = 0;
    const failedFiles = [];
    for (const file of files) {
        const cmd = `node --test --test-force-exit "${file}"`;
        try {
            execSync(cmd, {
                cwd: repoRoot,
                stdio: "inherit",
                env: process.env,
                maxBuffer: 20 * 1024 * 1024,
            });
            passes += 1;
        } catch {
            failures += 1;
            failedFiles.push(file);
        }
    }
    return { passes, failures, failedFiles };
}

function runMochaTests(files) {
    if (files.length === 0) {
        return { passes: 0, failures: 0, failedFiles: [] };
    }
    let passes = 0;
    let failures = 0;
    const failedFiles = [];
    for (const file of files) {
        const cmd = `node ./node_modules/mocha/bin/mocha.js --exit --timeout 30000 "${file}"`;
        try {
            execSync(cmd, {
                cwd: repoRoot,
                stdio: "inherit",
                env: process.env,
                maxBuffer: 20 * 1024 * 1024,
            });
            passes += 1;
        } catch {
            failures += 1;
            failedFiles.push(file);
        }
    }
    return { passes, failures, failedFiles };
}

function writeReport(report) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
}

function syncReadmeTestCount(report) {
    if (!fs.existsSync(readmePath)) {
        return;
    }

    const total = Number(report?.discovered?.total ?? 0);
    if (!Number.isFinite(total) || total <= 0) {
        return;
    }

    const statusSuffix = report?.run?.passed ? "_passing" : "";
    const badgeValue = `${total}_discovered_suites${statusSuffix}`;
    const summaryValue = report?.run?.passed
        ? `**${total} auto-discovered test suites passing** covering unit, integration, E2E, security, and governance scenarios`
        : `**${total} auto-discovered test suites** covering unit, integration, E2E, security, and governance scenarios`;

    let readme = fs.readFileSync(readmePath, "utf8");
    readme = readme.replace(
        /https:\/\/img\.shields\.io\/badge\/tests-[^\"]+/,
        `https://img.shields.io/badge/tests-${badgeValue}-22c55e?style=for-the-badge&labelColor=0a0a0f`,
    );
    readme = readme.replace(
        /^- \*\*.*test suites?.*$/m,
        `- ${summaryValue}`,
    );
    fs.writeFileSync(readmePath, readme, "utf8");
}

function main() {
    if (shouldBuild) {
        execSync("npm run build", { cwd: repoRoot, stdio: "inherit", env: process.env });
    }

    if (!fs.existsSync(distTestsRoot)) {
        console.error("[run-discovered-tests] dist/tests not found. Run build first.");
        process.exit(1);
    }

    const files = listTestFiles(distTestsRoot);
    const { node, mocha } = classify(files);

    const report = {
        generatedAt: new Date().toISOString(),
        includeE2E,
        discovered: {
            total: files.length,
            node: node.length,
            mocha: mocha.length,
        },
        samples: {
            firstNode: node.slice(0, 10),
            firstMocha: mocha.slice(0, 10),
        },
        run: {
            listOnly,
            node: { passes: 0, failures: 0, failedFiles: [] },
            mocha: { passes: 0, failures: 0, failedFiles: [] },
            passed: true,
        },
    };

    console.log(`[run-discovered-tests] Discovered ${files.length} tests (${node.length} node:test, ${mocha.length} mocha).`);

    if (!listOnly) {
        report.run.node = runNodeTests(node);
        report.run.mocha = runMochaTests(mocha);
        report.run.passed = report.run.node.failures === 0 && report.run.mocha.failures === 0;
    }

    writeReport(report);
    syncReadmeTestCount(report);
    console.log(`[run-discovered-tests] Report written to ${reportPath}`);

    if (!report.run.passed) {
        process.exit(1);
    }
}

main();
