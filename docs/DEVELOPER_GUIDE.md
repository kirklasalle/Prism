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
- `src/core/accountability`: character accountability store & manager (CAC identity chain, lifecycle, profile-aware email validation)
- `src/core/runtime`: orchestrator and workflow execution
- `src/core/approval`: approval queue/service
- `src/core/memory`: episodic/session/semantic retrieval and metrics
- `src/core/config`: workspace resolver, execution profiles, environment config
- `src/core/agents`: agent pool, agent lifecycle, agent types, agent router, swarm coordinator, telemetry collector
- `src/core/operator`: dashboard service, LLM provider manager, agentic executor, model capability matrix (incl. SR validation), chat session store (incl. SR config)
- `src/adapters/*`: system/protocol/application/network tool implementations
- `tests`: unit and integration tests

### 3.1 Workspace Resolution

All runtime data (databases, artifacts, config) is stored outside the source tree in a persistent workspace directory resolved by `src/core/config/workspace-resolver.ts`.

**Default locations:**

| Platform | Path                                        |
|----------|---------------------------------------------|
| Windows  | `%USERPROFILE%\Documents\Prism_Refraction` |
| macOS    | `~/Documents/Prism_Refraction`              |
| Linux    | `$XDG_DATA_HOME/Prism_Refraction`           |

Set `PRISM_WORKSPACE_ROOT` to override.

**Key exports:**

| Function | Purpose |
|----------|---------|
| `resolveWorkspaceRoot()` | Returns the absolute workspace path (cached) |
| `workspacePath(...segments)` | Join helper for workspace-relative paths |
| `workspaceDbPath()` | SQLite database path |
| `workspaceArtifactsDir()` | Benchmarks, releases, contracts directory |
| `workspaceDataDir()` | Application tool data (tasks/notes/email/calendar) |
| `workspaceConfigDir()` | MCP settings, runtime config |
| `workspaceCharactersDir()` | Agent character brief definitions |
| `ensureWorkspaceStructure(profile)` | Creates all subdirs + writes manifest |
| `detectLegacyPaths()` | Returns list of CWD-relative legacy paths for migration notices |

All per-artifact env var overrides (`PRISM_DATA_DIR`, `PRISM_PERF_OUTPUT_PATH`, `PRISM_MCP_SETTINGS`, etc.) still take precedence over workspace defaults.

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
{ id: 'agentic', label: 'Agentic Control' }
{ id: 'computer', label: 'Computer Control' }
{ id: 'browser', label: 'Browser Control' }
{ id: 'workspace', label: 'Workspace' }
{ id: 'network', label: 'Network' }
{ id: 'telemetry', label: 'Telemetry' }
{ id: 'logs', label: 'Logs & Debug' }
{ id: 'scheduler', label: 'Scheduler' }
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

The dashboard exposes 38+ HTTP API routes. Every route (except public routes listed in Section 7C.3) requires authentication via the Auth Gate and is scoped to the active session context.

Key route groups:

| Group | Example routes | Auth | Session | Purpose |
| --- | --- | --- | --- | --- |
| LLM Provider | `/api/llm/providers`, `/api/llm/select`, `/api/llm/provider-settings`, `/api/llm/provider-secret` | Required | Required | Provider configuration, model selection, secure key storage |
| Activity | `/api/events`, `/api/events/stream` | Required | Required | Event querying and SSE streaming |
| Approval | `/api/approval/pending`, `/api/approval/approve/:id`, `/api/approval/deny/:id` | Required | Required | Approval queue management |
| Retrieval | `/api/retrieval/cohorts`, `/api/retrieval/alerts`, `/api/retrieval/trends` | Required | Required | Retrieval quality observability |
| Dashboard | `/api/dashboard/actions`, `/api/dashboard/status` | Required | Optional | Action triggers, runtime status |
| Session | `/api/chat/sessions`, `/api/chat/messages` | Required | Required | Chat session and message management |
| SR | `/api/sr/status`, `/api/sr/configure`, `/api/sr/activate`, `/api/sr/presets` | Required | Required | Spectrum Refraction configuration and presets |
| Setup | `/api/setup/status`, `/api/setup/profile`, `/api/setup/complete` | Required | Not required | First-run setup wizard endpoints |
| Agents | `/api/agents`, `/api/agents/launch`, `/api/swarms/create` | Required | Required | Agent lifecycle and swarm management |

### 7.8 WebSocket

The dashboard uses a WebSocket connection for real-time event streaming. The client connects on page load and receives push updates for new activity events, approval state changes, and provider switch notifications without polling.

**Authentication:** WebSocket connections authenticate via `?token=<value>` query parameter on the upgrade URL, since browsers cannot set custom `Authorization` headers on WebSocket handshakes. The Auth Gate validates this token using the same `timingSafeEqual` check as HTTP requests. Unauthenticated upgrade requests are rejected with a `401` response before the connection is established.

**Session scoping:** Once authenticated, WebSocket messages are scoped to the operator's active session. Session changes (create, switch, delete) trigger a re-evaluation of the readiness state, and the updated snapshot is pushed to connected clients.

**Event types pushed via WebSocket:**

| Event | Trigger |
| --- | --- |
| `activity` | New activity event emitted by ActivityBus |
| `approval` | Approval request created, resolved, or timed out |
| `provider` | Provider configuration or model selection changed |
| `readiness` | Readiness gate status changed |
| `sr` | SR activation/deactivation or configuration change |

## 7A. Agent Lifecycle & Swarm Architecture

### 7A.1 Agent lifecycle

## Appendix: Computer Use Core Implementation Alignment (2026-03-25)

Computer use is a first-class engineering surface in PRISM and must be implemented with enterprise-governed behavior by default.

Canonical architecture reference:

- `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md`

Mandatory developer controls:

1. Preserve tiered governance for browser/terminal/container operations.
2. Preserve CAC accountability fields in governed computer-use event narratives.
3. Preserve Business profile safeguards: sandboxing, least privilege, and sensitive-action confirmation checkpoints.
4. Preserve claim discipline: no security/reliability assertion without first-party artifact linkage.

Implementation anti-drift rule:

- Any PR that expands computer-use capability must update test strategy, traceability, and runbook evidence references before release candidate promotion.

Agents in PRISM have three lifecycle states:

- **Ephemeral**: spawned for a single task, automatically reaped after completion or idle timeout.
- **Semi-permanent**: promoted from ephemeral based on dispatch frequency or operator action. Survives across tasks within a session but not across server restarts.
- **Permanent**: persisted to workspace and restored on boot. The 6 built-in agents (classifier, chat, summarizer, planner, coder, indexer) are permanent by default.

Lifecycle transitions: `spawn()` → ephemeral, `promote()` → semi-permanent or permanent, `demote()` → lower tier, `stop()` → removed, `reap()` → idle cleanup.

Key module: `src/core/agents/agent-lifecycle.ts` (`AgentLifecycleManager`)

### 7A.2 Per-agent model assignment

Every agent can be assigned a specific LLM provider and model via `setAgentModelOverride(agentId, provider, model)` on the `LlmProviderManager`. When `AgentPool.dispatch()` is called, it passes the `agentId` to `generateForRole()`, which checks `agentOverrides[agentId]` before falling back to role-based or automatic selection.

Models can be switched dynamically at any time. The model capability matrix validates that the assigned model meets the minimum tier requirement for the agent's `TaskRole`.

Key module: `src/core/operator/llm-provider-manager.ts` (agentOverrides in RoutingConfig)

### 7A.3 Chat-to-agent routing

Chat messages are routed through agents rather than going directly to an LLM provider. The flow:

1. User message enters `generateAssistantReply()`
2. `AgentRouter.classify()` sends the message to the classifier agent to determine intent
3. Based on classification, the router selects the appropriate agent (chat, coder, summarizer, etc.)
4. `AgentPool.dispatch()` executes with the selected agent and its model assignment
5. If the task is complex, `TaskDecomposer` breaks it into sub-agent steps executed in parallel batches

Key module: `src/core/agents/agent-router.ts` (`AgentRouter`)

### 7A.4 Swarm orchestration

Swarms coordinate multiple agents toward a shared goal. Four topologies are supported:

| Topology | Pattern | Use Case |
| --- | --- | --- |
| mesh | All-to-all peer communication | Collaborative brainstorming, consensus |
| star | Coordinator → N workers | Divide-and-conquer, map-reduce |
| pipeline | Sequential handoff A → B → C | Multi-stage processing, refinement chains |
| broadcast | One message → all agents, aggregate | Parallel evaluation, voting |

Swarm lifecycle: `create` → `start` → running (with step tracking) → `complete` or `failed`. Each swarm has a timeout budget and per-step governance via the policy engine.

Key module: `src/core/agents/swarm-coordinator.ts` (`SwarmCoordinator`)

### 7A.5 Intelligent telemetry

The `AgentTelemetryCollector` captures per-dispatch metrics and derives operational intelligence:

- Dispatch frequency histograms per agent/role
- Latency distributions (p50/p95/p99) per agent and model
- Token usage tracking per dispatch
- Promotion recommendations for ephemeral agents exceeding dispatch thresholds
- Efficiency pattern detection (bottlenecks, underutilized agents)

Telemetry is emitted to the ActivityBus on the `"agent"` layer and persisted for historical analysis.

Key module: `src/core/agents/agent-telemetry-collector.ts` (`AgentTelemetryCollector`)

### 7A.6 API routes (Agent Control)

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/agents` | GET | List all agents with lifecycle state, model assignment, and telemetry summary |
| `/api/agents/launch` | POST | Spawn a new agent instance with role, model override, and lifecycle tier |
| `/api/agents/stop` | POST | Stop an agent by ID |
| `/api/agents/:id/model` | POST | Reassign model for an agent |
| `/api/agents/:id/promote` | POST | Promote agent lifecycle tier |
| `/api/agents/:id/demote` | POST | Demote agent lifecycle tier |
| `/api/agents/telemetry` | GET | Retrieve telemetry summary and recommendations |
| `/api/swarms/create` | POST | Create a new swarm with topology, agents, and goal |
| `/api/swarms` | GET | List active swarms with status |
| `/api/swarms/:id/stop` | POST | Stop a running swarm |

## 7D. Spectrum Refraction (SR) Architecture

Spectrum Refraction is PRISM's novel tri-model parallel fan-out orchestration system, conceived by Kirk LaSalle. It refracts a single prompt into three cognitive perspectives (Logic, Creative, Coordination) that generate simultaneously, then fuses their outputs via structured aggregation.

### 7D.1 Core types

| Type | Location | Purpose |
| --- | --- | --- |
| `SRIsolationLevel` | `model-capability-matrix.ts` | `"full" \| "model" \| "insufficient"` — isolation quality classification |
| `SRTriadValidation` | `model-capability-matrix.ts` | Cross-validation result for the entire SR triad (Left + Right + Main) |
| `SRGenerationOutput` | `llm-provider-manager.ts` | Full output of an SR generation pass: content, hemispheres, timing, media artifacts, isolation level |
| `SpectrumRefractionConfig` | `model-capability-matrix.ts` | Per-session SR configuration: Left/Right/Main model+provider assignments |

### 7D.2 Isolation enforcement

Instance isolation is enforced at three mandatory gates:

1. **Configuration gate** (`/api/sr/configure`): `validateSRTriadConfig()` rejects identical Left/Right (same provider + same model).
2. **Activation gate** (`/api/sr/activate`): re-validates before enabling SR mode.
3. **Runtime gate** (`generateSR()` pre-flight): guards before fan-out execution.

Classification:

- `full`: different providers — separate API keys, infrastructure, rate limits (strongest).
- `model`: same provider, different models — separate capabilities, shared key.
- `insufficient`: same provider + same model — **REJECTED** at all gates.

Main is permitted to overlap Left or Right because it serves the distinct coordinator role.

**Model qualification is advisory, not blocking.** The SR UI displays models in two groups ("✓ Qualified" and "Other Available") based on capability validation (`validateSRLeftModel` / `validateSRRightModel`). Operators may select non-qualified models — the configuration will proceed with an advisory notice. Only the isolation invariant (Left ≠ Right) is enforced as a hard gate.

Key function: `validateSRTriad(left, right)` in `model-capability-matrix.ts`

### 7D.3 Generation pipeline

The `generateSR()` method in `LlmProviderManager` executes:

```
1. Pre-flight isolation check (validateSRTriad)
2. Parallel fan-out:
   - Left (Logic) hemisphere: role-specific system prompt + user prompt
   - Right (Creative) hemisphere: role-specific system prompt + user prompt
3. Wait for both (concurrent, timing ≈ max not sum)
4. Structured aggregation:
   - Build XML-tagged prompt: <logic_analysis>...</logic_analysis> + <creative_synthesis>...</creative_synthesis>
   - Main model receives aggregation system prompt + tagged sections
   - Main produces unified compound response
5. Extract media artifacts from Creative hemisphere output
6. Return SRGenerationOutput with hemispheres, timing, media, isolation level
```

Key module: `src/core/operator/llm-provider-manager.ts` (`generateSR()`)

### 7D.4 Model capability validation

| Function | Purpose |
| --- | --- |
| `validateSRLeftModel(profile)` | Validates Left model meets logic-oriented requirements (reasoning, function calling) |
| `validateSRRightModel(profile)` | Validates Right model meets creative-oriented requirements (vision, multimedia) |
| `filterSRLogicModels()` | Returns available models suitable for Left hemisphere |
| `filterSRCreativeModels()` | Returns available models suitable for Right hemisphere |

System prompts are defined in `SR_SYSTEM_PROMPTS` (model-capability-matrix.ts):

- `SR_SYSTEM_PROMPTS.left`: analytical reasoning, structured analysis, factual precision
- `SR_SYSTEM_PROMPTS.right`: creative synthesis, lateral thinking, multimedia generation
- `SR_SYSTEM_PROMPTS.aggregation`: XML-tagged fusion instructions for Main model

### 7D.5 SR API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/sr/status` | GET | Return current SR configuration, active state, and isolation level |
| `/api/sr/configure` | POST | Set Left/Right/Main model assignments with isolation validation |
| `/api/sr/activate` | POST | Enable SR mode for the session (re-validates isolation) |
| `/api/sr/deactivate` | POST | Disable SR mode and revert to single-model generation |
| `/api/sr/catalog` | GET | Return full model catalog with per-model SR qualification status |
| `/api/sr/suggest` | GET | Return suggested Left/Right model pairings based on available providers |
| `/api/sr/presets` | GET | List saved SR configuration presets (global and session-scoped) |
| `/api/sr/presets` | POST | Save a new SR preset (name, scope, Left/Right model assignments) |
| `/api/sr/presets/:id` | DELETE | Delete a saved SR preset by ID |
| `/api/sr/presets/:id/load` | POST | Load a saved preset into the active SR configuration |

All routes are implemented in `dashboard-service.ts` with isolation enforcement integrated. All routes require authentication and an active session (see Section 7C).

### 7D.6 Frontend integration

| File | Component |
| --- | --- |
| `tab-settings.js` | SR panel with `.tp-toggle` activation switch, provider/model dropdowns (`<optgroup>` sections: "✓ Qualified" + "Other Available"), presets dropdown with save-as/delete flow, "✨ Suggested Models" button |
| `tab-chat.js` | SR response badge: visual indicator + isolation level pill + hemisphere attribution |
| `dashboard-core.js` | State fields: `srIsolationLevel`, `srIsolationAdvisory` |
| `dashboard-app.js` | SR function exports to `window` scope |

**Key frontend functions (`tab-settings.js`):**

| Function | Purpose |
| --- | --- |
| `renderSRPanel()` | Main SR panel renderer with toggle, dropdowns, presets |
| `buildSRProviderDropdown(side)` | Build provider `<select>` for Left or Right hemisphere |
| `buildSRModelDropdown(side, providerId)` | Build model `<select>` with qualification optgroups |
| `refreshSRPresets()` | Fetch and re-render the presets dropdown |
| `refreshSRCatalog()` | Fetch full model catalog from `/api/sr/catalog` |
| `onSRPresetSelected(presetId)` | Load selected preset into active configuration |
| `promptSaveSRPreset()` | Show inline preset naming UI |
| `confirmSaveSRPreset()` | Save current configuration as a named preset |
| `deleteSRPreset(presetId)` | Delete a preset after confirmation |
| `suggestSRModels()` | Fetch and apply suggested model pairings |

### 7D.7 Data persistence

SR configuration is stored per chat session in the `sr_config` SQLite table managed by `ChatSessionStore`:

| Method | Purpose |
| --- | --- |
| `getSRConfig(sessionId)` | Retrieve SR configuration for a session |
| `saveSRConfig(sessionId, config)` | Persist SR configuration |
| `deleteSRConfig(sessionId)` | Remove SR configuration (on deactivate) |

SR presets are stored in the `sr_presets` SQLite table:

| Column | Type | Description |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Unique preset identifier |
| `name` | `TEXT NOT NULL` | Human-readable preset name |
| `scope` | `TEXT NOT NULL DEFAULT 'global'` | `'global'` or `'session'` |
| `scope_id` | `TEXT` | Session ID when scope is `'session'` |
| `left_provider_id` | `TEXT` | Left hemisphere provider |
| `left_model` | `TEXT` | Left hemisphere model |
| `right_provider_id` | `TEXT` | Right hemisphere provider |
| `right_model` | `TEXT` | Right hemisphere model |
| `created_at` | `TEXT` | ISO 8601 creation timestamp |
| `updated_at` | `TEXT` | ISO 8601 last-update timestamp |

| Method | Purpose |
| --- | --- |
| `listSRPresets(scope, scopeId?)` | List presets filtered by scope |
| `saveSRPreset(id, name, scope, scopeId, left*, right*)` | Create or update a preset |
| `deleteSRPreset(id)` | Delete a preset by ID |
| `getSRPreset(id)` | Retrieve a single preset |

### 7D.8 SR Presets and Suggested Models

**Presets** allow operators to save and recall SR model configurations. Presets can be scoped globally (available across all sessions) or to a specific session. The presets dropdown in the SR panel shows all available presets; selecting one loads its Left/Right model assignments into the active configuration.

**Suggested Models** uses heuristic matching to recommend optimal Left/Right pairings based on currently configured providers. The `/api/sr/suggest` endpoint evaluates available models against SR qualification criteria and returns a ranked suggestion. The "✨ Suggested Models" button in the SR panel fetches and auto-applies the top suggestion.

## 7B. Character Accountability Control (CAC) Architecture

The CAC subsystem binds every agent action to an immutable identity chain: character → Prism user → operator → client/session. It lives in `src/core/accountability/`.

### 7B.1 Modules

| File | Purpose |
| --- | --- |
| `character-accountability-store.ts` | SQLite-backed persistence for character assignments. Stores identity fields, lifecycle state, dispatch counts, and timestamps. Uses `ensureColumn()` migration for backward compatibility. |
| `character-accountability-manager.ts` | Business logic for assignment lifecycle (assign, dispatch, suspend, resume, revoke). Integrates with `ActivityBus` to emit events. Enforces profile-aware email validation. |

### 7B.2 Identity fields

| Field | Description |
| --- | --- |
| `characterId` | Character brief identifier (from `characters/*.json`) |
| `prismUserId` / `prismUserEmail` | Prism platform user identity |
| `operatorId` / `operatorEmail` | Human operator identity |
| `clientId` | Client application identifier |
| `sessionId` | Session context identifier |
| `executionProfileSegment` | Resolved profile segment: `individual` or `business` |
| `assignmentId` | UUID generated at assignment time |

These fields are also present on `ActivityEvent` (optional) and included in the SHA-256 event hash when populated.

### 7B.3 Lifecycle state machine

```
assigned → active (on first dispatch)
         → suspended (operator/policy pause, with reason)
         → revoked (terminal, no resume)

active   → suspended
         → revoked

suspended → active (resume)
          → revoked
```

State `revoked` is terminal. Calling `resume()` on a revoked assignment throws.

### 7B.4 Profile-aware email validation

The manager uses `BusinessEmailValidationPolicy` to enforce constraints when `executionProfileSegment === 'business'`:

- **`requireMatchingDomains`** (default `true`): Prism user and operator emails must share the same domain.
- **`allowedDomains`** (optional): if set, both emails must belong to a domain in this list.

For individual profile, no domain constraints are applied.

### 7B.5 Alias normalization

`resolveExecutionProfileSegment()` maps input strings to the canonical two-segment model:

| Input | Resolved segment |
| --- | --- |
| `individual` | `individual` |
| `business` | `business` |
| `enterprise` | `business` |
| `corporate` | `business` |

### 7B.6 Activity event enrichment

When an accountability chain is active, the following fields are set on emitted `ActivityEvent` objects:

- `characterId`, `prismUserId`, `prismUserEmail`, `operatorId`, `operatorEmail`, `clientId`, `assignmentId`, `executionProfileSegment`
- `accountabilityChain`: serialized JSON of the full `AccountabilityChain` interface

These fields are included in the SHA-256 hash computed by `hashEvent()` in `src/core/activity/bus.ts`.

### 7B.7 Query and filtering

`CharacterAccountabilityStore.list(filter)` supports filtering by:

- `characterId`, `operatorId`, `prismUserId`, `clientId`, `sessionId`
- `operatorEmail`, `prismUserEmail`
- `executionProfileSegment`
- `state` (assigned, active, suspended, revoked)

### 7B.8 Test coverage

`tests/character-accountability.test.ts` covers:

- Individual profile assignment with mixed-domain emails
- Business profile domain-matching enforcement
- Enterprise/corporate alias normalization
- Full lifecycle (dispatch, suspend, resume, revoke)
- Query filtering by identity fields
- Activity event emission verification
- Invalid email rejection

## 7C. Session-Gating Security Architecture

PRISM cannot be used or started until an operator chat session is established. Sessions serve as mandatory containment boundaries that scope every agent action, tool execution, and governance decision to an auditable context. This section documents the complete security stack that enforces this invariant.

### 7C.1 Session as mandatory containment

Every PRISM operation is contained within a chat session. No tool execution, agent dispatch, or LLM call can proceed without an active session context.

**Profile-specific session creation:**

| Profile | Behavior |
| --- | --- |
| `individual` | Auto-creates a session at boot if none exist (`dashboard-service.ts` — if `listSessions().length === 0`, calls `createSession()` automatically) |
| `business` | Requires explicit operator action to create a session. No auto-creation. |

**Two sessionId concepts coexist in the codebase:**

| Concept | Source | Purpose |
| --- | --- | --- |
| Runtime session | `DashboardService.currentSessionId` | Active operator session for request scoping |
| Chat session | `ChatSessionStore` record ID | Persistent chat thread with message history |

Both must be present for operations to proceed. The readiness gate (`getReadinessSnapshot()`) includes `session-selected` as one of four mandatory requirements.

Key module: `src/core/operator/dashboard-service.ts`, `src/core/operator/chat-session-store.ts`

### 7C.2 Five-layer request security flow

Every inbound HTTP request passes through five sequential security layers before reaching business logic:

```
Request
  │
  ▼
┌──────────────────────┐
│  1. Auth Gate        │──── Token validation (timingSafeEqual)
│     auth.ts          │     Public routes bypass
└──────────┬───────────┘
           │ ✓ authenticated
           ▼
┌──────────────────────┐
│  2. Rate Limiter     │──── 200 req/min per IP
│     rate-limiter.ts  │     Fixed-window counter
└──────────┬───────────┘
           │ ✓ under limit
           ▼
┌──────────────────────┐
│  3. Session Guard    │──── assertSessionExists()
│     chat-session-    │     Readiness gate check
│     store.ts         │
└──────────┬───────────┘
           │ ✓ session active
           ▼
┌──────────────────────┐
│  4. Policy Engine    │──── Risk classification
│     engine.ts        │     Tier/decision/reason codes
└──────────┬───────────┘
           │ ✓ allow | require_approval
           ▼
┌──────────────────────┐
│  5. Approval Queue   │──── Tier-3 blocking approval
│     approval-queue.ts│     2-min timeout, auto-deny
└──────────┴───────────┘
           │ ✓ approved
           ▼
       Business Logic
```

Failure at any layer returns the appropriate HTTP status (`401`, `429`, `400`, `403`) and emits an activity event recording the denial.

### 7C.3 Auth Gate

The `AuthGate` class (`src/core/security/auth.ts`) implements token-based authentication for all API and WebSocket traffic.

**Token lifecycle:**

1. On first boot, `randomBytes(32).toString('hex')` generates a 64-character hex token.
2. Token is persisted to `{workspace}/state/admin-token` with file mode `0o600` (owner-only read/write).
3. `start_web.bat` reads the token file and opens the browser with `?token=<value>` appended.
4. All subsequent requests must include the token as `Authorization: Bearer <token>` header or `?token=<value>` query parameter.

**Validation:**

- Uses `crypto.timingSafeEqual()` to prevent timing side-channel attacks.
- Buffers are compared after encoding to ensure constant-time evaluation regardless of token content.

**Public route bypass:**

The following routes skip authentication to allow initial page load:

- `/` (dashboard HTML)
- `/favicon.ico`
- Static asset routes (`/setup-wizard`, `/setup-wizard-advanced`)

**WebSocket authentication:**

WebSocket upgrade requests authenticate via `?token=` query parameter on the connection URL, since browsers cannot set custom headers on WebSocket handshakes.

Key module: `src/core/security/auth.ts` (`AuthGate`)

### 7C.4 Rate Limiter

The `RateLimiter` class (`src/core/security/rate-limiter.ts`) enforces per-IP request throttling.

| Parameter | Value |
| --- | --- |
| Window size | 60 seconds (fixed window) |
| Max requests per window | 200 |
| Key derivation | Client IP address |
| `X-Forwarded-For` trust | Only from loopback (`127.0.0.1`, `::1`) |
| Stale entry cleanup | Every 5 minutes |

When a client exceeds the limit, the response is `429 Too Many Requests` with a `Retry-After` header. The limiter does not persist state across restarts — counters reset on reboot.

Key module: `src/core/security/rate-limiter.ts` (`RateLimiter`)

### 7C.5 Session Guard

The `assertSessionExists()` method on `ChatSessionStore` (`src/core/operator/chat-session-store.ts`) enforces that a valid session context is present before any state-mutating operation.

**Guarded methods (12):**

All store methods that read or write session-scoped data call `assertSessionExists()` as a precondition. These include message CRUD, SR configuration, model assignment, and session metadata operations.

**Readiness gate:**

`getReadinessSnapshot()` evaluates four requirements before the dashboard becomes interactive:

1. `provider-configured` — At least one LLM provider has a valid API key.
2. `model-selected` — A model is selected for the active provider.
3. `session-selected` — A chat session exists and is active.
4. `system-healthy` — No critical runtime errors.

Until all four requirements are met, the UI displays a readiness overlay blocking interaction. This ensures operators cannot issue commands into a session-less context.

Key module: `src/core/operator/chat-session-store.ts`, `src/core/operator/dashboard-service.ts`

### 7C.6 Policy Engine

The `PolicyEngine` class (`src/core/policy/engine.ts`) evaluates every tool execution request against a `PolicyContext` and returns a `PolicyResult`.

**Evaluation inputs (`PolicyContext`):**

- Tool name, operation type, risk metadata
- Execution profile segment (`individual` or `business`)
- Current session context and accountability chain
- Tool contract (mutability, side effects, rollback guidance)

**Evaluation outputs (`PolicyResult`):**

| Field | Type | Description |
| --- | --- | --- |
| `decision` | `'allow' \| 'deny' \| 'require_approval'` | Governance outcome |
| `tier` | `1 \| 2 \| 3` | Risk tier classification |
| `reasons` | `string[]` | Human-readable explanation |
| `reasonCodes` | `ReasonCode[]` | Machine-readable structured codes |

**Risk tier matrix:**

| Tier | Actions | Governance |
| --- | --- | --- |
| 1 | Read-only, informational | Auto-allow |
| 2 | State-mutating, reversible | Allow with audit |
| 3 | Destructive, irreversible, external | Require human approval |

**Profile-aware behavior:**

Execution profiles (`src/core/policy/execution-profiles.ts`) modify policy thresholds:

- `individual`: relaxed rollback requirements, streamlined approval
- `business`: mandatory rollback semantics, stricter audit requirements, enhanced approval gates

**Reason codes:**

12 structured reason codes are defined in `src/core/policy/reason-codes.ts`, providing machine-readable justifications for every policy decision (e.g., `TOOL_RISK_HIGH`, `PROFILE_REQUIRES_APPROVAL`, `CONTRACT_VIOLATION`).

Key modules: `src/core/policy/engine.ts`, `src/core/policy/execution-profiles.ts`, `src/core/policy/reason-codes.ts`

### 7C.7 Approval Queue

The `ApprovalQueue` class (`src/core/approval/approval-queue.ts`) handles tier-3 blocking approvals.

**Flow:**

1. Policy engine returns `require_approval` for a tier-3 action.
2. `ApprovalQueue.request()` creates a pending approval entry and returns a `Promise<boolean>`.
3. The pending approval appears in the dashboard Approval panel (via WebSocket push).
4. Operator clicks Approve or Deny via `/api/approval/approve/:id` or `/api/approval/deny/:id`.
5. If no response within **120 seconds**, the request is auto-denied (fail-safe timeout).
6. The promise resolves with the decision; execution proceeds or aborts accordingly.

**Design principles:**

- Timeout-based auto-denial ensures the system never hangs waiting for operator input.
- Approval state changes are broadcast via WebSocket for real-time UI updates.
- All approval decisions (including timeouts) are emitted as activity events for audit.

Key module: `src/core/approval/approval-queue.ts` (`ApprovalQueue`)

### 7C.8 Directive Integrity

The `DirectiveIntegrity` module (`src/core/security/directive-integrity.ts`) ensures that the Permanent Active Directives (PAD) — PRISM's root governance document — have not been tampered with.

**Mechanism:**

- A SHA-256 hash of the canonical PAD file is hardcoded as `DIRECTIVE_SHA256` in the source.
- `verifyDirectiveIntegrity()` computes the hash of the on-disk PAD and compares it against the constant.
- Any mismatch indicates unauthorized modification and blocks operations that depend on directive compliance.

**Rotation protocol:**

When the PAD is intentionally amended (per Governance Council approval), the `DIRECTIVE_SHA256` constant must be updated in the same commit — ensuring the change is visible in version control and cannot be introduced silently.

Key module: `src/core/security/directive-integrity.ts`

### 7C.9 Tool Contract Governance

Tool contracts define the security surface of every tool registered in PRISM.

**Contract validation (`src/core/tools/contracts.ts`):**

Every tool must declare:

- Operation name and argument schema
- Mutability classification (read-only, state-mutating, destructive)
- Risk metadata (tier hint, side effect description)
- Rollback guidance (where applicable)

Contracts are validated at registration time. Tools with missing or invalid contracts are rejected.

**Governance normalizer (`src/core/tools/governance-normalizer.ts`):**

The normalizer auto-promotes risk classifications when tool metadata indicates higher risk than declared. This prevents tools from under-reporting their risk to bypass governance.

Key modules: `src/core/tools/contracts.ts`, `src/core/tools/governance-normalizer.ts`

### 7C.10 Session-scoped audit trail

All actions within a session are captured on two complementary surfaces, providing both real-time operator visibility and persistent forensic records.

**Surface 1 — Chat tab (real-time):**

- Tool calls appear inline in the chat conversation via the SSE `agentic_event` stream.
- Each tool call shows: tool name, arguments, result, duration, and governance decision.
- Tool results are matched back to their originating call for clear cause-effect tracing.

**Surface 2 — Logs tab (persistent):**

- The `ActivityBus` (`src/core/activity/bus.ts`) captures every operation as an `ActivityEvent`.
- Events include 30+ fields: operation, layer, severity, tool metadata, governance decision, accountability chain, timing, and a SHA-256 integrity hash.
- `emit()` assigns a unique ID, timestamp, and computes the hash before fan-out to subscribers.
- `SqliteActivityStore` (`src/core/activity/sqlite-store.ts`) persists all events to SQLite, queryable by session, operation, layer, identity, and time range.
- The Logs tab displays: events table, trace view, action history, tool call log, and activity log with severity filtering.

**Event integrity:**

Each `ActivityEvent` includes a SHA-256 hash computed over its content fields (including accountability chain when present). This hash enables tamper detection on the audit trail — any modification to a stored event invalidates its hash.

**`ActivityEvent` key fields** (from `src/core/activity/types.ts`):

| Category | Fields |
| --- | --- |
| Identity | `id`, `timestamp`, `sessionId` |
| Operation | `operation`, `layer`, `severity`, `category` |
| Governance | `decision`, `tier`, `reasonCodes`, `approvalId` |
| Accountability | `characterId`, `operatorId`, `prismUserId`, `assignmentId`, `accountabilityChain` |
| Integrity | `hash` (SHA-256) |

Key modules: `src/core/activity/bus.ts`, `src/core/activity/types.ts`, `src/core/activity/sqlite-store.ts`

## 7E. Setup Wizard Architecture

### Overview

PRISM provides setup wizards across three surfaces (web, TUI, CLI) that all consume the same backend API endpoints. This architecture ensures consistent behavior and configuration output regardless of which surface the user chooses.

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Wizard    │    │   TUI Wizard    │    │   CLI Wizard    │
│  (setup-wizard  │    │ (SetupWizardTab │    │  (readline,     │
│   .js, vanilla) │    │  .tsx, Ink)     │    │   implemented)  │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Setup API Endpoints  │
                    │  /api/setup/*         │
                    │  dashboard-service.ts │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  State Persistence    │
                    │  .prism-preferences   │
                    │  workspace-resolver   │
                    └───────────────────────┘
```

### API Endpoints

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/setup/status` | Current setup state: `setupComplete`, `executionProfileSegment`, `workspaceRoot` |
| `GET` | `/api/setup/prerequisites` | System prerequisite checks (Node version, workspace existence) |
| `POST` | `/api/setup/profile` | Set execution profile (`individual` or `business`) |
| `POST` | `/api/setup/workspace` | Set workspace root, creates directory structure via `ensureWorkspaceStructure()` |
| `POST` | `/api/setup/complete` | Mark setup done, run readiness check, emit activity event |
| `GET` | `/api/setup/advanced/status` | Full system snapshot for advanced wizard (routing, guardian, CAC, browser, scheduler) |
| `POST` | `/api/setup/initialization-session` | Generate initialization certificate (advanced wizard completion) |

### State Persistence

All wizard surfaces write to the same state files:

- **`.prism-preferences.json`** — User preferences persisted via `writePreferences()` in `workspace-resolver.ts`
  - `setupComplete: boolean`
  - `executionProfileSegment: 'individual' | 'business'`
  - `workspaceRoot: string`
- **`{workspace}/state/routing-config.json`** — Model routing configuration (advanced wizard)

### Source Files

| File | Surface | Description |
| :--- | :--- | :--- |
| `src/core/operator/public/setup-wizard.js` | Web | 4-step basic wizard (vanilla JS) |
| `src/core/operator/public/setup-wizard-advanced.js` | Web | 8-step advanced wizard (vanilla JS) |
| `src/tui/tabs/SetupWizardTab.tsx` | TUI | 4-step wizard (React/Ink) |
| `src/tui/api/prism-client.ts` | TUI | API client with `getSetupStatus()`, `postSetupProfile()`, etc. |
| `src/cli/setup-wizard.ts` | CLI | 4-step readline-based wizard (entry point) |
| `src/cli/setup-wizard-advanced.ts` | CLI | 8-step advanced wizard (routing, guardian, CAC, scheduler) |
| `src/cli/api-client.ts` | CLI | Lightweight HTTP client for `/api/setup/*` + advanced endpoints |
| `src/cli/cli-utils.ts` | CLI | Readline helpers: `prompt()`, `select()`, `confirm()`, `maskedInput()`, `spinner()` |
| `src/core/operator/dashboard-service.ts` | Backend | API route handlers + HTML page serving |
| `src/core/config/workspace-resolver.ts` | Backend | `readPreferences()`, `writePreferences()`, `ensureWorkspaceStructure()` |

### Adding a New Wizard Step

To add a step to the wizard:

1. **Backend:** Add a new `POST /api/setup/<step>` endpoint in `dashboard-service.ts` that validates input and persists state.
2. **Web basic wizard:** Increment `TOTAL_STEPS` in `setup-wizard.js`, add a `step-N` div in the HTML, add an `initNewStep()` function, and wire it into `showStep()`.
3. **Web advanced wizard:** Same pattern in `setup-wizard-advanced.js`.
4. **TUI wizard:** Add a new step case in `SetupWizardTab.tsx` with Ink components and `useInput` handlers.
5. **CLI basic wizard:** Add a new step block in `setup-wizard.ts` between the existing steps, using `prompt()`, `select()`, or other CLI utilities from `cli-utils.ts`.
6. **CLI advanced wizard:** Add a matching step in `setup-wizard-advanced.ts` with the same CLI utilities.
7. **Tests:** Add integration test covering the new endpoint and wizard flow.

### Testing Wizard Flows

- **Web wizard:** Playwright end-to-end test navigating `/setup`, filling each step, verifying `/api/setup/complete` response.
- **TUI wizard:** Component test rendering `SetupWizardTab` with mock `PrismClient`.
- **API endpoints:** HTTP integration tests for each `/api/setup/*` route with valid and invalid payloads.
- **Parity check:** Verify `.prism-preferences.json` output is identical regardless of wizard surface.

### Activity Events

All wizard actions emit structured events to the ActivityBus:

- `prism.setup_wizard.profile_selected` — Profile choice with segment value
- `prism.setup_wizard.workspace_configured` — Workspace path validated and set
- `prism.setup_wizard.provider_configured` — Provider selection and test result
- `prism.setup_wizard.complete` — Wizard finished, includes `source` field (`web`, `tui`, `cli`)
- `prism.initialization_certificate.created` — Advanced wizard certificate generated

## 8. Safety and Governance Standards

### 7F. Browser Control Architecture

Browser Control provides Playwright-powered browser automation integrated with Prism's governance, identity, and audit systems.

#### 7F.1 Components

| Component | File | Purpose |
| --- | --- | --- |
| `BrowserSessionManager` | `src/core/operator/browser-session-manager.ts` | Session lifecycle, Playwright context isolation, network/console capture |
| `BrowserControlTool` | `src/adapters/system/browser-control-tool.ts` | Tool interface adapter with governance schema (implements `Tool`) |
| Browser API routes | `src/core/operator/dashboard-service.ts` | 12 HTTP endpoints under `/api/browser/*` |
| Browser Control tab UI | `src/core/operator/dashboard-service.ts` | 5 sub-views: Sessions, Viewport, Network, Console, DOM |

#### 7F.2 Session lifecycle

```
IDLE → LAUNCHING → ACTIVE ⇄ NAVIGATING → TERMINATED
                     ↓
                  SUSPENDED
```

Each session maps to one Playwright `BrowserContext` (isolation boundary). Sessions auto-terminate after 10 minutes of idle time.

#### 7F.3 Governance tiers

| Action | Risk | Mutating | Rollback Required |
| --- | --- | --- | --- |
| `screenshot`, `get_console_logs`, `get_network_log`, `get_dom_snapshot`, `diagnostics`, `list_sessions` | low | no | no |
| `launch_session`, `navigate`, `click`, `type` | medium | yes | no |
| `evaluate` | **high** | yes | **yes** |

#### 7F.4 API endpoints

All browser API endpoints follow the `/api/browser/{action}` convention:

- `GET /api/browser/diagnostics` — Playwright availability check
- `GET /api/browser/sessions` — List active sessions
- `POST /api/browser/launch` — Create a new session (`{ headless: boolean }`)
- `POST /api/browser/navigate` — Navigate to URL (`{ sessionId, url }`)
- `POST /api/browser/click` — Click element (`{ sessionId, selector }`)
- `POST /api/browser/type` — Type text (`{ sessionId, selector, text }`)
- `POST /api/browser/evaluate` — Execute JS in page (`{ sessionId, expression }`)
- `GET /api/browser/screenshot/{sessionId}` — PNG viewport capture
- `GET /api/browser/dom-snapshot/{sessionId}` — Full DOM HTML
- `GET /api/browser/console-logs/{sessionId}` — Console log entries
- `GET /api/browser/network-log/{sessionId}` — Network request waterfall
- `DELETE /api/browser/sessions/{sessionId}` — Close session

#### 7F.5 ActivityBus events

All browser operations emit audit events:

- `browser.session.started` — Session created
- `browser.session.terminated` — Session closed
- `browser.navigate.completed` — Page navigation
- `browser.click.completed` — Element clicked
- `browser.type.completed` — Text entered
- `browser.screenshot.captured` — Viewport captured
- `browser.evaluate.completed` — JS evaluated

#### 7F.6 Dashboard UI

The Browser Control tab has 5 sub-navigation views:

1. **Sessions**: Launch/close sessions, diagnostics check
2. **Viewport**: URL bar, live screenshot viewer, click/type action inputs
3. **Network**: Request/response waterfall table with method, URL, status, type, time
4. **Console**: Live console log stream color-coded by level, JS evaluate input
5. **DOM**: Full DOM snapshot viewer

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
10. Agent lifecycle manager (spawn/stop/promote/reap/persist)
11. Per-agent model assignment and dynamic switching
12. Chat-to-agent routing (classifier-first)
13. Swarm coordinator (mesh/star/pipeline/broadcast)
14. Intelligent agent telemetry and pattern detection

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

## 16. Permanent Active Directives (PAD) — Security Architecture

### 16.1 Overview

The Permanent Active Directives (`Permanent_Active_Directives.txt`) are the root governance artifact for all Prism intelligence systems. The 10 Laws define immutable behavioral boundaries that are cryptographically enforced at runtime.

### 16.2 Security Module Layout

| Module | Path | Purpose |
| --- | --- | --- |
| Directive Integrity | `src/core/security/directive-integrity.ts` | SHA-256 hash verification of PAD file |
| Directive Manifest | `src/core/security/directive-manifest.ts` | Machine-readable 10 Laws with enforcement mapping |

### 16.3 Integrity Verification Flow

```
Boot → computeDirectiveHash() → compare against DIRECTIVE_SHA256 constant
  ├─ Match: emit governance event (status: succeeded)
  └─ Mismatch: emit governance event (status: failed) + log warning
```

Guardian Agent re-runs this check every 600 seconds as a `directive_integrity` security task.

### 16.4 Governance Preamble Injection

The `buildAdaptiveSystemPrompt()` function in `model-capability-matrix.ts` injects a governance preamble for Tier 2+ models:

- **Business profile**: Full 10-law text in `<governance>` XML tags
- **Individual profile**: Compact numbered reference

### 16.5 Amendment Protocol

Per Law 10 and the PAD amendment clause:

1. Governance Council approves the amendment
2. PAD file is modified
3. New SHA-256 hash is computed
4. `DIRECTIVE_SHA256` constant in `directive-integrity.ts` is updated in the same commit
5. CI Gate 9 validates the new hash matches the constant

Any PR that modifies `Permanent_Active_Directives.txt` without updating the hash constant will be blocked by CI.

### 16.6 Related Documents

- `docs/TERMS_AND_GOVERNANCE_FRAMEWORK.md` — Full governance hierarchy and compliance mapping
- `docs/PAD_WHITEPAPER.md` — Purpose, philosophy, and market impact analysis
- `docs/CI_GATING_POLICY.md` — Gate 9 specification

## 17. References

1. <https://www.anthropic.com/engineering/building-effective-agents>
2. <https://arxiv.org/abs/2210.03629>
3. <https://arxiv.org/abs/2302.04761>
4. <https://arxiv.org/abs/2303.17580>
5. <https://modelcontextprotocol.io/introduction>
6. <https://www.nist.gov/itl/ai-risk-management-framework>
