# Phase C Tasks Manifest

**Project**: PRISM Phase C Reliability and Observability  
**Start Date**: 2026-03-11  
**Completed Date**: 2026-04-20  
**Status**: COMPLETE

---

## Task Board Summary

| Workstream | Primary Owner | Status | Blocker? | Due Date | Artifacts |
|-----------|---------------|--------|----------|----------|-----------|
| **A: Governance-Path Integration** | Engineering/QA | **Complete** | — | 2026-04-20 | Workflow engine, approval integration, domain templates, test reports |
| **B: Retrieval Observability Pipeline** | Engineering | **Complete** | — | 2026-04-20 | Metrics collector, cohort dashboards, alert policies, drift diagnostics |
| **C: Character Accountability Control (CAC)** | Engineering/Governance | **Complete** | — | 2026-04-20 | Identity manager, store, lifecycle tests, email validation |
| **D: Documentation Synchronization** | Engineering/Product | **Complete** | — | 2026-04-20 | Phase Execution Plan, ROADMAP, TEST_STRATEGY, USER_GUIDE, policy docs |

---

## Workstream Details

### A: Governance-Path Integration (8 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| A1 | Implement workflow retry/timeout/fallback engine | Engineering | `complete` | 2026-03-18 | 2026-03-25 |
| A2 | Integrate approval queue (granted/denied/timeout paths) | Engineering | `complete` | 2026-03-18 | 2026-03-25 |
| A3 | Build domain workflow templates (email, calendar, notes, tasks) | Engineering | `complete` | 2026-03-25 | 2026-04-01 |
| A4 | Write governance-path integration tests (workflow) | QA | `complete` | 2026-04-01 | 2026-04-07 |
| A5 | Write terminal governance-path tests (allow/deny/timeout/revoke) | QA | `complete` | 2026-04-07 | 2026-04-14 |
| A6 | Write container governance-path tests (allow/deny/timeout/revoke) | QA | `complete` | 2026-04-07 | 2026-04-14 |
| A7 | Implement event lineage with reason-code taxonomy | Engineering | `complete` | 2026-04-01 | 2026-04-07 |
| A8 | Validate domain workflow policy paths (allow/deny/timeout) | QA | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Runtime foundations (Phase A) and memory foundations (Phase B) operational  
**Exit Criteria**: All governance paths tested (granted, denied, timeout, revoke), reason codes propagated  
**Deliverables**:

- `src/core/runtime/workflow.ts` — DAG-based workflow engine with retry/timeout/fallback
- `src/core/runtime/domain-workflow-templates.ts` — 4 domain templates
- `src/core/approval/approval-queue.ts` — Approval queue with timeout management
- `src/core/policy/reason-codes.ts` — Structured reason-code enumeration
- `tests/workflow.test.ts` — 9 workflow tests (success, failure, timeout, retry, approval paths)
- `tests/d2-governance-paths.test.ts` — Terminal and container governance paths
- `tests/domain-workflow-templates.test.ts` — Domain template policy-path tests
- `tests/event-lineage-telemetry.test.ts` — Reason-code propagation validation

---

### B: Retrieval Observability Pipeline (7 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| B1 | Implement retrieval metrics collector (coverage/novelty/utility) | Engineering | `complete` | 2026-03-18 | 2026-03-25 |
| B2 | Add percentile tracking (p50/p95/p99) | Engineering | `complete` | 2026-03-25 | 2026-03-31 |
| B3 | Build cohort dashboard with SQLite persistence | Engineering | `complete` | 2026-03-31 | 2026-04-07 |
| B4 | Implement drift diagnostics with trend windows | Engineering | `complete` | 2026-04-01 | 2026-04-07 |
| B5 | Implement configurable alert policy thresholds (dev/staging/prod) | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| B6 | Build cohort trend API and baseline comparison views | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| B7 | Write retrieval dashboard and alert tests | QA | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Memory subsystem operational (Phase B), activity bus emitting events  
**Exit Criteria**: Pipeline collecting metrics end-to-end, alerts firing on threshold breach, drift detected  
**Deliverables**:

- `src/core/memory/retrieval-metrics.ts` — Metric collection with percentile statistics
- `src/core/memory/retrieval-dashboard-store.ts` — SQLite-backed cohort persistence and trend analysis
- `src/core/memory/retrieval-alert-policy.ts` — Configurable threshold profiles (dev/staging/prod)
- `tests/retrieval-dashboard-store.test.ts` — Snapshot persistence, cohort aggregation, alert thresholds
- `tests/semantic-memory-diagnostics.test.ts` — Event ingestion, multi-term scoring, case-insensitive matching

---

### C: Character Accountability Control (6 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| C1 | Implement identity chain binding (character → operator → user → session) | Engineering | `complete` | 2026-04-01 | 2026-04-07 |
| C2 | Implement lifecycle management (assign/dispatch/suspend/resume/revoke) | Engineering | `complete` | 2026-04-01 | 2026-04-07 |
| C3 | Add profile-aware email domain validation | Engineering | `complete` | 2026-04-07 | 2026-04-10 |
| C4 | Add segment alias normalization (enterprise/corporate → business) | Engineering | `complete` | 2026-04-07 | 2026-04-10 |
| C5 | Propagate accountability chain into activity events and SHA-256 hashes | Engineering | `complete` | 2026-04-10 | 2026-04-14 |
| C6 | Write comprehensive CAC lifecycle and validation tests | QA | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Activity bus operational (Phase A), policy engine tiering functional  
**Exit Criteria**: All 5 CAC sub-requirements met per Phase Execution Plan  
**Deliverables**:

- `src/core/accountability/character-accountability-manager.ts` — Lifecycle and policy enforcement
- `src/core/accountability/character-accountability-store.ts` — SQLite-backed persistence
- `src/core/policy/reason-code-taxonomy.ts` — CAC-specific reason codes
- `tests/character-accountability.test.ts` — Identity binding, lifecycle, email validation, query filtering

**CAC Sub-requirement Checklist**:

- [x] Identity binding (characterId, prismUserId, prismUserEmail, operatorId, operatorEmail, clientId, sessionId)
- [x] Lifecycle management (assign → active → suspended → revoked, with dispatch tracking)
- [x] Profile-aware email domain validation (business enforces matching; individual permissive)
- [x] Accountability chain propagated into activity events and SHA-256 integrity hashes
- [x] Segment alias normalization (enterprise/corporate → business)

---

### D: Documentation Synchronization (5 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| D1 | Update Phase Execution Plan with Phase C scope and CAC sub-requirements | Product/Engineering | `complete` | 2026-03-18 | 2026-03-25 |
| D2 | Expand ROADMAP with Phase C implementation details | Engineering | `complete` | 2026-03-25 | 2026-04-01 |
| D3 | Add CAC governance scenarios to TEST_STRATEGY (11 scenarios) | QA | `complete` | 2026-04-07 | 2026-04-14 |
| D4 | Add Character Accountability section to USER_GUIDE | Product | `complete` | 2026-04-07 | 2026-04-14 |
| D5 | Integrate CAC into BUSINESS_TRUST_PROVENANCE_POLICY | Governance | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Implementation features complete (Workstreams A, B, C)  
**Exit Criteria**: All referenced docs reflect implemented state, no aspirational claims  
**Deliverables**:

- `docs/PHASE_EXECUTION_PLAN.md` — Phase C scope with 4 exit criteria and 5 CAC sub-requirements
- `docs/ROADMAP.md` — 27+ Phase C implementation items documented
- `docs/TEST_STRATEGY.md` — 11 governance-critical CAC scenarios
- `docs/USER_GUIDE.md` — §12: Character Accountability & Identity section
- `docs/BUSINESS_TRUST_PROVENANCE_POLICY.md` — CAC trust integration

---

## Dependencies & Constraints

### Critical Dependency Chain

```
Phase A (Runtime) + Phase B (Memory) ✓
        ↓
    A1 → A2 → A3 → A4-A8 ✓ (Governance Paths)
    B1 → B2 → B3 → B4 → B5 → B6 → B7 ✓ (Retrieval Pipeline)
    C1 → C2 → C3 → C4 → C5 → C6 ✓ (CAC)
        ↓
    D1 → D2 → D3 → D4 → D5 ✓ (Documentation)
```

### Integration Points

- Workflow engine integrates with approval queue and policy engine (Phase A foundations)
- Retrieval metrics collector integrates with memory subsystem (Phase B foundations)
- CAC accountability chain integrates with activity bus SHA-256 hashing (Phase A foundations)
- Documentation synchronization depends on all implementation workstreams being finalized

---

## Success Criteria

### Exit Criteria (All Met — 2026-04-20)

- [x] Full governance-path integration tests green — 21+ test cases covering approval granted/denied/timeout/revoke across workflows, terminals, containers, and domain templates
- [x] Retrieval observability pipeline operational — Metrics collection (coverage/novelty/utility), cohort dashboards, drift diagnostics, configurable alert policies, SQLite persistence, baseline trending
- [x] Documentation synchronized to implementation state — PHASE_EXECUTION_PLAN, ROADMAP, TEST_STRATEGY, USER_GUIDE, and policy documents all reference Phase C features with completion status
- [x] CAC implemented and tested — All 5 sub-requirements (identity binding, lifecycle management, profile-aware email validation, accountability chain propagation, segment alias normalization) fully tested and passing

### Test Evidence Summary

| Test File | Tests | Pass | Coverage |
|-----------|-------|------|----------|
| `tests/workflow.test.ts` | 9 | 9 | Retry, timeout, fallback, approval granted/denied/timeout |
| `tests/d2-governance-paths.test.ts` | 4+ | 4+ | Terminal and container governance paths |
| `tests/domain-workflow-templates.test.ts` | 4 | 4 | Template availability, allow/deny/timeout paths |
| `tests/event-lineage-telemetry.test.ts` | 3+ | 3+ | Reason codes, event lineage propagation |
| `tests/policy-engine.test.ts` | 5+ | 5+ | Tier routing, rollback requirements |
| `tests/activity-bus.test.ts` | 3+ | 3+ | Event emission, hash chain |
| `tests/retrieval-dashboard-store.test.ts` | 5+ | 5+ | Snapshots, cohorts, alerts, trends |
| `tests/semantic-memory-diagnostics.test.ts` | 4+ | 4+ | Ingestion, scoring, pagination |
| `tests/memory.test.ts` | 5+ | 5+ | Episodic, session, semantic memory |
| `tests/character-accountability.test.ts` | 10+ | 10+ | Lifecycle, identity, email validation, queries |

---

**Last Updated**: 2026-04-20  
**Next Review**: N/A (Phase C COMPLETE)
