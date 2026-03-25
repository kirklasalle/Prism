# PRISM Roadmap

Date: 2026-03-11

## Phase A (Done)

- Runtime scaffolding with TypeScript and tool registry
- Activity bus with structured events and hash chain
- Policy engine with 3-tier authority model
- Orchestrator with approval-gated flow
- Real adapters for system/protocol/application basics
- SQLite persistence for activity events
- Approval queue + approval HTTP service

## Phase B (Done)

- Episodic memory buffer
- Session summary persistence
- Semantic memory index
- First-class retrieval tools: `semantic_query` and `memory_query`

## Phase C (In Progress)

- Memory retrieval quality instrumentation expanded (coverage/utility/novelty + p50/p95/p99)
- Memory growth and drift diagnostics implemented (trend windows + alerting)
- Query cohort quality dashboards and alerting implemented
- Cohort dashboard persistence/export snapshots implemented (SQLite-backed)
- Cohort trend API and baseline comparison views implemented
- Configurable retrieval alert policy thresholds implemented
- Workflow orchestration expansion complete for retries/timeouts/fallback routing
- Deterministic replay harness implemented for trace parity checks
- Performance qualification harness implemented (`npm run perf:qualify`) with p50/p95/p99 gate outputs
- Approval-pathway contention load benchmark implemented in performance qualification harness
- CI quality workflow implemented (tests + perf qualification + artifact upload)
- Environment-specific SLO profile presets implemented for qualification gates (dev/staging/prod)
- Environment-specific retrieval alert policy profiles implemented (dev/staging/prod)
- Adapter contract versioning and runtime schema checks implemented with regression tests
- Tool contract snapshot artifact generation implemented for release evidence
- Workflow integration coverage expanded:
  - approval granted path
  - approval denied path
  - approval timeout path
  - fallback and hard-failure behavior under governance outcomes
- Documentation expansion complete:
  - README strategy refresh
  - PRD major expansion
  - Developer Guide added
  - User Guide added
- **Operator Dashboard UI enhancements (complete):**
  - Tab-based navigation: Chat Interface, Provider & Settings, Tools & Plugins, Network, Telemetry, Logs & Debug
  - Collapsible panel system with persistent expand/collapse state and chevron indicators
  - Provider & Settings tab: Session Provider Assignment, Provider Configuration, Model Capability Matrix, Settings (runtime config), LLM Audit Trail with JSON/CSV export
  - Tools & Plugins tab with full inventories:
    - Tools panel: 19 built-in tools across System (7), Application (5), Knowledge (3), Integration (4) with risk-level and mutation badges
    - Plugins panel: 7 MCP server plugins (ids-mcp, web-search-mcp, ImpressionCore suite) with type and status badges
    - Utilities panel: 30 system utilities across 6 categories (Benchmarks, Operator Services, Memory, Activity, Replay, Configuration)
  - Network tab with full network command governance:
    - Network Tools panel: ~50 curated commands across Tier 1 (diagnostics), Tier 2 (config inspection), Tier 3 (mutating) with platform badges
    - Network Settings panel: live interface data viewer (ipconfig/ifconfig)
    - Network Telemetry panel: command execution counters, tier distribution, error rates
    - Network Console panel: interactive command input with real-time output
    - NetworkTool adapter (`network_exec`) with curated allowlist, blocked pattern safety, and per-command tier classification
    - 3 new API endpoints: `/api/network/interfaces`, `/api/network/exec`, `/api/network/telemetry`
  - ARIA-compliant tab navigation for accessibility
  - WebSocket real-time event streaming
  - 38+ HTTP API routes for programmatic dashboard access
- **Persistent Workspace (Prism_Refraction) (complete):**
  - OS-aware workspace resolver (`workspace-resolver.ts`) — Windows/macOS/Linux detection with `PRISM_WORKSPACE_ROOT` override
  - All SQLite stores, benchmarks, application tools, and MCP config use workspace paths
  - Workspace manifest (`prism-workspace.json`) with version, profile, and platform tracking
  - Structured subdirectories: `config/`, `artifacts/`, `data/`, `state/`, `characters/`, `logs/`
  - Legacy path detection with migration notices
  - Character briefs directory with JSON schema and example agent definitions
  - `start_web.bat` workspace verification on startup
  - Dashboard Settings panel shows active workspace root
- **Character Accountability Control (CAC) (complete):**
  - Character-to-operator identity binding with full accountability chain (characterId, prismUserId, prismUserEmail, operatorId, operatorEmail, clientId, sessionId)
  - Assignment lifecycle management: assign, dispatch, suspend, resume, revoke
  - Profile-aware email domain validation: business profile enforces matching domains; individual profile is permissive
  - Execution profile segment normalization: `enterprise`/`corporate` resolve to canonical `business`
  - Accountability chain propagated into activity events and included in SHA-256 integrity hashes
  - SQLite-backed persistence with `ensureColumn()` backward-compatible migrations
  - Full test coverage: lifecycle, identity validation, profile enforcement, query filtering

## Next Steps

1. Capability Parity Program (new)

- Objective:
  - Deliver top-tier agent capability parity for `PRISM Individual` while preserving mandatory tiered governance in `PRISM Business`.
- Operating profiles:
  - `PRISM Individual`: high-capability defaults for tool use, terminal virtualization, and containerized workflows.
  - `PRISM Business`: same capability surface with policy-tier enforcement, approval pathways, and auditable operations.
- Milestones:
  - M1 Capability Surface Parity
    - terminal session virtualization and persistent channel management
    - container orchestration adapter (create/start/stop/destroy, snapshot/revert, quotas)
    - dynamic transient tool staging and controlled registration path
    - adapter pack manifest and compatibility validator
  - M2 Governance Completion
    - policy tier mapping for shell/container/plugin actions
    - approval/revoke/timeout semantics for long-running sessions
    - reason-code telemetry and event lineage for high-risk operations
  - M3 Performance Qualification
    - profile-specific SLO targets and qualification gates
    - execution mode qualification: `fast`, `balanced`, `governed`
  - M4 Release Readiness
    - parity claim traceability matrix
    - investor appendix and licensing-brand appendix
    - go/no-go evidence package and runbook update

1. Agent Control & Swarm Intelligence (new — Phase D3)

- Objective:
  - Deliver a fully wired agent control system where the majority of tasks are dispatched through managed agents with intelligent lifecycle tracking and multi-agent swarm capabilities.
- Core capabilities:
  - Agent lifecycle management with three tiers: ephemeral (per-task, auto-reaped), semi-permanent (survives across tasks, idle-reaped), permanent (persists until manual stop, survives server restarts).
  - Per-agent model assignment: dynamic provider/model override per agent, changeable at runtime without restart. Override precedence: agent > role > automatic tier selection.
  - Intelligent telemetry: per-agent metrics, dispatch pattern detection over 1h/1d/7d windows, lifecycle promotion recommendations, model performance tracking per role.
  - Swarm orchestration with four topologies: mesh (parallel sub-tasks), star (coordinator delegates to workers), pipeline (sequential handoff), broadcast (same prompt, best result selected).
  - Chat-to-agent routing: classifier-first intent detection routes majority of tasks through specialized agents (coder, summarizer, planner, indexer, chat).
  - Workspace persistence fix: error surfacing, write-then-verify, env var precedence correction.
- Exit criteria:
  - Agent lifecycle tests pass (spawn/stop/promote/reap/persist/restore)
  - Swarm execution verified for all four topologies
  - Telemetry producing actionable pattern insights and promotion recommendations
  - Per-agent model assignment confirmed via dispatch telemetry
  - Chat messages routed through agents by default
  - Workspace change persists across server reboot
  - Dashboard Agent Control tab fully wired (no mock handlers)

1. Individual-native MVP execution (new)

- Build workflow templates for:
  - email triage + draft
  - calendar conflict + day planning (✅ Scheduler tab — calendar, board, timeline, projects)
  - notes capture + extraction
  - chronological tasks/events planning (✅ Scheduler tab — integrated project management)
- Add policy-path integration tests for mutating operations (allow/deny/timeout)
- Publish release evidence bundle:
  - tool contract snapshots
  - retrieval attribution samples
  - workflow trace parity checks

1. Retrieval quality instrumentation

- Expand profile-specific alert tuning based on production incident trends

1. Adapter hardening and regression safety

- Expand safety regression tests for system and protocol adapters
- Add baseline-to-candidate contract diff policy and release blocking rules
- Expand SQLite migration compatibility scenarios across historical schema variants

1. Performance qualification deepening

- Expand contention scenarios by environment profiles (approve/deny/timeout mixes)
- Add profile-differentiated trend history and regression drift alerts in CI artifacts

1. Operator surfaces

- Build runbook-grade incident triage guide
- Add session trace explorer UX/API
- Add policy bundle diff and audit export tools

1. Novel systems incubation

- Constitutional Causal Compiler prototype
- Dual-Lens Memory Arbitration prototype
- Self-Healing Workflow Synthesis prototype

1. Dashboard and operator UX evolution

- Live plugin enable/disable toggle and MCP server health monitoring
- Utility execution triggers from dashboard (run qualification suites, export lineage bundles)
- Tool risk-level editing and custom policy override from the UI
- Session trace explorer integrated into Logs & Debug tab
- Real-time performance SLO gauge panels in Telemetry tab

1. CAC Identity Expansion (planned)

- Browser automation identity binding: link browser sessions (headless and user-visible) to the accountability chain (✅ BrowserSessionManager emits session events to ActivityBus with session ID binding)
- Email provider OAuth integration: validate operator email ownership via OAuth flow before assignment
- CAC policy expansion: configurable per-character permission scopes, assignment expiry, and auto-revocation rules
- Dashboard CAC panel: visual accountability chain inspector, assignment lifecycle timeline, and identity audit export
- Exit criteria:
  - Browser session bound to accountability chain with client fingerprint
  - OAuth email verification passing for at least one provider (Google, Microsoft)
  - Assignment expiry triggers automatic revocation with audit event
  - Dashboard displays live accountability chain for active sessions

## Target Quality Gates

- Workflow success rate >= 99.0% on approved patterns
- Activity stream delivery p95 <= 200ms
- Telemetry overhead p95 <= 20ms
- Policy decision latency p95 <= 30ms
- Retrieval latency p95 <= 50ms (hot memory)
- Full traceability for sampled sessions
