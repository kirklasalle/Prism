/**
 * Unit tests for scripts/perf-trend-report.cjs internals.
 * Validates summarizeDrift status thresholds and renderMarkdown shape.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

export async function testPerfTrendReport(): Promise<void> {
    const scriptPath = resolve(process.cwd(), "scripts", "perf-trend-report.cjs");
    const mod = require(scriptPath);

    // Baseline → status === "baseline"
    const baseline = mod.summarizeDrift(null, { p95Ms: 100 });
    assert.equal(baseline.status, "baseline");

    // No drift
    const ok = mod.summarizeDrift({ p95Ms: 100 }, { p95Ms: 100 });
    assert.equal(ok.status, "ok");

    // Warn band (+20%)
    const warn = mod.summarizeDrift({ p95Ms: 100 }, { p95Ms: 120 });
    assert.equal(warn.status, "warn");

    // Fail band (+50%)
    const fail = mod.summarizeDrift({ p95Ms: 100 }, { p95Ms: 150 });
    assert.equal(fail.status, "fail");

    // Markdown rendering smoke-test
    const md = mod.renderMarkdown([
        { profile: "individual", current: { count: 10, p50Ms: 1.2, p95Ms: 4.5 }, drift: { driftRatio: 0, driftPct: 0, status: "baseline" } },
        { profile: "business", current: { count: 10, p50Ms: 1.5, p95Ms: 5.0 }, drift: { driftRatio: 0.2, driftPct: 20, status: "warn" } },
    ]);
    assert.match(md, /Profile-differentiated perf trend report/);
    assert.match(md, /individual/);
    assert.match(md, /business/);
    assert.match(md, /baseline/);
    assert.match(md, /warn/);
}
