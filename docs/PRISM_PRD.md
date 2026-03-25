# PRISM Product Requirements Document (PRD)

Date: 2026-03-11  
Status: Phase C Active  
Product: PRISM (Original SOTA Development by Kirk LaSalle, 03/16/2026)

## 1. Executive Summary

PRISM is being developed as a world-class autonomous agent runtime that combines:

- hard governance controls,
- memory-aware decisioning,
- robust workflow execution,
- and explicit human authority boundaries.
- native cross-integration for Agents As A Service (AaaS), bridging machine operations with human calendar and project management for sustainable mutual growth.

The strategic objective is to move from a strong governed runtime to a **SOTA and novel agent platform** that can safely operate in open-ended, high-value computer use tasks.

This PRD integrates:

1. observed state from this repository,
2. applied agentic-system research guidance,
3. a concrete implementation plan for next-generation capabilities.

Companion reference:

- `PRISM_RESEARCH_DOCUMENTATION.md` (full-context research source and evidence mapping).
- `REQUIREMENTS_TRACEABILITY_MATRIX.md` (parity requirement-to-test-to-artifact mapping for Phase D2).

## 2. Product Thesis

Most agent systems fail in production not because they lack model capability, but because they lack:

- control-plane rigor,
- failure-path design,
- tool interface precision,
- and measurable trust guarantees.

PRISMâ€™s thesis is that **governed autonomy + causal observability + adaptive execution** yields superior real-world reliability and unlocks safe scaling.

## 3. Problem Statement

Users need an agent that can:

- execute real operations across files, shell, HTTP, and databases,
- make autonomous progress on multi-step tasks,
- escalate correctly for high-risk actions,
- recover from failures and denials,
- and provide full post-hoc auditability.

Current market offerings often optimize for demo fluency over operational trust.
PRISM targets operational trust as a first-class design goal.

## 4. Agentic Landscape Findings

### 4.1 Core architectural finding

From industry production guidance, successful systems use simple composable patterns first, then add autonomy when measurable value justifies complexity.

Implication for PRISM:

- preserve deterministic workflows as baseline,
- selectively enable autonomous orchestration with bounded controls.

### 4.2 Reasoning + acting loop requirement

ReAct demonstrates that interleaving reasoning and environment interaction improves task quality and interpretability.

Implication for PRISM:

- ensure every action step is grounded in tool outcomes and policy state,
- avoid free-running text-only planning without environment feedback.

### 4.3 Tooling as capability multiplier

Toolformer and practical agent deployments show that explicit tool invocation materially improves quality on tasks where external computation or lookup is required.

Implication for PRISM:

- invest in high-clarity tool schemas and robust error contracts,
- track tool-level quality and misuse patterns.

### 4.4 Controller-worker decomposition

Controller-worker style orchestration (e.g., HuggingGPT family patterns) scales capability breadth across domains.

Implication for PRISM:

- maintain a central orchestrator with specialized adapters,
- add domain workers progressively while preserving governance coherence.

### 4.5 Governance as platform requirement

NIST AI RMF emphasizes trustworthiness through lifecycle risk management.

Implication for PRISM:

- map governance policies to measurable operational controls,
- enforce reviewable risk boundaries rather than informal safety promises.

## 5. Product Goals

### 5.1 Primary goals

1. Achieve safe high-autonomy execution for complex tasks.
2. Maintain full operation traceability and replayability.
3. Provide deterministic governance under risk and uncertainty.
4. Continuously improve performance through measurable eval loops.
5. Introduce novel technical mechanisms that improve reliability and adaptability.
6. Enforce identity accountability: every agent action is attributable to a character, a Prism user, and an operator.

### 5.2 Non-goals (current horizon)

- Unbounded self-modification without policy gate
- Opaque proprietary control paths that cannot be audited
- Pure benchmark optimization detached from operator usability

## 6. Existing Baseline (Repository-Aligned)

Implemented today:

- activity bus and hashed event stream
- three-tier policy engine
- approval queue + HTTP service
- adapters across system/protocol/application
- SQLite activity/session persistence
- memory query tools (`semantic_query`, `memory_query`)
- workflow retries/timeouts/fallbacks
- integration tests for approval success, denial, and timeout paths
- **Character Accountability Control (CAC)**:
  - character-to-operator identity binding with full accountability chain
  - lifecycle management (assign, dispatch, suspend, resume, revoke)
  - profile-aware email domain validation (business enforces matching domains; individual is permissive)
  - execution profile segment normalization (`enterprise`/`corporate` → canonical `business`)
  - accountability chain propagated into activity events and SHA-256 integrity hashes

## 7. Novelty Roadmap (PRISM-specific)

### 7.1 Novel Capability A: Constitutional Causal Compiler (CCC)

Definition:
A pre-execution compiler that transforms intent + policy + memory + environment context into a constrained executable plan graph.

Expected value:

- reduces unsafe branching,
- improves explainability,
- formalizes policy conformance before execution starts.

### 7.2 Novel Capability B: Dual-Lens Memory Arbitration (DLMA)

Definition:
A retrieval system combining:

- semantic relevance lens,
- causal consequence lens (impact/rollback-sensitive),
then arbitration based on confidence and risk profile.

Expected value:

- better decision context for high-stakes operations,
- fewer semantically relevant but operationally unsafe recommendations.

### 7.3 Novel Capability C: Self-Healing Workflow Synthesis (SHWS)

Definition:
When a workflow fails, generate candidate repair plans, evaluate under policy and quality constraints, then stage safe promotion.

Expected value:

- decreases manual intervention frequency,
- improves recovery speed,
- builds adaptive capability with control.

## 8. Functional Requirements

### 8.1 Governance and authority

- Every operation must be classified by risk and mutability.
- Tier-3 operations require explicit approval or deterministic timeout behavior.
- Denial and timeout must be testable and observable states.

Acceptance criteria:

- policy decision events emitted for all operations,
- denial and timeout states represented in workflow outcomes.

### 8.2 Workflow execution

- Workflows support retries, timeout, and conditional fallback.
- Recovery branches can succeed overall workflow when policy-compliant.
- Non-recoverable failure paths terminate with failed workflow status.

Acceptance criteria:

- integration tests cover success, failure, retry, timeout, approval granted, approval denied, approval timeout.

### 8.3 Memory and retrieval

- Unified retrieval API supports episodic/session/semantic modes.
- Retrieval telemetry includes latency and quality proxies.
- Retrieval outputs must be attributable to source events.

Acceptance criteria:

- p95 retrieval latency tracked,
- quality proxy metrics recorded per query cohort,
- growth and drift diagnostics generated from rolling windows with alert outputs,
- cohort dashboards generated with per-cohort latency/utility/hit-rate and alerting,
- cohort dashboard snapshots persisted for export and historical audit,
- trend and baseline-comparison deltas generated across cohort snapshot history,
- alert thresholds configurable via centralized retrieval policy.

### 8.4 Observability and audit

- Activity events are immutable-hash recorded.
- Full operation lineage is queryable by session.
- Incident reconstruction is possible from persisted traces.

Acceptance criteria:

- sampled sessions fully reconstructable end-to-end.

### 8.4A Character Accountability Control (CAC)

Every agent action must be linked to an immutable identity chain comprising a character, a Prism user, an operator, and a client/session context. This identity chain is propagated into activity events and included in SHA-256 integrity hashes.

Required identity fields:

- `characterId`: the character brief assigned to the agent.
- `prismUserId` / `prismUserEmail`: the Prism platform user under which the agent operates.
- `operatorId` / `operatorEmail`: the human operator responsible for the session.
- `clientId` / `sessionId`: the client application and session context.
- `executionProfileSegment`: the resolved profile segment (`individual` or `business`).

Lifecycle states:

- **assigned**: character bound to operator/session; ready for dispatch.
- **active**: at least one dispatch has occurred.
- **suspended**: temporarily paused (with reason code); no further dispatches until resumed.
- **revoked**: permanently terminated; no resume possible.

Profile-aware email validation:

- **Business profile**: operator and Prism user email domains must match (configurable allowed-domains list). Mismatched domains are rejected at assignment time.
- **Individual profile**: no domain constraints; any valid email address is accepted.
- **Alias normalization**: `enterprise` and `corporate` profile inputs resolve to the canonical `business` segment.

Acceptance criteria:

- accountability chain present on all activity events emitted during governed operations,
- lifecycle transitions (assign, dispatch, suspend, resume, revoke) each emit auditable activity events,
- business-profile domain mismatch is rejected with structured error before assignment completes,
- individual-profile allows mixed-domain assignments without constraint,
- `enterprise` and `corporate` inputs resolve to `business` segment in all code paths,
- query APIs support filtering by characterId, operatorEmail, prismUserEmail, and executionProfileSegment.

### 8.5 Individual-native MVP capabilities (Phase 1)

The first productization track implements native individual productivity capabilities over existing governance/runtime foundations.

Scope domains:

- email triage and draft workflows,
- calendar and daily-plan workflows,
- notes capture and structured extraction,
- chronological tasks/events planning.

Functional requirements:

1. Email triage + draft

- Support read/classify/summarize/draft operations with explicit send gate.
- Require source attribution in summaries and draft rationale.
- Enforce send operation as mutating action under tier2/tier3 policy.

1. Calendar planning

- Support availability lookup, conflict detection, and recommendation generation.
- Require explicit policy path for event creation/update.
- Persist conflict and recommendation traces for operator review.
- **Implemented**: Scheduler tab with full-year calendar (year/month/week/day views), category-coded events, project management, Kanban board, and Gantt timeline. SchedulerEngine provides cron-based recurring schedules with ActivityBus audit trail.

1. Notes and extraction

- Support capture of unstructured note content and extraction of:
  - action items,
  - deadlines,
  - follow-up entities.
- Require extracted outputs to link back to originating note context.

1. Chronological tasks/events

- Support timeline generation from tasks + constraints.
- Support reorder/replan with explicit change deltas.
- Emit drift alerts when schedule changes exceed threshold.

Tooling requirements:

- New capability tools must ship with versioned tool contracts.
- Contracts must define required args, mutation semantics, and rollback hints.
- Contract snapshot diffs are required in release evidence.

Workflow requirements:

- Each capability must expose at least one workflow template with:
  - retries,
  - timeout policy,
  - fallback branch.
- Each mutation-capable workflow must define deterministic deny/timeout outcomes.

Memory requirements:

- Email/calendar workflows must use session + semantic retrieval modes.
- Notes/task workflows must expose attributable retrieval references in outputs.
- Retrieval cohort metrics for these domains must be dashboard-visible.

Acceptance criteria:

- four domain templates available and runnable in controlled test mode,
- policy-path tests pass for allow/deny/timeout on mutating operations,
- contract snapshots updated and passing regression checks,
- retrieval attribution present in sampled workflow outputs.

### 8.6 Capability parity program requirements (Phase D2)

PRISM must deliver capability parity with top-tier agent classes while preserving profile-specific operational behavior.

### 8.7 Operator Dashboard and UI Requirements

The PRISM dashboard (`http://localhost:7070`) serves as the primary operator interface for runtime inspection, governance control, and system administration. The following requirements govern its behavior and content.

#### 8.7.1 Tab-based navigation

The dashboard must provide a tab-based navigation system with the following tabs, each accessible via a single click:

| Tab | Purpose |
| --- | --- |
| Chat Interface | Real-time conversational interface with session-scoped LLM provider binding |
| Provider & Settings | LLM provider configuration, model capability matrix, runtime settings, and audit trail |
| Tools & Plugins | Inventory of built-in tools, registered MCP plugins, and system utilities |
| Network | Curated network command execution with tier-based governance, live interface viewer, telemetry, and interactive console |
| Telemetry | Runtime telemetry, retrieval observability, and performance metrics |
| Logs & Debug | Activity event stream, error inspection, and debug-level trace output |

Acceptance criteria:

- All tabs render without JavaScript errors.
- Tab state persists within a session (active tab survives data refreshes).
- ARIA-compliant tab navigation for accessibility.

#### 8.7.2 Collapsible panel system

All dashboard panels within each tab must support collapsible headers with visual chevron indicators (`▼`/`▶`). Collapse/expand state must be persisted in the client-side state object and survive render cycles within a session.

Acceptance criteria:

- Each panel renders with a clickable header.
- Clicking the header toggles body visibility.
- Chevron indicator reflects current state.
- State is preserved across data refreshes within the same session.

#### 8.7.3 Provider & Settings tab panels

The Provider & Settings tab must contain the following panels, in order:

1. **Session Provider Assignment** — Current LLM provider/model binding for the active chat session with Apply controls.
2. **Provider Configuration** — Per-provider settings (base URL, models, API key presence) for OpenAI, Anthropic, Ollama, and Custom providers.
3. **Model Capability Matrix** — Feature/model comparison grid showing context window, vision, function calling, and streaming capabilities per configured model.
4. **Settings** — Runtime system configuration: uptime, event count, server status, PRISM version, platform, runtime readiness, active provider, and active model.
5. **LLM Audit Trail** — Session-scoped provider switch audit with success/failure counts and recent transition history. Supports Export JSON, Copy JSON, and Export CSV.

#### 8.7.4 Tools & Plugins tab panels

The Tools & Plugins tab must contain three panels:

1. **Tools** — Complete inventory of all registered built-in tools organized by category (System, Application, Knowledge, Integration). Each tool entry displays name, description, risk level (low/medium/high with color coding), and mutation status (read-only/mutating).

2. **Plugins** — Complete inventory of all registered MCP plugins organized by source group (In-Repo, ImpressionCore Suite). Each plugin entry displays name, server type (Python MCP Server), description, and status (Active).

3. **Utilities** — Complete inventory of system utilities organized by category (Benchmarks & Qualification, Operator Services, Memory & Retrieval, Activity & Audit, Replay & Verification, Configuration). Each utility entry displays name and description.

Acceptance criteria:

- Tools panel displays all 19 built-in tools with risk and mutation badges.
- Plugins panel displays all 7 MCP server plugins with type and status badges.
- Utilities panel displays all 30 registered utilities across 6 categories.
- All panels support collapsible headers.

#### 8.7.5 Network tab panels

The Network tab must contain four panels:

1. **Network Tools** — Curated catalog of ~50 network commands organized by security tier (Tier 1: read-only diagnostics, Tier 2: config inspection, Tier 3: mutating operations). Each command entry displays name, description, tier badge (green/amber/red), and platform badge (WIN/LINUX/CROSS).

2. **Network Settings** — Live network interface data viewer. Users can refresh to query system interfaces and display adapter details (IP address, MAC, DHCP, DNS, gateway).

3. **Network Telemetry** — Network operation metrics: total commands executed, per-tier counts, error count, and most recent command.

4. **Network Console** — Interactive command console for executing network commands in real time. Only commands from the curated allowlist are permitted; blocked patterns are rejected.

Acceptance criteria:

- Network Tools panel displays all curated commands with tier and platform badges.
- Network Settings panel queries and displays live interface data on user request.
- Network Telemetry panel updates counters after each command execution.
- Network Console accepts commands, validates against allowlist, and displays structured output.
- All panels support collapsible headers.
- NetworkTool adapter enforces curated allowlist with blocked pattern safety.
- Three API endpoints operational: `GET /api/network/interfaces`, `POST /api/network/exec`, `GET /api/network/telemetry`.

#### 8.7.6 Dashboard API surface

The dashboard must expose a minimum set of HTTP API routes for programmatic access:

- Provider management: configuration, secrets, selection, and audit
- Activity event querying by session and operation type
- Retrieval observability: cohorts, alerts, and trends
- Approval queue management: list, approve, deny
- Dashboard actions: trigger and status
- Session management: list, create, delete

All API endpoints must validate input parameters and return structured JSON responses.

Functional requirements:

1. Dual-profile parity contract

- `PRISM Individual` and `PRISM Business` must expose equivalent capability surfaces for:
  - tool invocation,
  - terminal session operations,
  - container sandbox lifecycle,
  - dynamic staged tool execution,
  - adapter/plugin pack usage.
- Business profile adds governance rigor and must not reduce capability availability.

1. Terminal virtualization

- Support persistent terminal channels with lifecycle controls:
  - start,
  - stop,
  - timeout,
  - revoke.
- Persist session lineage and policy decisions for mutating commands.

1. Container orchestration

- Support sandbox create/start/stop/destroy and snapshot/revert operations.
- Enforce resource and network guardrails via policy-controlled runtime metadata.

1. Dynamic staged tools

- Candidate dynamic tools must be generated only inside isolated sandbox execution context.
- Tool contract extraction and risk classification are required before controlled registration.

1. Adapter/plugin packs

- Pack manifests must include compatibility metadata and capability scopes.
- Business profile requires trust/provenance validation before install/enable.

Acceptance criteria:

- profile-equivalence tests confirm equal capability availability in both profiles,
- governance-path tests pass for allow/deny/timeout/revoke across shell/container/plugin operations,
- high-risk operations emit reason-coded policy decisions and replayable lineage,
- execution mode qualification results documented for `fast`, `balanced`, and `governed`.

## 9. Quality Gates (SLO/SLA Targets)

### 8.8 Agent Control & Swarm Orchestration Requirements (Phase D3)

PRISM must deliver a fully wired agent control system where the majority of tasks are dispatched through managed agents with intelligent lifecycle tracking and multi-agent swarm capabilities.

#### 8.8.1 Agent lifecycle management

- Support three lifecycle tiers: ephemeral (spawned per-task, auto-reaped after idle timeout), semi-permanent (survives across tasks, reaped after extended idle), permanent (persists until manually stopped).
- Agents must persist across server restarts: permanent and semi-permanent agents serialized to workspace `state/agent-registry.json` and restored on boot.
- Idle reaper runs on configurable interval (default 60s) to garbage-collect expired ephemeral and semi-permanent agents.
- All lifecycle transitions (spawn, stop, promote, reap) must emit ActivityBus events on the `agent` layer.

Acceptance criteria:

- spawn/stop/promote operations functional via dashboard and API,
- permanent agents survive server restart,
- idle reaper correctly garbage-collects expired agents.

#### 8.8.2 Per-agent model assignment

- Each agent instance supports an optional model override (`providerId` + `model`).
- Override precedence: agent-specific override > role-based routing override > automatic tier selection.
- Model assignments are dynamically changeable at runtime without agent restart.
- Model override changes emit audit events to ActivityBus.

Acceptance criteria:

- per-agent model override applied on next dispatch,
- clearing override reverts to role-based auto-selection,
- dashboard shows current model assignment per agent.

#### 8.8.3 Intelligent agent telemetry

- Per-agent metrics: tasks completed/failed, average response time, model usage history, error patterns, role distribution.
- Global metrics: total dispatches, active agent count, role hotspots (dispatches per role with avg latency and best model).
- Pattern detection: track dispatch frequency per role over 1h/1d/7d sliding windows.
- Promotion recommendations: if a role dispatches above threshold consistently, recommend promoting its agent from ephemeral to semi-permanent; if semi-permanent alive >7d, recommend permanent.
- Model performance tracking: if model X is consistently faster/better for role Y, recommend override.

Acceptance criteria:

- telemetry summary available via API and dashboard,
- pattern insights surface after sustained dispatch activity,
- promotion recommendations appear with one-click action in dashboard.

#### 8.8.4 Swarm orchestration

- Support four swarm topologies:
  - **Mesh**: all agents work sub-tasks in parallel, results merged.
  - **Star**: coordinator agent delegates to worker agents, collects/merges results.
  - **Pipeline**: sequential handoff — output of agent A becomes input of agent B.
  - **Broadcast**: same prompt to all agents, best result selected.
- Swarm creation specifies goal, topology, agent count, and optional role distribution.
- Swarm agents default to ephemeral lifecycle; dissolved when swarm completes.
- All swarm operations emit ActivityBus events for governance and telemetry.

Acceptance criteria:

- swarms creatable via dashboard and API,
- all four topologies execute correctly,
- swarm dissolution stops all member agents and collects results.

#### 8.8.5 Chat-to-agent routing

- The majority of chat tasks must be dispatched through specialized agents rather than direct LLM calls.
- Classification-first routing: a fast classifier agent (T1/T2 model) determines intent before routing.
- Routing targets: code requests → coder agent, summaries → summarizer, complex multi-step → TaskDecomposer → ephemeral swarm, memory/search → indexer, general → chat.
- Fallback to direct LLM if agent dispatch fails.

Acceptance criteria:

- chat messages routed through agents by default,
- telemetry shows per-agent dispatch distribution,
- complex tasks decomposed and executed via multi-agent plans.

#### 8.8.6 Workspace persistence reliability

- Workspace location changes must persist reliably across server reboots.
- Write failures must be surfaced to the operator (not silently swallowed).
- Write-then-verify: after persisting preferences, immediately read back to confirm.
- Environment variable override must not silently override newer user preferences.

Acceptance criteria:

- workspace change → restart → new location loads,
- write failure produces visible error in dashboard,
- preferences file verified after write.

## 9-continued. Quality Gates (SLO/SLA Targets)

| Domain | Metric | Target |
| --- | --- | --- |
| Workflow reliability | Success on approved paths | >= 99.0% |
| Governance latency | Policy decision p95 | <= 30ms |
| Eventing | Activity delivery p95 | <= 200ms |
| Telemetry overhead | Instrumentation p95 | <= 20ms |
| Retrieval | Query latency p95 | <= 50ms (hot memory) |
| Persistence | SQLite write latency p95 | <= 100ms |
| Approval flow | Operator response path p99 | <= 5s (excluding human delay) |

Parity-program gate requirements:

- profile parity matrix must be complete and validated,
- business governance-path pass rate must remain 100% for high-risk parity operations,
- investor and licensing appendix claims must map to implemented and tested capabilities.
- requirements traceability matrix must be completed for all D2 requirement IDs.

## 10. Evaluation Strategy

### 10.1 Evaluation dimensions

- correctness
- safety
- recoverability
- explainability
- operator burden
- cost/latency efficiency

### 10.2 Evaluation types

1. Unit tests for policy, memory, and adapters.
2. Integration tests for workflow/governance edge cases.
3. Scenario tests with seeded failure modes.
4. Replay tests for deterministic reconstruction.
5. Regression tests for known incident patterns.

### 10.3 Release gates

No promotion to next maturity ring unless:

- governance regression suite is green,
- denial/timeout paths remain stable,
- telemetry completeness is above threshold,
- rollback confidence remains above defined floor.

## 11. Phased Plan

### Phase C (current)

- complete adapter and governance test hardening
- complete documentation and operational guides
- expand retrieval quality instrumentation

### Phase D

- production-grade workflow planner and policy-aware task routing
- evaluator-optimizer loop for plan quality
- deterministic replay and comparative run analysis

### Phase D1 (parallel execution track): Individual-native MVP

- implement email triage/draft workflow templates
- implement calendar conflict + day-plan templates
- implement notes capture + extraction templates
- implement chronological tasks/events planning templates
- add policy-path coverage for mutation operations in all templates
- add release evidence bundle for contracts, traces, and retrieval attribution

### Phase D2 (parallel execution track): Capability parity program

- implement dual-profile capability parity contract
- implement terminal virtualization and lifecycle controls
- implement container orchestration adapter and sandbox lifecycle controls
- implement dynamic staged tool path with contract extraction and tier routing
- implement adapter/plugin pack manifest compatibility and trust policy behavior
- implement governance-path and profile-equivalence test coverage

### Phase D3 (parallel execution track): Agent Control & Swarm Intelligence

- implement agent lifecycle management (ephemeral/semi-permanent/permanent tiers)
- implement per-agent model assignment with dynamic runtime switching
- implement intelligent agent telemetry with pattern detection and promotion recommendations
- implement swarm coordinator with four topologies (mesh/star/pipeline/broadcast)
- implement chat-to-agent routing (classifier-first, majority of tasks through agents)
- implement workspace persistence reliability fix
- wire Agent Control dashboard tab with real data (replace mock handlers)

### Phase E (novel systems activation)

- implement CCC (Constitutional Causal Compiler)
- implement DLMA (Dual-Lens Memory Arbitration)
- implement SHWS (Self-Healing Workflow Synthesis)

### Phase F

- enterprise governance envelope,
- compliance-ready audit exports,
- multi-environment policy bundles.

## 12. Risks and Mitigations

1. **Compounding autonomous errors**
   - Mitigation: bounded loops, hard stops, fallback paths, operator checkpoints.

2. **Tool misuse and schema drift**
   - Mitigation: contract tests, schema linting, tool ABI versioning.

3. **Opaque decisioning**
   - Mitigation: mandatory causal events and policy reason logging.

4. **Quality regressions during rapid iteration**
   - Mitigation: canary eval sets + mandatory denial/timeout path tests.

5. **Over-complex architecture creep**
   - Mitigation: complexity budget and measurable uplift requirements before adding components.

## 13. Documentation and Operator Readiness Requirements

Required artifacts:

- README (strategy + architecture + references)
- PRD (this file)
- Developer Guide (implementation standards and test strategy)
- User Guide (operator workflows, approvals, troubleshooting)

All release candidates must keep documentation synchronized with runtime behavior.

## 14. References

1. Anthropic Engineering, Building effective agents (2024): <https://www.anthropic.com/engineering/building-effective-agents>
2. ReAct paper, arXiv:2210.03629: <https://arxiv.org/abs/2210.03629>
3. Toolformer paper, arXiv:2302.04761: <https://arxiv.org/abs/2302.04761>
4. HuggingGPT paper, arXiv:2303.17580: <https://arxiv.org/abs/2303.17580>
5. Model Context Protocol introduction: <https://modelcontextprotocol.io/introduction>
6. NIST AI Risk Management Framework: <https://www.nist.gov/itl/ai-risk-management-framework>
