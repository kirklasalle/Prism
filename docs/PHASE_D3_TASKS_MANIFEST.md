# Phase D3 Tasks Manifest

**Project**: PRISM Phase D3 Agent Control & Intelligent Orchestration  
**Start Date**: 2026-03-25  
**Completed Date**: 2026-04-20  
**Status**: COMPLETE

---

## Task Board Summary

| Workstream | Primary Owner | Status | Blocker? | Due Date | Artifacts |
|-----------|---------------|--------|----------|----------|-----------|
| **A: Agent Lifecycle Management** | Engineering | **Complete** | — | 2026-04-20 | Lifecycle manager, 3-tier persistence, test reports |
| **B: Swarm Orchestration** | Engineering | **Complete** | — | 2026-04-20 | Swarm coordinator, 4 topologies, test reports |
| **C: Agent Telemetry & Intelligence** | Engineering | **Complete** | — | 2026-04-20 | Telemetry collector, pattern detection, promotion recommendations |
| **D: Chat-to-Agent Routing** | Engineering | **Complete** | — | 2026-04-20 | Agent router, intent classification, agent pool |
| **E: Guardian Agent & Task Decomposition** | Engineering | **Complete** | — | 2026-04-20 | Guardian agent, task decomposer, task catalog |
| **F: Dashboard Wiring & API Routes** | Engineering/QA | **Complete** | — | 2026-04-20 | API endpoints, dashboard tab, integration tests |

---

## Workstream Details

### A: Agent Lifecycle Management (5 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| A1 | Implement 3-tier agent lifecycle (ephemeral, semi-permanent, permanent) | Engineering | `complete` | 2026-03-31 | 2026-04-07 |
| A2 | Implement spawn/stop/promote/demote lifecycle operations | Engineering | `complete` | 2026-03-31 | 2026-04-07 |
| A3 | Implement idle-reap for ephemeral agents | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| A4 | Implement serialize/restore for persistent agents | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| A5 | Fix workspace persistence (error surfacing, write-then-verify, env var precedence) | Engineering | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Phase C foundations (activity bus, policy engine) operational  
**Exit Criteria**: Agent lifecycle tests pass for spawn, stop, promote, reap, persist, and restore  
**Deliverables**:

- `src/core/agents/agent-lifecycle.ts` — `AgentLifecycleManager` with 3-tier lifecycle
- `src/core/agents/agent-types.ts` — Shared interfaces (`AgentInstance`, `AgentLifecycleTier`, etc.)
- `tests/agent-lifecycle.test.ts` — 19+ test cases (spawn, stop, promote, demote, reap, serialize/restore)

---

### B: Swarm Orchestration (4 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| B1 | Implement SwarmCoordinator with mesh topology | Engineering | `complete` | 2026-04-01 | 2026-04-07 |
| B2 | Add star topology (coordinator delegates to workers) | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| B3 | Add pipeline topology (sequential handoff) | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| B4 | Add broadcast topology (same prompt, best result selected) | Engineering | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Agent lifecycle (Workstream A) operational, agent pool populated  
**Exit Criteria**: Swarm execution verified for all four topologies (mesh, star, pipeline, broadcast)  
**Deliverables**:

- `src/core/agents/swarm-coordinator.ts` — `SwarmCoordinator` with 4 topologies
- `tests/swarm-coordinator.test.ts` — All 4 topologies + single-agent fallback

---

### C: Agent Telemetry & Intelligence (4 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| C1 | Implement per-agent dispatch telemetry with summary stats | Engineering | `complete` | 2026-04-01 | 2026-04-07 |
| C2 | Add frequency histograms over 1h/1d/7d windows | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| C3 | Implement lifecycle promotion recommendations based on usage patterns | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| C4 | Add per-agent model performance tracking and p95 duration metrics | Engineering | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Agent lifecycle (Workstream A) operational  
**Exit Criteria**: Telemetry pattern detection operational, producing actionable promotion recommendations  
**Deliverables**:

- `src/core/agents/agent-telemetry-collector.ts` — `AgentTelemetryCollector` with dispatch metrics, frequency, recommendations
- `tests/agent-telemetry.test.ts` — 10+ test cases (summary stats, p95, histograms, recommendations, memory bounds)

---

### D: Chat-to-Agent Routing (3 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| D1 | Implement AgentPool with 16 default agents across task roles | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| D2 | Implement AgentRouter with LLM-based intent classification | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| D3 | Wire per-agent model override with dispatch-time routing | Engineering | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Agent lifecycle (Workstream A) and telemetry (Workstream C) operational  
**Exit Criteria**: Chat messages routed through agents by default, per-agent model override confirmed via dispatch telemetry  
**Deliverables**:

- `src/core/agents/agent-pool.ts` — `AgentPool` with 16 role-based agents
- `src/core/agents/agent-router.ts` — `AgentRouter` with confidence threshold (0.6)
- `tests/agent-pool.test.ts` — Pool registration, role lookup, dispatch hooks
- `tests/agent-router.test.ts` — Intent classification, routing dispatch, confidence fallback

---

### E: Guardian Agent & Task Decomposition (3 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| E1 | Implement GuardianAgent (permanent autonomous system agent) | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| E2 | Build task catalog (maintenance, security, diagnostics) | Engineering | `complete` | 2026-04-07 | 2026-04-14 |
| E3 | Implement TaskDecomposer for multi-step goal breakdown | Engineering | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: Agent lifecycle and pool (Workstreams A, D) operational  
**Exit Criteria**: Guardian agent running with task catalog, task decomposition operational  
**Deliverables**:

- `src/core/agents/guardian-agent.ts` — `GuardianAgent` powered by llama.cpp
- `src/core/agents/task-decomposer.ts` — Task decomposition for complex goals
- `tests/guardian-agent.test.ts` — Guardian lifecycle, task catalog, authority tier
- `tests/task-decomposer.test.ts` — Task decomposition logic tests

---

### F: Dashboard Wiring & API Routes (4 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| F1 | Wire Agent Control tab in dashboard (replace mock handlers) | Engineering | `complete` | 2026-04-14 | 2026-04-20 |
| F2 | Implement /api/agents/*, /api/swarms/*, /api/guardian/* API routes | Engineering | `complete` | 2026-04-14 | 2026-04-20 |
| F3 | Implement /api/hardware/swarm/* and /api/agents/telemetry routes | Engineering | `complete` | 2026-04-14 | 2026-04-20 |
| F4 | Write HTTP integration tests for all agent API endpoints | QA | `complete` | 2026-04-14 | 2026-04-20 |

**Entry Criteria**: All agent subsystems (Workstreams A-E) operational  
**Exit Criteria**: Agent Control dashboard tab fully wired with real data (no mock handlers)  
**Deliverables**:

- `src/core/operator/dashboard-service.ts` — `setAgentControl()` injection, all agent API routes
- `tests/agentic-api-routes.test.ts` — Full HTTP integration tests for agent/swarm/guardian endpoints
- `tests/tab-agentic-ui.test.ts` — Frontend rendering tests for Agent Control tab

---

## Dependencies & Constraints

### Critical Dependency Chain

```
Phase C (Governance + Observability) ✓
        ↓
    A1-A2 → A3-A4 → A5 ✓ (Agent Lifecycle)
        ↓
    B1 → B2-B3 → B4 ✓ (Swarm Orchestration)
    C1 → C2-C3 → C4 ✓ (Telemetry)
        ↓
    D1-D2 → D3 ✓ (Chat Routing)
    E1-E2 → E3 ✓ (Guardian + Decomposition)
        ↓
    F1-F3 → F4 ✓ (Dashboard + API Tests)
```

### Integration Points

- Agent lifecycle integrates with activity bus for event emission (Phase A foundations)
- Swarm coordinator uses agent pool for topology execution (Workstream D)
- Telemetry collector binds to lifecycle and dispatch events (Workstreams A, D)
- Dashboard wiring injects all agent subsystems via `setAgentControl()` (all workstreams)
- Guardian agent uses llama.cpp for local model inference (independent of cloud providers)

---

## Success Criteria

### Exit Criteria (All Met — 2026-04-20)

- [x] Agent lifecycle tests pass for spawn, stop, promote, reap, persist, and restore — 19+ test cases across 3 tiers
- [x] Swarm execution verified for all four topologies (mesh, star, pipeline, broadcast) — plus single-agent fallback
- [x] Telemetry pattern detection operational and producing promotion recommendations — frequency histograms, p95 duration, memory bounds tested
- [x] Per-agent model override confirmed via dispatch telemetry — dynamic runtime switching without restart
- [x] Chat messages routed through agents by default — classifier-first intent detection with confidence threshold
- [x] Workspace location change persists across server reboot — write-then-verify, env var precedence fixed
- [x] Agent Control dashboard tab fully wired with real data (no mock handlers) — all API routes return live lifecycle/telemetry/swarm data

### Test Evidence Summary

| Test File | Tests | Pass | Coverage |
|-----------|-------|------|----------|
| `tests/agent-lifecycle.test.ts` | 19+ | 19+ | Spawn, stop, promote, demote, reap, serialize/restore |
| `tests/swarm-coordinator.test.ts` | 5+ | 5+ | Mesh, star, pipeline, broadcast, single-agent fallback |
| `tests/agent-telemetry.test.ts` | 10+ | 10+ | Summary stats, p95, histograms, recommendations, memory bounds |
| `tests/agent-pool.test.ts` | 4+ | 4+ | Registration, role lookup, dispatch hooks |
| `tests/agent-router.test.ts` | 4+ | 4+ | Intent classification, routing, confidence fallback |
| `tests/guardian-agent.test.ts` | 3+ | 3+ | Guardian lifecycle, task catalog, authority tier |
| `tests/task-decomposer.test.ts` | 3+ | 3+ | Task decomposition logic |
| `tests/agentic-api-routes.test.ts` | 28+ | 28+ | HTTP integration for agents/swarms/guardian endpoints |
| `tests/tab-agentic-ui.test.ts` | 4+ | 4+ | Agent Control tab rendering |

---

**Last Updated**: 2026-04-20  
**Next Review**: N/A (Phase D3 COMPLETE)
