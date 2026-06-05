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

## Phase C (Complete — 2026-04-20)

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
  - Decoupled monolithic dashboard template into 12 distinct HTML fragments with dynamic async lazy-loading
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

1. Production Qualification (Phase D — Active)

- Objective:
  - Complete staging burn-in, performance qualification, and incident readiness to meet production release gates.
- Progress:
  - **Tool Contract Extraction Gap Remediation (Done — April 2026)**: Replaced 3 stub extraction methods with real implementations — manifest file parsing (`tool-contract.json`, `tool-contract-snapshot.json`, subdirectory manifests), registry-based extraction (ToolRegistry scanning for explicit contracts), governance-inferred dynamic extraction. Enhanced risk scoring from keyword-only to 6-dimension analysis (description, parameter count/types/names, tool name patterns, governance schema). 21 tests passing (10 existing + 11 new in `tests/tool-contract-extractor-real.test.ts`).
- Scope:
  - Adapter safety regression suite expansion
  - Replay determinism coverage and migration tests
  - Performance qualification against SLOs (baseline harness implemented)
  - Approval-pathway contention load scenarios
  - CI/CD quality gates and release artifacts (baseline implemented)
  - Staging burn-in and incident runbook validation
- Exit criteria:
  - Staging burn-in completed
  - Performance and reliability gates met
  - Incident, rollback, and operator runbooks validated

1. Capability Parity Program (Done — Phase D2)

- All milestones complete (M1–M4): terminal virtualization, container orchestration, tool staging pipeline, plugin validation, profile parity, execution modes, trust/provenance, CI gating, claim alignment, event lineage, traceability matrix, computer-use business gate.
- See `docs/PHASE_D2_TASKS_MANIFEST.md` for full closure evidence.

1. Computer Use Core Program (done)

- Canonical architecture established in `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md`
- Business Security Alignment Gate wired into test strategy, traceability matrix, and runbook
- Cross-tool orchestration tests and contention/failure-path coverage complete
- Evidence-backed readiness snapshots published for Individual and Business profiles

1. Agent Control & Swarm Intelligence (Done — Phase D3)

- All 7 exit criteria met: agent lifecycle (spawn/stop/promote/reap/persist/restore), swarm orchestration (4 topologies), telemetry pattern detection, per-agent model assignment, chat-to-agent routing, workspace persistence, dashboard wiring.
- See `tests/agent-lifecycle.test.ts`, `tests/swarm-coordinator.test.ts`, `tests/agent-telemetry.test.ts`, `tests/agent-router.test.ts` for evidence.

1. Spectrum Refraction (SR) Tri-Model Orchestration (Done — Phase D4)

- Objective:
  - Deliver a novel compounding tri-model parallel fan-out architecture where Left (Logic), Right (Creative), and Main (Coordination) generate simultaneously, producing a structured aggregate response that exceeds any single model's capability. Conceived by Kirk LaSalle.
- Core capabilities:
  - Tri-model parallel fan-out: Left + Right generate concurrently on the same prompt, Main coordinates aggregation.
  - Mandatory instance isolation enforcement: Left ≠ Right validated at configuration, activation, and runtime gates.
  - Three isolation quality levels: `full` (different providers), `model` (same provider, different models), `insufficient` (rejected).
  - Structured XML-tagged aggregation: `<logic_analysis>` and `<creative_synthesis>` sections fused by Main model.
  - Model capability validation per hemisphere role (logic strength vs creative modality).
  - Media artifact extraction from Creative hemisphere (image/audio/video).
  - 4 SR API endpoints: status, configure, activate, deactivate.
  - SR dashboard panel with isolation badge (🔒/🔏/⛔) and cost advisory.
  - SR chat rendering with isolation level pill and hemisphere attribution.
- Implementation status: **COMPLETE** (Phase D4a + D4b + D4c)
  - D4a: SR Core (UI + backend + orchestration + API endpoints) ✅
  - D4b: Instance isolation enforcement across all gates ✅
  - D4c: Advanced SR (multi-key slot support, per-hemisphere timeouts, circuit breaker, audit trail, cost estimation API, transparent hemisphere output, 20/20 tests) ✅
- Exit criteria:
  - SR isolation enforcement rejects identical Left/Right at all three gates
  - Fan-out generates concurrently (timing ≈ max, not sum)
  - Aggregation produces coherent synthesis with XML-tagged hemisphere attribution
  - SR API endpoints return correct state
  - SR panel in dashboard renders with real-time isolation badge
  - Chat messages show SR attribution badge

1. Individual-native MVP (Done — Phase D1)

- All 4 exit criteria met: domain workflow templates (email, calendar, notes, tasks), governance-path integration tests passing, retrieval attribution in dashboard traces, tool contract snapshots validated.
- See `docs/PHASE_D1_TASKS_MANIFEST.md` for full closure evidence.

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

---

## Phase E — Integration Hardening (Active — 2026 Q2)

Objective: Replace all simulated/mock adapter implementations with production-grade integrations, complete real-user prerequisite features (OAuth email/calendar), uplift the operator dashboard UX for non-technical users, and establish API versioning and observability infrastructure required for enterprise deployment.

### E1: Real Adapters (P0)

Replace simulated `child_process.spawn` mocks with production runtime integrations. Both adapters remain backward-compatible via graceful degradation when runtime dependencies are unavailable.

**E1a: Real PTY Terminal (node-pty)**

- Replace `child_process.spawn` shell mock with `node-pty` IPty instances
- Full pseudoterminal I/O (stdin/stdout/stderr over single PTY stream)
- Dynamic import with graceful fallback to mock when `node-pty` not installed
- Expose `isPtyEnabled()` method on adapter; surface real/simulated status in exec responses
- Resize support (`resize(cols, rows)`) for terminal UI consumers
- Cleanup on session revoke/timeout (pty.kill())
- Tests: extend existing suite with PTY-specific cases (resize, raw ANSI output, interactive shell)
- See: `src/adapters/application/terminal-session-adapter.ts`

**E1b: Real Docker Container Isolation (dockerode)**

- Replace `spawn("sh", ["-c", "sleep infinity"])` mock with Docker Engine API via `dockerode`
- Full container lifecycle: create, start, exec, stop, remove
- Resource quota enforcement via Docker hostConfig (CpuQuota, Memory, DiskQuota)
- Snapshot implementation via `docker commit` → stored image tag
- Dynamic import with graceful fallback to mock when Docker daemon unavailable
- Expose `isDockerEnabled()` method; surface real/simulated status in exec responses
- `docker exec` result streaming with exit code capture
- Container network isolation (no host network by default)
- Tests: extend existing suite with Docker-specific cases (resource limits, image pull, exec streams)
- See: `src/adapters/application/container-sandbox-adapter.ts`

### E2: Email & Calendar OAuth Integration (P1)

Deliver real end-user email and calendar integration replacing mock implementations, completing the Individual-Native MVP promise.

- Gmail OAuth 2.0: authorize, token refresh, thread list, draft, send, label operations
- Outlook OAuth 2.0: MSAL flow, mailbox read/write, draft, send operations
- Google Calendar API: event CRUD, free/busy query, conflict detection
- Outlook Calendar API: event CRUD, calendar view, conflict detection
- OAuth token storage via `ProviderSecretStore` (encrypted at rest)
- OAuth setup step added to Setup Wizard (Step 3b: Email & Calendar accounts)
- Dashboard Settings: OAuth account connection status panel
- See: `src/adapters/application/email-tool.ts`, `src/adapters/application/calendar-tool.ts`

### E3: Dashboard UX Uplift (P1)

Establish a two-mode dashboard experience: Simple Mode for individual users (chat-first) and Advanced Mode for operators and developers (existing full dashboard).

- **Simple Mode**: Character picker landing page → chat panel → settings drawer
  - Accessible without technical knowledge
  - Character (Aria/Phoenix/Sentinel) selection as entry point
  - Minimal chrome: conversation window, provider status pill, history sidebar
- **Advanced Mode toggle**: Existing full operator dashboard behind explicit switch
- **CAC Identity Panel** in Settings tab: visual accountability chain inspector, assignment lifecycle timeline, identity audit export (JSON/CSV)
- **SLO Gauge Panel** in Telemetry tab: real-time SLO health indicators (p50/p95/p99 vs target)
- **Live Plugin Enable/Disable Toggle** in Tools tab: MCP server health control + immediate effect
- **Incident Triage UI** in Logs & Debug tab: guided runbook steps, copy-to-clipboard evidence
- **Policy Diff Viewer** in Settings tab: side-by-side governance change inspector
- See: `src/core/operator/public/`, `src/core/operator/dashboard-service.ts`

### E4: API Versioning & OpenAPI (P1)

- Version all API endpoints under `/api/v1/` with backward-compatible redirect from legacy `/api/`
- Generate OpenAPI 3.0 spec from route definitions, served at `/api/v1/openapi.json`
- Deprecation policy: 90-day sunset notices for removed endpoints via `Sunset` response header
- API changelog section added to `CHANGELOG.md`
- See: `src/core/operator/dashboard-service.ts`

### E5: Plugin Cryptographic Signature Verification (P1)

- Implement Ed25519 signature verification in `plugin-pack-validator.ts`
- PRISM signing key management (official pack signing, community key registry)
- Trust-tier gating: official-only (strict business), community-trusted, unsigned (dev/individual only)
- Key distribution via `plugin-pack-manifest.json` `signature` field
- See: `src/core/plugins/plugin-pack-validator.ts`

### E6: CAC Identity Expansion (P1)

- Browser session fingerprint binding: link `BrowserSessionManager` sessions to CAC chain (client fingerprint, user-agent, session token)
- Per-character permission scopes with expiry-based auto-revocation
- OAuth email verification for Business profile characters (Google/Microsoft OAuth)
- Dashboard CAC Panel (see E3)
- See: `src/core/accountability/`, `src/core/operator/browser-session-manager.ts`

### E7: Observability Integration (P1)

- OpenTelemetry trace exporter: instrument activity bus events as OTel spans
- Prometheus `/metrics` endpoint: expose request rates, error rates, latency histograms, queue depths
- Grafana dashboard template (starter JSON) in `docs/grafana/`
- PagerDuty webhook integration for critical governance alerts (tier3 approval timeouts)
- See: `src/core/activity/bus.ts`, `src/core/operator/dashboard-service.ts`

### E8: Low-Level Reasoning Engine (LLRE) & Cognitive Economics (P1 — Done)

- Prompt AST linter & compiler to parse prompt directives and signal density ratios (`src/core/llre/ast.ts`)
- Core math model formulating Tool Call Accuracy, Request Satisfaction Index, Context Saturation Ratio, and Token Efficacy Quotient (`src/core/llre/telemetry.ts`)
- Event-driven background telemetry store (`src/core/activity/sqlite-store.ts`)
- REST Gateway endpoint providing aggregated statistics (`src/core/operator/routes/api-handler.ts`)
- Premium operators setting panel with dynamic metrics visualization (`tab-settings.html`, `tab-settings.js`)

### E: Exit Criteria

- `node-pty` PTY terminal executes real shell commands (`ls`, `pwd`, `cat`) with correct output
- `dockerode` container lifecycle: create → start → exec → stop → remove completes end-to-end
- OAuth flow: user can authorize Gmail account and retrieve real inbox thread list
- Simple Mode: 5 non-technical users complete first agent task in < 5 minutes unassisted
- `/api/v1/openapi.json` returns valid OpenAPI 3.0 spec
- Plugin packs with invalid Ed25519 signatures rejected by validator
- OpenTelemetry spans visible in collector; Prometheus `/metrics` returns valid metrics
- LLRE integration test suite (`tests/llre.test.ts`) compiles and passes successfully (`✓ LLRE tests passed`)

---

## Phase F — Production Qualification & Private Beta (Planned — 2026 Q3)

Objective: Validate PRISM under real-world conditions through staged qualification, multi-user stress testing, and a structured private beta with real users.

### F1: Scalability Foundation

- Database abstraction layer: `ISessionStore`, `IActivityStore` interfaces
- PostgreSQL adapter implementation alongside SQLite (Prisma or `pg`)
- Multi-tenant namespace support: per-organization workspace isolation
- Connection pooling for high-concurrency PostgreSQL deployments
- Migration tooling: SQLite → PostgreSQL data export

### F2: Staging Burn-In

- 72-hour soak test on staging environment (0 unhandled rejections target)
- All 13 governance-critical scenarios validated under sustained load
- 10 concurrent session stress test (Business/governed mode p95 < 500ms)
- SR tri-model under concurrent session load
- Incident runbook drill validation (deny/timeout/revoke/recovery sequences)
- Performance contention testing with mixed approve/deny/timeout profiles

### F3: Private Beta Program

- 10–20 recruited users: 5 individual users, 5 SMB users, 5–10 enterprise IT
- Structured onboarding sessions with UX research protocol (think-aloud, session recording)
- Feedback synthesis cycles (weekly): prioritize based on blocking vs. enhancement
- Beta-specific telemetry opt-in: session recordings, error reports, feature usage heat maps

### F4: Release Infrastructure

- CI/CD pipeline with automated tool contract diff policy (baseline-to-candidate regression gate)
- Signed release artifacts (binary + plugin packs) via CI signing key
- Release notes automation from CHANGELOG
- GitHub Actions workflow for full test + perf qualify + release gate

### F5: Security Audit II

- OWASP Top 10 scan on all API endpoints (automated + manual)
- Linux/macOS parity audit: eliminate all Windows-only code paths
- Penetration test on authentication, rate limiting, and WebSocket endpoints
- OAuth token security review (storage, rotation, revocation)

### F: Exit Criteria

- 72-hour soak: 0 P0 incidents, p95 SLOs maintained
- Private beta: >= 80% of participants complete target workflow without assistance
- Contract diff gate: CI blocks on breaking tool contract changes
- OWASP scan: 0 critical findings

---

## Phase G — Public Launch (Planned — 2026 Q3/Q4)

Objective: Public availability of PRISM with ecosystem foundations, community infrastructure, and commercial tier readiness.

### G1: Ecosystem

- Plugin SDK: documented adapter pack authoring guide with signing support
- Community hub: Discord + GitHub Discussions
- Plugin marketplace v1: PRISM-curated, manually reviewed initial catalog
- Plugin registry API: `GET /api/plugins/registry` fetches community-verified adapter list
- Contribution guide and code of conduct

### G2: Go-to-Market

- External documentation site (separate from internal `/docs`)
- Getting Started guide: 5-minute path from install to first agent conversation
- Spectrum Refraction showcase: interactive demo of tri-model parallel generation
- Character showcase page: Aria/Phoenix/Sentinel live demos
- AaaS positioning white paper (public version of PAD whitepaper)
- Demo videos: 60-second and 5-minute variants
- Blog post series: "Agents as a Service", "Governed Autonomy", "Spectrum Refraction Explained"
- Outreach to enterprise AI governance communities, AI safety researchers

### G3: Commercial Readiness

- License model: dual-license (OSS Individual tier + commercial Business/Enterprise tier)
- Enterprise support tier: SLA definition, dedicated instance support, governance audit services
- Pricing model: freemium individual, per-seat SMB, enterprise contract
- SOC 2 Type II readiness assessment (evidence already exists via governance gates)
- Design partner program: 1–3 enterprise partners for pre-GA validation

### G: Exit Criteria

- 100+ plugin SDK downloads in first 30 days
- 1 enterprise design partner running PRISM in internal controlled environment
- External docs site has < 5 minutes time-to-first-agent for new users
- License model published with clear OSS/commercial boundary

---

## Phase H — Novel Systems Incubation (Planned — 2026 Q4/2027 Q1)

Objective: Prototype and integrate the three novel architectural pillars that represent PRISM's next-generation competitive differentiation.

### H1: Constitutional Causal Compiler (CCC)

- Compile policy + memory + workflow definitions into optimized runtime execution plans
- Pre-compute governance paths to reduce per-decision overhead
- CCC output: deterministic execution graph with pre-validated policy decisions per node
- Integration: CCC plans consumed by Orchestrator, bypassing policy evaluation for pre-approved paths
- Fallback: if CCC plan is stale, revert to runtime policy evaluation

### H2: Dual-Lens Memory Arbitration (DLMA)

- Fuse semantic relevance retrieval with causal consequence retrieval (two-lens model)
- Risk-aware context assembly: surface rollback-relevant context alongside task context
- Reduce semantically plausible but operationally unsafe recommendations
- Integration: replace current semantic-only retrieval with DLMA in orchestrator context assembly
- Metrics: DLMA coverage score, arbitration confidence, unsafe-recommendation reduction rate

### H3: Self-Healing Workflow Synthesis (SHWS)

- On workflow step failure: generate constrained repair candidates from failure context
- Policy-gated evaluation: repair candidates pass governance validation before promotion
- Safe promotion: approved repair replaces failed step; original logged for audit
- Integration: SHWS hooks into Orchestrator `onStepFailure` callback
- Exit: operator confirms or rejects SHWS proposals within approval window

### H4: Spectrum Refraction Evolution

- N-model fan-out: configurable hemisphere count (beyond tri-model)
- Hemisphere specialization profiles: domain-specific system prompts (legal analysis, code review, creative writing, factual research)
- SR cross-session learning: persist hemisphere performance metrics and recommend optimal model configurations per task type
- Agent-level SR tool: per-agent SR invocation with per-agent model assignment override
- SR memory: aggregate SR generation patterns to learn and improve hemisphere configuration recommendations

### H: Exit Criteria

- CCC produces deterministic execution plan from policy + workflow definition; plan executes 20% faster than runtime evaluation
- DLMA retrieval reduces unsafe-recommendation rate vs baseline by >= 15%
- SHWS successfully repairs >= 70% of simulated workflow failures in test harness
- N-model SR fan-out with 4 hemispheres produces coherent aggregation

---

## Phase I — Scale & Enterprise Expansion (Planned — 2027)

Objective: Production-scale multi-tenant deployment, regulatory compliance, professional/industrial domain packs, and mobile companion.

### I1: Cloud-Native Scale

- Kubernetes operator for multi-instance PRISM deployment
- Horizontal pod autoscaling for agent pools and workflow executors
- Distributed event bus (Kafka/NATS) replacing in-process ActivityBus for cluster-scale
- PostgreSQL HA with read replicas for session/activity stores

### I2: Enterprise Compliance Packs

- SOC 2 Type II audit completion
- GDPR data residency controls (per-tenant data isolation, right-to-erasure)
- HIPAA compliance pack (PHI handling, audit log immutability)
- EU AI Act alignment pack (risk classification, human oversight documentation)
- NIST AI RMF mapping document
- ISO 27001 evidence kit (policy controls, risk register)

### I3: Professional & Industrial Domain Packs

- **Professional Pack**: team workflow orchestration, compliance reporting, advanced analytics, multi-user session sharing
- **Industrial Pack**: critical operations playbooks, dual-control patterns, high-SLO execution tiers, incident-grade rollback

### I4: Enterprise IAM Integration

- SAML 2.0 SSO integration (Okta, Azure AD, Google Workspace)
- OIDC/OAuth 2.0 for user authentication
- Role-based access control (RBAC) for dashboard and API endpoints
- SCIM provisioning for automated user lifecycle management

### I5: Mobile Companion

- React Native or PWA mobile dashboard companion
- Push notifications for approval queue requests and critical alerts
- Mobile-optimized character interaction (voice-to-text, simplified chat)

### I: Exit Criteria

- Kubernetes deployment supports 50 concurrent users with p95 < 500ms governed mode
- SOC 2 Type II report issued
- Professional Pack: at least 3 team workflows operational end-to-end
- SAML SSO works with Okta and Azure AD

## Phase S1: Security Hardening (Done — April 2026)

- Token-based authentication gate for all dashboard HTTP and WebSocket endpoints
  - Auto-generated 256-bit admin token persisted to workspace
  - Timing-safe token comparison to prevent timing attacks
  - Public routes exempted: `/health`, `/api/health`, `/public/*`, `/setup*`
  - WebSocket upgrade requests authenticated via query param or header
  - Token injected into client-side HTML via `<meta>` tag for transparent API auth
- Rate limiting: per-IP fixed-window limiter (200 req/min default, configurable via `PRISM_RATE_LIMIT`)
- HTTPS/TLS support: optional via `PRISM_TLS_CERT` + `PRISM_TLS_KEY` environment variables
- Security headers on all responses: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
- Enhanced health endpoint: returns version, uptime, session ID, and mode

## Phase S2: User Testing Ready (Done — April 2026)

- PM2 process management (`ecosystem.config.js`)
  - Auto-restart on crash (max 10 restarts, 3s delay)
  - Memory limit restart (512 MB)
  - Log rotation with timestamps
  - Graceful shutdown support (5s kill timeout)
  - Optional: detected automatically by `start_web.bat` / `start_web.sh` when PM2 is installed
- WebSocket auto-reconnect with exponential backoff
  - Base delay 1s, doubles each attempt, capped at 30s
  - Maximum 50 retry attempts before giving up
  - Jitter (±20%) to prevent thundering herd
  - Reset on successful reconnection
  - Visual connection status indicator (green/red dot) in dashboard tab bar
- SSE (EventSource) reconnect with matching exponential backoff
  - Shared `createReconnector()` utility in `dashboard-core.js`
- Docker deployment support
  - Multi-stage `Dockerfile` (node:22-alpine, ~200MB image)
  - `docker-compose.yml` with persistent volume for `Prism_Refraction` workspace
  - Health check configured (30s interval, wget to `/health`)
  - `.dockerignore` for efficient builds
- Provider health endpoint: `GET /api/llm/provider-health`
  - Tests all 16 configured providers in parallel
  - Returns `{ providerId, ok, message, models, latencyMs }` per provider
  - Latency measurement added to all `testProvider()` calls

## Phase S3: Setup Wizard Completeness (Done — April 2026)

Objective: Ensure all three PRISM interfaces (Web Dashboard, TUI, and headless CLI) have complete, well-documented setup wizard experiences, and that comprehensive wizard documentation exists for both end users and developers.

### Current State

- **Web Setup Wizard** (4-step): Profile → Workspace → Provider → Summary — `setup-wizard.js`, served at `/setup`
- **Web Advanced Wizard** (8-step): Profile → Workspace → Provider → Model Routing → Guardian Agent → CAC Identity → Browser/Scheduler → Certificate — `setup-wizard-advanced.js`, served at `/setup/advanced`
- **TUI Setup Wizard** (4-step): Interactive React/Ink tab in TUI — `src/tui/tabs/SetupWizardTab.tsx`
- **CLI Setup Wizard** (4-step): ✅ Implemented — Pure Node.js readline-based interactive wizard at `src/cli/setup-wizard.ts`
- **`start_wizard.bat`**: Launches server and opens web wizard, or `start_wizard.bat --cli` for CLI wizard
- **`start_wizard.sh`**: Linux/macOS equivalent with `--cli` flag support

### S3-M1: CLI Setup Wizard Implementation (Done — April 2026)

- Pure Node.js readline-based interactive wizard (no Ink/React dependency)
- Works in any terminal: SSH, CI, Docker exec, minimal containers
- Same 4-step flow as web wizard:
  1. Execution Profile selection (individual / business)
  2. Workspace directory validation and configuration
  3. LLM Provider selection + optional API key entry (masked input)
  4. Summary, readiness check, and completion
- Consumes the same setup API endpoints as web wizard (`/api/setup/*`)
- Supports non-interactive mode via environment variables or CLI flags:
  - `--profile individual|business`
  - `--workspace /path/to/workspace`
  - `--provider ollama|openai|anthropic|...`
  - `--api-key <key>`
  - `--non-interactive` (uses defaults/env vars, no prompts)
- Invocation:
  - `npm run setup` or `node dist/src/cli/setup-wizard.js`
  - `start_wizard.bat --cli` flag to prefer CLI over browser
  - `start_wizard.sh` equivalent for Linux/macOS
- Exit criteria:
  - All 4 steps complete with validation feedback
  - Provider connectivity test runs inline
  - Readiness summary printed at completion
  - `.prism-preferences.json` written with same schema as web wizard
  - Activity event `prism.setup_wizard.complete` emitted with `source: 'cli'`

### S3-M2: CLI Advanced Wizard (Done — April 2026)

- Extended CLI wizard matching the 8-step advanced web wizard
- Invocation: `npm run setup:advanced` or `--advanced` flag
- Implementation: `src/cli/setup-wizard-advanced.ts`
- Additional steps:
  - Model routing strategy selection (single / multi-provider / modality-based)
  - Guardian Agent configuration (model, tier, auto-start)
  - CAC identity binding (character, operator email, workspace hub)
  - Browser profile and scheduler pre-configuration
- Certificate generation at completion (markdown + session package)

### S3-M3: Wizard Documentation (Done — April 2026)

- `docs/SETUP_WIZARD_GUIDE.md` — Comprehensive standalone guide covering:
  - Web wizard walkthrough (4-step and 8-step advanced)
  - TUI wizard walkthrough
  - CLI wizard walkthrough (basic and advanced)
  - Non-interactive/headless setup for CI/Docker
  - Re-running the wizard to reconfigure
  - Troubleshooting common setup issues
- `docs/USER_GUIDE.md` — New §4A "Setup Wizard" section:
  - When to use each wizard variant
  - Step-by-step instructions for first-run setup
  - Screenshots / terminal output examples
- `docs/DEVELOPER_GUIDE.md` — New §7E "Setup Wizard Architecture" section:
  - API endpoint reference (`/api/setup/*`)
  - State persistence model (`.prism-preferences.json`)
  - Adding new wizard steps
  - Testing wizard flows
  - Frontend integration patterns

### S3-M4: Wizard Parity Validation (Done — April 2026)

- All three wizard surfaces (web, TUI, CLI) produce identical `.prism-preferences.json` output
- Readiness checks return consistent results across all surfaces
- Activity events emitted with correct `source` field (`web`, `tui`, `cli`)
- Non-interactive CLI mode tested in Docker container and CI pipeline
- Test evidence: `tests/wizard-parity.test.ts` (25 tests, 8 suites)

---

## 2026 Q2 — Phase R (Readiness) and Beyond

Phase R (Readiness) has been added between Phase E and Phase F based on the [2026 Q2 audit](PRISM_FULL_AUDIT_2026_Q2.md). Phase R closes the gap between "code complete" and "user-testable + production-deployable."

For the full roadmap — E-Close residuals, Phase R's 8 workstreams (R1 config hygiene, R2 security hardening, R3 wizard UX, R4 E2E tests, R5 ops/data, R6 observability, R7 CI/CD, R8 docs), and extended F / G / H / I plans — see:

- [PRISM_UPDATED_ROADMAP_2026_Q2.md](PRISM_UPDATED_ROADMAP_2026_Q2.md) — formal updated roadmap
- [READINESS_RUNBOOK.md](READINESS_RUNBOOK.md) — operator checklist with task IDs, target files, acceptance criteria, and effort bands
- [PRISM_FULL_AUDIT_2026_Q2.md](PRISM_FULL_AUDIT_2026_Q2.md) — audit baseline and canonical gap list G-1 through G-25
- [PRISM_COMPETITIVE_AaaS_MAP_2026.md](PRISM_COMPETITIVE_AaaS_MAP_2026.md) — AaaS market survey and competitive positioning

Phase summary:

| Phase | Status | Window |
|---|---|---|
| A / B / C / D1 / D2 / D3 / D4 | Closed | Through April 2026 |
| E — Integration Hardening | Active | May–Jun 2026 |
| **R — Readiness (NEW)** | Planned | Jun–Jul 2026 |
| F — Expansion (A2A, OCI, Python SDK) | Planned | Aug–Oct 2026 |
| G — Ecosystem (marketplace, docs site) | Planned | Nov 2026 – Q1 2027 |
| H — Enterprise (SSO, multi-tenant, HA) | Planned | Q2 2027 |
| I — Compliance & Scale (SOC 2 II) | Planned | Q3 2027 |
