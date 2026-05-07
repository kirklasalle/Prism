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

### Governance-critical computer-use Business scenarios (Phase C/D2)

1. Browser high-risk action in Business profile -> approval pathway enforced and audit trail emitted
2. Terminal destructive operation in Business profile -> allow/deny/timeout/revoke behavior deterministic
3. Container privileged operation in Business profile -> policy decision enforced, outcome auditable
4. Cross-tool orchestration (browser + terminal + container) -> no bypass of tier boundaries
5. Sensitive action requiring confirmation -> explicit human confirmation checkpoint enforced
6. Prompt-injection stress scenario -> risk handling path invoked and logged

### Governance-critical agent control scenarios (Phase D3)

1. Agent spawn with model override -> dispatch uses assigned model, telemetry confirms
2. Agent promote ephemeral -> semi-permanent -> state persists across tasks within session
3. Agent promote to permanent -> state persists across server restarts
4. Agent demote permanent -> semi-permanent -> no longer restored on reboot
5. Idle ephemeral agent -> reaped after configured timeout
6. Per-agent model reassignment -> next dispatch uses new model immediately
7. Swarm mesh topology -> all agents receive messages, results aggregated
8. Swarm star topology -> coordinator dispatches to workers, collects results
9. Swarm pipeline topology -> sequential handoff completes in order
10. Swarm broadcast topology -> single message dispatched to all, results merged
11. Swarm timeout -> running swarm stopped, partial results returned with failure status
12. Chat-to-agent routing -> classifier determines intent, correct agent dispatched
13. Telemetry promotion recommendation -> ephemeral agent exceeding threshold flagged

### Governance-critical Spectrum Refraction (SR) scenarios (Phase D4)

1. SR configure with identical Left/Right model+provider -> rejected with isolation error
2. SR configure with same provider, different models -> accepted with `model` isolation level
3. SR configure with different providers -> accepted with `full` isolation level
4. SR activate with insufficient isolation -> rejected at activation gate
5. SR activate with valid isolation -> SR mode enabled, status reflects active state
6. SR deactivate -> SR mode disabled, fallback to single-model generation
7. SR generateSR() pre-flight with insufficient isolation -> generation blocked before fan-out
8. SR fan-out timing -> Left and Right generate concurrently (total ≈ max, not sum)
9. SR aggregation -> Main receives both hemisphere outputs with XML tags, produces synthesis
10. SR model capability validation -> unqualified Left/Right model produces advisory, blocks configuration
11. SR media artifact extraction -> Creative hemisphere media outputs extracted and typed
12. SR isolation badge in UI -> reflects real-time isolation level (🔒/🔏/⛔)
13. SR chat rendering -> SR-generated messages display isolation level pill and attribution

### Governance-critical CAC identity scenarios (Phase C)

1. Individual profile assignment with mixed-domain emails -> accepted without constraint
2. Business profile assignment with matching domains -> accepted
3. Business profile assignment with mismatched domains -> rejected with structured error
4. Business profile assignment with allowed-domains list -> only listed domains accepted
5. Enterprise/corporate profile input -> resolved to business segment and business rules applied
6. Character lifecycle: assign -> dispatch -> suspend (with reason) -> resume -> dispatch succeeds
7. Character lifecycle: assign -> revoke -> resume attempt throws error
8. Activity events emitted with full accountability chain on every lifecycle transition
9. Accountability chain fields included in SHA-256 event integrity hash
10. Query by characterId/operatorEmail/prismUserEmail/executionProfileSegment returns correct results
11. Invalid email format rejected at assignment time regardless of profile

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
- Business Security Alignment Gate checks pass for computer-use critical pathways

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

Additional minimum for agent control promotion (Phase D3):

- Agent lifecycle tests pass (spawn/stop/promote/demote/reap/persist/restore)
- Per-agent model assignment verified (override applied, telemetry confirms model)
- Swarm orchestration tests pass for all four topologies (mesh/star/pipeline/broadcast)
- Chat-to-agent routing tests pass (classifier-first intent detection)
- Agent telemetry pattern detection samples generated
- Dashboard Agent Control tab verified (real data, no mock handlers)

Additional minimum for Spectrum Refraction (SR) promotion (Phase D4):

- SR isolation enforcement tests pass (identical Left/Right rejected at configure, activate, and runtime)
- SR fan-out verified (concurrent generation, timing within expected bounds)
- SR aggregation quality verified (XML-tagged sections present, synthesis not concatenation)
- SR model capability validation tests pass (unqualified models produce advisory)
- SR API endpoints functional (status/configure/activate/deactivate return correct state)
- SR dashboard panel verified (isolation badge, model selection, cost advisory)
- SR chat rendering verified (isolation level pill, hemisphere attribution)

## Business Security Alignment Gate Test Checklist

The following checklist is required for enterprise-ready computer-use claims:

- Governance-tier pathways validated (`tier1`/`tier2`/`tier3`) for computer-use operations
- CAC accountability fields present in governed computer-use event samples
- Sensitive-action confirmation behavior verified in Business profile scenarios
- Cross-tool orchestration coverage includes failure and revoke pathways
- External benchmark statements in release evidence marked `vendor-reported` unless internally reproduced

Minimum for CAC identity validation (Phase C):

- CAC lifecycle tests pass for assign, dispatch, suspend, resume, revoke
- Business profile email domain validation enforced (matching domains required)
- Individual profile accepts mixed-domain emails without constraint
- Enterprise/corporate alias normalization resolves to business segment
- Accountability chain present on all governed activity events
- SHA-256 hash includes accountability fields

CAC artifact additions:

- Lifecycle state transition audit samples (per test run)
- Domain validation accept/reject evidence (business vs individual)
- Query filter result samples by identity field

## Short-Term Additions (Remaining)

1. Contention scenario expansion for mixed approve/deny/timeout profiles by environment
2. CI publication of profile-differentiated performance trend history
3. Baseline-to-candidate contract diff policy for automated release blocking
4. SR integration test suite: isolation enforcement, fan-out timing, aggregation quality, API endpoint coverage

## Security Test Layer

The following security-focused test scenarios are required for release readiness. These validate the 5-layer security stack documented in `DEVELOPER_GUIDE.md` Section 7C.

### Authentication tests

- Unauthenticated request to any protected endpoint returns `401 Unauthorized`.
- Invalid token returns `401` (not `403`).
- `timingSafeEqual` is used for token comparison (no early-exit on mismatch).
- Public routes (`/`, `/favicon.ico`, setup pages) return successfully without a token.
- WebSocket upgrade without `?token=` is rejected before connection establishment.

### Session guard tests

- API request without an active session returns `400` (session required).
- `assertSessionExists()` is called on all 12 guarded store methods.
- Readiness gate reports `session-selected: false` when no session exists.
- Individual profile auto-creates a session on boot; Business profile does not.

### Rate limiting tests

- Exceeding 200 requests in a 60-second window returns `429 Too Many Requests`.
- `Retry-After` header is present on 429 responses.
- `X-Forwarded-For` is trusted only from loopback addresses.
- Stale counter cleanup occurs after 5-minute interval.

### Cross-session isolation tests

- Messages from session A are not visible in session B queries.
- SR configuration saved in session A does not leak to session B.
- Activity events are queryable by session ID with correct filtering.

### Approval timeout tests

- Tier-3 approval request auto-denies after 120-second timeout.
- Timeout denial is emitted as an activity event.
- Approved and denied decisions resolve the promise correctly.

### Directive integrity tests

- `verifyDirectiveIntegrity()` passes with unmodified PAD file.
- Modified PAD file triggers integrity failure.
- `DIRECTIVE_SHA256` constant matches the actual PAD hash.

### Tool contract governance tests

- Tool registration with missing contract fields is rejected.
- Governance normalizer auto-promotes under-reported risk levels.
- Contract violation during execution is caught and denied.

### Phase D4c — Spectrum Refraction Advanced Test Scenarios

These 20 test cases cover the advanced SR engine capabilities introduced in Phase D4c. All tests live in `tests/spectrum-refraction-advanced.test.ts` and run via `node --test`.

**Per-hemisphere timeout & partial result (2 tests)**

- Returns partial result when left hemisphere times out (right succeeds).
- Returns partial result when right hemisphere times out (left succeeds).

**Circuit breaker (4 tests)**

- Circuit opens after configured consecutive failure threshold.
- Circuit resets to closed state after a successful call.
- `getSRCircuitBreakerState()` returns `open: false` for un-tripped circuits.
- `circuitBreakerEnabled: false` disables tracking entirely (all failures allowed through).

**Signed audit trail / activity events (4 tests)**

- `sr.fanout_start` event emitted before fan-out begins.
- `sr.fanout_complete` event emitted after parallel generation finishes.
- `sr.generation_complete` event emitted with timing data after aggregation.
- `sr.circuit_breaker_triggered` event emitted when an open circuit blocks a hemisphere.

**Parallel timing (1 test)**

- Total elapsed time ≈ max(hemispheres), not sum — verifying true parallelism.

**Cost estimation (3 tests)**

- `SRCostEstimate` returned with correct shape (inputTokens, outputTokens, costUsd per hemisphere + aggregate).
- `totalEstimatedCostUsd ≥ sum` of constituent parts.
- Aggregation cost accounts for expanded input (3× output tokens added to aggregate input).

**Multi-key slot assignment (6 tests)**

- Sets and gets API key for default slot.
- Sets and gets API key for named slot.
- Default and named slots are independent (setting one does not affect the other).
- `listSlots()` returns only named slot names (not the default slot).
- `clearApiKey()` removes only the specified slot.
- Returns `null` for unknown provider+slot combination.

**Coverage gate:** all 20 tests must pass (0 failures) before any Phase D4 release decision.
