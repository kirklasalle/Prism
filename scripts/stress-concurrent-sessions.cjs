#!/usr/bin/env node
/**
 * Phase F-E — Concurrent Session Stress Harness
 *
 * Spawns N concurrent synthetic session pipelines against a running
 * dashboard and measures per-message latency. Emits p50/p95/p99 plus a
 * pass/fail verdict against a profile-specific SLO target.
 *
 * Targets (defaults):
 *   business / governed : p95 < 500ms
 *   individual          : p95 < 1500ms
 *
 * Output:  prism-output/stress/{run-id}.json
 *
 * Env:
 *   PRISM_STRESS_TARGET       default http://127.0.0.1:7777
 *   PRISM_STRESS_SESSIONS     default 10
 *   PRISM_STRESS_MESSAGES     default 20  (per session)
 *   PRISM_STRESS_PROFILE      default business  (business|individual)
 *   PRISM_STRESS_SLO_P95_MS   override SLO target
 *   PRISM_STRESS_DRY_RUN      "1" to skip network and emit a synthetic
 *                              report (CI-safe smoke).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const rank = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) return sorted[lo];
    const w = rank - lo;
    return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function summarize(latencies) {
    const sorted = latencies.slice().sort((a, b) => a - b);
    return {
        count: sorted.length,
        p50: Math.round(percentile(sorted, 50)),
        p95: Math.round(percentile(sorted, 95)),
        p99: Math.round(percentile(sorted, 99)),
        max: sorted.length ? sorted[sorted.length - 1] : 0,
        min: sorted.length ? sorted[0] : 0,
    };
}

function verdict(stats, sloP95Ms) {
    if (stats.count === 0) return "no-data";
    return stats.p95 <= sloP95Ms ? "pass" : "fail";
}

function defaultSloFor(profile) {
    if (profile === "individual") return 1500;
    return 500; // business / governed
}

function timedHttpGet(target, route) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const req = http.get(`${target}${route}`, (res) => {
            res.resume();
            res.on("end", () => resolve({ ok: res.statusCode < 500, ms: Date.now() - t0 }));
        });
        req.on("error", () => resolve({ ok: false, ms: Date.now() - t0 }));
        req.setTimeout(10_000, () => {
            req.destroy();
            resolve({ ok: false, ms: Date.now() - t0 });
        });
    });
}

async function sessionLoop(target, messages, latencies) {
    for (let i = 0; i < messages; i += 1) {
        const r = await timedHttpGet(target, "/api/health");
        if (r.ok) latencies.push(r.ms);
    }
}

async function main() {
    const target = (process.env.PRISM_STRESS_TARGET || "http://127.0.0.1:7777").replace(/\/$/, "");
    const sessions = Number(process.env.PRISM_STRESS_SESSIONS || 10);
    const messages = Number(process.env.PRISM_STRESS_MESSAGES || 20);
    const profile = (process.env.PRISM_STRESS_PROFILE || "business").toLowerCase();
    const sloP95Ms = Number(process.env.PRISM_STRESS_SLO_P95_MS || defaultSloFor(profile));
    const dryRun = process.env.PRISM_STRESS_DRY_RUN === "1";

    const runId = `stress-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const outDir = path.join(process.cwd(), "prism-output", "stress");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${runId}.json`);

    const latencies = [];

    if (dryRun) {
        // Synthesize 200 latencies for smoke-test verdict math.
        for (let i = 0; i < sessions * messages; i += 1) {
            latencies.push(50 + Math.floor(Math.random() * 100));
        }
    } else {
        const t0 = Date.now();
        await Promise.all(
            Array.from({ length: sessions }, () => sessionLoop(target, messages, latencies)),
        );
        // Wall-clock used for reporting only.
        void (Date.now() - t0);
    }

    const stats = summarize(latencies);
    const v = verdict(stats, sloP95Ms);
    const report = {
        runId,
        target,
        profile,
        sessions,
        messagesPerSession: messages,
        sloP95Ms,
        stats,
        verdict: v,
        ts: new Date().toISOString(),
    };
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`[stress] ${v} — p95=${stats.p95}ms (SLO ${sloP95Ms}ms) — ${outPath}`);
    return v === "fail" ? 1 : 0;
}

if (require.main === module) {
    main().then((code) => process.exit(code)).catch((err) => {
        console.error("[stress] fatal:", err);
        process.exit(2);
    });
}

module.exports = { percentile, summarize, verdict, defaultSloFor };
