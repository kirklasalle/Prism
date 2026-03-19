# PRISM Developer Guide

Date: 2026-03-11

## 1. Purpose

This guide explains how to build, extend, and validate PRISM as a cutting-edge, policy-governed agent runtime.

Research baseline:

- `PRISM_RESEARCH_DOCUMENTATION.md` (full-context architecture and evidence rationale).

Design principle:

- Human/AI Mutual Growth (AaaS integration respecting human calendar and project realities).

- maximum capability under explicit control.

## 2. Engineering Principles

1. **Governance first**
   - Tool execution is never detached from policy evaluation.

2. **Observable by default**
   - If behavior is not captured as an event, it is considered invisible and unsafe.

3. **Recoverability over optimism**
   - Every mutating operation should include rollback semantics.

4. **Simple baseline, measured complexity growth**
   - Add orchestration complexity only with demonstrated evaluation gain.

5. **Test failure paths as first-class behavior**
   - Approval denied and timeout are expected operational states, not edge afterthoughts.

## 3. Repository Layout

- `src/core/activity`: event types, bus, subscribers, persistence
- `src/core/policy`: authority tiering and decision logic
- `src/core/runtime`: orchestrator and workflow execution
- `src/core/approval`: approval queue/service
- `src/core/memory`: episodic/session/semantic retrieval and metrics
- `src/adapters/*`: system/protocol/application tool implementations
- `tests`: unit and integration tests

## 4. Runtime Control Flow (Authoritative)

1. Request enters orchestrator.
2. Policy engine classifies risk and action constraints.
3. Governance decision emitted (`allow`, `deny`, `require_approval`).
4. If approval required, request is queued and awaited.
5. Tool executes (or is blocked).
6. Outcome and side effects emitted to activity stream.
7. Subscribers update storage/memory indexes.

Workflow mode adds:

- retries,
- per-step timeout,
- conditional fallback transitions.

## 5. Workflow Semantics

### 5.1 Outcomes

Each step resolves to one of:

- `succeeded`
- `failed`
- `timed_out`

### 5.2 Routing

Fallback conditions:

- `always`
- `on_failure`
- `on_timeout`

### 5.3 Completion rules

- Workflow is `succeeded` if terminal path completes and unrecovered failure does not occur.
- Workflow is `failed` if a non-success outcome has no valid continuation path.

## 6. Tool Interface Design (ACI discipline)

Treat tool contracts as Agent-Computer Interface surfaces.

Required properties:

- clear operation name,
- strict argument shape,
- explicit mutability and risk metadata,
- deterministic error classes,
- side effect description,
- rollback guidance where relevant.

Recommended practices:

- avoid ambiguous parameter names,
- include edge-case semantics in tool description,
- enforce safe defaults in adapter implementation.

## 7. Safety and Governance Standards

### 7.1 Tier definitions

- Tier 1: low-risk autonomous
- Tier 2: medium-risk conditional
- Tier 3: high-risk approval-gated

### 7.2 Mandatory controls

- Denial path must be executable and tested.
- Timeout path must be executable and tested.
- State mutation without rollback plan should be policy-restricted.

### 7.3 Dual-profile operating contract

PRISM supports two operating profiles with a shared capability surface:

- `PRISM Individual`: capability-first defaults for tooling, terminal workflows, virtualization, and containerized execution.
- `PRISM Business`: same capability surface, with mandatory tiered governance, approval controls, and auditable lineage.

Profile invariants:

- Business must never have fewer functional capabilities than Individual.
- Every high-risk capability must have explicit tier mapping and governance-path tests.
- Every mutating operation must emit replayable event lineage.

### 7.4 Capability parity standards

All new parity subsystems must be designed profile-first:

1. Terminal virtualization
   - persistent session channels
   - explicit lifecycle controls (`start`, `stop`, `revoke`, `timeout`)
   - environment injection policy metadata

2. Container orchestration
   - sandbox lifecycle controls (`create`, `start`, `stop`, `destroy`)
   - snapshot/revert semantics
   - resource quotas and network/filesystem guardrails

3. Dynamic tool staging
   - transient tool generation only in isolated sandbox context
   - required contract extraction before registration
   - risk classification and tier routing before execution

4. Adapter/plugin packs
   - manifest schema with version pinning and compatibility metadata
   - capability scope declarations
   - trust/provenance metadata (signed-required for business profile installs)

## 8. Test Strategy

### 8.1 Required suites

1. Unit tests
   - policy decisions,
   - memory query behavior,
   - adapter contract behavior.

2. Integration tests
   - workflow success/retry/timeout/fallback,
   - approval granted/denied/timeout,
   - orchestration end-to-end event trace.

3. Regression tests
   - preserve behavior of previously fixed incidents.

### 8.2 Denial/Timeout test intent

Denied and timed-out approvals validate that:

- gated high-risk actions do not execute,
- workflows either fail correctly or recover via explicit fallback,
- governance events remain complete for audit.

### 8.3 Parity subsystem test obligations

Required for terminal/container/plugin parity work:

1. Governance-path tests
   - `allow`, `deny`, `timeout`, and `revoke` for each high-risk operation class.

2. Profile-equivalence tests
   - verify capability availability is equivalent between Individual and Business profiles.
   - verify Business adds governance rigor without reducing capability surface.

3. Session lifecycle tests
   - long-running terminal/container sessions with expiry and forced revocation.

4. Contract compatibility tests
   - plugin manifest compatibility checks and policy response behavior on mismatch.

5. Replay and lineage tests
   - every mutating shell/container/plugin action must appear in replay artifacts.

## 9. Observability and Telemetry

Capture at minimum:

- policy decision latency,
- tool execution duration,
- retrieval latency distributions,
- workflow branch transitions,
- approval queue lifecycle (requested/granted/denied/timed out).

Retrieval observability requirements:

- persist cohort dashboard snapshots to SQLite for historical audit,
- compute baseline-comparison deltas across snapshot history,
- emit alerts for utility drops, hit-rate drops, and p95 latency spikes.
- tune sensitivity via centralized retrieval alert policy thresholds.

## 10. Performance Targets

- policy decision p95 <= 30ms
- retrieval p95 <= 50ms (hot memory path)
- event propagation p95 <= 200ms
- telemetry overhead p95 <= 20ms

Execution mode guidance:

- `fast`: low-risk operations with minimal non-critical checks.
- `balanced`: default development and individual profile mode.
- `governed`: full-check mode and required default for business profile high-risk paths.

Profile-level SLO policy:

- Individual may optimize for responsiveness within approved low-risk boundaries.
- Business must satisfy governance and auditability SLOs before latency optimization.

## 11. Development Workflow

1. Edit targeted component.
2. Run `npm run build`.
3. Run `npm test`.
4. Verify approval-path tests in workflow suite.
5. Update docs if behavior changed.

## 12. Near-Term Build Priorities

1. Adapter safety regression suite
2. Retrieval quality proxy metrics
3. Deterministic replay mode
4. Policy bundle versioning
5. Operator cockpit APIs
6. Terminal virtualization subsystem
7. Container orchestration adapter
8. Dynamic tool staging pipeline
9. Signed adapter pack framework

## 13. Mid-Term Novel System Tracks

1. Constitutional Causal Compiler
2. Dual-Lens Memory Arbitration
3. Self-Healing Workflow Synthesis

## 14. Research-to-Implementation Mapping

- ReAct -> environment-grounded action loops
- Toolformer -> stronger tool invocation contracts
- Controller-worker pattern -> orchestrator + specialized adapters
- NIST AI RMF -> measurable governance lifecycle
- MCP ecosystem -> extensible tool/data connection layer

## 15. References

1. <https://www.anthropic.com/engineering/building-effective-agents>
2. <https://arxiv.org/abs/2210.03629>
3. <https://arxiv.org/abs/2302.04761>
4. <https://arxiv.org/abs/2303.17580>
5. <https://modelcontextprotocol.io/introduction>
6. <https://www.nist.gov/itl/ai-risk-management-framework>
