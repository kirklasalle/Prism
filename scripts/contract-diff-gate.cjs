#!/usr/bin/env node
/**
 * PRISM Contract Diff Release Gate
 *
 * Compares a baseline tool-contract snapshot to a candidate snapshot using
 * `compareToolContractSnapshots()` from `src/core/tools/contract-snapshot.ts`
 * (compiled to `dist/`). Exits non-zero when breaking changes are present
 * (`removed` or `schema_changed`), making this script suitable for use as a
 * CI release-blocking gate.
 *
 * The existing `src/benchmarks/tool-contract-snapshot.ts` already short-
 * circuits with `process.exitCode = 1` when a baseline is provided via
 * `PRISM_CONTRACT_BASELINE_PATH`; this script makes that gate explicit,
 * scriptable, and standalone (no DB / temp file work — pure JSON diff).
 *
 * Usage:
 *   node scripts/contract-diff-gate.cjs \
 *        --baseline <baseline.json> \
 *        --candidate <candidate.json> \
 *        [--report-out <diff.md>] \
 *        [--allow-breaking]
 *
 * Defaults:
 *   --baseline   artifacts/contracts/tool-contract-baseline.json
 *   --candidate  artifacts/contracts/tool-contract-snapshot.json
 *
 * Exit codes:
 *   0 — no breaking changes (or --allow-breaking)
 *   1 — breaking changes detected
 *   2 — invocation error (missing baseline, parse failure, etc.)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
    const args = {
        baseline: null,
        candidate: null,
        reportOut: null,
        allowBreaking: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--baseline") args.baseline = argv[++i];
        else if (a === "--candidate") args.candidate = argv[++i];
        else if (a === "--report-out") args.reportOut = argv[++i];
        else if (a === "--allow-breaking") args.allowBreaking = true;
        else if (a === "--help" || a === "-h") {
            console.log(
                "Usage: node scripts/contract-diff-gate.cjs " +
                "[--baseline <path>] [--candidate <path>] [--report-out <md>] [--allow-breaking]"
            );
            process.exit(0);
        }
    }
    args.baseline = args.baseline || path.join(REPO_ROOT, "artifacts", "contracts", "tool-contract-baseline.json");
    args.candidate = args.candidate || path.join(REPO_ROOT, "artifacts", "contracts", "tool-contract-snapshot.json");
    return args;
}

function readJson(p) {
    const txt = fs.readFileSync(p, "utf8");
    return JSON.parse(txt);
}

function fmtRow(c) {
    const v = c.previousVersion || "—";
    const w = c.currentVersion || "—";
    return `| \`${c.name}\` | ${c.change} | ${v} | ${w} |`;
}

function buildReport(diff, args) {
    const lines = [];
    lines.push(`# Contract Diff Gate Report`);
    lines.push(``);
    lines.push(`- Baseline: \`${args.baseline}\``);
    lines.push(`- Candidate: \`${args.candidate}\``);
    lines.push(`- Generated: ${new Date().toISOString()}`);
    lines.push(``);
    lines.push(`## Summary`);
    lines.push(``);
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|------:|`);
    lines.push(`| Previous tool count | ${diff.previousToolCount} |`);
    lines.push(`| Current tool count  | ${diff.currentToolCount} |`);
    lines.push(`| Total changes       | ${diff.changes.filter(c => c.change !== "unchanged").length} |`);
    lines.push(`| Breaking changes    | ${diff.breakingChanges.length} |`);
    lines.push(``);
    if (diff.breakingChanges.length > 0) {
        lines.push(`## Breaking Changes (BLOCKING)`);
        lines.push(``);
        lines.push(`| Tool | Change | Previous Version | Current Version |`);
        lines.push(`|------|--------|------------------|-----------------|`);
        for (const c of diff.breakingChanges) lines.push(fmtRow(c));
        lines.push(``);
    }
    const others = diff.changes.filter(c => c.change !== "unchanged" && !diff.breakingChanges.includes(c));
    if (others.length > 0) {
        lines.push(`## Non-Breaking Changes`);
        lines.push(``);
        lines.push(`| Tool | Change | Previous Version | Current Version |`);
        lines.push(`|------|--------|------------------|-----------------|`);
        for (const c of others) lines.push(fmtRow(c));
        lines.push(``);
    }
    lines.push(`## Verdict`);
    lines.push(``);
    if (diff.breakingChanges.length === 0) {
        lines.push(`- ✅ **PASS** — no breaking contract changes detected.`);
    } else if (args.allowBreaking) {
        lines.push(`- ⚠️ **OVERRIDDEN** — ${diff.breakingChanges.length} breaking change(s) present; \`--allow-breaking\` was used.`);
    } else {
        lines.push(`- ❌ **FAIL** — ${diff.breakingChanges.length} breaking change(s) block this release.`);
    }
    return lines.join("\n");
}

async function main() {
    const args = parseArgs(process.argv);

    if (!fs.existsSync(args.baseline)) {
        console.error(
            `[contract-diff-gate] baseline not found: ${args.baseline}\n` +
            `[contract-diff-gate] (Bootstrap: copy a known-good snapshot to this path to enable the gate.)`
        );
        process.exit(2);
    }
    if (!fs.existsSync(args.candidate)) {
        console.error(`[contract-diff-gate] candidate not found: ${args.candidate}`);
        process.exit(2);
    }

    let baseline, candidate;
    try {
        baseline = readJson(args.baseline);
        candidate = readJson(args.candidate);
    } catch (err) {
        console.error(`[contract-diff-gate] failed to parse JSON: ${err && err.message ? err.message : err}`);
        process.exit(2);
    }

    // Lazy-load the compiled diff module so this script stays standalone.
    const modulePath = path.join(REPO_ROOT, "dist", "src", "core", "tools", "contract-snapshot.js");
    if (!fs.existsSync(modulePath)) {
        console.error(`[contract-diff-gate] missing compiled module: ${modulePath} (run \`npm run build\` first)`);
        process.exit(2);
    }
    const mod = await import(pathToFileURL(modulePath).href);
    const compare = mod.compareToolContractSnapshots;
    if (typeof compare !== "function") {
        console.error(`[contract-diff-gate] compareToolContractSnapshots not exported from ${modulePath}`);
        process.exit(2);
    }

    const diff = compare(baseline, candidate);
    const report = buildReport(diff, args);

    if (args.reportOut) {
        fs.mkdirSync(path.dirname(args.reportOut), { recursive: true });
        fs.writeFileSync(args.reportOut, report, "utf8");
        console.log(`[contract-diff-gate] report written: ${args.reportOut}`);
    }

    console.log(`[contract-diff-gate] previousTools=${diff.previousToolCount} currentTools=${diff.currentToolCount} changes=${diff.changes.filter(c => c.change !== "unchanged").length} breaking=${diff.breakingChanges.length}`);
    for (const c of diff.breakingChanges) {
        console.log(`[contract-diff-gate]   BREAKING ${c.change} ${c.name} ${c.previousVersion || "—"} -> ${c.currentVersion || "—"}`);
    }

    if (diff.breakingChanges.length > 0 && !args.allowBreaking) {
        console.error(`[contract-diff-gate] FAIL — ${diff.breakingChanges.length} breaking change(s) block the release.`);
        process.exit(1);
    }
    if (diff.breakingChanges.length > 0 && args.allowBreaking) {
        console.warn(`[contract-diff-gate] OVERRIDDEN — breaking changes present but --allow-breaking was provided.`);
    }
    console.log(`[contract-diff-gate] PASS`);
    process.exit(0);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`[contract-diff-gate] crashed: ${err && err.stack ? err.stack : err}`);
        process.exit(2);
    });
}

module.exports = { main };
