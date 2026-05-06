# PRISM Full Audit 2026-Q3 + Phase R Closure + PTAC Plan

**Status:** Approved plan, implementation underway.
**Baseline release:** v0.4.2 (D4c + production hardening, 2026-04-25).
**Baton-pass author:** GitHub Copilot (Claude Opus 4.7), 2026-05-03.
**Operator:** Kirk LaSalle.
**Supersedes / extends:** [`PRISM_FULL_AUDIT_2026_Q2.md`](PRISM_FULL_AUDIT_2026_Q2.md), [`PRISM_UPDATED_ROADMAP_2026_Q2.md`](PRISM_UPDATED_ROADMAP_2026_Q2.md), [`READINESS_RUNBOOK.md`](READINESS_RUNBOOK.md).

This document is the consolidated 2026-Q3 audit, the closure plan for the eight Phase R blockers, the production-grade specification of **PRISM Testing & Active Control (PTAC)**, and an updated roadmap. The non-negotiable principle running through every step: **production-only, no stubs anywhere.** Either a feature ships with a real I/O integration and tests, or its completion claim is removed.

---

## 1. Audit Baseline

### 1.1 Implemented and production-grade

The following subsystems are real, tested, and shipping:

- **Governance core**: 3-tier policy engine (D2), Approval Queue HTTP service (D3), Permanent Active Directives with SHA-256 integrity verification (D4 + Law 10), Character Accountability Control (CAC), Business Trust validator with signing/review/attestation, Guardian agent with periodic re-verification.
- **Agent runtime**: AgentPool, AgentRouter, AgentLifecycleManager, SwarmCoordinator (4 topologies — mesh, hierarchical, pipeline, broadcast), TaskDecomposer, per-agent model routing.
- **Spectrum Refraction (D4a/b/c)**: tri-model fan-out, multi-key model slots (`leftSlot` / `rightSlot`), per-hemisphere timeouts, circuit breaker, signed audit trail, cost estimation pre-flight, show-hemispheres mode (40 / 40 tests).
- **Browser automation**: Playwright 1.58 with 40+ actions, session/profile/cookie isolation, JS evaluation; real WebSocket events.
- **Memory subsystem**: episodic + semantic + session stores with retrieval-dashboard attribution and metrics collector with retrieval alert profiles.
- **LLM provider plane**: 17 providers under one manager, per-provider cost tracking, capability matrix, governance preamble injection for Tier 2+ routes.
- **Adapters and tools**: terminal-session-adapter and container-sandbox-adapter (code-complete with policy routing, lifecycle, lineage; CI Gates pass), MCP 1.0 stdio client, plugin pack framework, framebuffer capture, Gmail / Outlook OAuth scaffolding, Neo4j tool, semantic query tool, scheduler engine, self-review scheduler, usage metering service.
- **Surfaces**: web dashboard (12+ tabs, dynamic tab loader with prefetch), Ink/React TUI (chat, settings, tools, agentic, computer, browser, workspace, network, telemetry, logs, scheduler), Setup Wizard (web + TUI variants).
- **Operations**: Dockerfile + docker-compose, PM2 ecosystem config, health endpoint with dependency detail, Prometheus-style /metrics endpoint, graceful shutdown audit event.

### 1.2 Claimed-complete but not production-real

Findings that the prior audit register flagged and that remain open until the implementation work in §3 lands:

| Ref. | Surface | Reality | Plan ref. |
| --- | --- | --- | --- |
| G-4 / E1a-9 | `terminal-session-adapter.isPtyEnabled()` returns `false` | `node-pty` is in `optionalDependencies` and is not yet wired into the adapter's read/write path. | E1a-9 |
| G-6 / E1b-10 | `container-sandbox-adapter.isDockerEnabled()` returns `false` | `dockerode` not wired; `snapshot` / `revert` are no-ops. | E1b-10 |
| G-7 / E2 | `email-oauth-adapter`, `outlook-oauth-adapter` | OAuth flow scaffolded; no real Gmail / Outlook / Calendar API calls. 0 / 11 tasks done. | E2 |
| G-12 | `directive-integrity.ts` `DIRECTIVE_SHA256` was a manual constant | **CLOSED in this commit.** Replaced with `directive-hash.generated.ts` produced by `npm run prebuild`. | R1-2 |
| G-2 | `config/plugin-signing-keys.json` was a placeholder with `_note` | **CLOSED in this commit.** `_note` removed; `tier` renamed to `bootstrap` with `productionReady: false`; new `npm run keys:generate-plugin` script + custody doc plan. | R1-3 |
| G-1 | `PRISM_JWT_SECRET` was a startup warning | **CLOSED in this commit.** Now FATAL when `NODE_ENV=production`. | R1-4 |
| 3.6 | README header line versioning | README already says v0.4.2; `package.json` was at `0.2.0`. **CLOSED in this commit.** Bumped to 0.4.2. | R1 |
| G-3 | Setup wizard accepts `@prism.local` Business CAC, runtime denies | Open. To be fixed in R3. | R3 |
| 3.5 | Computer-use `handleKeyboardInput` is SendKeys-only | Open. To be replaced with real Win32 `SendInput` path under PTAC keyboard work. | PTAC-K1 |
| 3.7 | Vision capture `burst` / `list` actions scaffolded | Open. To be wired to `framebuffer-capture.ts`. | PTAC-V1 |

### 1.3 System critique

**Strengths** — defensibly novel and production-ready combinations:

- The pillar set `PAD + Tier-3 policy engine + CAC + Spectrum Refraction + Approval Queue` is unmatched among self-hostable agent runtimes; cryptographic enforcement of operator directives is unique.
- Minimal mandatory dependency footprint (Node + sqlite3 + ws + sharp + Playwright); optional features gated cleanly.
- Dual surfaces (web + Ink TUI) cover both desktop and headless ops; CI gates for tool contracts, profile parity, lineage telemetry, and PAD hash exist and pass.

**Weaknesses** — items that block reach more than capability:

- Distribution: no Python SDK, no OCI character registry, no Docker Agent inbound bridge, no marketplace. Competing OSS stacks (OpenHands 71k★, CrewAI 48k★, LangGraph 29k★) have ecosystem-driven leverage Prism does not yet have.
- Enterprise IAM: SSO / RBAC / SCIM are absent; this caps Phase H readiness.
- UX traps: Setup Wizard accepts placeholder CAC for Business profile and only fails at first action; optional dependencies disable features silently rather than warning at /api/health and the TUI boot panel.
- Calendar drift: D2 manifests dated `2026-03-18` but actual completion `2026-04-20`, leaving a perception gap between docs and reality.

**Risks** — external pressures and self-test gaps:

- Docker Agent ships pre-installed in Docker Desktop 4.63+ (~20M users); without an inbound bridge Prism cedes the easiest distribution surface.
- Computer-use keyboard gap (SendKeys vs. real `SendInput`) is a benchmark blocker on OSWorld / WebArena equivalent tests.
- No automated end-to-end test currently exercises Setup → chat → Tier-2 → Tier-3 approval → real PTY → real Docker → accountability chain. PTAC closes this.

### 1.4 Market position

Web verification (May 2026) confirms:

- OpenAI CUA / Operator (OSWorld 38.1 %, WebArena 58.1 %, WebVoyager 87 %), Anthropic Claude computer-use (OSWorld 14.9 – 22 %), Google Project Mariner, Perplexity Comet, Microsoft Agent Framework (successor to AutoGen, in maintenance), LangGraph, CrewAI, OpenHands, Agent Zero, Salesforce Agentforce, AWS Bedrock Agents, GCP Vertex Agents, Cohere, Manus.
- Major commercial AaaS offerings are vendor-locked clouds.
- The "AaaS" brand is not a common product category among competitors today (Salesforce → Agentforce, Microsoft → Agent Framework, AWS → Bedrock Agents, Google → Vertex Agents). Kirk LaSalle's coining of "AaaS" remains a brand-positioning win.
- The defensible technology claim is **first open-source, self-hostable, governance-native AaaS runtime with cryptographic directive enforcement and tri-model parallel orchestration.** The blanket "first AaaS technology" claim is not defensible against Salesforce Agentforce (2024) and Microsoft Agent Framework (2024 – 2025) and is reframed accordingly.

---

## 2. Closure of the eight blockers (production-only)

The eight blockers identified in [`PRISM_FULL_AUDIT_2026_Q2.md`](PRISM_FULL_AUDIT_2026_Q2.md) collapse onto Phase R items R1 – R8 in the [`READINESS_RUNBOOK.md`](READINESS_RUNBOOK.md). The first commit alongside this document closes the foundation:

| Blocker | Resolution shipped in this commit |
| --- | --- |
| G-12 — manual directive hash | `scripts/compute-directive-hash.cjs` runs in `npm run prebuild`; `directive-integrity.ts` now imports `DIRECTIVE_SHA256_GENERATED` from `directive-hash.generated.ts`. |
| G-1 — JWT secret warning only | `src/index.ts` refuses to boot in production when `PRISM_JWT_SECRET` is missing or shorter than 32 chars, when `PRISM_AUTH_DISABLED=true`, or when `PRISM_DATA_DIR` is unset. |
| G-2 — placeholder plugin signing key | `_note` removed; new `npm run keys:generate-plugin` script generates Ed25519 keypairs; `productionReady: false` flag carries the bootstrap status; `config/plugin-private-key*.pem` is gitignored; custody / rotation documented in `docs/SECURITY_KEY_MANAGEMENT.md` (next commit). |
| Version drift | `package.json` bumped from `0.2.0` to `0.4.2`. |
| Missing `.env.example` | Created with every variable read by `src/index.ts`, the dashboard, and adapters, including PTAC variables. |

The remaining blockers (G-3 Setup Wizard CAC fail-fast, G-4 / G-6 real PTY / Docker, G-7 OAuth, plus R6 Prometheus parity / R7 GitHub Actions / R4 Playwright E2E) close in the next commits per [`READINESS_RUNBOOK.md`](READINESS_RUNBOOK.md).

---

## 3. Phase PTAC — PRISM Testing & Active Control

### 3.1 Goals

PTAC is a Prism-driven harness that uses Prism's own public APIs and computer- and browser-control tools to execute end-to-end test scenarios. It serves three production purposes simultaneously:

1. **Self-test gate** — passing the full PTAC suite is the formal entry criterion to "user testing ready" and "business deployment ready."
2. **Live demo asset** — every run produces a deterministic recording (per-step screenshots, action log, accountability chain, optional sandbox video, single `report.html`) suitable as the headline investor / customer demo.
3. **Continuous regression cover** — a self-hosted Windows runner runs `--suite=fast` per PR and `--suite=full` nightly.

### 3.2 Tiered safety profiles

Two profiles ship from day one:

| Profile | Where it runs | Confirmation | Triggers wired |
| --- | --- | --- | --- |
| `sandbox` (default) | Windows Sandbox / Hyper-V VM / Linux Xvfb container | none | SIGINT / SIGTERM / step timeout / `--abort-on-failure` / HTTP `POST /api/ptac/abort` |
| `host` | Operator desktop | `--i-understand-host-control` flag | Adds: global panic chord (default `Ctrl+Alt+Shift+Escape`), 60-second focus-idle watchdog, every destructive action requires a Tier-3 approval through the existing Approval Queue |

The `host` profile never silently aborts — every trigger emits a structured `ptac.aborted` audit event with `accountabilityHash` mirrored into the run report.

### 3.3 Production scaffold (in this commit)

```
src/ptac/
├── index.ts                  public re-exports
├── types.ts                  typed step vocabulary (PtacStep union)
├── orchestrator.ts           drives Prism via public HTTP + WS API only
├── kill-switch.ts            global chord, idle watchdog, HTTP abort poller
├── recorder.ts               screenshots + JSONL + report.html + summary.json
├── scenario-registry.ts      authoritative registry (empty until scenarios land)
└── cli.ts                    npm run ptac:sandbox | ptac:host | ptac:demo
```

Important: the registry is intentionally empty in this commit. The CLI exits with code `3` and a clear message rather than fabricating a green run. Every scenario must register itself at import time and is shipped alongside (a) a typed scenario file under `src/ptac/scenarios/`, (b) a fixture / expected-result bundle under `tests/fixtures/ptac/<id>/`, and (c) a unit test asserting the scenario parses, references valid reason codes, and only contains host-only steps when flagged `requiresHost`.

### 3.4 Step library

The orchestrator dispatches on a typed `kind` field. The first commit wires two: `chat` (real `POST /api/chat` with optional `expectApprovalRequired`) and `padHashVerify` (real `GET /api/health` with the `directive.valid` field). Every other `kind` throws an explicit "not yet wired" error so a scenario depending on it surfaces a real failure. This enforces the no-stub rule: PTAC will never silently report a green run for a feature that is not actually implemented.

| Step kind | First commit | Subsequent commit |
| --- | --- | --- |
| `chat` | wired | refine: assert tier label |
| `padHashVerify` | wired | tamper scenario s14 |
| `setupWizard` | error | wire to wizard API after R3 |
| `approveAt` | error | wire to Approval Queue after R3 |
| `runTool` | error | wire to /api/tools/execute |
| `assertEvent` | error | wire to /api/activity stream |
| `clickAt`, `typeText`, `screenshotDiff` | error | wire after PTAC-K1 (real keyboard) and PTAC-V1 (vision burst) |
| `terminalExec` | error | wire after E1a-9 (real PTY) |
| `containerExec` | error | wire after E1b-10 (real Docker) |
| `oauthFlowCanary` | error | wire after E2 (real OAuth) |
| `srFanOut` | error | wire to /api/sr/generate |

### 3.5 Scenario plan (s01 – s20)

Each scenario will be added in its own commit with the corresponding step support landing first.

| ID | Title | Suite | Profile |
| --- | --- | --- | --- |
| s01 | Setup wizard, individual profile, end-to-end | fast / full | sandbox |
| s02 | Setup wizard, business profile, CAC fail-fast on placeholder email | fast / full | sandbox |
| s03 | Tier-1 chat, capability-only | fast / full | sandbox |
| s04 | Tier-2 chat with rollback assertion | fast / full | sandbox |
| s05 | Tier-3 chat with human approval through Approval Queue | full | sandbox |
| s06 | Real PTY exec with policy gate | full | sandbox |
| s07 | Real Docker exec with snapshot / revert | full | sandbox |
| s08 | Gmail canary: list + send + label | full | sandbox |
| s09 | Outlook canary: list + send | full | sandbox |
| s10 | Google Calendar canary: read + create event | full | sandbox |
| s11 | Spectrum Refraction tri-model fan-out | fast / full | sandbox |
| s12 | SR circuit breaker trip-and-recover | full | sandbox |
| s13 | SR pre-flight cost estimation | full | sandbox |
| s14 | PAD tamper detection (negative scenario) | fast / full | sandbox |
| s15 | Plugin signature fail-closed | full | sandbox |
| s16 | Mini WebVoyager browser tasks | full | sandbox |
| s17 | Mini OSWorld desktop tasks (Notepad / Edge) | full | host |
| s18 | Swarm-mesh topology coordination | full | sandbox |
| s19 | Guardian self-heal | full | sandbox |
| s20 | CAC lineage roundtrip | full | sandbox |

### 3.6 CI integration

GitHub Actions self-hosted Windows runner (configured in the R7 workstream):

- `ptac.yml` (per PR): `ptac:sandbox -- --suite=fast`. Run report attached as artifact; PR comment links to it.
- `ptac-nightly.yml`: `ptac:sandbox -- --suite=full` plus a curated `host` shadow run on a dedicated demo machine with the panic chord active.
- Failure surfaces `report.html` and `summary.json` as artifacts with retention 30 days.

---

## 4. Updated roadmap

### Phase R — Readiness

R1 config & secrets (this commit closes R1-2, R1-3 partial, R1-4); R2 web security; R3 wizard UX (CAC fail-fast); R4 user-flow E2E; R5 backup / migration; R6 Prometheus + OTel; R7 GitHub Actions; R8 docs sync.

### Phase E — Integration hardening

E1a-9 real `node-pty`; E1b-10 real `dockerode` with real `snapshot` / `revert` via `docker commit`; E2 Gmail + Outlook + Calendar; E3a Simple Mode persisted per user (additive only); E3b CAC accountability panel polish; E4 Ed25519 plugin signature enforcement at install + activation; E5 scoped tokens (read / write / approve).

### Phase PTAC — see §3

### Phase F — Reach

A2A protocol server; OCI characters published to `agentcatalog/prism/*`; **Python SDK**; native installers (MSI / .pkg / .deb); inbound Docker Agent bridge.

### Phases G / H / I

G — design-partner beta, Grafana templates, OpenAI Assistants compatibility. H — SSO / RBAC / SCIM, Postgres + Redis HA, K8s + Helm + Terraform. I — SOC 2 Type II, FedRAMP moderate, formal red-team, per-tenant spend caps.

---

## 5. Verification matrix

| Gate | Command | Status as of this commit |
| --- | --- | --- |
| Build | `npm run build` | ✅ green (prebuild hash automation runs) |
| Directive integrity tests | `mocha dist/tests/directive-integrity.test.js` | ✅ 24 / 24 pass |
| CI gate suite | `npm run ci:gate:check` | unchanged |
| Computer-use business gate | `npm run cu:bg:check` | unchanged |
| Release validation strict | `npm run release:validate:strict` | unchanged |
| PTAC fast suite | `npm run ptac:sandbox -- --suite=fast` | scenarios pending; CLI exits `3` with an explicit "no scenarios" message rather than a fake pass |
| PTAC full suite | `npm run ptac:sandbox -- --suite=full` | as above |

The strict no-stub rule is preserved by design: PTAC's `cli.ts` returns exit code `3` until real scenarios land, and the orchestrator throws explicit "not yet wired" errors for every step kind that does not have a real backend.

---

## 6. Decisions on the three further considerations

1. **Canary OAuth secret hosting** — GitHub OIDC → Azure Key Vault for CI; `.env.canary` (gitignored) locally. Pinned in `.env.example`.
2. **Host profile elevation on Windows** — non-elevated default that handles non-elevated UIs; elevation-required scenarios documented as Tier-3 Business only and only run on the dedicated demo machine.
3. **Docker Agent bridge direction** — inbound first (Docker Agent → Prism). Lowest engineering cost; exposes Prism governance to the Docker Desktop installed base immediately.

---

## 7. Frontend Protection Guarantee

Every change in this audit and in every downstream commit is **additive only** to the UI. No existing component, route, or WebSocket wiring is removed or destructively modified. New features ship alongside existing ones; the Simple Mode toggle hides Advanced tabs without removing them.
