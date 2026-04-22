# PRISM Changelog

All notable changes to the PRISM project are documented in this file.

## v0.4.2 — Phase D4c: SR Advanced Features + Production Hardening (Current)

Date: 2026-04-25

### Added

- **Spectrum Refraction D4c advanced features** (20/20 tests passing):
  - Multi-key model slot assignment (`leftSlot`, `rightSlot`) — route SR to any named LLM key slot
  - Per-hemisphere timeout configuration (`leftTimeoutMs`, `rightTimeoutMs`)
  - Circuit breaker — disables SR after successive hemisphere failures, auto-resets
  - Audit trail — every SR generation emits signed activity events with isolation level, model assignments, and outcome
  - Cost estimation — pre-flight token estimation before fan-out
  - Show-hemispheres mode — exposes raw Left/Right responses to the operator UI alongside the fused synthesis
- **Approval endpoint path alignment** — TUI client calls (`/api/approval/pending`, `/api/approval/:id/approve`, `/api/approval/:id/deny`) now match server routes; previous mismatch caused all TUI approval flows to 404.
- **REST-canonical approval routes** — Added `/api/approval/:id/approve` and `/api/approval/:id/deny` alongside legacy routes.
- **`POST /api/tools/stage` approval routing** — Tier 3 contracts are now enqueued into the approval queue when `approval_routing: true` is set; response includes `approval_pending_ids`.
- **SQLite WAL mode** — `ChatSessionStore` now sets `PRAGMA journal_mode=WAL` on init for improved concurrent read throughput.
- **Guardian agent dashboardBaseUrl** — `GuardianConfig` now accepts `dashboardBaseUrl`; eliminates hardcoded `localhost:7070` from `taskEndpointAccessAudit()`.
- **Health endpoint dependency detail** — `GET /api/health` now reports `db`, `providers`, `sr_enabled`, `guardian`, `pending_approvals` under a `dependencies` key.
- **Startup environment validation** — Boot-time warnings for missing/misconfigured `PRISM_JWT_SECRET`, `PRISM_DASHBOARD_PORT`, `PRISM_DATA_DIR` in production.
- **Graceful shutdown event** — `system.shutdown` activity event emitted before stores are closed on SIGTERM/SIGINT.

### Fixed

- `tool-contract-extractor.ts` — Removed all 3 simulated fallback contracts (fake `semantic-query`, `calendar-integration`, `mcp-client`); callers now receive an empty array when no real sources are configured.
- `container-sandbox-adapter.ts` — `snapshot_size_mb` was `Math.random() * 1000`; replaced with `0` pending real Docker integration.
- `terminal-session-tool.ts` — Simulated execution output now includes `_advisory` field surfacing integration status.
- `PRISM_AUTH_DISABLED` guard — Throws at startup if `NODE_ENV === "production"`, preventing accidental auth bypass in production deployments.
- Request body size limit — `readBody()` now enforces a 10 MB cap (configurable via `PRISM_MAX_BODY_SIZE`) to prevent DoS via large request bodies.

### Tests Added

- `tests/chat-session-store.test.ts` — 12 tests: WAL mode, session CRUD, message persistence, full D4c SR config roundtrip, upsert, default values, migration idempotency.
- `tests/approval-queue-integration.test.ts` — 11 tests: list, approve/deny resolution, unknown ID handling, multiple concurrent requests, timeout behavior.

---

## v0.4.1 — Permanent Active Directives: Cryptographic Governance Infrastructure

Date: 2026-04-17

### Added

- **Permanent Active Directives (PAD) SHA-256 Integrity Verification** — Boot-time and runtime cryptographic verification that the 10 Laws governance document has not been tampered with. Hash: `1a87dac4340e110c85bbdbeb120a529228b0662ea7fa9bdedfbe33692496b7ab`.
- **`src/core/security/directive-integrity.ts`** — SHA-256 computation, verification, and integrity result reporting for the PAD file.
- **`src/core/security/directive-manifest.ts`** — Machine-readable representation of all 10 Laws with enforcement mechanism mapping, version tracking, and governance preamble generation.
- **Guardian Agent `directive_integrity` security task** — Periodic (600s) re-verification of PAD integrity with activity event emission on mismatch.
- **Governance preamble injection into system prompts** — Tier 2+ models receive governance context; business profile gets full 10-law text, individual profile gets compact version.
- **CI Gate 9: Directive Integrity Gate** — Blocks merge/release when PAD SHA-256 does not match the hardcoded constant, enforcing Law 10 (no unauthorized directive modification).
- **`docs/TERMS_AND_GOVERNANCE_FRAMEWORK.md`** — Formal 4-tier governance hierarchy (PAD → Platform Policies → Operational Policies → Runtime Enforcement) with ToS/AoS framework, compliance alignment, and amendment process.
- **`docs/PAD_WHITEPAPER.md`** — Standalone paper covering the PAD's purpose, design philosophy, market impact, and contribution to responsible AI governance.
- **`tests/directive-integrity.test.ts`** — 24 unit tests covering hash computation, verification, manifest structure, governance preamble generation, and tamper detection.
- **Policy reason codes** — `DIRECTIVE_INTEGRITY_VERIFIED`, `DIRECTIVE_INTEGRITY_VIOLATION`, `DIRECTIVE_AMENDMENT_UNAUTHORIZED`.

### Technical Files Modified

- `src/core/operator/dashboard-service.ts` — PAD verification at server boot with governance activity event emission
- `src/core/agents/guardian-agent.ts` — `directive_integrity` task in GUARDIAN_TASK_CATALOG
- `src/core/operator/model-capability-matrix.ts` — `getGovernancePreambleForPrompt()` + injection into `buildAdaptiveSystemPrompt()`
- `src/core/policy/reason-codes.ts` — 3 new directive-specific reason codes
- `docs/CI_GATING_POLICY.md` — Gate 9 (Directive Integrity)

### Security Impact

- Implements Law 10: "shall not permanently modify its core directives without explicit, cryptographically secured approval from Governance"
- Creates verifiable audit trail: PAD hash → activity events → telemetry → release artifacts
- Enterprise-grade compliance evidence for SOC 2, ISO 27001, NIST AI RMF, EU AI Act

---

## v0.4.0 — Phase D4: Spectrum Refraction

Date: 2026-04-12

### Added

- **Spectrum Refraction (SR) tri-model orchestration system** — Compounding parallel fan-out across Left (Logic), Right (Creative), and Main (Coordination) hemispheres with structured aggregation.
- **Instance isolation enforcement** — Mandatory uniqueness validation at every gate:
  - `/api/sr/configure` rejects identical Left/Right model+provider
  - `/api/sr/activate` re-validates before enabling
  - `generateSR()` pre-flight guard before fan-out
- **SRIsolationLevel classification** — Three-tier isolation quality: `full` (different providers), `model` (same provider, different models), `insufficient` (rejected).
- **SR API endpoints** — Four new routes: `/api/sr/status`, `/api/sr/configure`, `/api/sr/activate`, `/api/sr/deactivate`.
- **SR model capability validation** — `validateSRLeftModel()`, `validateSRRightModel()`, `filterSRLogicModels()`, `filterSRCreativeModels()` for role-qualified model filtering.
- **SR UI panel** in Provider & Settings tab with model selection, isolation badge (🔒 Full / 🔏 Model / ⛔ Insufficient), and cost advisory.
- **SR chat rendering** — Response badges in Chat tab with isolation level pill and hemisphere attribution.
- **XML-tagged structured aggregation** — Aggregation prompt uses role-tagged sections (`<logic_analysis>`, `<creative_synthesis>`) for deterministic hemisphere fusion.
- **Media artifact extraction** — Pipeline extracts image/audio/video artifacts from Creative hemisphere output.

### Technical Files Modified

- `src/core/operator/model-capability-matrix.ts` — SR types, validation, model filtering, system prompts
- `src/core/operator/llm-provider-manager.ts` — `SRGenerationOutput`, `validateSRTriadConfig()`, `generateSR()`
- `src/core/operator/dashboard-service.ts` — 4 SR API endpoints with isolation enforcement
- `src/core/operator/chat-session-store.ts` — `sr_config` table schema, CRUD methods
- `src/dashboard/tab-settings.js` — SR panel with isolation badge
- `src/dashboard/tab-chat.js` — SR response badge with isolation level
- `src/dashboard/dashboard-core.js` — SR state fields
- `src/dashboard/dashboard-app.js` — SR function exports

## v0.3.0 — Phase D3: Agent Control & Swarm Intelligence

Date: 2026-03-28

### Added

- Agent lifecycle management with three tiers: ephemeral, semi-permanent, permanent
- Per-agent model assignment with hot-swap runtime switching
- Intelligent agent telemetry: dispatch pattern detection, promotion recommendations
- Swarm orchestration with four topologies: mesh, star, pipeline, broadcast
- Chat-to-agent routing with classifier-first intent detection
- Task decomposition with dependency-aware parallel batch execution
- Agentic Control dashboard tab
- Guardian Agent (llama.cpp) permanent autonomous system agent

## v0.2.0 — D2 Parity

Date: 2026-03-17

### Added

- Character Accountability Control (CAC) identity chain
- Computer use (browser, terminal, container) as core governed capability
- Plugin/adapter pack ecosystem with signed manifests
- Business Security Alignment Gate for enterprise claims
- Requirements Traceability Matrix (D2-R1 through D2-R32)
- Operator dashboard with 11 tabs

## v0.1.0 — Phase A+B Foundation

Date: 2026-03-11

### Added

- Governed runtime with 3-tier policy engine
- Activity bus with SHA-256 event hashing
- Approval queue and HTTP service
- Memory subsystems: episodic, session, semantic
- Workflow engine: retries, timeouts, fallback routing
- Real adapters: system (shell/fs), protocol (HTTP), application (Neo4j, memory)
- SQLite persistence
- Retrieval observability and quality metrics
