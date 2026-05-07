# PRISM Updated Roadmap — 2026 Q2

**Date:** 2026-04-22
**Baseline release:** v0.4.2 (D4c)
**Supersedes:** nothing — this document **appends** to [ROADMAP.md](ROADMAP.md). Phases A through D4 remain closed per existing manifests.
**Companions:** [PRISM_FULL_AUDIT_2026_Q2.md](PRISM_FULL_AUDIT_2026_Q2.md) · [READINESS_RUNBOOK.md](READINESS_RUNBOOK.md)

---

## 1. Phase summary (current + new)

| Phase | Title | Status | Target window | Owner |
|---|---|---|---|---|
| A | Runtime Foundations | Closed | — | — |
| B | Memory Foundations | Closed | — | — |
| C | Reliability & Observability | Closed (2026-04-20) | — | — |
| D1 | Individual-native MVP | Closed (2026-04-20) | — | — |
| D2 | Capability Parity Program | Closed (2026-03-18) | — | — |
| D3 | Agent Control & Swarm | Closed (2026-04-20) | — | — |
| D4 | Spectrum Refraction (SR) | Closed (2026-04-25) | — | — |
| **E** | **Integration Hardening** | **Active** | **May–Jun 2026** | Core team |
| **R** | **Readiness** (NEW) | **Planned** | **Jun–Jul 2026** | Core team |
| F | Expansion (A2A, OCI, Python SDK, monolith split) | Planned | Aug–Oct 2026 | Core team |
| G | Ecosystem (marketplace, docs site, beta) | Planned | Nov 2026 – Q1 2027 | Core + community |
| H | Enterprise (IAM, multi-tenant, HA, cloud) | Planned | Q2 2027 | Enterprise team |
| I | Compliance & Scale (SOC 2 II, FedRAMP) | Planned | Q3 2027 | Compliance team |

Phase R is **new** and is inserted between E and F. It is not a renumbering — existing F / G designations are preserved. Phase R is deliberately narrow-scope: it exists to close the gap between "code complete" and "user-testable + production-deployable" surfaced by the [2026 Q2 audit](PRISM_FULL_AUDIT_2026_Q2.md).

---

## 2. Phase E-Close (remaining work)

Goal: finish what Phase E started so claims in docs match shipped code. Each item has a file target and an acceptance test.

### E1a — Real PTY integration

- **E1a-9.** Add `tests/terminal-session-pty.integration.test.ts` with skip-guard for missing `node-pty`. Assert [terminal-session-adapter.ts](../src/adapters/application/terminal-session-adapter.ts) `isPtyEnabled()` returns `true` when dependency is present and a real shell session completes a `pwd` command.

### E1b — Real Docker integration

- **E1b-10.** Add `tests/container-sandbox-docker.integration.test.ts` with skip-guard for missing Docker daemon. Assert [container-sandbox-adapter.ts](../src/adapters/application/container-sandbox-adapter.ts) runs a container, captures output, and reports `runtime_backend: "docker"` instead of `"mock"`.

### E2 — Email / Calendar OAuth (0 of 11 tasks)

- **E2-1** Gmail OAuth 2.0 authorize URL + token exchange → [email-oauth-adapter.ts](../src/adapters/application/email-oauth-adapter.ts)
- **E2-2** Gmail mailbox read (thread list + message content)
- **E2-3** Gmail send + draft + label
- **E2-4** Outlook OAuth 2.0 via MSAL → [outlook-oauth-adapter.ts](../src/adapters/application/outlook-oauth-adapter.ts)
- **E2-5** Outlook mailbox read + draft + send
- **E2-6** Google Calendar CRUD + free/busy + conflict detection → [calendar-tool.ts](../src/adapters/application/calendar-tool.ts)
- **E2-7** Outlook Calendar CRUD
- **E2-8** OAuth token persistence via `ProviderSecretStore`
- **E2-9** Wizard OAuth connection step 3b → [src/cli/setup-wizard.ts](../src/cli/setup-wizard.ts) + [templates/setup.ts](../src/core/operator/templates/setup.ts)
- **E2-10** Settings panel OAuth connection status → [public/tab-settings.js](../src/core/operator/public/tab-settings.js)
- **E2-11** Mock OAuth test servers for integration tests

### E3a — Simple Mode

- **E3a-5.** Wire the Simple Mode toggle in Settings → persist to `uiPreferences.mode` → conditionally hide advanced tabs. Acceptance: new user defaults to Simple; Logs, Scheduler, Telemetry, Network tabs hidden until toggled.

### E3b — CAC identity panel (0 of 4 tasks)

- **E3b-1.** `GET /api/v1/cac/chain?sessionId=…` endpoint on [dashboard-service.ts](../src/core/operator/dashboard-service.ts).
- **E3b-2.** Visual accountability-chain renderer in [public/tab-settings.js](../src/core/operator/public/tab-settings.js).
- **E3b-3.** Lifecycle timeline (assign → dispatch → suspend → resume → revoke).
- **E3b-4.** JSON + CSV audit export.

### E3c / E3e — Header surfaces

- SLO gauge visible in dashboard header.
- Plugin enable/disable toggles in header.

### E4 — Plugin cryptographic signatures

- Ed25519 verification wired into plugin install path.
- Real keys generated into [config/plugin-signing-keys.json](../config/plugin-signing-keys.json) (see Phase R1).
- Documented key-rotation procedure.

### E6 / E7 — Observability

- `/metrics` Prometheus endpoint (even if Grafana template is deferred).
- Optional OTel collector egress.

### Phase E-Close exit criteria

- All E1a-9 / E1b-10 / E2-*/ E3a-5 / E3b-* / E4 / E6 tests green.
- No item in [PRISM_FULL_AUDIT_2026_Q2.md](PRISM_FULL_AUDIT_2026_Q2.md) §3 remains "looks complete but isn't."

---

## 3. Phase R — Readiness (NEW)

**Goal:** bring PRISM to a state where a non-team member can onboard in under 15 minutes and a small operator can deploy it to production following a documented runbook. Scope is deliberately narrow.

Phase R is organized into 8 workstreams (R1 through R8). R1 and R2 block everything else. R4 through R7 can run in parallel after R2. R8 runs continuously.

### R1 — Configuration and secrets hygiene (blocking)

| Task | File / target |
|---|---|
| R1-1 Create `.env.example` covering all ~25 env vars with descriptions | `/.env.example` (new) |
| R1-2 Automate `DIRECTIVE_SHA256` in `npm run prebuild` | [src/core/security/directive-integrity.ts](../src/core/security/directive-integrity.ts), [package.json](../package.json) |
| R1-3 Generate real Ed25519 plugin-signing keys | [config/plugin-signing-keys.json](../config/plugin-signing-keys.json) |
| R1-4 Enforce `PRISM_JWT_SECRET ≥ 32 chars` when `NODE_ENV=production` (fail-fast) | [src/index.ts](../src/index.ts) |
| R1-5 Validate TLS cert / key load at startup (not on first request) | [src/core/operator/dashboard-service.ts](../src/core/operator/dashboard-service.ts) |
| R1-6 Add `validateProductionReadiness()` fail-fast at boot | [src/index.ts](../src/index.ts) |

**Acceptance:** production build with any missing-critical-config combination refuses to start and prints a concrete error for each missing item.

### R2 — Security hardening (blocking)

| Task | File / target |
|---|---|
| R2-1 CSRF token middleware on all state-changing endpoints (POST/PUT/DELETE) | [dashboard-service.ts](../src/core/operator/dashboard-service.ts) |
| R2-2 Explicit CORS configuration (default deny cross-origin) | [dashboard-service.ts](../src/core/operator/dashboard-service.ts) |
| R2-3 Lower default `PRISM_RATE_LIMIT` from 200 to 50; stricter bucket on `/api/auth/*` | [src/core/security/rate-limiter.ts](../src/core/security/rate-limiter.ts) |
| R2-4 Input validation (zod) on auth + approval endpoints | [src/core/operator/auth-gate.ts](../src/core/operator/auth-gate.ts) + route handlers |

**Acceptance:** `tests/e2e-smoke.test.ts` extended with CSRF rejection, CORS allowlist, rate-limit brute-force, zod malformed-input cases — all pass.

### R3 — Setup wizard UX uplift

| Task | File / target |
|---|---|
| R3-1 Provider connectivity test before save | [src/cli/setup-wizard.ts](../src/cli/setup-wizard.ts), [templates/setup.ts](../src/core/operator/templates/setup.ts) |
| R3-2 Workspace writability + SQLite integrity probe | [src/core/config/workspace-resolver.ts](../src/core/config/workspace-resolver.ts) |
| R3-3 Explicit success screen with "Next Steps" and direct dashboard link | wizard templates |
| R3-4 Rollback on failure — do not persist partial configuration | wizard CLI + server |
| R3-5 Optional TLS cert configuration step | wizard advanced |
| R3-6 Post-setup OAuth handoff once E2 lands | wizard step 3b |

**Acceptance:** a new user with a bad API key sees an error before the wizard reports "done."

### R4 — User-flow E2E tests

| Task | File / target |
|---|---|
| R4-1 Setup → chat → simple tool round-trip | `tests/e2e-user-flow.test.ts` (new) |
| R4-2 Individual profile `shell_exec` succeeds | same |
| R4-3 Business profile `shell_exec` denied by policy | `tests/business-scenario.test.ts` (new) |
| R4-4 Approval queue round-trip (request → approve → execute → verify) | `tests/e2e-user-flow.test.ts` |
| R4-5 Error recovery (kill server mid-request; client reconnects) | same |
| R4-6 Long-running stability (10 k operations; memory + file descriptor bounds) | `tests/stability.test.ts` (new, scheduled weekly) |
| R4-7 Wire `npm run perf:qualify` into default `npm test` as a warning gate | [package.json](../package.json) |

**Acceptance:** every R4 scenario passes on Windows + Linux CI.

### R5 — Operations and data safety

| Task | File / target |
|---|---|
| R5-1 `scripts/backup.sh` and `scripts/restore.sh` | `scripts/` (new) |
| R5-2 Lightweight DB migration framework (migration table + versioned SQL files) | [src/core/operator/chat-session-store.ts](../src/core/operator/chat-session-store.ts) + new `src/core/db/migrations/` |
| R5-3 Log rotation policy (daily, 30-day retention) | new logger module or winston adoption |
| R5-4 Structured JSON log mode via `PRISM_LOG_FORMAT=json` | logger module |

**Acceptance:** operator can restore a workspace from a backup archive and the system boots and serves `/api/health` within 60 seconds.

### R6 — Observability completeness

| Task | File / target |
|---|---|
| R6-1 `/metrics` Prometheus endpoint (counters + histograms for activity events, approvals, tier denials, tool latency, cost) | [dashboard-service.ts](../src/core/operator/dashboard-service.ts) |
| R6-2 Dashboard health widget (uptime, memory, DB size, active sessions, queue depth) | [public/dashboard-app.js](../src/core/operator/public/dashboard-app.js) |
| R6-3 Approval queue UI in Telemetry tab | [public/tab-telemetry.js](../src/core/operator/public/tab-telemetry.js) |
| R6-4 Logs tab: tail `workspace/logs/*.log` over WebSocket | [public/tab-logs.js](../src/core/operator/public/tab-logs.js) |

**Acceptance:** a curl to `/metrics` returns valid Prometheus exposition format; operators can see pending approvals in the UI without reloading.

### R7 — CI/CD automation

| Task | File / target |
|---|---|
| R7-1 `.github/workflows/ci.yml` — lint, build, unit, integration, E2E, contracts:snapshot, release:validate:strict, cu:bg:check, directive-integrity | `.github/workflows/ci.yml` (new) |
| R7-2 `.github/workflows/release.yml` — manual dispatch → 9 gates → signed release packet artifact | `.github/workflows/release.yml` (new) |
| R7-3 Branch protection: require CI green on `main`; `feat/*` require lint + unit | GitHub repo settings |

**Acceptance:** a PR to `main` cannot merge without green CI; a release run produces a signed release packet artifact.

### R8 — User-facing documentation (continuous during R1–R7)

| Doc | Purpose |
|---|---|
| [BUSINESS_VS_INDIVIDUAL_GUIDE.md](BUSINESS_VS_INDIVIDUAL_GUIDE.md) | Concrete tool-by-tool examples |
| [ERROR_RECOVERY.md](ERROR_RECOVERY.md) | Lost admin token, corrupted DB, lost JWT, cert expiration |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Docker, Compose, PM2, systemd, K8s, TLS via caddy/nginx |
| [ADMIN_SRE_GUIDE.md](ADMIN_SRE_GUIDE.md) | Health endpoints, log locations, backup cadence, rotate keys, rotate PAD hash |
| [CHARACTER_SELECTION_GUIDE.md](CHARACTER_SELECTION_GUIDE.md) | When to use aria / phoenix / sentinel × individual / business |
| Swagger UI served from `/api/v1/docs` | Interactive API reference using existing [openapi.json](../src/core/operator/openapi-generator.ts) |

### Phase R exit criteria

1. A non-team member can complete setup → first chat → denied operation → approval → success in **under 15 minutes** following only the new user guides.
2. `npm run release:validate:strict` passes on a clean clone after only following [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).
3. CI green on `main`; release-workflow artifact produced.
4. Every gap G-1 through G-17 in [PRISM_FULL_AUDIT_2026_Q2.md](PRISM_FULL_AUDIT_2026_Q2.md) §5 is resolved.

---

## 4. Phase F — Expansion (post-Readiness)

Target: **Aug–Oct 2026.** Prerequisites: Phase E-Close and Phase R complete.

| Workstream | Scope |
|---|---|
| F1 A2A Protocol Server | Make PRISM callable from Docker Agent, OpenHands, LangGraph. Per [A2A_OCI_INTEGRATION_SPEC.md](A2A_OCI_INTEGRATION_SPEC.md). |
| F2 OCI character packaging | `oras push` signed character manifests; `oras pull` install from registry. |
| F3 Docker Agent governance hook adapter | Wire existing [governance-hooks-adapter.ts](../src/adapters/application/governance-hooks-adapter.ts) into Docker Agent's hooks surface. |
| F4 **Python SDK (`pypi: prism-client`)** | Thin typed REST bindings. Unlocks ~70% of AI developer market. |
| F5 Dashboard monolith fragmentation | Split [dashboard-service.ts](../src/core/operator/dashboard-service.ts) into route modules. Target: no module > 120 KiB. |
| F6 Native installers | Signed macOS `.pkg`, Linux `.AppImage`, Windows `.msi`. |
| F7 Full TUI client | Beyond the wizard — chat, approvals, operations on headless servers. |

### Phase F exit criteria

- PRISM callable from Docker Agent via A2A.
- Python SDK on PyPI with matching typed API.
- Dashboard routing modularized; no single file > 120 KiB in `src/core/operator/`.
- Signed installers published to GitHub Releases.

---

## 5. Phase G — Ecosystem

Target: **Nov 2026 – Q1 2027.**

| Workstream | Scope |
|---|---|
| G1 Plugin marketplace | Requires E4 signatures. Browse, install, rate plugins from the dashboard. |
| G2 Docs site | Docusaurus or VitePress. Hosted API reference. Hosted versions of all guides. |
| G3 Community | Discord, GitHub Discussions, office hours. |
| G4 Design-partner beta | 5 individuals + 5 SMBs in compliance-adjacent verticals (legal / healthcare / finance). |
| G5 Grafana + OTel templates | Reference dashboards for operators. |
| G6 OpenAI Assistants API compatibility shim | `/v1/assistants/*` endpoints that accept OpenAI-SDK-shaped requests. High-leverage conversion lever. |
| G7 Starter templates | 5–10 pre-built characters + workflows. |

### Phase G exit criteria

- Public plugin marketplace operational.
- Docs site live with search.
- ≥ 10 public partner success stories or design-partner reports.
- OpenAI-SDK client can target PRISM with only a base-URL change.

---

## 6. Phase H — Enterprise

Target: **Q2 2027.**

| Workstream | Scope |
|---|---|
| H1 SSO | OIDC + SAML. |
| H2 RBAC | Role matrix with audit. |
| H3 SCIM | User provisioning. |
| H4 Multi-tenant workspaces | Tenant isolation at SQLite + filesystem + policy layers. |
| H5 Audit export | SIEM-ready NDJSON to S3 / Azure Blob sink. |
| H6 HA | External SQLite → Postgres; activity bus → Redis Streams / NATS option. |
| H7 K8s Helm chart + Terraform module + AWS / GCP / Azure quickstarts | — |
| H8 Compliance dossiers | SOC 2 Type I evidence kit, ISO 27001 controls mapping. |
| H9 Hosted trial tier | Managed cloud PRISM for evaluations. |

### Phase H exit criteria

- SSO works with Okta + Entra ID + Google Workspace.
- Multi-tenant isolation validated by red-team test.
- SOC 2 Type I audit window opened.
- Helm chart passes `kube-linter` and `helm lint`.

---

## 7. Phase I — Compliance and Scale

Target: **Q3 2027.**

| Workstream | Scope |
|---|---|
| I1 SOC 2 Type II | 12-month audit window. |
| I2 FedRAMP Moderate evaluation | Path assessment, not full ATO. |
| I3 Cost governance | Per-session budget caps, per-tenant spend reporting, hard killswitch. |
| I4 Model routing policies | Auto-pick provider by cost/latency/privacy. |
| I5 Formal red-team program | External pentest + bug bounty. |

---

## 8. Cross-cutting invariants

These hold across every phase and override any conflicting phase item:

1. **Frontend Protection Guarantee.** All UI changes are additive. Existing components, views, and WebSocket wiring are never removed or destructively modified.
2. **`start_web.bat` remains the single reliable entrypoint** and performs all required startup checks.
3. **`.venv` (Python 3.10)** is the canonical Python environment. `.venv_guitar`, `.venv310`, etc. are forbidden.
4. **Additive documentation.** No doc is deleted; stale content is marked superseded with a pointer to the current version.
5. **Governance invariants are immovable.** PAD hash verification, CI Gate 9, instance isolation enforcement, and the 3-tier policy engine cannot be softened by any phase work.

---

## 9. Dependency graph

```
E (active)  ──┐
              ├──► R (Readiness) ──► F (Expansion) ──► G (Ecosystem) ──► H (Enterprise) ──► I (Compliance & Scale)
E-Close ─────┘
```

- **E and R run in parallel.** E-Close fixes "looks complete but isn't." R adds user-testing and deployment readiness.
- **F requires both E-Close and R.** Expansion is not safe to ship without real integration tests and user docs.
- **G requires F.** Ecosystem (marketplace, docs site) presumes a Python SDK and stable A2A.
- **H and I are sequential.** Compliance audits cannot start until enterprise IAM exists.

---

## 10. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dashboard monolith obstructs Phase R fixes | Medium | High | Extract only the route modules needed for R2 security work; full split deferred to F5 |
| Phase E2 OAuth complexity | High | Medium | Start with Gmail only; Outlook in follow-up; mock OAuth test servers early |
| No design partners sign on | Medium | High | Recruit through compliance-vertical conferences + MCP community during Phase R |
| Docker Agent competitive response | Medium | Medium | A2A integration (F1) neutralizes — positions PRISM as Docker Agent's governance layer |
| Python SDK maintenance burden | Medium | Medium | Auto-generate from OpenAPI rather than hand-code |
| Enterprise IAM underestimated | High | High | Scope H1–H4 as three separate subphases; SSO first, then RBAC, then SCIM, then multi-tenancy |
| Compliance (SOC 2) timeline slip | Medium | Medium | Start Type I evidence collection in Phase H, not Phase I |

---

## 11. What this roadmap does not do

- Does **not** commit to a managed SaaS PRISM offering as primary business model. A hosted trial tier ships in H9 for evaluations; full managed cloud is out of scope.
- Does **not** promise a visual agent builder (Flowise / Langflow style). Not core to the governance thesis.
- Does **not** rebrand or renumber closed phases A–D4.
- Does **not** change cryptographic governance invariants — PAD + Policy + CAC are locked.

---

## 12. Review and signoff

| Role | Name | Signoff |
|---|---|---|
| Technical lead | Kirk LaSalle | pending |
| Validation lead | — | pending |
| Operations lead | — | pending |
| Product lead | — | pending |

**Next review:** End of Phase E-Close + Phase R (estimated 2026-07).
