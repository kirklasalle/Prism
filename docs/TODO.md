# PRISM TODO

Date: 2026-04-20

Actionable work items extracted from ROADMAP.md and engineering sessions. See ROADMAP.md for full milestone context and sequence.

## Recently Completed

### Phase D4c + Production Hardening (April 2026)

- [x] SR multi-key model slot assignment (leftSlot, rightSlot)
- [x] SR per-hemisphere timeout configuration (leftTimeoutMs, rightTimeoutMs)
- [x] SR circuit breaker with auto-reset
- [x] SR audit trail with signed activity events
- [x] SR cost estimation (pre-flight token count)
- [x] SR show-hemispheres mode
- [x] Approval endpoint path alignment (TUI client ↔ server routes)
- [x] POST /api/tools/stage approval_routing wired to ApprovalQueue
- [x] SQLite WAL mode for ChatSessionStore
- [x] Guardian dashboardBaseUrl — decoupled from hardcoded localhost:7070
- [x] Health endpoint enriched with dependency detail
- [x] Startup env validation with production warnings
- [x] Graceful shutdown activity event before store teardown
- [x] tool-contract-extractor fake fallbacks removed
- [x] container-sandbox-adapter Math.random() snapshot size fixed
- [x] terminal-session-tool simulated advisory surfaced
- [x] PRISM_AUTH_DISABLED production guard
- [x] Request body size limit (10 MB cap, DoS protection)
- [x] tests/chat-session-store.test.ts (12 tests)
- [x] tests/approval-queue-integration.test.ts (11 tests)
- [x] CHANGELOG.md updated with v0.4.2 entry

### User Testing Ready (Phase S2 — April 2026)

- [x] PM2 process management with auto-restart, memory limits, log rotation
- [x] WebSocket auto-reconnect with exponential backoff (1s → 30s cap, max 50 retries)
- [x] SSE (EventSource) reconnect with matching exponential backoff
- [x] Docker support: multi-stage Dockerfile, docker-compose.yml, .dockerignore
- [x] Provider health endpoint: `GET /api/llm/provider-health` with latency measurement
- [x] Connection status indicator in dashboard tab bar

### Security Hardening (Phase S1 — April 2026)

- [x] Token-based authentication gate for dashboard HTTP and WebSocket endpoints
- [x] Rate limiting: per-IP fixed-window (200 req/min, configurable via `PRISM_RATE_LIMIT`)
- [x] HTTPS/TLS support via `PRISM_TLS_CERT` + `PRISM_TLS_KEY` env vars
- [x] Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
- [x] Enhanced health endpoint: version, uptime, sessionId, mode

### Agent Control & Swarm Intelligence (Phase D3)

- [x] Agent lifecycle management (ephemeral/semi-permanent/permanent)
- [x] Per-agent model assignment and hot-swap
- [x] Intelligent telemetry: dispatch pattern detection, promotion recommendations
- [x] Swarm orchestration: mesh, star, pipeline, broadcast topologies
- [x] Chat-to-agent routing with classifier-first intent detection
- [x] Guardian Agent (llama.cpp) permanent autonomous agent

### Setup Wizard Completeness (Phase S3 — April 2026)

- [x] CLI Setup Wizard: pure readline-based interactive 4-step wizard (no Ink dependency)
- [x] CLI non-interactive mode via `--profile`, `--workspace`, `--provider`, `--api-key`, `--non-interactive` flags
- [x] CLI Advanced Wizard: 8-step version with routing, guardian, CAC, browser/scheduler
- [x] `start_wizard.sh` — Linux/macOS equivalent of `start_wizard.bat`
- [x] `npm run setup` / `npm run setup:advanced` scripts in package.json
- [x] `docs/SETUP_WIZARD_GUIDE.md` — Comprehensive standalone wizard documentation
- [x] `docs/USER_GUIDE.md` §4A — Setup Wizard user walkthrough
- [x] `docs/DEVELOPER_GUIDE.md` §7E — Setup Wizard architecture and API reference
- [x] Wizard parity validation: identical output across web, TUI, and CLI surfaces (25 tests, 8 suites)

### Tool Contract Extraction Gap Remediation (April 2026)

- [x] Replace `extractFromManifest()` stub with real JSON manifest file parsing
- [x] Replace `extractFromDecorators()` stub with ToolRegistry-based extraction
- [x] Replace `extractFromDynamic()` stub with governance-inferred extraction
- [x] Enhance `assessRiskTier()` from keyword-only to 6-dimension scoring
- [x] 21 tests passing (10 existing + 11 new in `tests/tool-contract-extractor-real.test.ts`)
- [x] Update TOOL_CONTRACT_EXTRACTION_SPEC.md Known Gaps (4 of 5 resolved)

## Near-Term (Active)

### Production Qualification (Phase D)

- [x] Wire `POST /api/tools/stage` HTTP endpoint in dashboard-service.ts — landed in v0.4.2 (`src/core/operator/dashboard-service.ts` ~L4552, tested by `tests/tool-staging-api-routes.test.ts`)
- [x] Complete approval handler response flow in tool-contract-extractor.ts — bidirectional `consumeApprovalDecision()` + `getContractChangeStatus()` with ApprovalQueue resolver wiring (May 2026)
- [x] Generate missing release packet markdown reports (governance-path, lifecycle, plugin-compat, claim-alignment) — produced by `scripts/generate-release-packet.ts` (`npm run release:generate-packet`)
- [x] Close RTM items D2-R10, D2-R11, D2-R12 (release packet traceability) — verified PASS in RTM
- [x] Generate `release-packet-manifest.md` and `go-no-go-signoff.md` — manifest auto-emitted by generator; `docs/go-no-go-signoff.md` retained as manual review artifact for v0.4.2

### Spectrum Refraction Enhancements (Phase D4c — COMPLETE)

- [x] Multi-key provider support: extend `ProviderSecretStore` with `getApiKey(providerId, slot?)` for multiple API keys per provider, enabling full isolation within a single provider (e.g., `openai:a` vs `openai:b`)
- [x] Per-hemisphere timeout: configurable timeout per SR hemisphere with partial aggregation on timeout (return completed hemisphere results + advisory)
- [x] Circuit breaker per hemisphere: if a provider is down, degrade gracefully to single-hemisphere output with advisory
- [x] SR audit trail: dedicated ActivityBus events for SR generations with hemisphere timing, isolation level, and token usage
- [x] Cost estimation before activation: estimate per-generation cost based on model pricing + average token usage and surface via `GET /api/sr/cost-estimate`
- [x] Transparent hemisphere output: optional `showHemispheres` toggle to expose individual Left/Right outputs alongside aggregated result
- [x] SR test coverage: 20/20 tests in `spectrum-refraction-advanced.test.ts` covering all D4c features

### Individual-Native MVP

- [x] Email triage + draft workflow template — `templates.email` in `src/core/runtime/domain-workflow-templates.ts` (steps: `email_scan` → `email_send` with `email_draft_fallback` on failure/timeout); tested in `tests/domain-workflow-templates.test.ts`
- [x] Calendar conflict + day planning integration — `templates.calendar` (steps: `calendar_fetch` (detect_conflicts) → `calendar_commit` with `calendar_propose_fallback`); same test file
- [x] Notes capture + extraction pipeline — `templates.notes` (steps: `notes_capture` → `notes_persist` with `notes_extract_fallback`); same test file
- [x] Chronological tasks/events planning — `templates.tasks` (steps: `tasks_analyze` → `tasks_commit` with `tasks_replan_fallback`); same test file plus `src/benchmarks/d1-workflow-template-qualification.ts`
- [x] Policy-path integration tests for mutating operations (allow/deny/timeout) — `tests/policy-path-mutating-ops.test.ts` covers `email_ops.send`, `calendar_plan.create_or_update_event`, `file_write`, `browser.navigate`/`screenshot`/`click`/`submit_form` plus an ApprovalQueue timeout roundtrip; registered in `tests/index.ts` as `PolicyPathMutatingOps`

### Retrieval & Memory

- [x] Expand profile-specific alert tuning based on production incident trends — `IncidentTrendStore` ([incident-trend-store.ts](src/core/memory/incident-trend-store.ts)) + `tuneFromIncidentTrends()` ([retrieval-alert-policy.ts](src/core/memory/retrieval-alert-policy.ts)); `GET /api/retrieval/incident-trends`. Tests: [operator-surfaces-phase-e3.test.ts](tests/operator-surfaces-phase-e3.test.ts) (`testIncidentTrendStore`, `testRetrievalAlertTuning`).
- [x] Retrieval quality proxy tuning: coverage, novelty, utility scoring baselines — `RetrievalMetricsCollector` (`src/core/memory/retrieval-metrics.ts`) computes coverage/novelty/utility per query; `RetrievalDashboardStore.getTrendReport()` (`src/core/memory/retrieval-dashboard-store.ts`) does baseline-vs-latest comparison; surfaced via `GET /api/retrieval/trends`

### Adapter Hardening

- [x] Expand safety regression tests for system and protocol adapters — three layered suites now in place: `tests/adapter-safety.test.ts` (broad happy-path baseline), `tests/adapter-safety-expanded.test.ts` (Shell/File/HTTP hostile + boundary inputs, registered as `AdapterSafetyRegressionExpanded`), and `tests/network-adapter-safety.test.ts` (NetworkTool allowlist + tier-classifier regression: empty/whitespace, unknown-command rejection with `allowedPrefixes`, longest-prefix tier3 win, blocked-beats-allowlisted, case-insensitive blocking, cross-platform gate; registered as `NetworkAdapterSafety`). Companion mocha suites `tests/network-blocked-patterns.test.ts` and `tests/mcp-client-tool.test.ts` remain in place for the protocol surface.
- [x] Baseline-to-candidate contract diff policy and release blocking rules — `scripts/contract-diff-gate.cjs` exits 1 on breaking changes (`removed`/`schema_changed`); npm scripts `release:contract-diff-gate` and `release:contract-diff-gate:allow-breaking`; smoke-tested by `tests/contract-diff-gate.test.ts`
- [x] SQLite migration compatibility across historical schema variants — `MigrationRunner` (`src/core/db/migrations.ts`) enforces strictly-ascending versions with SHA-256 checksum drift detection; coverage in `tests/db-migrations.test.ts` (R5-2 unit tests) + `tests/sqlite-migrations.test.ts` (`testSqliteMigrations`) + per-store idempotency in `tests/chat-session-store.test.ts`

### Performance

- [x] Contention scenario expansion for mixed approve/deny/timeout profiles — `tests/approval-contention-mixed-outcomes.test.ts` exercises all three resolution paths (approve/deny/timeout) against `ApprovalQueue` with deterministic counts and bounded latencies, alternating Individual ↔ Business profiles
- [x] Profile-differentiated trend history and regression drift alerts in CI — [`scripts/perf-trend-report.cjs`](scripts/perf-trend-report.cjs) maintains 30-entry rolling p50/p95 history per profile; warns at +15% drift, fails at +30% (`PRISM_PERF_GATE=strict`); CI artifact `profile-trends` uploaded by [`quality-gates.yml`](.github/workflows/quality-gates.yml). Tests: `testPerfTrendReport` in [tests/perf-trend-report.test.ts](tests/perf-trend-report.test.ts).

## Medium-Term (Planned)

### Operator Surfaces

- [x] Incident triage guide (runbook-grade) — `docs/INCIDENT_TRIAGE_RUNBOOK.md` (operator playbook covering symptom triage, evidence-bundle capture via `POST /api/incidents/bundle`, escalation paths, and severity matrix)
- [x] Session trace explorer UX/API — `src/core/operator/session-trace-explorer.ts` (`SessionTraceExplorer.exportBundle()`) wired into `dashboard-service.ts` ~L1572 with bundles surfaced via incident endpoint
- [x] Policy bundle diff and audit export tools — `src/core/operator/policy-audit-exporter.ts` (`PolicyAuditExporter.exportBundle()`) emits per-session policy decision audit; surfaced through incident bundle and operator dashboard
- [x] Live plugin enable/disable toggle and MCP server health monitoring — see E3 *Live Plugin Toggle*; `POST /api/(v1/)?plugins/:name/toggle` in `dashboard-service.ts` ~L4524 with health polling in `tab-tools.js`
- [x] Utility execution triggers from dashboard — `UtilityRegistry` ([utility-registry.ts](src/core/operator/utility-registry.ts)); routes `GET /api/v1/utilities`, `POST /api/v1/utilities/:id/execute`, `GET /api/v1/utilities/runs/:runId`. Tests: `testUtilityRegistry`.
- [x] Tool risk-level editing and custom policy override from UI — `RiskOverrideStore` ([risk-override-store.ts](src/core/operator/risk-override-store.ts)); routes `GET/PATCH/DELETE /api/v1/tools/:toolId/risk` + `GET /api/v1/tools/risk-overrides`. Tests: `testRiskOverrideStore`.
- [x] Real-time performance SLO gauge panels in Telemetry tab — see E3 *SLO Gauge Panel* (`#slo-gauge-panel` in `tab-telemetry.js`/`.html`, fed by `computeSloSummary()`)

### CAC Identity Expansion

- [x] Browser automation identity binding with client fingerprint — see E5 (`src/core/operator/browser-session-manager.ts` binds Playwright user-agent/viewport/session token into the CAC chain)
- [x] Email provider OAuth integration (Google, Microsoft) — already shipped in `email-oauth-adapter.ts` / `outlook-oauth-adapter.ts`; surfaced via dashboard E5 verification flow (`POST /api/v1/cac/:assignmentId/verify-email`). Tests: existing `oauth-adapters.test.ts` + new `testCharacterAccountabilityPhaseE3`.
- [x] Per-character permission scopes and assignment expiry — see E5 (`CharacterAssignment.permissionScopes` + `revokeExpiredScopes()` self-review scheduler in `character-accountability-manager.ts`; tested in `tests/character-accountability.test.ts`)
- [x] Dashboard CAC panel: visual chain inspector and identity audit export — `getAssignmentChain()` + `exportAudit()` on `CharacterAccountabilityManager`; routes `GET /api/v1/cac/assignments`, `GET /api/v1/cac/assignments/:id/chain`, `GET /api/v1/cac/export?format=csv|json`, `POST /api/v1/cac/:id/verify-email`. Tests: `testCharacterAccountabilityPhaseE3`.

### CI/CD

- [x] CI publication of profile-differentiated performance trend history — [`scripts/perf-trend-report.cjs`](scripts/perf-trend-report.cjs) generates `prism-output/profile-trends/{profile}-history.json` + `profile-trends-summary.md`; uploaded by `quality-gates.yml` via `profile-trends` artifact. Soft-warn at +15%, hard-fail at +30% only when `PRISM_PERF_GATE=strict`. Tests: `testPerfTrendReport`.
- [x] Baseline-to-candidate contract diff policy for automated release blocking — see Adapter Hardening above (`scripts/contract-diff-gate.cjs`)

## Aspirational / Wishlist

### Novel Systems Incubation

- [x] Constitutional Causal Compiler (CCC) prototype: auto-compile policy + memory + workflow constraints into enforceable runtime plans — [`src/core/incubation/ccc/`](src/core/incubation/ccc/) (`compiler.ts`, `enforcer.ts`, `constitution.ts`, `types.ts`); sample [`examples/constitutions/business-default.json`](examples/constitutions/business-default.json); routes `/api/v1/incubation/ccc/{compile,constitutions}` (PRISM_INCUBATION-gated); tests: `testCccCompiler`.
- [x] Dual-Lens Memory Arbitration prototype: semantic relevance lens + causal consequence lens with confidence fusion — [`src/core/incubation/dlma/`](src/core/incubation/dlma/) (`arbiter.ts`, `causal-lens.ts`, `fusion.ts`, `types.ts`); EMA-driven weight feedback over `SemanticMemoryIndex` + `EpisodicMemory`; routes `/api/v1/incubation/dlma/{query,weights}`; tests: `testDlmaArbiter`.
- [x] Self-Healing Workflow Synthesis prototype: runtime transforms failed workflow segments into candidate alternatives under policy constraints — [`src/core/incubation/shws/`](src/core/incubation/shws/) (`synthesizer.ts`, `policy-validator.ts`, `history-index.ts`, `orchestrator-integration.ts`, `types.ts`); never auto-executes (always tier-3 ApprovalQueue), max depth 3, max 1 active synthesis per workflow; CCC-validated; routes `/api/v1/incubation/shws/{propose,recent-syntheses}`; tests: `testShwsSynthesizer`.

### SR Future Vision (Kirk LaSalle)

- [x] Quad-model or N-model fan-out: extend SR beyond tri-model to arbitrary hemisphere count — [`model-capability-matrix.ts`](src/core/operator/model-capability-matrix.ts) `HemisphereSpec` + `normalizeSRConfig` (cap `SR_MAX_HEMISPHERES=8`, backward-compat with legacy `leftModel`/`rightModel`); test: `SRNModelFanout`.
- [x] Hemisphere specialization profiles: domain-specific system prompts per hemisphere (e.g., legal analysis, code review, creative writing) — [`sr-hemisphere-profiles.ts`](src/core/operator/sr-hemisphere-profiles.ts) profiles: `logic`, `creative`, `legal-analysis`, `code-review`, `creative-writing`, `research-synthesis`, `reasoning-deep`, `summarization`.
- [x] SR memory: persist SR generation patterns and learn which hemisphere configurations produce best results per task type — [`sr-memory-store.ts`](src/core/memory/sr-memory-store.ts) rolling JSON cap 500.
- [x] Cross-session SR learning: aggregate SR performance metrics across sessions for model recommendation engine — [`sr-recommender.ts`](src/core/memory/sr-recommender.ts) blended `0.6·utility + 0.2·(1/(1+cost)) + 0.2·succeededRatio`; test: `SrMemoryAndRecommender`.
- [x] SR-aware agent routing: agents can invoke SR generation as a tool for complex reasoning tasks — [`sr-tool.ts`](src/adapters/cognition/sr-tool.ts) `cognition.spectrum_refraction` tool with cost gate $0.10 + opt-in `PRISM_SR_AGENT_ROUTING` heuristic; test: `SrTool`.

### Platform Evolution

- [x] Multi-tenant workspace support — [`tenant-context.ts`](src/core/config/tenant-context.ts) AsyncLocalStorage `withTenant`/`tenantSubroot` + `X-Prism-Tenant` middleware; gated `PRISM_MULTI_TENANT=on`; default tenant preserves legacy behavior; test: `TenantContext`.
- [x] Remote/cloud workspace sync — [`src/core/sync/`](src/core/sync/) `SyncAdapter` interface + `NoopSyncAdapter` + `FilesystemSyncAdapter` (JSONL, idempotent cursor, replay-tagged) + `SyncEngine`; HTTP/cloud transports follow without touching call sites; test: `SyncScaffold`.
- [x] Plugin marketplace with community-verified adapter packs — [`plugin-marketplace.ts`](src/core/plugins/plugin-marketplace.ts) catalog read/install/uninstall with `file://` transport (HTTP deferred to security review), business profile rejects `unsigned`; sample [`examples/marketplace/catalog.json`](examples/marketplace/catalog.json); test: `PluginMarketplace`.
- [x] Mobile/tablet dashboard companion — [`public/manifest.json`](public/manifest.json) + [`public/service-worker.js`](public/service-worker.js) (cache-first static, network-first GET API, never-cache mutating) + [`public/phase-i-mobile-polish.css`](public/phase-i-mobile-polish.css) (44×44 tap targets via `@media (hover: none) and (pointer: coarse)`); test: `PwaAssets`.

---

## Phase E — Integration Hardening (Active — 2026 Q2)

### E1: Real Adapters [P0 — BLOCKING for user deployment]

#### E1a: Real PTY Terminal (node-pty)

- [x] `npm install node-pty @types/node-pty` — listed under `optionalDependencies`
- [x] `terminal-session-adapter.ts`: dynamic import `node-pty` with graceful fallback (`tryInitPty()`)
- [x] Replace `child_process.spawn(shell, [], {stdio:["pipe","pipe","pipe"]})` in `startSession()` with `pty.spawn(shell, [], {cwd, env, cols:80, rows:24})`
- [x] Refactor `execCommand()` for single-stream PTY output (no separate stdout/stderr)
- [x] Add `resize(cols, rows)` method on `TerminalSessionAdapter` (`resizeTerminal`)
- [x] Cleanup: `ptyProcess.kill()` on session revoke/timeout
- [x] `isPtyEnabled()` method returns `true` when node-pty available, `false` on fallback
- [x] Update exec response `advisory` field: `"real-pty"` or `"simulated-mock"`
- [x] Tests: `tests/terminal-session-adapter.test.ts` covers PTY-specific paths

#### E1b: Real Docker Container Isolation (dockerode) — SUPERSEDED BY DESIGN

> **Deferred-by-design**: PRISM ships a built-in filesystem-isolated container runtime (`getRuntimeBackend() === "builtin-prism"`) instead of a Docker daemon dependency. Avoiding `dockerode` was a deliberate deployment choice so end users don't need Docker installed. The original Docker-based bullets are retained below for historical reference; they are not active work.

- [~] `npm install dockerode @types/dockerode` — listed in `optionalDependencies` but not used by production path
- [~] `container-sandbox-adapter.ts`: dynamic import `dockerode` + `docker.ping()` health check on init — superseded by built-in runtime
- [~] Replace mock `spawn("sh",["-c","sleep infinity"])` in `startContainer()` with `docker.createContainer(...)` — not pursued; built-in runtime uses per-container filesystem namespaces
- [~] Replace stdin-echo exec with `docker exec` via `container.exec(...)` — superseded
- [~] Implement `takeSnapshot()` via `container.commit(...)` — implemented via filesystem copy in built-in runtime
- [~] Implement `revertToSnapshot()` via `docker.createContainer({Image: snapshotTag})` — implemented via filesystem restore in built-in runtime
- [~] `isDockerEnabled()` method — present, returns `false` permanently in built-in runtime
- [~] Update exec response `advisory` field — built-in runtime surfaces `"builtin-prism"` advisory
- [~] Tests: `tests/container-sandbox-adapter.test.ts` exercises the built-in runtime paths

### E2: Email & Calendar OAuth [P1]

- [x] `email-tool.ts`: Gmail OAuth 2.0 flow (authorize URL → token exchange → refresh → mailbox operations) — [`email-oauth-adapter.ts`](src/adapters/application/email-oauth-adapter.ts)
- [x] `email-tool.ts`: Outlook OAuth 2.0 flow via MSAL (same interface) — [`outlook-oauth-adapter.ts`](src/adapters/application/outlook-oauth-adapter.ts)
- [x] `calendar-tool.ts`: Google Calendar API (event CRUD, free/busy, conflict detection) — integrated via Gmail adapter scopes
- [x] `calendar-tool.ts`: Outlook Calendar API (event CRUD, calendar view, conflict detection) — integrated via Outlook adapter scopes
- [x] OAuth token persistence via `ProviderSecretStore` (`getApiKey("gmail:token")`, etc.) — see [`oauth-token-store.ts`](src/core/operator/oauth-token-store.ts)
- [x] Setup Wizard Step 3b: email & calendar OAuth account connection — [`setup-wizard-advanced.js`](src/core/operator/public/setup-wizard-advanced.js) Step 8 *Integrations*
- [x] Dashboard Settings: OAuth account connection status panel (connected/disconnected per provider) — [`tab-settings.js`](src/core/operator/public/tab-settings.js) Section 10b
- [x] Tests: existing [`tests/oauth-adapters.test.ts`](tests/oauth-adapters.test.ts) covers graceful unavailability + adapter contract; live OAuth roundtrip deferred to manual verification (no real provider credentials in CI by policy)

### E3: Dashboard UX Uplift [P1]

- [x] **Simple Mode**: character picker landing page with chat panel + settings drawer — `src/core/operator/public/simple-mode.js` ships character picker, single chat panel, mode toggle
  - [x] `public/simple-mode.js` — Simple Mode UI module
  - [x] Character picker: Aria/Phoenix/Sentinel cards with profile badge (`#sm-character-picker`)
  - [x] Single chat panel (no tabs), history sidebar, minimal chrome
  - [x] `GET /` serves Simple Mode by default for new users (no prior session)
  - [x] Toggle: "Advanced Mode →" button switches to full operator dashboard
- [x] **CAC Identity Panel** (tab-settings.js): mounted via additive [`phase-e3-panels.js`](src/core/operator/public/phase-e3-panels.js) into `#phase-e3-cac-panel` anchor in [`tab-settings.html`](src/core/operator/public/tab-settings.html)
  - [x] Visual accountability chain: characterId → operatorId → sessionId — served by `GET /api/v1/cac/assignments/:id/chain` (calls `CharacterAccountabilityManager.getAssignmentChain()`)
  - [x] Assignment lifecycle timeline (assign → active → suspend → resume → revoke) — included in chain payload (`AccountabilityChain.events[]`)
  - [x] Export button: JSON/CSV identity audit export — `GET /api/v1/cac/export?format=json|csv` (calls `exportAudit()`)
- [x] **SLO Gauge Panel** (tab-telemetry.js): `#slo-gauge-panel` rendered in `tab-telemetry.js`/`tab-telemetry.html`, fed by `MetricsStore` via `computeSloSummary()` in `dashboard-service.ts`
  - [x] Real-time p50/p95/p99 vs SLO target bars
  - [x] Color: green (< 80% of target), yellow (80–100%), red (> target)
  - [x] Refresh interval: 5s
- [x] **Live Plugin Toggle** (tab-tools.js): `toggleItemEnabled('plugin', name)` posts to `/api/v1/plugins/:name/toggle` (`dashboard-core.js`)
  - [x] Enable/Disable MCP server toggle with immediate effect via `POST /api/plugins/{name}/toggle`
  - [x] Health indicator polling every 30s
- [x] **Incident Triage UI** (tab-logs.js): `captureIncidentBundle()` posts to `/api/incidents/bundle` and downloads evidence JSON
  - [x] Guided runbook: expandable checklist steps
  - [x] Copy-to-clipboard for evidence bundles (activity events + session trace)
- [x] **API Versioning**: `/api/v1/*` prefix with normalization passthrough to `/api/*` handlers in `dashboard-service.ts` (~L2793); `/api/v1/openapi.json` serves OpenAPI 3.0 spec
  - [x] Prefix all routes with `/api/v1/` in `dashboard-service.ts`
  - [~] Backward-compat: `/api/` paths normalize to `/api/v1/` handlers (transparent, not a 301 redirect — current behaviour preserves clients that depend on either prefix)
  - [x] `GET /api/v1/openapi.json` — serves generated OpenAPI 3.0 spec

### E4: Plugin Cryptographic Signatures [P1]

- [x] `plugin-pack-validator.ts`: implement `verifyEd25519Signature(manifest, signature, publicKey)`
- [x] Trust-tier enforcement: `official` (signed by PRISM key), `community` (signed by trusted key), `unsigned` (dev-mode only)
- [x] Key registry: `config/plugin-signing-keys.json` (PRISM official key + community trusted keys)
- [x] Business profile: reject unsigned plugins at activation
- [x] Individual profile: warn on unsigned, allow with explicit confirmation
- [x] Tests: extend `tests/plugin-pack-validator.test.ts` with signature verification cases

### E5: CAC Identity Expansion [P1]

- [x] `browser-session-manager.ts`: bind Playwright session fingerprint (user-agent, viewport, session token) to CAC chain
- [x] `character-accountability-manager.ts`: add `permissionScopes` field with expiry-based auto-revocation
- [x] Add `permissionScopes` to `CharacterAssignment` type
- [x] Self-review scheduler: `revokeExpiredScopes()` on `CharacterAccountabilityManager` checks and revokes
- [x] OAuth email verification for Business profile characters (Google/Microsoft) — `markEmailVerified(assignmentId, email, provider)` + `isEmailVerificationFresh()` on `CharacterAccountabilityManager`; `POST /api/v1/cac/:assignmentId/verify-email` route; policy-engine gate emits `CAC_EMAIL_VERIFICATION_REQUIRED` for Business + tier≥2 + email-bound tools without fresh (≤30d) verification. Tests: `testCharacterAccountabilityPhaseE3` in [tests/character-accountability.test.ts](tests/character-accountability.test.ts).
- [x] Tests: extend `tests/character-accountability.test.ts` with scope expiry and browser binding cases

### E6: Observability Integration [P1]

- [x] `src/core/activity/otel-exporter.ts`: OpenTelemetry trace exporter (emit activity events as OTel spans) — `OtelExporter` subscribes to ActivityBus and drives MetricsStore counters/histograms
- [x] `dashboard-service.ts`: `GET /metrics` endpoint (Prometheus text format) — registered in publicRoutes; handler at ~L7072
  - [x] Counters: `prism_requests_total`, `prism_errors_total`, `prism_policy_decisions_total` — see `MetricsStore` in `src/core/activity/metrics-store.ts`
  - [x] Histograms: `prism_request_duration_ms`, `prism_policy_latency_ms`, `prism_retrieval_latency_ms`
  - [x] Gauges: `prism_active_sessions`, `prism_approval_queue_depth`, `prism_agent_pool_size`
- [x] `docs/grafana/prism-dashboard.json` — starter Grafana dashboard template (with `docs/grafana/README.md` import guide)
- [x] Tests: `tests/metrics-endpoint.test.ts` — validates Prometheus format and exporter integration

---

## Phase F — Production Qualification & Private Beta [P2]

- [x] Database abstraction layer (`ISessionStore`, `IActivityStore` interfaces) — [`src/core/database/store-interfaces.ts`](../src/core/database/store-interfaces.ts); `ChatSessionStore` and `SqliteActivityStore` declared `implements`. Tests: `PersistenceInterfaces` in [`tests/persistence-interfaces.test.ts`](../tests/persistence-interfaces.test.ts).
- [x] PostgreSQL adapter implementation (Prisma or `pg`) — [`postgres-database-adapter.ts`](../src/core/database/postgres-database-adapter.ts) scaffold with dynamic `pg` import (no new dep), `:named`→`$N` translator, `selectedBackend()` factory keyed off `PRISM_DATABASE_BACKEND`. Tests: `PostgresAdapter`.
- [x] Multi-tenant workspace namespace support — `workspacePath()` in [`workspace-resolver.ts`](../src/core/config/workspace-resolver.ts) wired to `tenantSubroot()`; `untenantedWorkspacePath()` for shared assets; legacy path preserved when `PRISM_MULTI_TENANT≠on`. Tests: `MultiTenantWorkspace`.
- [x] 72-hour staging soak test (target: 0 unhandled rejections) — `npm run soak:smoke` (5min) / `npm run soak:staging` (72h via `PRISM_SOAK_DURATION_MS`); harness at [`scripts/soak-harness.cjs`](../scripts/soak-harness.cjs); RSS-slope + rejection budget verdict. Tests: `SoakHarness` validates aggregation math.
- [x] 10 concurrent session stress test (Business/governed p95 < 500ms) — `npm run stress:concurrent`; harness at [`scripts/stress-concurrent-sessions.cjs`](../scripts/stress-concurrent-sessions.cjs); profile-aware SLO defaults (business=500ms, individual=1500ms). Tests: `StressHarness`.
- [ ] Private beta: 10–20 users recruited (individual + SMB + enterprise IT) — operational, not source-tree work.
- [x] CI/CD: automated tool contract diff gate (baseline-to-candidate regression blocking) — `npm run release:contract-diff-gate` (`scripts/contract-diff-gate.cjs`)
- [x] Signed release artifacts (binary + plugin packs) — Ed25519 signing + verification at [`src/core/security/artifact-signature.ts`](../src/core/security/artifact-signature.ts) with sidecars `<artifact>.sig` + `<artifact>.sig.json`; CLIs `npm run release:sign-artifact` / `release:verify-artifact`; new `release` tier in [`config/release-signing-keys.json`](../config/release-signing-keys.json). Tests: `ArtifactSignature`.
- [x] OWASP Top 10 scan + remediation — `npm run security:owasp` runs `npm audit` + in-house static category sweep with `// @owasp-allow A0X` annotation support; report to `prism-output/owasp/{run}.{md,json}`; living checklist at [`docs/OWASP_TOP_10_CHECKLIST.md`](OWASP_TOP_10_CHECKLIST.md). Tests: `OwaspScan`.
- [x] Linux/macOS parity audit (eliminate Windows-only code paths) — `npm run audit:platform-parity`; classifier at [`scripts/platform-parity-audit.cjs`](../scripts/platform-parity-audit.cjs) labels each finding `gated`/`cross-platform`/`needs-fix`; baseline at [`docs/LINUX_MACOS_PARITY_REPORT.md`](LINUX_MACOS_PARITY_REPORT.md); strict mode via `PRISM_PARITY_STRICT=1`. Tests: `PlatformParityAudit`.

---

## Phase G — Public Launch [P3]

- [x] Plugin SDK: documented adapter pack authoring guide with signing — manifest schema v1, trust tiers, signing flow, scaffolding, publishing pipeline at [`docs/PLUGIN_SDK_AUTHORING_GUIDE.md`](PLUGIN_SDK_AUTHORING_GUIDE.md); scaffolder at [`scripts/scaffold-plugin.cjs`](../scripts/scaffold-plugin.cjs); CLI `npm run plugin:scaffold -- --id <id> --name <name> --out <path>`. Tests: `PluginScaffold`.
- [ ] Community hub: Discord + GitHub Discussions *(operational handoff — provisioning of community spaces lives outside the source tree)*
- [x] Plugin marketplace v1: PRISM-curated, manually reviewed — review ledger at [`src/core/plugins/marketplace-review-ledger.ts`](../src/core/plugins/marketplace-review-ledger.ts) (`recordDecision`, `latestDecisionFor`, `isApproved`); `listEntries({ curated: true })` and `listEntriesWithCuration()` at [`src/core/plugins/plugin-marketplace.ts`](../src/core/plugins/plugin-marketplace.ts); curation policy at [`docs/MARKETPLACE_CURATION_POLICY.md`](MARKETPLACE_CURATION_POLICY.md); sample data at [`examples/marketplace/`](../examples/marketplace/). Tests: `MarketplaceCuration`.
- [x] External documentation site (separate from internal `/docs`) — MkDocs Material scaffold at [`docs/site/`](site/) (`mkdocs.yml`, `index.md`, `README.md`); `npm run docs:build` invokes MkDocs with actionable error if not installed. Hosting decision (GitHub Pages vs Cloudflare Pages) is operational.
- [x] Getting Started guide (5-minute path to first agent) — [`docs/GETTING_STARTED.md`](GETTING_STARTED.md): prereqs → `start_wizard.bat/.sh` → character pick → first message → next-step links.
- [x] Spectrum Refraction showcase demo — 4-hemisphere fan-out with cost gate + audit trail at [`examples/sr-showcase/`](../examples/sr-showcase/); CLI `npm run demo:sr-showcase -- --dry-run` (deterministic synthesis for CI) or live mode with provider key. Tests: `SrShowcaseDemo`.
- [ ] License model decision + publish (dual-license recommended) *(operational handoff — recommendation drafted in [`docs/LICENSE_MODEL_RECOMMENDATION.md`](LICENSE_MODEL_RECOMMENDATION.md): Apache-2.0 + PRISM Commercial dual license; final ratification + filing requires legal sign-off)*
- [x] SOC 2 Type II readiness assessment — TSC1-5 mapping with status table + outstanding gaps at [`docs/SOC2_READINESS_CHECKLIST.md`](SOC2_READINESS_CHECKLIST.md). Outstanding: token rotation runbook, DR drill cadence, RPO/RTO targets, KMS integration, public privacy policy.
- [ ] Enterprise design partner (1–3 organizations) *(operational handoff — partner recruitment is BD-led and lives outside the source tree)*

---

## Phase H — Novel Systems Incubation [P4]

> **Reconciled May 2026**: All five Phase H prototypes were delivered upstream under *Aspirational / Wishlist → Novel Systems Incubation* and *SR Future Vision*. This section is retained as the canonical Phase H ledger; entries cross-link to the implementations and tests that already shipped.

- [x] Constitutional Causal Compiler (CCC) prototype — [`src/core/incubation/ccc/`](../src/core/incubation/ccc/) (`compiler.ts`, `enforcer.ts`, `constitution.ts`, `types.ts`); sample [`examples/constitutions/business-default.json`](../examples/constitutions/business-default.json); routes `/api/v1/incubation/ccc/{compile,constitutions}` (PRISM_INCUBATION-gated); test: `testCccCompiler`.
- [x] Dual-Lens Memory Arbitration (DLMA) prototype — [`src/core/incubation/dlma/`](../src/core/incubation/dlma/) (`arbiter.ts`, `causal-lens.ts`, `fusion.ts`, `types.ts`); EMA-driven weight feedback over `SemanticMemoryIndex` + `EpisodicMemory`; routes `/api/v1/incubation/dlma/{query,weights}`; test: `testDlmaArbiter`.
- [x] Self-Healing Workflow Synthesis (SHWS) prototype — [`src/core/incubation/shws/`](../src/core/incubation/shws/) (`synthesizer.ts`, `policy-validator.ts`, `history-index.ts`, `orchestrator-integration.ts`, `types.ts`); never auto-executes (always tier-3 ApprovalQueue), max depth 3, max 1 active synthesis per workflow; CCC-validated; routes `/api/v1/incubation/shws/{propose,recent-syntheses}`; test: `testShwsSynthesizer`.
- [x] N-model SR fan-out (Quad+) prototype — [`model-capability-matrix.ts`](../src/core/operator/model-capability-matrix.ts) `HemisphereSpec` + `normalizeSRConfig` (cap `SR_MAX_HEMISPHERES=8`, backward-compat with legacy `leftModel`/`rightModel`); test: `SRNModelFanout`.
- [x] Hemisphere specialization profiles — [`sr-hemisphere-profiles.ts`](../src/core/operator/sr-hemisphere-profiles.ts) profiles: `logic`, `creative`, `legal-analysis`, `code-review`, `creative-writing`, `research-synthesis`, `reasoning-deep`, `summarization`.
