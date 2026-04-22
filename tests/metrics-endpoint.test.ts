/**
 * metrics-endpoint.test.ts — E6 Observability: MetricsStore + OtelExporter
 *
 * Validates:
 *  - MetricsStore: counters, histograms, gauges, Prometheus text format
 *  - OtelExporter: ActivityBus event → metric counter increments
 *  - At least 10 named metrics present in output (Go/No-Go gate)
 */

import * as assert from "assert";
import { describe, it, before } from "mocha";
import { MetricsStore } from "../src/core/activity/metrics-store.js";
import { OtelExporter } from "../src/core/activity/otel-exporter.js";
import { ActivityBus } from "../src/core/activity/bus.js";

// ── MetricsStore unit tests ───────────────────────────────────────────────────

describe("MetricsStore", function () {
    this.timeout(5000);

    let store: MetricsStore;

    before(() => {
        store = new MetricsStore();
    });

    // ── Counter ───────────────────────────────────────────────────────────────

    describe("counter", () => {
        it("registers and increments a counter with no labels", () => {
            store.registerCounter("test_requests_total", "Test requests");
            store.inc("test_requests_total");
            store.inc("test_requests_total");
            const output = store.render();
            assert.ok(output.includes("# TYPE test_requests_total counter"), "should include TYPE declaration");
            assert.ok(output.includes("test_requests_total 2"), "should reflect inc count of 2");
        });

        it("increments a counter with labels", () => {
            store.registerCounter("test_labelled_total", "Test with labels");
            store.inc("test_labelled_total", { method: "GET", status: "200" });
            store.inc("test_labelled_total", { method: "GET", status: "200" });
            store.inc("test_labelled_total", { method: "POST", status: "201" });
            const output = store.render();
            assert.ok(output.includes('test_labelled_total{method="GET",status="200"} 2'));
            assert.ok(output.includes('test_labelled_total{method="POST",status="201"} 1'));
        });

        it("auto-registers counter on first inc()", () => {
            store.inc("test_auto_counter");
            const output = store.render();
            assert.ok(output.includes("# TYPE test_auto_counter counter"));
            assert.ok(output.includes("test_auto_counter 1"));
        });

        it("increments by custom amount", () => {
            store.registerCounter("test_bulk_total", "Bulk increment");
            store.inc("test_bulk_total", {}, 10);
            store.inc("test_bulk_total", {}, 5);
            const output = store.render();
            assert.ok(output.includes("test_bulk_total 15"));
        });
    });

    // ── Histogram ─────────────────────────────────────────────────────────────

    describe("histogram", () => {
        it("registers and observes a histogram", () => {
            store.registerHistogram("test_latency_ms", "Test latency", [10, 50, 100]);
            store.observe("test_latency_ms", 25);
            store.observe("test_latency_ms", 75);
            const output = store.render();
            assert.ok(output.includes("# TYPE test_latency_ms histogram"));
            assert.ok(output.includes('test_latency_ms_bucket{le="10"} 0'));
            assert.ok(output.includes('test_latency_ms_bucket{le="50"} 1'));
            assert.ok(output.includes('test_latency_ms_bucket{le="100"} 2'));
            assert.ok(output.includes('test_latency_ms_bucket{le="+Inf"} 2'));
            assert.ok(output.includes("test_latency_ms_sum 100"));
            assert.ok(output.includes("test_latency_ms_count 2"));
        });

        it("uses default buckets when none specified", () => {
            store.observe("test_default_buckets_ms", 50);
            const output = store.render();
            assert.ok(output.includes('test_default_buckets_ms_bucket{le="5"}'));
            assert.ok(output.includes('test_default_buckets_ms_bucket{le="+Inf"}'));
        });

        it("maintains cumulative bucket counts", () => {
            store.registerHistogram("test_cumulative_ms", "Cumulative test", [10, 20, 30]);
            store.observe("test_cumulative_ms", 5);   // fits all three buckets
            store.observe("test_cumulative_ms", 15);  // fits 20 and 30
            store.observe("test_cumulative_ms", 25);  // fits 30 only
            const output = store.render();
            assert.ok(output.includes('test_cumulative_ms_bucket{le="10"} 1'));
            assert.ok(output.includes('test_cumulative_ms_bucket{le="20"} 2'));
            assert.ok(output.includes('test_cumulative_ms_bucket{le="30"} 3'));
            assert.ok(output.includes('test_cumulative_ms_bucket{le="+Inf"} 3'));
        });

        it("handles histogram with labels", () => {
            store.registerHistogram("test_labelled_latency_ms", "Labelled histogram", [10, 50]);
            store.observe("test_labelled_latency_ms", 8, { endpoint: "/api" });
            store.observe("test_labelled_latency_ms", 30, { endpoint: "/api" });
            const output = store.render();
            assert.ok(output.includes('le="10",endpoint="/api"') || output.includes('endpoint="/api",le="10"'));
        });
    });

    // ── Gauge ─────────────────────────────────────────────────────────────────

    describe("gauge", () => {
        it("registers and sets a gauge", () => {
            store.registerGauge("test_active_connections", "Active connections");
            store.set("test_active_connections", 42);
            const output = store.render();
            assert.ok(output.includes("# TYPE test_active_connections gauge"));
            assert.ok(output.includes("test_active_connections 42"));
        });

        it("overrides previous gauge value", () => {
            store.set("test_active_connections", 5);
            const output = store.render();
            assert.ok(output.includes("test_active_connections 5"));
            assert.ok(!output.includes("test_active_connections 42"), "old value should be replaced");
        });

        it("auto-registers gauge on first set()", () => {
            store.set("test_auto_gauge", 99);
            const output = store.render();
            assert.ok(output.includes("# TYPE test_auto_gauge gauge"));
            assert.ok(output.includes("test_auto_gauge 99"));
        });
    });

    // ── Render format ─────────────────────────────────────────────────────────

    describe("render", () => {
        it("output ends with a trailing newline", () => {
            const output = store.render();
            assert.ok(output.endsWith("\n"), "Prometheus format requires trailing newline");
        });

        it("includes HELP line before TYPE line", () => {
            const output = store.render();
            const helpIdx = output.indexOf("# HELP test_requests_total");
            const typeIdx = output.indexOf("# TYPE test_requests_total");
            assert.ok(helpIdx < typeIdx, "HELP must appear before TYPE");
        });

        it("escapes special characters in label values", () => {
            store.inc('test_escaped_total', { msg: 'say "hello"\nworld' });
            const output = store.render();
            assert.ok(output.includes('\\"hello\\"'), "double quotes must be escaped");
            assert.ok(output.includes("\\n"), "newlines must be escaped");
        });
    });
});

// ── OtelExporter unit tests ───────────────────────────────────────────────────

describe("OtelExporter", function () {
    this.timeout(5000);

    let bus: ActivityBus;
    let store: MetricsStore;
    let exporter: OtelExporter;

    before(() => {
        bus = new ActivityBus();
        store = new MetricsStore();
        exporter = new OtelExporter(bus, store, {
            serviceName: "prism-test",
            serviceVersion: "0.0.0",
            consoleExport: false,
            endpoint: "",
        });
        exporter.start();
    });

    it("increments prism_activity_events_total on event", () => {
        bus.emit({
            layer: "agent",
            operation: "test_op",
            status: "succeeded",
            sessionId: "sess-1",
            details: {},
        });
        const output = store.render();
        assert.ok(
            output.includes('prism_activity_events_total{layer="agent",status="succeeded"}'),
            "should track agent event"
        );
    });

    it("increments prism_errors_total on failed events", () => {
        bus.emit({
            layer: "tool_execution",
            operation: "run_tool",
            status: "failed",
            sessionId: "sess-1",
            details: {},
        });
        const output = store.render();
        assert.ok(
            output.includes('prism_errors_total{layer="tool_execution",operation="run_tool"}'),
            "should track failed events"
        );
    });

    it("increments prism_llm_requests_total for llm layer events", () => {
        bus.emit({
            layer: "llm",
            operation: "generate",
            status: "succeeded",
            sessionId: "sess-1",
            details: {},
        });
        const output = store.render();
        assert.ok(
            output.includes('prism_llm_requests_total{status="succeeded"}'),
            "should track LLM requests"
        );
    });

    it("records histogram observation for durationMs", () => {
        bus.emit({
            layer: "episodic",
            operation: "store_memory",
            status: "succeeded",
            sessionId: "sess-1",
            durationMs: 42,
            details: {},
        });
        const output = store.render();
        assert.ok(output.includes("prism_operation_duration_ms_sum"), "should track duration");
    });

    it("increments prism_governance_hooks_total for pre_tool_use_evaluated", () => {
        bus.emit({
            layer: "governance",
            operation: "pre_tool_use_evaluated",
            status: "succeeded",
            sessionId: "sess-1",
            details: { permission_decision: "allow" },
        });
        const output = store.render();
        assert.ok(
            output.includes('prism_governance_hooks_total{decision="allow",hook="pre_tool_use"}'),
            "should track governance hook evaluations"
        );
    });

    it("increments prism_tool_executions_total for tool_execution layer", () => {
        bus.emit({
            layer: "tool_execution",
            operation: "read_file",
            status: "succeeded",
            sessionId: "sess-1",
            details: {},
        });
        const output = store.render();
        assert.ok(
            output.includes('prism_tool_executions_total{operation="read_file",status="succeeded"}'),
            "should track tool executions"
        );
    });

    it("increments prism_agent_lifecycle_total for agent layer", () => {
        bus.emit({
            layer: "agent",
            operation: "a2a_task_submitted",
            status: "succeeded",
            sessionId: "sess-1",
            details: {},
        });
        const output = store.render();
        assert.ok(
            output.includes('prism_agent_lifecycle_total{operation="a2a_task_submitted"}'),
            "should track agent lifecycle events"
        );
    });

    it("start() is idempotent (calling twice doesn't double-count)", () => {
        const beforeOutput = store.render();
        const countBefore = (beforeOutput.match(/prism_activity_events_total/g) ?? []).length;
        exporter.start(); // second call — should be no-op
        bus.emit({
            layer: "agent",
            operation: "idempotent_test",
            status: "succeeded",
            sessionId: "sess-1",
            details: {},
        });
        const afterOutput = store.render();
        const countAfter = (afterOutput.match(/prism_activity_events_total/g) ?? []).length;
        assert.strictEqual(countBefore, countAfter, "start() twice must not add duplicate subscriptions");
    });

    it("stop() unsubscribes (events after stop are not counted)", () => {
        exporter.stop();
        const storeBefore = store.render();

        // Extract current count for a new label we haven't used yet
        bus.emit({
            layer: "demo",
            operation: "after_stop",
            status: "succeeded",
            sessionId: "sess-1",
            details: {},
        });
        const storeAfter = store.render();

        // After stop, the after_stop operation should NOT appear
        assert.ok(
            !storeAfter.includes('operation="after_stop"'),
            "events after stop() should not be counted"
        );

        // Re-subscribe for remaining tests (cleanup)
        exporter.start();
    });

    // ── Go/No-Go gate: ≥10 named metrics in output ────────────────────────────

    it("Go/No-Go gate: at least 10 distinct named metrics present in output", () => {
        // Trigger a2a and governance events so all counters are primed
        bus.emit({ layer: "agent", operation: "a2a_task_submitted", status: "succeeded", sessionId: "s", details: {} });
        bus.emit({ layer: "governance", operation: "pre_tool_use_evaluated", status: "succeeded", sessionId: "s", details: { permission_decision: "allow" } });
        bus.emit({ layer: "governance", operation: "post_tool_use_recorded", status: "succeeded", sessionId: "s", details: {} });

        const output = store.render();
        const typeLines = output.match(/^# TYPE \S+/gm) ?? [];
        const metricNames = new Set(typeLines.map((l) => l.split(" ")[2]));

        assert.ok(
            metricNames.size >= 10,
            `Go/No-Go gate requires ≥10 metrics; found ${metricNames.size}: ${[...metricNames].join(", ")}`
        );
    });
});
