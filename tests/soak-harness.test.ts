/**
 * Phase F-D — Soak harness aggregation tests.
 *
 * The full soak run is a long-running operational task; this test
 * exercises the pure-function helpers (`aggregate`,
 * `rssSlopeBytesPerHour`) that drive the verdict math.
 */

import { createRequire } from "node:module";
import { resolve } from "node:path";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testSoakHarness(): Promise<void> {
    const require = createRequire(import.meta.url);
    const harness = require(resolve(process.cwd(), "scripts/soak-harness.cjs")) as {
        rssSlopeBytesPerHour: (samples: { tMs: number; rss: number }[]) => number;
        aggregate: (
            samples: { tMs: number; rss: number; errorsDelta?: number; rejectionsDelta?: number }[],
            opts: { errorBudget: number; rssSlopeMaxBytesPerHour: number },
        ) => { verdict: string; rssSlopeBytesPerHour: number; totalErrors: number; totalRejections: number };
    };

    // Empty / single-sample window.
    assert(harness.rssSlopeBytesPerHour([]) === 0, "empty slope = 0");
    assert(harness.rssSlopeBytesPerHour([{ tMs: 0, rss: 100 }]) === 0, "single sample slope = 0");

    // Linear growth: 1 MB over 1 hour.
    const slope = harness.rssSlopeBytesPerHour([
        { tMs: 0, rss: 0 },
        { tMs: 60 * 60 * 1000, rss: 1024 * 1024 },
    ]);
    assert(Math.round(slope) === 1024 * 1024, `expected 1MB/h, got ${slope}`);

    // Pass verdict: no errors, no rejections, slope under budget.
    const passing = harness.aggregate(
        [
            { tMs: 0, rss: 100, errorsDelta: 0, rejectionsDelta: 0 },
            { tMs: 1000, rss: 100, errorsDelta: 0, rejectionsDelta: 0 },
        ],
        { errorBudget: 50, rssSlopeMaxBytesPerHour: 50 * 1024 * 1024 },
    );
    assert(passing.verdict === "pass", `expected pass, got ${passing.verdict}`);

    // Fail on rejection.
    const failing = harness.aggregate(
        [
            { tMs: 0, rss: 100, errorsDelta: 0, rejectionsDelta: 0 },
            { tMs: 1000, rss: 100, errorsDelta: 0, rejectionsDelta: 1 },
        ],
        { errorBudget: 50, rssSlopeMaxBytesPerHour: 50 * 1024 * 1024 },
    );
    assert(failing.verdict === "fail", "fail on rejection");
    assert(failing.totalRejections === 1, "rejection counted");
}
