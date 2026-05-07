# PRISM Grafana Dashboard (R6 / E6-7)

This directory ships a starter Grafana dashboard for the PRISM operator
metrics. It is the visual front-end of the same metrics surfaced by
[`/metrics`](../../src/core/operator/dashboard-service.ts) and emitted by
[`OtelExporter`](../../src/core/activity/otel-exporter.ts) +
[`MetricsStore`](../../src/core/activity/metrics-store.ts).

## Files

| File | Purpose |
| --- | --- |
| [prism-dashboard.json](prism-dashboard.json) | Importable Grafana dashboard JSON (Grafana 10+). |

## Prerequisites

1. A Prometheus instance scraping the PRISM dashboard's `/metrics` endpoint.
   Minimum scrape config:

   ```yaml
   scrape_configs:
     - job_name: prism
       metrics_path: /metrics
       static_configs:
         - targets: ["prism-host:7070"]
   ```

   `/metrics` is intentionally unauthenticated (Prometheus convention) but
   subject to the R2 CORS allowlist. Add your Prometheus host to
   `PRISM_CORS_ORIGINS` if it talks to the dashboard from another machine.

2. Grafana 10+ with the Prometheus datasource plugin installed.

## Import

1. In Grafana, go to **Dashboards → New → Import**.
2. Click **Upload JSON file** and select `prism-dashboard.json`.
3. When prompted, pick the Prometheus datasource that scrapes PRISM.
4. Click **Import**.

The dashboard's UID is `prism-operator`; if you re-import to update an
existing copy, Grafana will recognize the UID and offer to overwrite.

## Panels

| # | Panel | Source metric | Type |
| - | --- | --- | --- |
| 1 | Active Sessions | `prism_active_sessions` | gauge → stat |
| 2 | Pending Approvals | `prism_approval_queue_depth` | gauge → stat |
| 3 | Uptime | `prism_uptime_seconds` | gauge → stat (s) |
| 4 | PRISM Build | `prism_info` | label → stat |
| 5 | Activity events / sec by status | `prism_activity_events_total` | counter → rate |
| 6 | Errors / sec by layer | `prism_errors_total` | counter → rate |
| 7 | Operation duration p50/p95/p99 | `prism_operation_duration_ms_*` | histogram |
| 8 | LLM latency p50/p95 | `prism_llm_latency_ms_*` | histogram |
| 9 | Policy decisions / sec by tier × outcome | `prism_policy_decisions_total` | counter → rate |
| 10 | Tool executions / sec by status | `prism_tool_executions_total` | counter → rate |
| 11 | Governance hooks / sec by decision | `prism_governance_hooks_total` | counter → rate |
| 12 | Agent lifecycle events / sec | `prism_agent_lifecycle_total` | counter → rate |

All counter panels use a 5-minute rate window — adjust to match your scrape
interval if it is significantly larger or smaller.

## Extending

Add panels by following the existing shape:

```jsonc
{
  "type": "timeseries",
  "title": "...",
  "datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" },
  "targets": [{ "expr": "<promql>", "legendFormat": "{{label}}", "refId": "A" }],
  "gridPos": { "h": 8, "w": 12, "x": 0, "y": <next row> }
}
```

The structural test in
[`tests/grafana-dashboard.test.ts`](../../tests/grafana-dashboard.test.ts)
asserts every panel references a metric that is actually registered by
`OtelExporter` or set in the `/metrics` route handler — keep that test
green when adding new panels.
