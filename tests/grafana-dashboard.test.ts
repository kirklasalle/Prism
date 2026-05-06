/**
 * R6 / E6-7 — Grafana dashboard JSON structural tests.
 *
 * These tests guard against the most common Grafana-import footguns:
 *
 *   - JSON is parseable.
 *   - The dashboard requires Prometheus and declares `${DS_PROMETHEUS}`
 *     as an input variable.
 *   - Every panel references a metric (via PromQL) that is actually
 *     emitted by Prism — either registered in OtelExporter or set in the
 *     /metrics route handler.
 *   - Every panel has a unique `id` and a `gridPos` so Grafana doesn't
 *     stack panels at (0,0).
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "mocha";

interface DashboardPanel {
    id: number;
    type: string;
    title: string;
    targets?: Array<{ expr?: string; refId?: string }>;
    gridPos?: { h: number; w: number; x: number; y: number };
}

interface Dashboard {
    title: string;
    uid: string;
    schemaVersion: number;
    panels: DashboardPanel[];
    __inputs?: Array<{ name: string; pluginId: string }>;
}

const DASHBOARD_PATH = join(process.cwd(), "docs", "grafana", "prism-dashboard.json");

// Metrics actually emitted by Prism. Sourced from
//   src/core/activity/otel-exporter.ts (registerMetrics + handleEvent)
//   src/core/operator/dashboard-service.ts (live gauge writes in /metrics handler)
const PRISM_METRICS = new Set<string>([
    "prism_activity_events_total",
    "prism_policy_decisions_total",
    "prism_errors_total",
    "prism_llm_requests_total",
    "prism_a2a_tasks_total",
    "prism_governance_hooks_total",
    "prism_tool_executions_total",
    "prism_agent_lifecycle_total",
    "prism_operation_duration_ms",
    "prism_policy_latency_ms",
    "prism_llm_latency_ms",
    "prism_info",
    "prism_active_sessions",
    "prism_approval_queue_depth",
    "prism_uptime_seconds",
]);

describe("R6 / E6-7 — Grafana dashboard JSON", () => {
    let dashboard: Dashboard;

    it("parses as JSON", () => {
        const text = readFileSync(DASHBOARD_PATH, "utf8");
        dashboard = JSON.parse(text) as Dashboard;
        assert.ok(dashboard, "dashboard must parse");
    });

    it("declares the standard top-level fields", () => {
        assert.strictEqual(dashboard.title, "PRISM — Operator Dashboard");
        assert.strictEqual(dashboard.uid, "prism-operator");
        assert.ok(typeof dashboard.schemaVersion === "number" && dashboard.schemaVersion >= 30);
    });

    it("declares the Prometheus datasource as an input variable", () => {
        const inputs = dashboard.__inputs ?? [];
        const prom = inputs.find((i) => i.name === "DS_PROMETHEUS");
        assert.ok(prom, "must declare DS_PROMETHEUS input");
        assert.strictEqual(prom!.pluginId, "prometheus");
    });

    it("ships at least 10 panels (Go/No-Go gate)", () => {
        assert.ok(dashboard.panels.length >= 10, `expected ≥10 panels, got ${dashboard.panels.length}`);
    });

    it("every panel has a unique id", () => {
        const ids = dashboard.panels.map((p) => p.id);
        const unique = new Set(ids);
        assert.strictEqual(ids.length, unique.size, `duplicate panel id detected: [${ids.join(", ")}]`);
    });

    it("every panel has a gridPos", () => {
        for (const panel of dashboard.panels) {
            assert.ok(panel.gridPos, `panel "${panel.title}" missing gridPos`);
            const { h, w, x, y } = panel.gridPos!;
            assert.ok(h > 0 && w > 0, `panel "${panel.title}" has zero-sized gridPos`);
            assert.ok(Number.isFinite(x) && Number.isFinite(y));
        }
    });

    it("every panel references a metric that Prism actually emits", () => {
        for (const panel of dashboard.panels) {
            const targets = panel.targets ?? [];
            assert.ok(targets.length >= 1, `panel "${panel.title}" has no targets`);
            for (const t of targets) {
                const expr = t.expr ?? "";
                assert.ok(expr.length > 0, `panel "${panel.title}" target ${t.refId} has empty expr`);
                // Strip _bucket / _sum / _count / _total suffixes when matching, so a
                // panel can reference `prism_operation_duration_ms_bucket` and we still
                // resolve to the registered base metric `prism_operation_duration_ms`.
                const referenced = extractMetricNames(expr);
                assert.ok(referenced.length > 0, `panel "${panel.title}" expr references no prism_* metric: ${expr}`);
                for (const m of referenced) {
                    const base = stripSuffix(m);
                    assert.ok(
                        PRISM_METRICS.has(base),
                        `panel "${panel.title}" references unknown metric "${m}" (base "${base}"). ` +
                        `Either register it in OtelExporter / metrics route, or fix the dashboard.`,
                    );
                }
            }
        }
    });

    it("uses the Prometheus datasource on every panel that has a datasource block", () => {
        for (const panel of dashboard.panels) {
            const ds = (panel as unknown as { datasource?: { type?: string } }).datasource;
            if (!ds) continue;
            assert.strictEqual(ds.type, "prometheus", `panel "${panel.title}" must use prometheus datasource`);
        }
    });
});

/**
 * Pull `prism_*` metric tokens out of a PromQL expression. We avoid a real
 * PromQL parser; this regex picks up any identifier that starts with
 * `prism_` and treats trailing _bucket/_sum/_count/_total as suffixes that
 * map back to the registered base name.
 */
function extractMetricNames(expr: string): string[] {
    const matches = expr.match(/prism_[a-zA-Z0-9_]+/g);
    return matches ? Array.from(new Set(matches)) : [];
}

function stripSuffix(name: string): string {
    for (const suffix of ["_bucket", "_sum", "_count"]) {
        if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
    }
    return name;
}
