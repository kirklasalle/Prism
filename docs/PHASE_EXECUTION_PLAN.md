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

### Phase C: Reliability and Observability (Active)

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

### Phase D: Production Qualification (Next)

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

### Phase D1: Individual-native MVP (Parallel Track)

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

### Phase D2: Capability Parity Program (Parallel Track)

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

### Phase D3: Agent Control & Intelligent Orchestration

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

1. Agent control & swarm intelligence evidence (required for Phase D3)

- Agent lifecycle test report (spawn/stop/promote/reap/persist/restore)
- Per-agent model assignment verification (override applied on dispatch, telemetry confirms model)
- Swarm orchestration test report (all four topologies: mesh, star, pipeline, broadcast)
- Intelligent telemetry pattern detection samples (dispatch frequency analysis, promotion recommendations)
- Chat-to-agent routing verification (classifier-first intent detection, per-agent dispatch distribution)
- Workspace persistence round-trip evidence (change location, restart, verify persistence)
- Dashboard Agent Control tab wiring verification (real data, no mock handlers)

## Ownership by Function

- Engineering: implementation and tests
- QA/Validation: reliability and regression evidence
- Operations: runbook readiness and incident workflow
- Product/Governance: release decision and risk acceptance
