# PRISM Roadmap

Date: 2026-03-11

## Phase A (Done)

- Runtime scaffolding with TypeScript and tool registry
- Activity bus with structured events and hash chain
- Policy engine with 3-tier authority model
- Orchestrator with approval-gated flow
- Real adapters for system/protocol/application basics
- SQLite persistence for activity events
- Approval queue + approval HTTP service

## Phase B (Done)

- Episodic memory buffer
- Session summary persistence
- Semantic memory index
- First-class retrieval tools: `semantic_query` and `memory_query`

## Phase C (In Progress)

- Memory retrieval quality instrumentation expanded (coverage/utility/novelty + p50/p95/p99)
- Memory growth and drift diagnostics implemented (trend windows + alerting)
- Query cohort quality dashboards and alerting implemented
- Cohort dashboard persistence/export snapshots implemented (SQLite-backed)
- Cohort trend API and baseline comparison views implemented
- Configurable retrieval alert policy thresholds implemented
- Workflow orchestration expansion complete for retries/timeouts/fallback routing
- Deterministic replay harness implemented for trace parity checks
- Performance qualification harness implemented (`npm run perf:qualify`) with p50/p95/p99 gate outputs
- Approval-pathway contention load benchmark implemented in performance qualification harness
- CI quality workflow implemented (tests + perf qualification + artifact upload)
- Environment-specific SLO profile presets implemented for qualification gates (dev/staging/prod)
- Environment-specific retrieval alert policy profiles implemented (dev/staging/prod)
- Adapter contract versioning and runtime schema checks implemented with regression tests
- Tool contract snapshot artifact generation implemented for release evidence
- Workflow integration coverage expanded:
  - approval granted path
  - approval denied path
  - approval timeout path
  - fallback and hard-failure behavior under governance outcomes
- Documentation expansion complete:
  - README strategy refresh
  - PRD major expansion
  - Developer Guide added
  - User Guide added

## Next Steps

1. Individual-native MVP execution (new)

- Build workflow templates for:
  - email triage + draft
  - calendar conflict + day planning
  - notes capture + extraction
  - chronological tasks/events planning
- Add policy-path integration tests for mutating operations (allow/deny/timeout)
- Publish release evidence bundle:
  - tool contract snapshots
  - retrieval attribution samples
  - workflow trace parity checks

1. Retrieval quality instrumentation

- Expand profile-specific alert tuning based on production incident trends

1. Adapter hardening and regression safety

- Expand safety regression tests for system and protocol adapters
- Add baseline-to-candidate contract diff policy and release blocking rules
- Expand SQLite migration compatibility scenarios across historical schema variants

1. Performance qualification deepening

- Expand contention scenarios by environment profiles (approve/deny/timeout mixes)
- Add profile-differentiated trend history and regression drift alerts in CI artifacts

1. Operator surfaces

- Build runbook-grade incident triage guide
- Add session trace explorer UX/API
- Add policy bundle diff and audit export tools

1. Novel systems incubation

- Constitutional Causal Compiler prototype
- Dual-Lens Memory Arbitration prototype
- Self-Healing Workflow Synthesis prototype

## Target Quality Gates

- Workflow success rate >= 99.0% on approved patterns
- Activity stream delivery p95 <= 200ms
- Telemetry overhead p95 <= 20ms
- Policy decision latency p95 <= 30ms
- Retrieval latency p95 <= 50ms (hot memory)
- Full traceability for sampled sessions
