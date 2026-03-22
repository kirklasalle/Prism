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

## 7. Dashboard & UI Architecture

### 7.1 Overview

The PRISM operator dashboard is served at `http://localhost:7070` by the `DashboardService` class in `src/core/operator/dashboard-service.ts`. This is a monolithic inline implementation: all HTML templates, CSS styles, and client-side JavaScript render functions are embedded within a single TypeScript file. The dashboard uses no frontend framework — it renders via string template literals, direct DOM manipulation, and a centralized client-side state object.

### 7.2 File structure

All dashboard UI code lives in one file:

- `src/core/operator/dashboard-service.ts`

Key regions within the file:

| Region | Purpose |
| --- | --- |
| CSS block (~line 3200–3450) | All dashboard styles including collapsible panel classes, tab styles, card patterns |
| Tab navigation HTML (~line 3461) | Tab button elements with ARIA attributes |
| HTML template body (~line 3470–3590) | Static HTML structure for all tabs and panels |
| State object (~line 3600–3630) | Client-side state: active tab, collapse flags, data arrays, notices |
| `tabs` array (~line 3628) | Registered tab definitions (`id`, `label`) |
| Render functions (~line 4600–5800) | Individual `render*()` functions for each panel |
| `render()` dispatcher (~line 5740) | Master render that calls all `safeRenderStep()` dispatches |
| API route handlers (~line 1–3200) | Express routes for 38+ HTTP API endpoints |

### 7.3 Tab system

Tabs are registered in the `tabs` array and rendered by `renderTabs()`. Each tab uses ARIA `role="tab"` and `aria-selected` attributes for accessibility compliance.

Current tabs:

```
{ id: 'chat', label: 'Chat Interface' }
{ id: 'provider', label: 'Provider & Settings' }
{ id: 'tools', label: 'Tools & Plugins' }
{ id: 'telemetry', label: 'Telemetry' }
{ id: 'logs', label: 'Logs & Debug' }
```

The `setActiveTab(tabId)` function updates `state.activeTab`, toggles CSS visibility on `tab-content-*` containers, and persists the selection within the session.

### 7.4 Collapsible panel pattern

All dashboard panels use a generic collapsible pattern:

1. **State flags**: Each panel has a boolean flag in the state object (e.g., `sessionProviderCollapsed`, `toolsPanelCollapsed`).
2. **HTML structure**: Each panel header is wrapped in a `.collapsible-header` div with a `.collapse-chevron` span. The panel body uses a `.collapsible-body` class.
3. **Toggle function**: `togglePanelCollapse(panelKey)` flips `state[panelKey + 'Collapsed']`, toggles the CSS `collapsed` class on the body element, and updates the chevron indicator (`▼` = expanded, `▶` = collapsed).

To add a new collapsible panel:

1. Add a `yourPanelCollapsed: false` entry to the state object.
2. Add HTML with `.collapsible-header` and `.collapsible-body` classes, wiring `onclick` to `togglePanelCollapse('yourPanel')`.
3. Write a `renderYourPanel()` function targeting the panel's container `id`.
4. Register `safeRenderStep('yourPanel', renderYourPanel)` in the `render()` dispatcher.

### 7.5 Render pipeline

The `render()` function is the master dispatch. It calls `safeRenderStep(name, fn)` for each registered panel render function. `safeRenderStep` wraps each call in a try/catch so a single panel failure cannot crash the entire dashboard.

Current render steps (in order):

1. `tabs` — tab navigation bar
2. `status` — runtime status indicators
3. `approvals` — pending approval queue
4. `events` — activity event stream
5. `actions` — dashboard action cards
6. `chat` — chat interface
7. `sessionProvider` — session provider assignment
8. `providerConfig` — provider configuration cards
9. `capabilityMatrix` — model capability matrix
10. `llmAudit` — LLM audit trail
11. `settingsPanel` — runtime settings display
12. `toolsPanel` — built-in tools inventory
13. `pluginsPanel` — MCP plugin inventory
14. `utilitiesPanel` — system utilities inventory
15. `retrievalPanel` — retrieval observability
16. `telemetry` — telemetry metrics

### 7.6 Panel inventories

**Tools Panel** — 19 built-in tools across 4 categories:

- System (7): file_read, file_write, file_delete, file_list, shell_exec, terminal_session, container_sandbox
- Application (5): email_ops, calendar_plan, notes_extract, tasks_timeline (+ adjacents)
- Knowledge (3): neo4j_query, memory_query, semantic_query
- Integration (4): http_request, nexus_check_hotline, nexus_read_memory, nexus_log_insight, nexus_broadcast

**Plugins Panel** — 7 MCP server plugins across 2 sources:

- In-Repo (2): ids-mcp, web-search-mcp
- ImpressionCore Suite (5): impressioncore-eds, impressioncore-ipa, impressioncore-goliath, impressioncore-vrgc, impressioncore-dpa

**Utilities Panel** — 30 utilities across 6 categories:

- Benchmarks & Qualification (11), Operator Services (5), Memory & Retrieval (5), Activity & Audit (3), Replay & Verification (3), Configuration (3)

### 7.7 API surface

The dashboard exposes 38+ HTTP API routes. Key route groups:

| Group | Example routes | Purpose |
| --- | --- | --- |
| LLM Provider | `/api/llm/providers`, `/api/llm/select`, `/api/llm/provider-settings`, `/api/llm/provider-secret` | Provider configuration, model selection, secure key storage |
| Activity | `/api/events`, `/api/events/stream` | Event querying and SSE streaming |
| Approval | `/api/approval/pending`, `/api/approval/approve/:id`, `/api/approval/deny/:id` | Approval queue management |
| Retrieval | `/api/retrieval/cohorts`, `/api/retrieval/alerts`, `/api/retrieval/trends` | Retrieval quality observability |
| Dashboard | `/api/dashboard/actions`, `/api/dashboard/status` | Action triggers, runtime status |
| Session | `/api/chat/sessions`, `/api/chat/messages` | Chat session and message management |

### 7.8 WebSocket

The dashboard uses a WebSocket connection for real-time event streaming. The client connects on page load and receives push updates for new activity events, approval state changes, and provider switch notifications without polling.

## 8. Safety and Governance Standards

### 8.1 Tier definitions

- Tier 1: low-risk autonomous
- Tier 2: medium-risk conditional
- Tier 3: high-risk approval-gated

### 8.2 Mandatory controls

- Denial path must be executable and tested.
- Timeout path must be executable and tested.
- State mutation without rollback plan should be policy-restricted.

### 8.3 Dual-profile operating contract

PRISM supports two operating profiles with a shared capability surface:

- `PRISM Individual`: capability-first defaults for tooling, terminal workflows, virtualization, and containerized execution.
- `PRISM Business`: same capability surface, with mandatory tiered governance, approval controls, and auditable lineage.

Profile invariants:

- Business must never have fewer functional capabilities than Individual.
- Every high-risk capability must have explicit tier mapping and governance-path tests.
- Every mutating operation must emit replayable event lineage.

### 8.4 Capability parity standards

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

## 9. Test Strategy

### 9.1 Required suites

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

### 9.2 Denial/Timeout test intent

Denied and timed-out approvals validate that:

- gated high-risk actions do not execute,
- workflows either fail correctly or recover via explicit fallback,
- governance events remain complete for audit.

### 9.3 Parity subsystem test obligations

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

## 10. Observability and Telemetry

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

## 11. Performance Targets

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

## 12. Development Workflow

1. Edit targeted component.
2. Run `npm run build`.
3. Run `npm test`.
4. Verify approval-path tests in workflow suite.
5. Update docs if behavior changed.

## 13. Near-Term Build Priorities

1. Adapter safety regression suite
2. Retrieval quality proxy metrics
3. Deterministic replay mode
4. Policy bundle versioning
5. Operator cockpit APIs
6. Terminal virtualization subsystem
7. Container orchestration adapter
8. Dynamic tool staging pipeline
9. Signed adapter pack framework

## 14. Mid-Term Novel System Tracks

1. Constitutional Causal Compiler
2. Dual-Lens Memory Arbitration
3. Self-Healing Workflow Synthesis

## 15. Research-to-Implementation Mapping

- ReAct -> environment-grounded action loops
- Toolformer -> stronger tool invocation contracts
- Controller-worker pattern -> orchestrator + specialized adapters
- NIST AI RMF -> measurable governance lifecycle
- MCP ecosystem -> extensible tool/data connection layer

## 16. References

1. <https://www.anthropic.com/engineering/building-effective-agents>
2. <https://arxiv.org/abs/2210.03629>
3. <https://arxiv.org/abs/2302.04761>
4. <https://arxiv.org/abs/2303.17580>
5. <https://modelcontextprotocol.io/introduction>
6. <https://www.nist.gov/itl/ai-risk-management-framework>
