# PRISM Phase Execution Plan

Date: 2026-03-11
Owner: PRISM Engineering

## Purpose

This plan defines delivery phases, exit criteria, and handoff requirements from active development to production release.

## Phase Model

### Phase A: Runtime Foundations (Complete)

Scope:

- Core runtime scaffolding
- Activity bus and event hashing
- Policy engine and tiering
- Initial orchestrator + adapters

Exit Criteria:

- Runtime executes baseline operations
- Governance events emitted and persisted
- Approval gate operational

### Phase B: Memory Foundations (Complete)

Scope:

- Episodic, session, semantic memory
- Retrieval tools and query modes

Exit Criteria:

- Memory query APIs operational
- Retrieval traceability verified
- Session summary persistence validated

### Phase C: Reliability and Observability (Complete)

Scope:

- Workflow retry/timeout/fallback behavior
- Approval success/denial/timeout integration coverage
- Retrieval quality telemetry (coverage, novelty, utility)
- Drift diagnostics, cohort dashboards, persistence, baseline trend comparisons
- Configurable threshold policy for retrieval alerts

Exit Criteria:

- Full governance-path integration tests green
- Retrieval observability pipeline operational
- Documentation synchronized to implementation state
- Character Accountability Control (CAC) implemented and tested:
  - Identity binding (character, Prism user, operator, client, session)
  - Lifecycle management (assign, dispatch, suspend, resume, revoke)
  - Profile-aware email domain validation (business enforces matching; individual permissive)
  - Accountability chain propagated into activity events and SHA-256 hashes
  - Segment alias normalization (enterprise/corporate → business)

### Phase D: Production Qualification (Active)

Scope:

- Adapter safety regression suite expansion
- Adapter contract versioning and runtime schema validation (implemented)
- Tool contract snapshot artifacts for release evidence (implemented)
- Replay determinism coverage and migration tests
- Performance qualification harness against SLOs (implemented)
- Approval-pathway contention load scenarios (baseline implemented)
- Environment profile presets for SLO qualification and retrieval alerts (implemented)
- CI/CD quality gates and release artifacts (baseline implemented)

Exit Criteria:

- Staging burn-in completed
- Performance and reliability gates met
- Incident, rollback, and operator runbooks validated

### Phase D1: Individual-native MVP (Complete)

Scope:

- Email triage and draft workflow templates
- Calendar conflict detection and day-plan recommendation templates
- Notes capture + action/deadline extraction templates
- Chronological task/event timeline templates
- Policy-path tests for allow/deny/timeout on mutation operations
- Contract snapshot evidence for all new capability tools

Exit Criteria:

- Four domain templates runnable in controlled test mode
- Governance-path integration tests pass for all mutating operations
- Retrieval attribution present in sampled outputs and dashboard traces
- Tool contract snapshots updated and validated in release artifacts

### Phase D2: Capability Parity Program (Complete)

Scope:

- Establish two operating profiles with shared capability surface:
  - `PRISM Individual` (capability-first profile)
  - `PRISM Business` (governance-first profile)
- Add terminal virtualization subsystem:
  - persistent terminal session channels
  - controlled environment injection
  - session lifecycle controls (start/stop/revoke/timeout)
- Add container orchestration adapter:
  - sandbox lifecycle (create/start/stop/destroy)
  - snapshot/revert support
  - resource quotas and guardrails
- Add dynamic tool staging pipeline:
  - transient tool generation in sandbox
  - contract extraction and risk classification
  - controlled registration via policy route
- Add adapter/plugin pack framework:
  - manifest schema and compatibility checks
  - signed trust metadata for business profile install path
- Extend governance policy matrix for shell/container/plugin actions.

Exit Criteria:

- Capability parity features available in both profiles.
- Business profile policy-path tests pass for allow/deny/timeout/revoke.
- Event lineage and reason-code telemetry validated for high-risk operations.
- Profile-specific SLO qualification evidence attached.
- Traceability matrix links parity claims to tests and artifacts.

### Phase D3: Agent Control & Intelligent Orchestration (Complete)

Scope:

- Agent lifecycle management with three tiers (ephemeral, semi-permanent, permanent)
- Per-agent model assignment with dynamic runtime switching
- Intelligent agent telemetry with dispatch pattern detection and promotion recommendations
- Swarm coordinator with four topologies (mesh, star, pipeline, broadcast)
- Chat-to-agent routing (classifier-first intent detection, majority of tasks through agents)
- Workspace persistence reliability fix (error surfacing, write-then-verify, env var precedence)
- Dashboard Agent Control tab wiring (replace mock handlers with real lifecycle/telemetry/swarm data)

Exit Criteria:

- Agent lifecycle tests pass for spawn, stop, promote, reap, persist, and restore
- Per-agent model override confirmed via dispatch telemetry
- Swarm execution verified for all four topologies (mesh, star, pipeline, broadcast)
- Telemetry pattern detection operational and producing promotion recommendations
- Chat messages routed through agents by default
- Workspace location change persists across server reboot
- Agent Control dashboard tab fully wired with real data (no mock handlers)

### Phase E: Novel Capability Activation

Scope:

- Constitutional Causal Compiler prototype
- Dual-Lens Memory Arbitration prototype
- Self-Healing Workflow Synthesis prototype

Exit Criteria:

- Controlled experiments show measurable uplift
- Safety constraints remain stable under novelty paths
- Governance coverage extends to all new execution routes

### Phase F: Production Scale and Governance Envelope

Scope:

- Policy bundles across environments
- Compliance/export hardening
- Enterprise reliability and audit operations

Exit Criteria:

- Multi-environment release process proven
- Audit exports and incident postmortems standardized
- Operational SLOs sustained under production traffic

## Phase Gate Checklist Template

For every phase completion, the following must be attached:

1. Test evidence

- Unit, integration, and regression outputs
- Failure-path test evidence

1. Performance evidence

- SLO measurements
- Variance and bottleneck notes

1. Safety evidence

- Governance decision correctness samples
- Approval path and denial path traces
- CAC identity validation evidence (domain enforcement in business, permissive in individual)
- CAC lifecycle transition audit samples (assign, active, suspend, resume, revoke)

1. Documentation evidence

- Updated README, PRD, developer and user guides
- Updated roadmap and release runbook references

1. Release decision

- Go / No-Go recommendation
- Risks and mitigations

1. Individual-native capability evidence (required for Phase D1)

- Domain matrix coverage report (email/calendar/notes/tasks)
- Template-level policy-path traces (allow/deny/timeout)
- Retrieval attribution samples per domain template
- Contract snapshot diff and compatibility notes

1. Capability parity evidence (required for Phase D2)

- Profile parity matrix (`Individual` vs `Business`) with capability equivalence proof
- Terminal/container/plugin governance-path test report (allow/deny/timeout/revoke)
- Performance qualification report for execution modes (`fast`, `balanced`, `governed`)
- Investor/licensing appendix alignment check signed off by product/governance
- Business Security Alignment Gate evidence for computer-use critical pathways (`CU-BG-*` pass status)

1. Agent control & swarm intelligence evidence (required for Phase D3)

- Agent lifecycle test report (spawn/stop/promote/reap/persist/restore)
- Per-agent model assignment verification (override applied on dispatch, telemetry confirms model)
- Swarm orchestration test report (all four topologies: mesh, star, pipeline, broadcast)
- Intelligent telemetry pattern detection samples (dispatch frequency analysis, promotion recommendations)
- Chat-to-agent routing verification (classifier-first intent detection, per-agent dispatch distribution)
- Workspace persistence round-trip evidence (change location, restart, verify persistence)
- Dashboard Agent Control tab wiring verification (real data, no mock handlers)

1. Spectrum Refraction advanced evidence (required for Phase D4)

- SR advanced test report: `tests/spectrum-refraction-advanced.test.ts` — 20/20 passing (zero failures)
- Per-hemisphere timeout and partial-result fallback verification
- Circuit breaker open/reset evidence (consecutive failure threshold, success reset)
- Signed audit trail: four SR activity events emitted per invocation
- Parallel timing verification: elapsed ≈ max(hemispheres)
- Cost estimation shape and expansion-accounting evidence (`SRCostEstimate`)
- Multi-key slot isolation evidence (default slot, named slots, clearApiKey)
- `REQUIREMENTS_TRACEABILITY_MATRIX.md` §9 D4-R1..D4-R10 all `status: pass`
- `docs/D4_COVERAGE_VALIDATION.md` with test listing and CI output

## Phase D4 — Spectrum Refraction Advanced (Completed 2026-04-20)

### D4c Task Breakdown

| Task ID | Description | Status |
| --- | --- | --- |
| D4c-1 | Per-hemisphere independent timeouts with partial-result fallback | complete |
| D4c-2 | Circuit breaker: threshold-based open/close, `circuitBreakerEnabled` bypass | complete |
| D4c-3 | Signed audit trail: `sr.fanout_start`, `sr.fanout_complete`, `sr.generation_complete`, `sr.circuit_breaker_triggered` | complete |
| D4c-4 | Parallel fan-out timing verification (elapsed ≈ max, not sum) | complete |
| D4c-5 | `SRCostEstimate` — per-hemisphere + aggregate cost, 3× output-token expansion for aggregation | complete |
| D4c-6 | Multi-key slot assignment: default slot, named slots, `listSlots`, `clearApiKey`, isolation | complete |
| D4c-7 | 20/20 test coverage in `tests/spectrum-refraction-advanced.test.ts` | complete |

### Phase D4 Go/No-Go Criteria

- All 20 D4c tests passing (`node --test dist/tests/spectrum-refraction-advanced.test.js` → 0 failures)
- `REQUIREMENTS_TRACEABILITY_MATRIX.md` §9 all D4-R1..D4-R10 `pass`
- `docs/D4_COVERAGE_VALIDATION.md` present and current
- No regressions in prior test suites (D2, D3, C1-C5)

## Ownership by Function

- Engineering: implementation and tests
- QA/Validation: reliability and regression evidence
- Operations: runbook readiness and incident workflow
- Product/Governance: release decision and risk acceptance
