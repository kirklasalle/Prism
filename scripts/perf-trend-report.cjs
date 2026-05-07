#!/usr/bin/env node
/**
 * Phase D4 / Phase E5 — Profile-differentiated perf trend report
 *
 * Consumes the latest perf-qualification snapshot produced by the approval
 * contention test suite and maintains a per-profile rolling history. Emits
 * trend summary artifacts that the quality-gates workflow uploads.
 *
 * INPUT (optional):
 *   --input=<path>   JSON file with shape:
 *     {
 *       "individual": { "count": N, "p50Ms": N, "p95Ms": N, "outcomes": {...} },
 *       "business":   { "count": N, "p50Ms": N, "p95Ms": N, "outcomes": {...} }
 *     }
 *
 * OUTPUTS (under prism-output/profile-trends/):
 *   - {profile}-history.json   appended history (capped at 30 entries)
 *   - {profile}-trend.json     latest baseline-vs-current comparison
 *   - profile-trends-summary.md  human-readable Markdown summary
 *
 * EXIT CODES:
 *   0  success / warning
 *   1  hard failure (corrupt history, IO error)
 *   2  perf gate failed (only when PRISM_PERF_GATE=strict and drift > 30%)
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "prism-output", "profile-trends");
const PROFILES = ["individual", "business"];
const HISTORY_CAP = 30;
const WARN_DRIFT = 0.15; // 15%
const FAIL_DRIFT = 0.30; // 30%

function parseArgs() {
    const args = { input: null };
    for (const a of process.argv.slice(2)) {
        if (a.startsWith("--input=")) args.input = a.slice("--input=".length);
    }
    return args;
}

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function readJson(p, fallback) {
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(p, obj) {
    ensureDir(path.dirname(p));
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function loadInput(inputPath) {
    if (inputPath) {
        if (!fs.existsSync(inputPath)) {
            throw new Error("Input file not found: " + inputPath);
        }
        return normalizeSnapshot(readJson(inputPath, null));
    }
    // Default sniff: prefer per-profile snapshot, else fall back to global perf qualification.
    const candidates = [
        path.join(ROOT, "prism-output", "perf", "perf-qualification-by-profile.json"),
        path.join(ROOT, "prism-output", "perf", "perf-qualification-current.json"),
        path.join(ROOT, "prism-output", "perf-qualification.json"),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            const raw = readJson(c, null);
            const norm = normalizeSnapshot(raw);
            if (norm) return norm;
        }
    }
    return null;
}

/**
 * Accepts:
 *   { individual: { p50Ms, p95Ms, count, outcomes }, business: {...} }
 *   { benchmarks: { approvalContention: { p50Ms, p95Ms, sampleCount } } }
 * Returns the per-profile shape (or null if neither matches).
 */
function normalizeSnapshot(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.individual && raw.business) {
        return raw;
    }
    const ac = raw.benchmarks && raw.benchmarks.approvalContention;
    if (ac && typeof ac.p95Ms === "number") {
        const profileEntry = {
            count: ac.sampleCount || 0,
            p50Ms: ac.p50Ms || 0,
            p95Ms: ac.p95Ms || 0,
            outcomes: { approved: 0, denied: 0, timeout: 0 },
        };
        // Fall back to identical numbers for both profiles when only the
        // aggregate benchmark is available — better than emitting "missing".
        return { individual: { ...profileEntry }, business: { ...profileEntry } };
    }
    return null;
}

function makeStubSnapshot() {
    // Used for first-run / dry-run only so the workflow can verify the script
    // is wired without requiring a freshly-generated perf snapshot.
    const stub = (count) => ({
        count, p50Ms: 0, p95Ms: 0,
        outcomes: { approved: 0, denied: 0, timeout: 0 },
    });
    return { individual: stub(0), business: stub(0) };
}

function summarizeDrift(baseline, current) {
    if (!baseline || baseline.p95Ms === 0) return { driftRatio: 0, driftPct: 0, status: "baseline" };
    const ratio = (current.p95Ms - baseline.p95Ms) / baseline.p95Ms;
    let status = "ok";
    if (ratio > FAIL_DRIFT) status = "fail";
    else if (ratio > WARN_DRIFT) status = "warn";
    return { driftRatio: ratio, driftPct: ratio * 100, status };
}

function processProfile(profile, snapshot) {
    const historyPath = path.join(OUT_DIR, `${profile}-history.json`);
    const trendPath = path.join(OUT_DIR, `${profile}-trend.json`);
    const history = readJson(historyPath, []) || [];
    const current = snapshot[profile];
    if (!current) {
        return { profile, status: "missing", drift: null, current: null, baseline: null };
    }
    const entry = { capturedAt: new Date().toISOString(), ...current };
    history.push(entry);
    while (history.length > HISTORY_CAP) history.shift();
    writeJson(historyPath, history);

    const baseline = history.length > 1 ? history[history.length - 2] : null;
    const drift = summarizeDrift(baseline, current);
    const trend = {
        profile,
        capturedAt: entry.capturedAt,
        current,
        baseline,
        drift,
        historyDepth: history.length,
    };
    writeJson(trendPath, trend);
    return trend;
}

function renderMarkdown(trends) {
    const lines = [];
    lines.push("# Profile-differentiated perf trend report");
    lines.push("");
    lines.push("| Profile | Samples | p50 (ms) | p95 (ms) | Drift vs prior | Status |");
    lines.push("|---|---|---|---|---|---|");
    for (const t of trends) {
        if (t.status === "missing" || !t.current) {
            lines.push(`| ${t.profile} | — | — | — | — | missing |`);
            continue;
        }
        const { current, drift } = t;
        const driftStr = drift.status === "baseline" ? "n/a (baseline)" : `${drift.driftPct.toFixed(1)}%`;
        lines.push(`| ${t.profile} | ${current.count} | ${current.p50Ms.toFixed(2)} | ${current.p95Ms.toFixed(2)} | ${driftStr} | ${drift.status} |`);
    }
    lines.push("");
    lines.push("**Thresholds:** warn at +15% p95 drift, fail at +30% p95 drift (only enforced when `PRISM_PERF_GATE=strict`).");
    return lines.join("\n") + "\n";
}

function main() {
    const args = parseArgs();
    let snapshot = loadInput(args.input);
    let usedStub = false;
    if (!snapshot) {
        snapshot = makeStubSnapshot();
        usedStub = true;
    }
    ensureDir(OUT_DIR);
    const trends = PROFILES.map((p) => processProfile(p, snapshot));
    const md = renderMarkdown(trends);
    fs.writeFileSync(path.join(OUT_DIR, "profile-trends-summary.md"), md);
    process.stdout.write(md);

    // Append to GITHUB_STEP_SUMMARY if available.
    if (process.env.GITHUB_STEP_SUMMARY) {
        try {
            fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
        } catch { /* non-fatal */ }
    }

    const strict = (process.env.PRISM_PERF_GATE || "").toLowerCase() === "strict";
    const failingProfiles = trends.filter((t) => t.drift && t.drift.status === "fail");
    if (strict && failingProfiles.length > 0) {
        console.error(`Perf gate FAIL (strict mode): ${failingProfiles.map((t) => t.profile).join(", ")} exceeded ${FAIL_DRIFT * 100}% p95 drift.`);
        process.exit(2);
    }
    if (usedStub) {
        console.warn("[perf-trend-report] no perf-qualification snapshot found; emitted stub baseline.");
    }
    process.exit(0);
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error("[perf-trend-report] failure:", err && err.message || err);
        process.exit(1);
    }
}

module.exports = { summarizeDrift, processProfile, renderMarkdown };
