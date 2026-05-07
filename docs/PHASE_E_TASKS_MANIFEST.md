# PRISM Phase E — Integration Hardening: Tasks Manifest

**Phase**: E  
**Status**: ACTIVE — 2026 Q2  
**Owner**: Kirk LaSalle  
**Last Updated**: 2026-04-20 (updated with Docker Agent competitive findings)

---

## Overview

Phase E replaces all simulated/mock adapter implementations with production-grade integrations, delivers real end-user features (OAuth email/calendar), uplifts the operator dashboard UX for non-technical users, and establishes API versioning and observability infrastructure required for enterprise deployment.

This phase is the gate that transitions PRISM from **internal-tested** to **user-testable**.

---

## Workstream E1 — Real Adapters (P0 — BLOCKING)

Both adapters use **graceful degradation**: real implementation when runtime dependencies available, transparent fallback to current mock behavior with advisory surfacing when they are not. This preserves backward compatibility with all existing tests.

---

### E1a: Real PTY Terminal Integration

| Task | File | Status | Priority | Notes |
|------|------|--------|----------|-------|
| E1a-1 | Add `node-pty` as optional dependency in `package.json` | `package.json` | ✅ Done | `npm install node-pty @types/node-pty` |
| E1a-2 | Dynamic import `node-pty` in `startSession()` with fallback | `terminal-session-adapter.ts` | ✅ Done | Try dynamic import; if fails → fallback flag |
| E1a-3 | Replace `spawn` mock with `pty.spawn()` when PTY available | `terminal-session-adapter.ts` | ✅ Done | `pty.spawn(shell, [], {cwd, env, cols:80, rows:24})` |
| E1a-4 | Refactor `execCommand()` for PTY single-stream output | `terminal-session-adapter.ts` | ✅ Done | Write cmd to pty.write(); collect output until prompt |
| E1a-5 | Add `resize(cols, rows)` method | `terminal-session-adapter.ts` | ✅ Done | Calls `ptyProcess.resize(cols, rows)` |
| E1a-6 | Cleanup `ptyProcess.kill()` on revoke/timeout | `terminal-session-adapter.ts` | ✅ Done | Ensures no zombie PTY processes |
| E1a-7 | Expose `isPtyEnabled()` public method | `terminal-session-adapter.ts` | ✅ Done | Returns boolean |
| E1a-8 | Update exec response `advisory` field | `terminal-session-adapter.ts` | ✅ Done | `"real-pty"` or `"simulated-mock"` |
| E1a-9 | Extend test suite with PTY-specific cases | `tests/terminal-session-adapter.test.ts` | [ ] Pending | Resize, real output, interactive shell (skip guard when no PTY) |

**Entry Criteria**: `terminal-session-adapter.ts` uses `child_process.spawn` mock.  
**Exit Criteria**: `isPtyEnabled()` returns `true` when node-pty installed; `execCommand("pwd")` returns real working directory; fallback still passes all existing tests.

---

### E1b: Real Docker Container Isolation

| Task | File | Status | Priority | Notes |
|------|------|--------|----------|-------|
| E1b-1 | Add `dockerode` as optional dependency | `package.json` | ✅ Done | `npm install dockerode @types/dockerode` |
| E1b-2 | Dynamic import `dockerode` + `docker.ping()` health check | `container-sandbox-adapter.ts` | ✅ Done | If ping fails → fallback flag |
| E1b-3 | Replace mock spawn with `docker.createContainer()` in `startContainer()` | `container-sandbox-adapter.ts` | ✅ Done | With HostConfig: Memory, CpuQuota |
| E1b-4 | Implement `execInContainer()` via `container.exec()` stream | `container-sandbox-adapter.ts` | ✅ Done | Docker exec with Multiplexing demux |
| E1b-5 | Implement `takeSnapshot()` via `container.commit()` | `container-sandbox-adapter.ts` | ✅ Done | Commits container state as image tag |
| E1b-6 | Implement `revertToSnapshot()` via snapshot image + new container | `container-sandbox-adapter.ts` | ✅ Done | Creates new container from snapshot image |
| E1b-7 | `stopContainer()` → `container.stop()` + `container.remove()` | `container-sandbox-adapter.ts` | ✅ Done | Proper Docker lifecycle |
| E1b-8 | Expose `isDockerEnabled()` public method | `container-sandbox-adapter.ts` | ✅ Done | Returns boolean |
| E1b-9 | Update exec response `advisory` field | `container-sandbox-adapter.ts` | ✅ Done | `"real-docker"` or `"simulated-mock"` |
| E1b-10 | Extend test suite with Docker-specific cases | `tests/container-sandbox-adapter.test.ts` | [ ] Pending | Guard: `if (!adapter.isDockerEnabled()) this.skip()` |

**Entry Criteria**: `container-sandbox-adapter.ts` uses `spawn("sh",["-c","sleep infinity"])` mock.  
**Exit Criteria**: `isDockerEnabled()` returns `true` when Docker daemon running; `execInContainer("echo hello")` returns `"hello\n"`; fallback passes all existing tests.

---

## Workstream E2 — Email & Calendar OAuth (P1)

| Task | File | Status | Notes |
|------|------|--------|-------|
| E2-1 | Gmail OAuth 2.0: authorize URL → token exchange → refresh | `email-tool.ts` | [ ] Pending |
| E2-2 | Gmail: mailbox read (thread list, message content) | `email-tool.ts` | [ ] Pending |
| E2-3 | Gmail: draft, send, label operations | `email-tool.ts` | [ ] Pending |
| E2-4 | Outlook OAuth 2.0 via MSAL (same interface as Gmail) | `email-tool.ts` | [ ] Pending |
| E2-5 | Outlook: mailbox read, draft, send | `email-tool.ts` | [ ] Pending |
| E2-6 | Google Calendar: event CRUD, free/busy, conflict detection | `calendar-tool.ts` | [ ] Pending |
| E2-7 | Outlook Calendar: event CRUD, calendar view, conflict detection | `calendar-tool.ts` | [ ] Pending |
| E2-8 | OAuth token persistence via `ProviderSecretStore` | `email-tool.ts`, `calendar-tool.ts` | [ ] Pending |
| E2-9 | Setup Wizard Step 3b: email/calendar OAuth account connection | `src/cli/setup-wizard.ts`, `public/setup-wizard.js` | [ ] Pending |
| E2-10 | Dashboard Settings: OAuth account connection status panel | `public/tab-settings.js` | [ ] Pending |
| E2-11 | Tests: mock OAuth server for email/calendar | `tests/email-tool-oauth.test.ts`, `tests/calendar-tool-oauth.test.ts` | [ ] Pending |

**Entry Criteria**: Email/calendar tools return mock data.  
**Exit Criteria**: User can authorize Gmail account and retrieve real inbox thread list; calendar conflict detection works against real calendar data.

---

## Workstream E3 — Dashboard UX Uplift (P1)

### E3a: Simple Mode

| Task | File | Status | Notes |
|------|------|--------|-------|
| E3a-1 | `public/simple-mode.js` — Simple Mode UI module | `public/simple-mode.js` | [x] Done |
| E3a-2 | Character picker: Aria/Phoenix/Sentinel cards with profile badge | `public/simple-mode.js` | [x] Done |
| E3a-3 | Single chat panel, history sidebar, minimal chrome | `public/simple-mode.js` | [x] Done |
| E3a-4 | `GET /` serves Simple Mode for new users; `GET /simple` always; `GET /dashboard` always full | `dashboard-service.ts` | [x] Done |
| E3a-5 | "Advanced Mode →" toggle to full operator dashboard | `public/simple-mode.js` | [x] Done |
| E3a-6 | Preference persistence via `POST /api/preferences/ui-mode` + `PrismPreferences.uiMode` | `dashboard-service.ts`, `workspace-resolver.ts` | [x] Done |

### E3b: CAC Identity Panel

| Task | File | Status | Notes |
|------|------|--------|-------|
| E3b-1 | Visual accountability chain renderer in Settings tab | `public/tab-settings.js` | [ ] Pending |
| E3b-2 | Assignment lifecycle timeline (assign→active→suspend→resume→revoke) | `public/tab-settings.js` | [ ] Pending |
| E3b-3 | Export button: JSON/CSV identity audit export | `public/tab-settings.js` | [ ] Pending |
| E3b-4 | `GET /api/v1/cac/chain?sessionId={id}` endpoint | `dashboard-service.ts` | [ ] Pending |

### E3c: SLO Gauge Panel

| Task | File | Status | Notes |
|------|------|--------|-------|
| E3c-1 | SLO gauge component: p50/p95/p99 vs target bars | `public/tab-telemetry.js` | [x] Done |
| E3c-2 | Color coding: green/yellow/red per SLO proximity | `public/tab-telemetry.js` | [x] Done |
| E3c-3 | 5-second auto-refresh | `public/tab-telemetry.js` | [x] Done |
| E3c-4 | `GET /api/v1/telemetry/slo-summary` endpoint | `dashboard-service.ts` | [x] Done |

### E3d: Live Plugin Toggle

| Task | File | Status | Notes |
|------|------|--------|-------|
| E3d-1 | Enable/Disable MCP server toggle in Tools tab | `public/tab-tools.js` | [x] Done |
| E3d-2 | `POST /api/v1/plugins/{name}/toggle` endpoint | `dashboard-service.ts` | [x] Done |
| E3d-3 | Health indicator polling every 30s | `public/tab-tools.js` | [x] Done |

### E3e: API Versioning

| Task | File | Status | Notes |
|------|------|--------|-------|
| E3e-1 | Prefix all routes with `/api/v1/` in `dashboard-service.ts` | `dashboard-service.ts` | [x] Done |
| E3e-2 | Backward-compat: `/api/` → 301 redirect to `/api/v1/` | `dashboard-service.ts` | [x] Done |
| E3e-3 | `GET /api/v1/openapi.json` — OpenAPI 3.0 spec endpoint | `dashboard-service.ts` | [x] Done |
| E3e-4 | OpenAPI spec generator: scan routes → generate spec object | `dashboard-service.ts` | [x] Done |

> **Post-completion fix (2026-04-21)**: `tool-contract-extractor.ts` had simulated fallback data removed, breaking 2 existing tests when no registry/manifest paths are configured. Restored fallback stubs. Scheduler API tests were flaky (timeout) after heavy Playwright tests in full suite; resolved by reordering `scheduler-api-routes` before `browser-integration` in `package.json` test command.

**Entry Criteria**: Single-mode operator dashboard with no UX for non-technical users.  
**Exit Criteria**: 5 non-technical users complete first agent task in < 5 minutes unassisted on Simple Mode.

---

## Workstream E4 — Plugin Cryptographic Signatures (P1)

| Task | File | Status | Notes |
|------|------|--------|-------|
| E4-1 | `verifyEd25519Signature(manifest, signature, publicKey)` implementation | `plugin-pack-validator.ts` | [ ] Pending |
| E4-2 | Trust-tier enforcement: official / community / unsigned | `plugin-pack-validator.ts` | [ ] Pending |
| E4-3 | Key registry: `config/plugin-signing-keys.json` | `config/plugin-signing-keys.json` | [ ] Pending |
| E4-4 | Business profile: reject unsigned plugins | `plugin-pack-validator.ts` | [ ] Pending |
| E4-5 | Individual profile: warn on unsigned + allow with confirmation | `plugin-pack-validator.ts` | [ ] Pending |
| E4-6 | Tests: signature verification cases | `tests/plugin-pack-validator.test.ts` | [ ] Pending |

---

## Workstream E5 — CAC Identity Expansion (P1)

| Task | File | Status | Notes |
|------|------|--------|-------|
| E5-1 | Browser session fingerprint → CAC chain binding | `browser-session-manager.ts` | [ ] Pending |
| E5-2 | `permissionScopes` field with expiry on `CharacterAssignment` | `character-accountability-manager.ts` | [ ] Pending |
| E5-3 | Self-review scheduler: expired scope revocation trigger | `self-review-scheduler.ts` | [ ] Pending |
| E5-4 | OAuth email verification for Business profile characters | `character-accountability-manager.ts` | [ ] Pending |
| E5-5 | Tests: scope expiry, browser binding, OAuth verification | `tests/character-accountability.test.ts` | [ ] Pending |

---

## Workstream E6 — Observability Integration (P1)

| Task | File | Status | Notes |
|------|------|--------|-------|
| E6-1 | `src/core/activity/otel-exporter.ts` — OTel span exporter | `otel-exporter.ts` | [x] Done — `OtelExporter` class, subscribes to ActivityBus |
| E6-2 | Activity bus subscriber → OTel span emission | `bus.ts` | [x] Done — `OtelExporter.start()` subscribes; OTLP-JSON to stdout or HTTP |
| E6-3 | `GET /metrics` — Prometheus text format endpoint | `dashboard-service.ts` | [x] Done — public route, `text/plain; version=0.0.4` |
| E6-4 | Counters: requests_total, errors_total, policy_decisions_total | `metrics-store.ts` | [x] Done — 8 counters registered in OtelExporter |
| E6-5 | Histograms: request_duration_ms, policy_latency_ms, llm_latency_ms | `metrics-store.ts` | [x] Done — 3 histograms with default buckets |
| E6-6 | Gauges: active_sessions, approval_queue_depth, uptime_seconds | `dashboard-service.ts` | [x] Done — set live at scrape time in `/metrics` handler |
| E6-7 | `docs/grafana/prism-dashboard.json` — starter Grafana template | `docs/grafana/` | [ ] Deferred — Go/No-Go gate satisfied without it |
| E6-8 | Tests: `tests/metrics-endpoint.test.ts` | `tests/` | [x] Done — 24 tests, all passing; Go/No-Go gate validated |

---

## Dependency Graph

```
E1a (PTY)     ──────────────────────────────────────────► E tests pass
E1b (Docker)  ──────────────────────────────────────────► E tests pass
E2 (OAuth)    ─────────► E3b (CAC panel shows OAuth status)
E3a (Simple Mode) ──────────────────────────────────────► UX beta ready
E3e (API v1)  ─────────► E6 (Prometheus uses /api/v1/)
E4 (Signatures) ──────────────────────────────────────► Phase F marketplace
E5 (CAC expansion) ────► E3b (CAC panel)
E6 (Observability) ────► Phase F burn-in monitoring
```

---

## Performance Targets (Phase E Exit Gates)

| Metric | Target | Mode |
|--------|--------|------|
| PTY exec `pwd` round-trip | < 200ms | real-pty |
| Docker exec `echo hello` | < 500ms | real-docker (includes container start) |
| OAuth token refresh | < 1s | — |
| Simple Mode initial load | < 1s | — |
| `/api/v1/openapi.json` response | < 100ms | — |
| `/metrics` response | < 50ms | — |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `node-pty` native build fails on Windows | Medium | High | Use `node-pty-prebuilt-multiarch`; fallback to mock if build fails |
| Docker daemon not available in CI | High | Medium | `isDockerEnabled()` guard in all Docker tests; mock path stays green |
| Gmail/Outlook API quota limits | Low | Medium | Implement exponential backoff + quota error handling |
| OAuth token security (at-rest exposure) | Medium | High | Use `WindowsProtectedFileProviderSecretStore` for production; never log tokens |
| Simple Mode UX fails user testing | Medium | High | Build in 2 weeks, run guerrilla usability with 3 users before beta |
| API v1 migration breaks TUI/CLI clients | Low | High | Redirects for 90 days; update TUI/CLI in same PR |

---

## Go/No-Go Criteria for Phase E → Phase F

| Gate | Criterion | Evidence |
|------|-----------|----------|
| E1a | `isPtyEnabled()` returns `true`; `execCommand("pwd")` returns real path | Test output |
| E1b | `isDockerEnabled()` returns `true`; `execInContainer("echo hello")` returns `"hello\n"` | Test output |
| E2 | Gmail OAuth: user can read 10 real inbox threads without error | Manual validation |
| E3 | 5 non-technical users complete first agent task < 5 min unassisted | UX research notes |
| E3e | `/api/v1/openapi.json` validates against OpenAPI 3.0 schema | Automated check |
| E4 | Invalid Ed25519 signature rejected; valid signature accepted | Test output |
| E6 | `/metrics` returns parseable Prometheus metrics; at least 10 metrics present | Automated check |
| All | `npm test` passes 100% with new packages installed | CI output |

---

## Artifacts

| Artifact | Location |
|----------|----------|
| Phase E Task Board (this file) | `docs/PHASE_E_TASKS_MANIFEST.md` |
| Updated Roadmap (Phase E–I) | `docs/ROADMAP.md` |
| Updated TODO (Phase E tasks) | `docs/TODO.md` |
| Terminal Session Adapter (real PTY) | `src/adapters/application/terminal-session-adapter.ts` |
| Container Sandbox Adapter (real Docker) | `src/adapters/application/container-sandbox-adapter.ts` |
| OTel Exporter | `src/core/activity/otel-exporter.ts` |
| Simple Mode UI | `src/core/operator/public/simple-mode.js` |
| Grafana Dashboard Template | `docs/grafana/prism-dashboard.json` |
| Plugin Signing Keys Registry | `config/plugin-signing-keys.json` |
| Competitive Analysis 2026 | `docs/COMPETITIVE_ANALYSIS_2026.md` |
| A2A & OCI Integration Spec | `docs/A2A_OCI_INTEGRATION_SPEC.md` |

---

## Phase F Preview — Competitive Intelligence–Driven Tasks

> Added 2026-04-20 based on Docker Agent competitive analysis findings. These are **Phase F P1** items that directly address the Docker Agent distribution threat (20M+ Docker Desktop users) and leverage PRISM's governance moat.

### F0: A2A Protocol Server (HIGH IMPACT — Distribution Multiplier)

| Task | File | Priority | Effort | Notes |
|------|------|----------|--------|-------|
| F0-1 | Implement A2A task handler routes (`/a2a/tasks/*`) | `src/server/a2a-adapter.ts` | P1 | New file — full spec in `docs/A2A_OCI_INTEGRATION_SPEC.md` |
| F0-2 | Agent Card endpoint (`GET /.well-known/agent.json`) | `src/server/dashboard-service.ts` | P1 | Per-character agent card with SR capabilities |
| F0-3 | A2A task SQLite persistence adapter | `src/adapters/application/a2a-task-adapter.ts` | P1 | task_id, status, character, policy_tier, audit_chain |
| F0-4 | A2A governance policy gate (tier1/2/3 routing) | `src/server/a2a-adapter.ts` | P1 | Tier 3 → submit for approval, return "submitted" state |
| F0-5 | ActivityBus A2A events (layer: "agent") | `src/server/a2a-adapter.ts` | P1 | a2a_task_received / completed / rejected / approval_required |
| F0-6 | A2A integration tests | `tests/a2a-adapter.test.ts` | P1 | All 4 routes + governance gating |

**Strategic Rationale**: Docker Agent (20M+ Docker Desktop users) can call PRISM as an A2A sub-agent. PRISM becomes the governance layer for Docker Agent workflows — "Docker Agent for speed, PRISM for governance."

### F0b: Docker Agent Governance Hook Endpoints

| Task | File | Priority | Effort | Notes |
|------|------|----------|--------|-------|
| F0b-1 | `POST /governance/hooks/pre-tool-use` endpoint | `src/server/governance-hooks-adapter.ts` | P1 | Docker Agent hook format → PRISM 3-tier policy → permit/deny/ask |
| F0b-2 | `POST /governance/hooks/post-tool-use` endpoint | `src/server/governance-hooks-adapter.ts` | P1 | Record in SHA-256 audit chain |
| F0b-3 | Tool classification (Docker Agent tool names → PRISM tier) | `src/server/governance-hooks-adapter.ts` | P1 | `shell`→tier3, `filesystem`→tier2, `think`→tier1 |
| F0b-4 | Governance hooks tests | `tests/governance-hooks-adapter.test.ts` | P1 | Mock Docker Agent hook payload |

**Strategic Rationale**: With PRISM governance hooks, Docker Agent's `--hook-pre-tool-use` flag can point to PRISM instead of a shell script — making PRISM the **governance backend** for Docker Agent. Addresses Docker Agent's self-acknowledged limitation: "client-side enforcement, not a security boundary."

### G0: OCI Character Packaging (Phase G Preview)

| Task | File | Priority | Effort | Notes |
|------|------|----------|--------|-------|
| G0-1 | OCI artifact packaging script | `scripts/package-character-oci.ts` | P2 | Bundles character.json + PAD hash into OCI artifact |
| G0-2 | GitHub Actions publish workflow | `.github/workflows/publish-characters.yml` | P2 | On release tag → push to Docker Hub `prism/<character-id>` |
| G0-3 | OCI publishing guide | `docs/OCI_PUBLISHING_GUIDE.md` | P2 | Operator guide for publishing custom characters |

**Strategic Rationale**: PRISM Characters in Docker Hub's agentcatalog namespace means discovery by Docker Desktop developers who are already using Docker Agent's `agentcatalog/` sub-agents.

---

*Full A2A and OCI specifications: [A2A_OCI_INTEGRATION_SPEC.md](A2A_OCI_INTEGRATION_SPEC.md)*  
*Competitive context: [COMPETITIVE_ANALYSIS_2026.md](COMPETITIVE_ANALYSIS_2026.md) Part I-B*
