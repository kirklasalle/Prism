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

- [ ] Wire `POST /api/tools/stage` HTTP endpoint in dashboard-service.ts
- [ ] Complete approval handler response flow in tool-contract-extractor.ts
- [ ] Generate missing release packet markdown reports (governance-path, lifecycle, plugin-compat, claim-alignment)
- [x] Close RTM items D2-R10, D2-R11, D2-R12 (release packet traceability) — verified PASS in RTM
- [ ] Generate `release-packet-manifest.md` and `go-no-go-signoff.md`

### Spectrum Refraction Enhancements (Phase D4c — COMPLETE)

- [x] Multi-key provider support: extend `ProviderSecretStore` with `getApiKey(providerId, slot?)` for multiple API keys per provider, enabling full isolation within a single provider (e.g., `openai:a` vs `openai:b`)
- [x] Per-hemisphere timeout: configurable timeout per SR hemisphere with partial aggregation on timeout (return completed hemisphere results + advisory)
- [x] Circuit breaker per hemisphere: if a provider is down, degrade gracefully to single-hemisphere output with advisory
- [x] SR audit trail: dedicated ActivityBus events for SR generations with hemisphere timing, isolation level, and token usage
- [x] Cost estimation before activation: estimate per-generation cost based on model pricing + average token usage and surface via `GET /api/sr/cost-estimate`
- [x] Transparent hemisphere output: optional `showHemispheres` toggle to expose individual Left/Right outputs alongside aggregated result
- [x] SR test coverage: 20/20 tests in `spectrum-refraction-advanced.test.ts` covering all D4c features

### Individual-Native MVP

- [ ] Email triage + draft workflow template
- [ ] Calendar conflict + day planning integration
- [ ] Notes capture + extraction pipeline
- [ ] Chronological tasks/events planning
- [ ] Policy-path integration tests for mutating operations (allow/deny/timeout)

### Retrieval & Memory

- [ ] Expand profile-specific alert tuning based on production incident trends
- [ ] Retrieval quality proxy tuning: coverage, novelty, utility scoring baselines

### Adapter Hardening

- [ ] Expand safety regression tests for system and protocol adapters
- [ ] Baseline-to-candidate contract diff policy and release blocking rules
- [ ] SQLite migration compatibility across historical schema variants

### Performance

- [ ] Contention scenario expansion for mixed approve/deny/timeout profiles
- [ ] Profile-differentiated trend history and regression drift alerts in CI

## Medium-Term (Planned)

### Operator Surfaces

- [ ] Incident triage guide (runbook-grade)
- [ ] Session trace explorer UX/API
- [ ] Policy bundle diff and audit export tools
- [ ] Live plugin enable/disable toggle and MCP server health monitoring
- [ ] Utility execution triggers from dashboard
- [ ] Tool risk-level editing and custom policy override from UI
- [ ] Real-time performance SLO gauge panels in Telemetry tab

### CAC Identity Expansion

- [ ] Browser automation identity binding with client fingerprint
- [ ] Email provider OAuth integration (Google, Microsoft)
- [ ] Per-character permission scopes and assignment expiry
- [ ] Dashboard CAC panel: visual chain inspector and identity audit export

### CI/CD

- [ ] CI publication of profile-differentiated performance trend history
- [ ] Baseline-to-candidate contract diff policy for automated release blocking

## Aspirational / Wishlist

### Novel Systems Incubation

- [ ] Constitutional Causal Compiler (CCC) prototype: auto-compile policy + memory + workflow constraints into enforceable runtime plans
- [ ] Dual-Lens Memory Arbitration prototype: semantic relevance lens + causal consequence lens with confidence fusion
- [ ] Self-Healing Workflow Synthesis prototype: runtime transforms failed workflow segments into candidate alternatives under policy constraints

### SR Future Vision (Kirk LaSalle)

- [ ] Quad-model or N-model fan-out: extend SR beyond tri-model to arbitrary hemisphere count
- [ ] Hemisphere specialization profiles: domain-specific system prompts per hemisphere (e.g., legal analysis, code review, creative writing)
- [ ] SR memory: persist SR generation patterns and learn which hemisphere configurations produce best results per task type
- [ ] Cross-session SR learning: aggregate SR performance metrics across sessions for model recommendation engine
- [ ] SR-aware agent routing: agents can invoke SR generation as a tool for complex reasoning tasks

### Platform Evolution

- [ ] Multi-tenant workspace support
- [ ] Remote/cloud workspace sync
- [ ] Plugin marketplace with community-verified adapter packs
- [ ] Mobile/tablet dashboard companion

---

## Phase E — Integration Hardening (Active — 2026 Q2)

### E1: Real Adapters [P0 — BLOCKING for user deployment]

#### E1a: Real PTY Terminal (node-pty)

- [ ] `npm install node-pty @types/node-pty` — add as optional dependency
- [ ] `terminal-session-adapter.ts`: dynamic import `node-pty` with graceful fallback
- [ ] Replace `child_process.spawn(shell, [], {stdio:["pipe","pipe","pipe"]})` in `startSession()` with `pty.spawn(shell, [], {cwd, env, cols:80, rows:24})`
- [ ] Refactor `execCommand()` for single-stream PTY output (no separate stdout/stderr)
- [ ] Add `resize(cols, rows)` method on `TerminalSessionAdapter`
- [ ] Cleanup: `ptyProcess.kill()` on session revoke/timeout
- [ ] `isPtyEnabled()` method returns `true` when node-pty available, `false` on fallback
- [ ] Update exec response `advisory` field: `"real-pty"` or `"simulated-mock"`
- [ ] Tests: extend `tests/terminal-session-adapter.test.ts` with PTY-specific test cases

#### E1b: Real Docker Container Isolation (dockerode)

- [ ] `npm install dockerode @types/dockerode` — add as optional dependency
- [ ] `container-sandbox-adapter.ts`: dynamic import `dockerode` + `docker.ping()` health check on init
- [ ] Replace mock `spawn("sh",["-c","sleep infinity"])` in `startContainer()` with `docker.createContainer({Image, HostConfig: {Memory, CpuQuota, NanoCpus}})` → `container.start()`
- [ ] Replace stdin-echo exec with `docker exec` via `container.exec({Cmd, AttachStdout, AttachStderr})`
- [ ] Implement `takeSnapshot()` via `container.commit({repo: snapshotName})`
- [ ] Implement `revertToSnapshot()` via `docker.createContainer({Image: snapshotTag})` → `container.start()`
- [ ] `isDockerEnabled()` method returns `true` when Docker daemon reachable, `false` on fallback
- [ ] Update exec response `advisory` field: `"real-docker"` or `"simulated-mock"`
- [ ] Tests: extend `tests/container-sandbox-adapter.test.ts` with Docker-specific cases (guard: skip if Docker unavailable)

### E2: Email & Calendar OAuth [P1]

- [ ] `email-tool.ts`: Gmail OAuth 2.0 flow (authorize URL → token exchange → refresh → mailbox operations)
- [ ] `email-tool.ts`: Outlook OAuth 2.0 flow via MSAL (same interface)
- [ ] `calendar-tool.ts`: Google Calendar API (event CRUD, free/busy, conflict detection)
- [ ] `calendar-tool.ts`: Outlook Calendar API (event CRUD, calendar view, conflict detection)
- [ ] OAuth token persistence via `ProviderSecretStore` (`getApiKey("gmail:token")`, etc.)
- [ ] Setup Wizard Step 3b: email & calendar OAuth account connection
- [ ] Dashboard Settings: OAuth account connection status panel (connected/disconnected per provider)
- [ ] Tests: `tests/email-tool-oauth.test.ts`, `tests/calendar-tool-oauth.test.ts` (mock OAuth server)

### E3: Dashboard UX Uplift [P1]

- [ ] **Simple Mode**: character picker landing page with chat panel + settings drawer
  - [ ] `public/simple-mode.js` — Simple Mode UI module
  - [ ] Character picker: Aria/Phoenix/Sentinel cards with profile badge
  - [ ] Single chat panel (no tabs), history sidebar, minimal chrome
  - [ ] `GET /` serves Simple Mode by default for new users (no prior session)
  - [ ] Toggle: "Advanced Mode →" button switches to full operator dashboard
- [ ] **CAC Identity Panel** (tab-settings.js):
  - [ ] Visual accountability chain: characterId → operatorId → sessionId
  - [ ] Assignment lifecycle timeline (assign → active → suspend → resume → revoke)
  - [ ] Export button: JSON/CSV identity audit export
- [ ] **SLO Gauge Panel** (tab-telemetry.js):
  - [ ] Real-time p50/p95/p99 vs SLO target bars
  - [ ] Color: green (< 80% of target), yellow (80–100%), red (> target)
  - [ ] Refresh interval: 5s
- [ ] **Live Plugin Toggle** (tab-tools.js):
  - [ ] Enable/Disable MCP server toggle with immediate effect via `POST /api/plugins/{name}/toggle`
  - [ ] Health indicator polling every 30s
- [ ] **Incident Triage UI** (tab-logs.js):
  - [ ] Guided runbook: expandable checklist steps
  - [ ] Copy-to-clipboard for evidence bundles (activity events + session trace)
- [ ] **API Versioning**:
  - [ ] Prefix all routes with `/api/v1/` in `dashboard-service.ts`
  - [ ] Backward-compat: `/api/` paths return 301 redirect to `/api/v1/`
  - [ ] `GET /api/v1/openapi.json` — serves generated OpenAPI 3.0 spec

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
- [ ] OAuth email verification for Business profile characters (Google/Microsoft)
- [x] Tests: extend `tests/character-accountability.test.ts` with scope expiry and browser binding cases

### E6: Observability Integration [P1]

- [ ] `src/core/activity/otel-exporter.ts`: OpenTelemetry trace exporter (emit activity events as OTel spans)
- [ ] `dashboard-service.ts`: `GET /metrics` endpoint (Prometheus text format)
  - [ ] Counters: `prism_requests_total`, `prism_errors_total`, `prism_policy_decisions_total`
  - [ ] Histograms: `prism_request_duration_ms`, `prism_policy_latency_ms`, `prism_retrieval_latency_ms`
  - [ ] Gauges: `prism_active_sessions`, `prism_approval_queue_depth`, `prism_agent_pool_size`
- [ ] `docs/grafana/prism-dashboard.json` — starter Grafana dashboard template
- [ ] Tests: `tests/metrics-endpoint.test.ts` — validate Prometheus format

---

## Phase F — Production Qualification & Private Beta [P2]

- [ ] Database abstraction layer (`ISessionStore`, `IActivityStore` interfaces)
- [ ] PostgreSQL adapter implementation (Prisma or `pg`)
- [ ] Multi-tenant workspace namespace support
- [ ] 72-hour staging soak test (target: 0 unhandled rejections)
- [ ] 10 concurrent session stress test (Business/governed p95 < 500ms)
- [ ] Private beta: 10–20 users recruited (individual + SMB + enterprise IT)
- [ ] CI/CD: automated tool contract diff gate (baseline-to-candidate regression blocking)
- [ ] Signed release artifacts (binary + plugin packs)
- [ ] OWASP Top 10 scan + remediation
- [ ] Linux/macOS parity audit (eliminate Windows-only code paths)

---

## Phase G — Public Launch [P3]

- [ ] Plugin SDK: documented adapter pack authoring guide with signing
- [ ] Community hub: Discord + GitHub Discussions
- [ ] Plugin marketplace v1: PRISM-curated, manually reviewed
- [ ] External documentation site (separate from internal `/docs`)
- [ ] Getting Started guide (5-minute path to first agent)
- [ ] Spectrum Refraction showcase demo
- [ ] License model decision + publish (dual-license recommended)
- [ ] SOC 2 Type II readiness assessment
- [ ] Enterprise design partner (1–3 organizations)

---

## Phase H — Novel Systems Incubation [P4]

- [ ] Constitutional Causal Compiler (CCC) prototype
- [ ] Dual-Lens Memory Arbitration (DLMA) prototype
- [ ] Self-Healing Workflow Synthesis (SHWS) prototype
- [ ] N-model SR fan-out (Quad+) prototype
- [ ] Hemisphere specialization profiles
