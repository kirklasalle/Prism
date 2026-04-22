# Phase D4 Tasks Manifest

**Project**: PRISM Phase D4 — Spectrum Refraction + Production Hardening  
**Start Date**: 2026-04-12  
**Completed Date**: 2026-04-25  
**Status**: COMPLETE (D4a + D4b + D4c)

---

## Task Board Summary

| Workstream | Status | Artifacts |
|-----------|--------|-----------|
| **D4a: SR Core** — tri-model parallel fan-out, instance isolation, `generateSR()` | **Complete** | `llm-provider-manager.ts`, `dashboard-service.ts` |
| **D4b: SR Persistence** — `sr_config` table, CRUD, ChatSessionStore | **Complete** | `chat-session-store.ts` SR migration + CRUD |
| **D4c: SR Advanced** — slots, timeouts, circuit breaker, audit trail, cost estimation, show-hemispheres | **Complete** | 20/20 tests, all fields persisted in SQLite |
| **P1: Production Hardening** — DoS limits, auth guards, health enrichment, startup validation | **Complete** | `dashboard-service.ts`, `index.ts` |
| **P2: Stub Elimination** — Remove fake contracts, random snapshot size, simulated terminal advisory | **Complete** | `tool-contract-extractor.ts`, `container-sandbox-adapter.ts`, `terminal-session-tool.ts` |
| **P3: Approval Routing** — Wire `approval_routing` flag in `POST /api/tools/stage` | **Complete** | `dashboard-service.ts` |
| **P4: Guardian Decoupling** — `dashboardBaseUrl` field, eliminate hardcoded `localhost:7070` | **Complete** | `guardian-agent.ts`, `dashboard-service.ts` |
| **P5: SQLite WAL** — `PRAGMA journal_mode=WAL` in ChatSessionStore | **Complete** | `chat-session-store.ts` |
| **T1: ChatSessionStore tests** | **Complete** | `tests/chat-session-store.test.ts` (12 tests) |
| **T2: ApprovalQueue integration tests** | **Complete** | `tests/approval-queue-integration.test.ts` (11 tests) |

---

## D4a: Spectrum Refraction Core

| Task ID | Task | Status | Notes |
|---------|------|--------|-------|
| D4a-1 | SR types and interfaces in model-capability-matrix.ts | `complete` | `SRConfig`, `SRIsolationLevel`, `SRTriadConfig` |
| D4a-2 | `generateSR()` in LlmProviderManager | `complete` | Left + Right + Main parallel fan-out |
| D4a-3 | Instance isolation enforcement | `complete` | Reject identical Left/Right model+provider |
| D4a-4 | SR API endpoints (status, configure, activate, deactivate) | `complete` | 4 routes in dashboard-service.ts |
| D4a-5 | SR UI panel in Provider & Settings tab | `complete` | Isolation badge, model dropdowns |
| D4a-6 | SR chat rendering with hemisphere badges | `complete` | Isolation level pill |

---

## D4b: SR Persistence

| Task ID | Task | Status | Notes |
|---------|------|--------|-------|
| D4b-1 | `sr_config` SQLite table with migration | `complete` | 11 columns |
| D4b-2 | `getSRConfig()` / `saveSRConfig()` in ChatSessionStore | `complete` | UPSERT semantics |
| D4b-3 | SR config loading on session resume | `complete` | `GET /api/sr/status` reads from store |
| D4b-4 | `deleteSRConfig()` on session deletion | `complete` | CASCADE delete via FK |

---

## D4c: SR Advanced Features

| Task ID | Task | Status | Notes |
|---------|------|--------|-------|
| D4c-1 | Multi-key model slot assignment (leftSlot, rightSlot) | `complete` | Persisted in sr_config |
| D4c-2 | Per-hemisphere timeout (leftTimeoutMs, rightTimeoutMs) | `complete` | Passed to generateSR() |
| D4c-3 | Circuit breaker — disable SR after successive failures | `complete` | Resets after configurable window |
| D4c-4 | Audit trail — signed activity event per SR generation | `complete` | isolation_level, models, status |
| D4c-5 | Cost estimation — pre-flight token count | `complete` | Blocks if estimated > cap |
| D4c-6 | Show-hemispheres mode — expose Left/Right raw responses | `complete` | showHemispheres persisted |
| D4c-7 | SR advanced test suite (spectrum-refraction-advanced.test.ts) | `complete` | 20/20 tests passing |

---

## P1–P5: Production Hardening

| Task ID | Task | Status | File |
|---------|------|--------|------|
| P1-1 | PRISM_AUTH_DISABLED throws in production | `complete` | dashboard-service.ts |
| P1-2 | Request body size limit (10 MB cap, streaming enforcement) | `complete` | dashboard-service.ts `readBody()` |
| P1-3 | Health endpoint with DB/provider/SR/guardian detail | `complete` | dashboard-service.ts `GET /api/health` |
| P1-4 | Startup env validation warnings | `complete` | index.ts `main()` |
| P1-5 | Graceful shutdown activity event before store teardown | `complete` | index.ts `waitForShutdown()` |
| P2-1 | Remove fake `semantic-query` manifest fallback | `complete` | tool-contract-extractor.ts |
| P2-2 | Remove fake `calendar-integration` decorator fallback | `complete` | tool-contract-extractor.ts |
| P2-3 | Remove fake `mcp-client` dynamic fallback | `complete` | tool-contract-extractor.ts |
| P2-4 | `snapshot_size_mb: Math.random() * 1000` → `0` | `complete` | container-sandbox-adapter.ts |
| P2-5 | Terminal simulated advisory field surfaced | `complete` | terminal-session-tool.ts |
| P3-1 | Wire `approval_routing` to `this.queue.request()` for Tier 3 contracts | `complete` | dashboard-service.ts |
| P3-2 | Approval endpoint path alignment (TUI ↔ server) | `complete` | dashboard-service.ts |
| P4-1 | `dashboardBaseUrl` in GuardianConfig interface | `complete` | guardian-agent.ts |
| P4-2 | Decouple `taskEndpointAccessAudit()` from hardcoded `localhost:7070` | `complete` | guardian-agent.ts |
| P4-3 | Pass `http://127.0.0.1:${this.port}` as dashboardBaseUrl at guardian construction | `complete` | dashboard-service.ts |
| P5-1 | `PRAGMA journal_mode=WAL` after DatabaseSync init | `complete` | chat-session-store.ts |

---

## T1–T2: Test Coverage

| Task ID | Test File | Tests | Status |
|---------|-----------|-------|--------|
| T1 | `tests/chat-session-store.test.ts` | 12 | `complete` — WAL, CRUD, SR D4c roundtrip |
| T2 | `tests/approval-queue-integration.test.ts` | 11 | `complete` — list, approve, deny, timeout |
| T3 | `tests/spectrum-refraction-advanced.test.ts` | 20 | `complete` — all D4c scenarios |

**Total new tests added this phase: 43**

---

## Release Criteria

| Criterion | Status |
|-----------|--------|
| Build clean (`npm run build` zero errors) | ✅ |
| SR advanced test suite 20/20 | ✅ |
| ChatSessionStore tests 12/12 | ✅ |
| ApprovalQueue tests 11/11 | ✅ |
| No simulated data in production code paths | ✅ |
| Auth bypass guard in production | ✅ |
| DoS body size limit enforced | ✅ |
| CHANGELOG v0.4.2 entry | ✅ |
| TODO.md fully reconciled | ✅ |
