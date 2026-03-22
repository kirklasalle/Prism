# PRISM Test Strategy

Date: 2026-03-11

## Objective

Define comprehensive test coverage required to move from development confidence to production confidence.

## Test Layers

### 1) Unit Tests

Coverage:

- Policy decisions and tiering
- Memory retrieval metrics and diagnostics
- Cohort dashboard generation and trend deltas
- Storage adapters and serialization correctness

Required outcomes:

- Deterministic outputs for stable inputs
- No hidden side effects

### 2) Integration Tests

Coverage:

- Orchestrator governance paths
- Approval granted, denied, timeout flows
- Workflow retries/timeouts/fallback transitions
- Memory + telemetry + persistence interaction

Required outcomes:

- Correct end-to-end status propagation
- Expected event lineage and rollback semantics

### 3) Regression Tests

Coverage:

- Previously fixed defects
- High-risk adapter safety behavior
- Known governance edge cases

Required outcomes:

- No reintroduction of historical failures

### 4) Replay and Determinism Tests

Coverage:

- Re-run identical trace inputs
- Verify output parity across runs

Required outcomes:

- Stable replay for audit and postmortem use

Current implementation:

- Replay signature normalization and parity comparison utility in runtime layer
- Deterministic workflow replay test validating stable event-sequence parity
- Mismatch detection test ensuring first-divergence reporting is reliable

### 5) Performance and Load Tests

Coverage:

- Policy latency
- Retrieval latency distributions
- Event delivery throughput
- Approval and persistence contention behavior

Required outcomes:

- SLO thresholds maintained under expected load

Current implementation:

- Qualification harness command: `npm run perf:qualify`
- Measures p50/p95/p99 for policy latency, retrieval latency, and activity delivery
- Computes telemetry overhead as p95 delta vs baseline event bus cost
- Includes approval-pathway contention benchmark with configurable in-flight concurrency
- Reports persistence overhead as advisory gate for staging capacity planning
- Exits non-zero when core SLO gates fail
- Emits JSON artifact (`prism-output/perf-qualification.json`) for release evidence
- CI quality workflow runs tests + qualification and uploads artifact on every push/PR

## Governance-Critical Scenarios (Must Always Pass)

1. High-risk operation approved -> execution proceeds
2. High-risk operation denied -> execution blocked
3. High-risk operation times out -> execution blocked
4. Failure without fallback -> workflow fails
5. Failure with fallback -> workflow recovers and completes

### Governance-critical parity scenarios (Phase D2)

1. Terminal session revoke -> active high-risk command path is blocked and logged
2. Terminal session timeout -> operation is halted with deterministic workflow outcome
3. Container privileged action denied -> sandbox state remains policy-compliant
4. Container snapshot/revert path -> side effects are traceable and replayable
5. Plugin/adaptor pack compatibility mismatch -> install blocked with structured policy reason
6. Plugin/adaptor pack trust failure in Business profile -> enable blocked with audit event

## Adapter Safety Regression Matrix (Phase D)

### System adapter: `shell_exec`

- Empty command rejected with explicit error
- Blocklisted destructive patterns rejected
- Safe command execution succeeds and emits process side effect metadata
- Non-zero command exits return structured failure payloads

### System adapters: filesystem tools

- `file_write` creates parent directories and writes content
- `file_write` append mode preserves existing content and appends deterministically
- `file_read` returns size/content for existing files and fails cleanly for missing files
- `file_list` returns deterministic entry metadata for a directory
- `file_delete` removes target and emits file side effect metadata

### Protocol adapter: `http_request`

- Non-HTTP schemes rejected (`ftp://`, etc.)
- GET JSON response parsed into structured body
- POST body serialization/deserialization round-trip verified
- 4xx/5xx responses surfaced with status and body for policy-level handling

### Evidence artifacts required per matrix run

- Test pass/fail summary by adapter and scenario
- Failure payload samples for rejected/blocked operations
- Side effect metadata snapshots for mutating operations
- Build/commit identifier attached to run output

## Release Test Gates

Minimum for release candidate:

- Unit tests: 100% pass
- Integration tests: 100% pass
- Governance-critical scenarios: 100% pass
- No unresolved blocker defects

Minimum for production promotion:

- Staging burn-in period complete
- Performance tests meet SLO thresholds
- Migration and rollback tests validated

Additional minimum for parity-program promotion (Phase D2):

- Profile-equivalence tests pass for capability availability (`Individual` == `Business` surface)
- Governance-path tests pass for shell/container/plugin operations:
 	- allow,
 	- deny,
 	- timeout,
 	- revoke
- Execution mode qualification report generated for:
 	- `fast`,
 	- `balanced`,
 	- `governed`
- Traceability matrix generated mapping parity claims to tests and artifacts

## Artifact Requirements Per Test Run

Every formal candidate run must produce:

- Test summary report
- Failure trace logs
- Coverage summary (where applicable)
- Environment metadata
- Commit/build identifier

Parity-program artifact additions:

- Profile parity matrix artifact (`Individual` vs `Business` capability equivalence)
- Governance reason-code samples for shell/container/plugin high-risk operations
- Session lineage replay samples for terminal and container lifecycle events
- Plugin/adaptor pack compatibility and trust-check evidence

## Short-Term Additions (Remaining)

1. Contention scenario expansion for mixed approve/deny/timeout profiles by environment
2. CI publication of profile-differentiated performance trend history
3. Baseline-to-candidate contract diff policy for automated release blocking
