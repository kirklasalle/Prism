# PRISM — Authoritative Status (v0.22.4)

> Single source of truth for what's shipped, what's pending, and what's gated.
> Replaces the audit-doc maze for operator and investor reading. Linked from
> `README.md`. Generated and maintained alongside each release.

## Headline

PRISM is an **open-source, self-hostable, governance-native Agents-as-a-Service
runtime**. It runs on a single laptop or a Kubernetes cluster, ships with a
provable Permanent Active Directives integrity gate, a tiered approval queue, a
self-driving test harness (PTAC), and — as of v0.22 — an additive **VRGC Robotics Add-on** and **Boot-time Add-on Management Panel** for managing and studying add-on components under full PRISM governance.

The phrase "Agents As A Service" was coined by Kirk LaSalle.

## Versioning

| Field            | Value                                          |
| ---------------- | ---------------------------------------------- |
| Current version  | `0.22.4`                                       |
| Branch           | `main`                                         |
| Build script     | `npm run build` (auto-runs PAD prebuild hash)  |
| Doctor           | `npm run doctor`                               |
| Headline demo    | `npm run ptac:demo` and the `Watch Me` tab     |

Operators are expected to run `npm run doctor` before every deployment. Any
non-zero exit indicates an unresolved readiness issue.

## What's Shipped (v0.21.0 → v0.22.4)

### Guardian MSD & Self-Healing (v0.22.4)

- **Verbatim 10 Laws Public Publication**: Successfully published the verbatim 10 laws of the Permanent Active Directives (PAD) in the public wiki (`docs/prism_public/wiki.html`) and root `README.md`, highlighting their historical expansion from Asimov's Three Laws of Robotics.
- **Guardian Self-Healing & Self-Improvement Skills**: Implemented `skill.custodian.self-heal` and `skill.custodian.self-improve` skill workflows, fully registered in the PRISM `SkillsEngine` database.
- **Micro Support Desk (MSD) & SQLite Ticketing Integration**: Configured the Guardian Agent to route diagnostic fallbacks (Law 9) and recovery actions through the MSD. Enabled SQL-level database level protection for ticket mutations (using `BEGIN IMMEDIATE TRANSACTION`).
- **Telemetry & Learned-History Logging**: Structured real-time logging of self-healing diagnostics to `logs/guardian-self-heal.log` and the TABS telemetry flow, complete with warning banners for `[SR_DISABLED]` fallback routing.
- **Test Coverage**: Added robust integration test cases in `tests/guardian-skills-recovery.test.ts` validating the end-to-end task routing.

### Add-on Management Panel & UI Visibility (v0.22.4)

- **Boot-time Add-on Management Panel**: Added a dedicated, collapsible **Add-ons** panel to the top of the **Tools & Plugins** tab. Displays disk/memory state, enabled toggle, and settings configurations.
- **High-Visibility Learn Feedback**: Replaced transient notice system with a fixed-position progress banner sliding down from the top of the viewport. Features a spinner, real-time elapsed timer, and explicit path outcomes for Wiki/Governance Skills.
- **Add-on Path Resolution**: Resolved mismatch issues between manifest IDs and folder names on disk using dynamic scan-matching.
- **Integration Test Suite**: Added `tests/addons-api-routes.test.ts` to test all add-on routes.

### Robotics Add-on & Intelligent Integration (v0.22.3)

- **VRGC Robotics Subsystem** (v0.22.3): Integrated a dedicated **Robotics** tab into the Operator Console containing four enterprise-grade panels:
  - **Entity Registry:** Registering, monitoring, and managing robotic and cognitive entities.
  - **Workshop:** Building characters, configuring safety thresholds, monitoring learning progress, and graduation gates.
  - **Integrations:** Bridge connections to built-in VRGC MCP Server, external spiking neural net runtime BrainSim III, graph-based conceptual store UKS (Universal Knowledge Store), ROS 2, and physical I/O endpoints.
  - **Telemetry & Governance:** Real-time ActivityBus telemetry stream and policy validation log for robotic actions.
- **REST Endpoints:** Exposed `/api/addons/vrgc-robotics/entities`, `/api/addons/vrgc-robotics/integrations`, and `/api/addons/vrgc-robotics/entities/:id/transition` for client control and state-machine automation.
- **Integration Tests:** Comprehensive suite `tests/robotics-addon.test.ts` verifying all registration, status transitions, and integration bridge routes.

### Governance

- Permanent Active Directives (PAD) integrity hash with build-time regeneration
  and runtime verification. Tampering produces a `directive_tamper` reason
  code and is exercised by PTAC scenario `s20`.
- Tiered approval queue (Tier-1 capability / Tier-2 approval / Tier-3 deny)
  with full enqueue + resolve coverage in PTAC `s05`, `s06`, `s08`, `s09`,
  `s15`.
- Profile-aware policy engine (Individual vs Business) with CAC enforcement
  on Business setup paths (`s02`, `s04`).
- SR (Sufficient Reasoning) cost gate (`s17`) and Guardian self-checks.

### Autonomous Loop

- `AgenticChatExecutor` (LLM → tool → observe → LLM) with iteration budget
  (default 25), workspace-sandbox enforcement on file writes, write-call
  cap (15/turn), Tier-3 routing to the Approval Queue, and live
  `agentic_event` WebSocket streaming.
- Driven through the public `/api/chat` handler — no internal-only path.
- **v0.21 — "Watch Me" tab** (additive UI): operator picks a session, types a
  goal, watches the timeline of thoughts + tool calls + screenshots in real
  time. Big red **STOP** button. Frontend Protection Guarantee preserved.

### PTAC — Self-Driving Test Harness

- 28 scenarios (`s01`–`s18`, `s20`, `s26`–`s28`) drive PRISM via its public
  HTTP/WS surface. Sandbox profile is the default; host profile is
  triple-gated (`PRISM_PTAC_OPERATOR_DEMO=1`, `PRISM_PTAC_SAFE=1`,
  `PRISM_PTAC_RECORD_VIDEO=1`).
- Demo recorder produces a portable HTML slideshow for investor / customer
  demos (`npm run ptac:demo-recording`).
- **v0.21 — `s28-autonomous-self-test`** (additive scenario): proves the
  autonomous loop is wired through the live `/api/chat` handler. Suites:
  `fast`, `full`, `demo`. Tags: `self-drive`, `autonomous`, `headline`.

### Operator Tooling

- **v0.21 — `prism doctor`** (`npm run doctor`): readiness probe over PAD
  integrity, JWT secret length in production, plugin signing keys not
  placeholder, workspace writability, SQLite header validity, and an
  optional HTTP probe of `/api/health`.
- `/api/health`, `/api/health/extended`, and `/api/status` consolidated
  endpoints. Auth-gated where appropriate; `/api/health` and `/metrics`
  remain public.

### Real Adapters (Phase R+)

- Real PTY pause/resume (`s26`).
- Real Docker container lifecycle (`s27`).

## What's Pending

These items are partially implemented and not yet on by default. Each has an
existing tracking task; none block the v0.21 demo.

| Item                                       | Status   | Notes                                             |
| ------------------------------------------ | -------- | ------------------------------------------------- |
| OAuth scenarios `s08`–`s10` deeper coverage | partial  | Tier-2 approval lifecycle covered; OAuth-specific assertions pending. |
| Plugin-signature enforcement (E4)           | partial  | Validation present; production-mode hard-fail behind flag. |
| Scoped-token issuer (E5)                    | partial  | Token shape and verification merged; issuer UI pending. |
| Marketplace HTTP transport                  | partial  | In-process and file transports stable; HTTP transport pending. |
| OTel egress profile                         | partial  | Local span buffer ships; remote exporter behind flag. |
| `pluginLifecycle: uninstall` PTAC step      | deferred | Throws "not yet wired" — see `src/ptac/orchestrator.ts:559`. |
| `screenshotDiff` / `clickAt` / `typeText`   | deferred | Recorder primitives exist; PTAC step kinds pending. |
| OSWorld benchmark integration               | not run  | See [OSWORLD_PUBLICATION_PLAN.md](OSWORLD_PUBLICATION_PLAN.md) for the conditions under which we'll publish. |
| Python SDK PyPI release                     | partial  | v0.2.0 source-installable from `sdk/python`; PyPI publication pending license-boundary signoff. |

## World-Class SAP Audit Implementation (2026-07-20)

This section tracks implementation of the world-class SAP audit program
(Software Application Programming discipline for ML) using a single
three-state model across code, documentation, market placement, and critical
security/governance findings.

### Current State

- **Accomplished**
  - Baseline audit evidence corpus established from `STATUS.md`, `ROADMAP.md`,
    `CHANGELOG.md`, `PRISM_CRITICAL_AUDIT_2026.md`,
    `REQUIREMENTS_TRACEABILITY_MATRIX.md`, and
    `prism_release_readiness_audit.md`.
  - MCP IDS recognized as a core runtime awareness subsystem and aligned with
    Guardian documentation drift checks.
- **In Progress**
  - Publication of SAP master approval package and single master matrix.
  - MCP IDS runtime awareness metrics formalization (awareness, drift,
    freshness, unresolved mismatch rates).
  - Cross-document integration and operator gate criteria.
- **Not Yet Accomplished**
  - Full closure of all critical release blockers in
    `prism_release_readiness_audit.md`.
  - End-to-end evidence publication for compliance-grade external review
    (SOC2-oriented artifacts, external pen-test evidence, buyer proof packets).

### Program Principle

When MCP IDS is actively integrated into runtime governance workflows, PRISM
must demonstrate increased operational awareness through measurable indicators,
not narrative-only claims.

## CI Gates

- PAD integrity must match (`Gate 9`).
- PTAC `--suite=fast` must be green per PR.
- PTAC `--suite=full` runs nightly on the self-hosted Windows runner.
- E2E tests (`npm run test:e2e`) must pass on the release branch.
- Contract diff gate refuses breaking changes to public tool contracts
  unless `--allow-breaking` is set on a documented release.

## Operator Quickstart

```pwsh
# 1. Verify the system is healthy.
npm run doctor

# 2. Boot the dashboard.
npm start                  # or .\start_web.bat on Windows

# 3. Run the headline autonomous demo.
#    Tab "Watch Me" → pick a session → type a goal → press Run.
#    Or, recorded: npm run ptac:demo-recording
```

## Frontend Protection Guarantee

All UI changes in v0.21 are **additive only**. No existing component, view,
WebSocket wiring, or client module has been removed or destructively modified.
The new **Watch Me** tab and the new PTAC s28 scenario sit alongside every
existing surface.
