Release Notes: Approval Auto-Run (2026-05-29)

Overview

This release adds a governed convenience feature: when an operator approves a Tier-2 chat prompt (one that requires approval due to potential external effects), PRISM can automatically continue and execute the prompt using the Agentic executor. Key points:

- Operator approval is still REQUIRED for Tier-2 work — this change does NOT relax governance.
- Auto-run behavior is controlled by runtime flag `autoRunApprovedTier2` (default: true). You can disable automatic continuation in the Dashboard Settings.
- The Dashboard includes an "Approve & Run" button to approve and immediately follow the agentic execution trace.
- Telemetry: metric `prism_auto_run_approved_tier2_total` counts auto-run executions.
- Latency telemetry: histogram `prism_auto_run_duration_ms` captures end-to-end auto-run duration after approval.

Files changed (high level)

- `src/core/operator/dashboard-service.ts` — enqueue approvals and continue approved prompts via `AgenticChatExecutor` when enabled.
- `src/core/operator/public/tab-approval-queue.js` — "Approve & Run" button and behavior.
- `src/core/operator/public/tab-settings.js` — toggle for `autoRunApprovedTier2`.
- `src/core/activity/otel-exporter.ts` — telemetry registration for auto-run counter.
- `docs/APPROVAL_AUTO_RUN.md` — documentation of behavior and runtime flag.

Operator guidance

- To disable automatic continuation, open Dashboard → Provider & Settings → Approval & Orchestration and uncheck "Auto-run approved Tier-2 chat prompts". Saving updates server runtime settings and persists to preferences.

Audit and observability

- Approval resolutions emit `approval.resolved` events on the ActivityBus (layer=governance).
- Agentic execution of approved requests emits `agentic_event` messages to dashboard SSE/WS clients.
- Metrics available at `/metrics` include `prism_auto_run_approved_tier2_total` and `prism_auto_run_duration_ms`.
- Grafana suggestion: [docs/grafana/auto-run-panel.json](docs/grafana/auto-run-panel.json) provides a starter panel for the counter metric.

If you'd like, I can add a Grafana panel suggestion or publish a short operator-facing announcement message template.
