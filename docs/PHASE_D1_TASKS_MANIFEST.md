# Phase D1 Tasks Manifest

**Project**: PRISM Phase D1 Individual-native MVP  
**Start Date**: 2026-03-25  
**Completed Date**: 2026-04-20  
**Status**: COMPLETE

---

## Task Board Summary

| Workstream | Primary Owner | Status | Blocker? | Due Date | Artifacts |
|-----------|---------------|--------|----------|----------|-----------|
| **A: Domain Workflow Templates** | Engineering | **Complete** | — | 2026-04-20 | 4 domain templates, template qualification harness, test reports |
| **B: Policy-Path Integration Tests** | QA/Engineering | **Complete** | — | 2026-04-20 | Governance path tests, mutation operation coverage |
| **C: Contract Snapshot Evidence** | Engineering | **Complete** | — | 2026-04-20 | Tool contract snapshots, versioning, release artifacts |
| **D: Retrieval Attribution & Observability** | Engineering | **Complete** | — | 2026-04-20 | Retrieval attribution pipeline, dashboard traces, SLO profiles |
| **E: Performance & Release Qualification** | Engineering/QA | **Complete** | — | 2026-04-20 | Performance harness, CI gates, release validation, environment profiles |

---

## Workstream Details

### A: Domain Workflow Templates (5 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| A1 | Implement email triage and draft workflow template | Engineering | `complete` | 2026-03-31 | 2026-04-07 |
| A2 | Implement calendar conflict detection and day-plan template | Engineering | `complete` | 2026-03-31 | 2026-04-07 |
| A3 | Implement notes capture + action/deadline extraction template | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| A4 | Implement chronological task/event timeline template | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| A5 | Build D1 workflow template qualification harness | Engineering | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Phase C governance and observability foundations operational  
**Exit Criteria**: Four domain templates runnable in controlled test mode with policy-path traces  
**Deliverables**:

- `src/core/runtime/domain-workflow-templates.ts` — 4 domain templates (email, calendar, notes, tasks)
- `src/benchmarks/d1-workflow-template-qualification.ts` — Workflow template qualification harness
- `tests/domain-workflow-templates.test.ts` — Template availability and policy-path tests

---

### B: Policy-Path Integration Tests (4 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| B1 | Write allow/deny/timeout tests for mutation operations | QA | `complete` | 2026-04-01 | 2026-04-07 |
| B2 | Write governance-path tests for terminal/container adapters | QA | `complete` | 2026-04-07 | 2026-04-14 |
| B3 | Validate domain workflow template policy paths | QA | `complete` | 2026-04-14 | 2026-04-20 |
| B4 | Validate policy-engine tier routing and rollback coverage | QA | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Domain templates (Workstream A) operational  
**Exit Criteria**: Governance-path integration tests pass for all mutating operations (allow/deny/timeout/revoke)  
**Deliverables**:

- `tests/d2-governance-paths.test.ts` — Terminal and container governance paths
- `tests/policy-engine.test.ts` — Tier routing and rollback coverage
- `tests/workflow.test.ts` — Workflow approval granted/denied/timeout paths

---

### C: Contract Snapshot Evidence (4 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| C1 | Implement adapter contract versioning and runtime schema validation | Engineering | `complete` | 2026-03-31 | 2026-04-07 |
| C2 | Build tool contract snapshot artifact generator | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| C3 | Expand tool contract test coverage (2 → 10 test cases) | QA | `complete` | 2026-04-14 | 2026-04-20 |
| C4 | Validate contract snapshot diff and compatibility | QA | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Tool registry and adapter framework operational  
**Exit Criteria**: Tool contract snapshots updated and validated in release artifacts  
**Deliverables**:

- `src/benchmarks/tool-contract-snapshot.ts` — Snapshot artifact generator
- `src/core/tools/tool-contract-extractor.ts` — Contract extraction engine
- `tests/tool-contracts.test.ts` — 10 contract versioning test cases
- `tests/tool-contract-snapshot.test.ts` — Snapshot generation tests
- `tests/tool-contract-extractor.test.ts` — Extraction logic tests
- `docs/TOOL_CONTRACT_EXTRACTION_SPEC.md` — Contract extraction specification

---

### D: Retrieval Attribution & Observability (4 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| D1 | Validate retrieval attribution in sampled outputs | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| D2 | Wire retrieval attribution into dashboard traces | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| D3 | Implement environment profile presets for SLO qualification | Engineering | `complete` | 2026-04-14 | 2026-04-20 |
| D4 | Validate retrieval observability pipeline end-to-end | QA | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Retrieval observability pipeline (Phase C) operational  
**Exit Criteria**: Retrieval attribution present in sampled outputs and dashboard traces  
**Deliverables**:

- `src/core/config/environment-profiles.ts` — Performance SLO profiles (dev/staging/prod)
- `tests/environment-profiles.test.ts` — Profile preset validation
- `tests/retrieval-dashboard-store.test.ts` — Dashboard trace validation
- `tests/semantic-memory-diagnostics.test.ts` — Retrieval attribution sampling

---

### E: Performance & Release Qualification (6 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| E1 | Implement performance qualification harness (p50/p95/p99) | Engineering | `complete` | 2026-04-01 | 2026-04-07 |
| E2 | Build Individual profile qualification suite | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| E3 | Build Business profile qualification suite | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| E4 | Implement CI/CD quality gate orchestrator | Engineering | `complete` | 2026-04-14 | 2026-04-20 |
| E5 | Build release validation harness (staging, perf, runbooks, contracts) | Engineering | `complete` | 2026-04-14 | 2026-04-20 |
| E6 | Expand adapter safety regression suite | QA | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Contract snapshots (Workstream C) and SLO profiles (Workstream D) available  
**Exit Criteria**: Performance and reliability gates met; CI/CD release artifacts generated  
**Deliverables**:

- `src/benchmarks/performance-qualification.ts` — SLO gate harness with environment-aware profiles
- `src/benchmarks/release-validation.ts` — CI/CD release gate orchestrator
- `src/benchmarks/ci-gate-check.ts` — CI quality gate checker
- `src/benchmarks/e1-individual-qualification.ts` — Individual profile qualification
- `src/benchmarks/e2-business-qualification.ts` — Business profile qualification
- `src/benchmarks/e3-policy-stress.ts` — Policy stress/contention scenarios
- `src/benchmarks/e4-profile-switch-qualification.ts` — Profile switch qualification
- `tests/release-validation.test.ts` — Release gate tests
- `tests/adapter-safety.test.ts` — Adapter safety regression suite
- `tests/e2e-smoke.test.ts` — End-to-end staging smoke test

---

## Dependencies & Constraints

### Critical Dependency Chain

```
Phase C (Governance + Observability) ✓
        ↓
    A1-A4 → A5 ✓ (Domain Templates + Qualification)
    B1 → B2 → B3-B4 ✓ (Policy-Path Tests)
    C1 → C2 → C3-C4 ✓ (Contract Snapshots)
        ↓
    D1-D2 → D3-D4 ✓ (Retrieval Attribution)
        ↓
    E1 → E2-E3 → E4-E5 → E6 ✓ (Performance + Release)
```

### Integration Points

- Domain templates integrate with workflow engine and approval queue (Phase C Workstream A)
- Policy-path tests validate governance routes through terminal/container adapters (Phase D2)
- Contract snapshots feed release validation harness (Workstream E)
- Environment profiles configure SLO thresholds per deployment stage (dev/staging/prod)

---

## Success Criteria

### Exit Criteria (All Met — 2026-04-20)

- [x] Four domain templates runnable in controlled test mode — email triage, calendar conflict, notes capture, chronological tasks all pass template qualification
- [x] Governance-path integration tests pass for all mutating operations — allow/deny/timeout/revoke paths covered across workflows, terminals, containers, and domain templates
- [x] Retrieval attribution present in sampled outputs and dashboard traces — environment profiles (dev/staging/prod) configure alert thresholds, cohort dashboards operational
- [x] Tool contract snapshots updated and validated in release artifacts — 10 contract versioning test cases pass, snapshot generator operational, extraction spec documented

### Test Evidence Summary

| Test File | Tests | Pass | Coverage |
|-----------|-------|------|----------|
| `tests/domain-workflow-templates.test.ts` | 4 | 4 | Template availability, allow/deny/timeout paths |
| `tests/workflow.test.ts` | 9 | 9 | Retry, timeout, fallback, approval paths |
| `tests/d2-governance-paths.test.ts` | 4+ | 4+ | Terminal and container governance paths |
| `tests/policy-engine.test.ts` | 5+ | 5+ | Tier routing, rollback requirements |
| `tests/tool-contracts.test.ts` | 10 | 10 | Contract versioning, schema validation |
| `tests/tool-contract-snapshot.test.ts` | 3+ | 3+ | Snapshot generation, diff validation |
| `tests/tool-contract-extractor.test.ts` | 5+ | 5+ | Contract extraction pipeline |
| `tests/environment-profiles.test.ts` | 4+ | 4+ | SLO profiles, profile presets |
| `tests/retrieval-dashboard-store.test.ts` | 5+ | 5+ | Snapshots, cohorts, alerts, trends |
| `tests/release-validation.test.ts` | 4+ | 4+ | Staging, perf gates, runbook checks |
| `tests/adapter-safety.test.ts` | 6+ | 6+ | Adapter regression coverage |
| `tests/e2e-smoke.test.ts` | 3+ | 3+ | End-to-end staging smoke |
| `tests/replay.test.ts` | 4+ | 4+ | Replay determinism coverage |

---

**Last Updated**: 2026-04-20  
**Next Review**: N/A (Phase D1 COMPLETE)
