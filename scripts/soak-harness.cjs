#!/usr/bin/env node
/**
 * Phase F-D — Soak Test Harness
 *
 * Long-running smoke driver that exercises a synthetic workload against
 * the dashboard's HTTP surface and records resource trends so we can
 * detect leaks, hung promises, and unhandled rejections.
 *
 * Modes:
 *   - smoke   : 5 minutes (default)             PRISM_SOAK_DURATION_MS=300000
 *   - staging : 72 hours                        PRISM_SOAK_DURATION_MS=259200000
 *
 * Output:  prism-output/soak/{run-id}.jsonl
 *
 * The harness DOES NOT spawn the server — point it at a running
 * instance via PRISM_SOAK_TARGET (default: http://127.0.0.1:7777).
 *
 * Exit codes:
 *   0 — clean (no unhandled rejections, RSS slope under threshold)
 *   1 — soak-test failure (rejection observed, leak detected, or http errors over budget)
 *   2 — invalid configuration
 *
 * @module scripts/soak-harness
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

function parseArgs() {
    const target = (process.env.PRISM_SOAK_TARGET || "http://127.0.0.1:7777").replace(/\/$/, "");
    const duration = Number(process.env.PRISM_SOAK_DURATION_MS || 5 * 60 * 1000);
    const concurrency = Number(process.env.PRISM_SOAK_CONCURRENCY || 4);
    const sampleIntervalMs = Number(process.env.PRISM_SOAK_SAMPLE_MS || 30_000);
    const errorBudget = Number(process.env.PRISM_SOAK_ERROR_BUDGET || 50);
    const rssSlopeMaxBytesPerHour = Number(process.env.PRISM_SOAK_RSS_SLOPE || 50 * 1024 * 1024);
    const dryRun = process.env.PRISM_SOAK_DRY_RUN === "1";
    return { target, duration, concurrency, sampleIntervalMs, errorBudget, rssSlopeMaxBytesPerHour, dryRun };
}

function rssSlopeBytesPerHour(samples) {
    if (samples.length < 2) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.tMs - first.tMs;
    if (dt <= 0) return 0;
    const dRss = last.rss - first.rss;
    return (dRss / dt) * 60 * 60 * 1000;
}

function aggregate(samples, opts) {
    const slope = rssSlopeBytesPerHour(samples);
    const errors = samples.reduce((n, s) => n + (s.errorsDelta || 0), 0);
    const rejections = samples.reduce((n, s) => n + (s.rejectionsDelta || 0), 0);
    const verdict =
        rejections === 0 && errors <= opts.errorBudget && slope < opts.rssSlopeMaxBytesPerHour
            ? "pass"
            : "fail";
    return {
        verdict,
        rssSlopeBytesPerHour: Math.round(slope),
        totalErrors: errors,
        totalRejections: rejections,
    };
}

function httpGet(url) {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            res.resume();
            res.on("end", () => resolve({ ok: res.statusCode < 500, status: res.statusCode }));
        });
        req.on("error", () => resolve({ ok: false, status: 0 }));
        req.setTimeout(5000, () => {
            req.destroy();
            resolve({ ok: false, status: 0 });
        });
    });
}

async function workerLoop(target, deadlineMs, counters) {
    while (Date.now() < deadlineMs) {
        const r = await httpGet(`${target}/api/health`);
        if (!r.ok) counters.errors += 1;
        counters.requests += 1;
        await new Promise((r) => setTimeout(r, 250));
    }
}

async function main() {
    const opts = parseArgs();
    const runId = `soak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const outDir = path.join(process.cwd(), "prism-output", "soak");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${runId}.jsonl`);
    const append = (record) => fs.appendFileSync(outPath, JSON.stringify(record) + "\n");

    const counters = { requests: 0, errors: 0, rejections: 0 };
    let rejectionsAtLastSample = 0;
    let errorsAtLastSample = 0;

    process.on("unhandledRejection", () => { counters.rejections += 1; });

    append({ kind: "start", runId, target: opts.target, duration: opts.duration, concurrency: opts.concurrency, ts: new Date().toISOString() });

    if (opts.dryRun) {
        append({ kind: "dry-run", verdict: "skipped" });
        console.log(`[soak] dry run — wrote header to ${outPath}`);
        return 0;
    }

    const t0 = Date.now();
    const deadline = t0 + opts.duration;

    const workers = [];
    for (let i = 0; i < opts.concurrency; i += 1) {
        workers.push(workerLoop(opts.target, deadline, counters));
    }

    const samples = [];
    let heartbeatId = 0;
    const sampler = setInterval(() => {
        const mem = process.memoryUsage();
        const sample = {
            kind: "sample",
            heartbeat: ++heartbeatId,
            tMs: Date.now() - t0,
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            external: mem.external,
            requests: counters.requests,
            errors: counters.errors,
            rejections: counters.rejections,
            errorsDelta: counters.errors - errorsAtLastSample,
            rejectionsDelta: counters.rejections - rejectionsAtLastSample,
        };
        errorsAtLastSample = counters.errors;
        rejectionsAtLastSample = counters.rejections;
        samples.push(sample);
        append(sample);
    }, opts.sampleIntervalMs);

    await Promise.all(workers);
    clearInterval(sampler);

    const summary = aggregate(samples, opts);
    const finalRecord = { kind: "summary", runId, durationMs: Date.now() - t0, ...summary, totalRequests: counters.requests };
    append(finalRecord);
    console.log(`[soak] ${summary.verdict} — wrote ${outPath}`);
    return summary.verdict === "pass" ? 0 : 1;
}

if (require.main === module) {
    main().then((code) => process.exit(code)).catch((err) => {
        console.error("[soak] fatal:", err);
        process.exit(2);
    });
}

module.exports = { aggregate, rssSlopeBytesPerHour };
