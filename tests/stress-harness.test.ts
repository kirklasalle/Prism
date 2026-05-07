/**
 * Phase F-E — Stress harness math tests.
 *
 * Validates percentile + verdict helpers without spawning a real server.
 */

import { createRequire } from "node:module";
import { resolve } from "node:path";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testStressHarness(): Promise<void> {
    const require = createRequire(import.meta.url);
    const harness = require(resolve(process.cwd(), "scripts/stress-concurrent-sessions.cjs")) as {
        percentile: (sorted: number[], p: number) => number;
        summarize: (latencies: number[]) => { count: number; p50: number; p95: number; p99: number; max: number; min: number };
        verdict: (stats: { count: number; p95: number }, sloP95Ms: number) => string;
        defaultSloFor: (profile: string) => number;
    };

    // Percentile sanity.
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert(Math.round(harness.percentile(sorted, 50)) === 55, "p50=55");
    assert(Math.round(harness.percentile(sorted, 95)) === 96, `p95 ~ 96, got ${harness.percentile(sorted, 95)}`);

    // Empty input safe.
    assert(harness.percentile([], 50) === 0, "empty p50 = 0");

    // Summarize empty.
    const emptyStats = harness.summarize([]);
    assert(emptyStats.count === 0, "empty count");
    assert(harness.verdict(emptyStats, 500) === "no-data", "no-data verdict on empty");

    // Pass / fail verdict.
    const okStats = harness.summarize([100, 200, 300, 400]);
    assert(harness.verdict(okStats, 1000) === "pass", "pass under SLO");
    assert(harness.verdict(okStats, 50) === "fail", "fail over SLO");

    // Default SLOs.
    assert(harness.defaultSloFor("business") === 500, "business SLO");
    assert(harness.defaultSloFor("individual") === 1500, "individual SLO");
}
