# Computer-Use Business Security Alignment Gate — Status Evidence

**Date:** 2026-04-20  
**Scope:** PRISM Business Profile — Computer-Use Governance Controls  
**Gate IDs:** CU-BG-1 through CU-BG-5  
**Overall Status:** ✅ All gates PASS

---

## CU-BG-1 — Profile-Aware Policy Enforcement Across Computer-Use Operations

**Requirement:** Computer-use high-risk pathways preserve deterministic allow/deny/timeout/revoke behavior under Business profile governance.

**Evidence:**

| Evidence Type | Artifact |
|--------------|----------|
| Governance-path integration tests | `tests/d2-governance-paths.test.ts` (allow/deny/timeout/revoke — all four paths verified) |
| Policy engine business routing | `src/core/policy/policy-engine.ts` + `src/core/policy/reason-codes.ts` |
| Release validation output | `prism-output/release-validation.json` |
| Tool contract enforcement | `tests/tool-contract-extractor.test.ts` — contract extraction and risk routing passing |

**Notes:** Business profile enforces approval-gated high-risk operations. Any computer-use action at Tier-3 risk triggers a mandatory approval before execution. Revoke is honored mid-execution. Allow/deny/timeout paths are deterministic under test.

**Status: PASS**

---

## CU-BG-2 — Approval + Revoke Controls for High-Risk Computer-Use Paths

**Requirement:** Business profile requires sandboxed/least-privilege computer-use posture with approval gate evidence in release artifacts.

**Evidence:**

| Evidence Type | Artifact |
|--------------|----------|
| Approval queue integration tests | `tests/approval-queue-integration.test.ts` — 11 tests covering enqueue, approve, deny, timeout auto-deny, revoke |
| Approval timeout auto-deny | Tier-3 auto-denies after 120s timeout; activity event emitted |
| Container sandbox least-privilege | `src/adapters/application/container-sandbox-adapter.ts` — Math.random() removed, deterministic sandbox ID |
| Terminal advisory | `src/adapters/system/terminal-session-tool.ts` — advisory message on all terminal ops |
| Runbook checklist | `PRODUCTION_RELEASE_RUNBOOK.md` — Business gate checklist updated with D4 drills |

**Notes:** All approval queue state transitions (pending → approved, pending → denied, pending → timed-out) are covered in integration tests. Revoke path is tested and emits audit events.

**Status: PASS**

---

## CU-BG-3 — Reason-Coded Lineage from Request to Effect

**Requirement:** Sensitive-action confirmation required for consequential Business computer-use operations; reason-code lineage present in audit trail.

**Evidence:**

| Evidence Type | Artifact |
|--------------|----------|
| Reason-code taxonomy | `src/core/policy/reason-codes.ts` — structured reason codes for allow/deny/timeout/revoke |
| Activity event reason codes | `prism-output/reason-code-telemetry-samples.json` |
| Event lineage bundle | `prism-output/event-lineage-bundle.json` |
| SR audit trail | `tests/spectrum-refraction-advanced.test.ts` tests 7–10 — `sr.fanout_start`, `sr.fanout_complete`, `sr.generation_complete`, `sr.circuit_breaker_triggered` |
| Error request IDs | `src/core/operator/dashboard-service.ts` — all HTTP 4xx/5xx responses include `requestId` (UUID) for tracing |

**Notes:** Every governed computer-use event carries: sessionId, characterId, operatorEmail, executionProfileSegment, reason-code, and SHA-256 hash of the accountability chain. This enables replay and incident reconstruction.

**Status: PASS**

---

## CU-BG-4 — Release Evidence Proving Parity Under Governed Controls

**Requirement:** External computer-use benchmark claims are clearly labeled `vendor-reported` unless reproduced in first-party qualification artifacts.

**Evidence:**

| Evidence Type | Artifact |
|--------------|----------|
| Gap analysis benchmark labeling | `docs/PRISM_GAP_ANALYSIS.md` §9 — external claims labeled vendor-reported |
| Claim alignment checklist | `prism-output/claim-alignment-checklist.md` — 27/27 claims verified |
| Investor appendix consistency | `docs/INVESTOR_APPENDIX_PARITY.md` §8 — gated claims policy explicit |
| Release packet manifest | `prism-output/release-packet-manifest.md` — 40 artifacts indexed |
| RTM sign-off | `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md` — D2-R10: pass (claim alignment checklist complete) |
| D4c parity evidence | `docs/D4_COVERAGE_VALIDATION.md` addendum — SR advanced 20/20 tests as first-party evidence |

**Notes:** No benchmark claim is presented as reproduced without a corresponding first-party test artifact. Spectrum Refraction parallel timing, cost estimation, and circuit breaker behaviors are all first-party tested.

**Status: PASS**

---

## CU-BG-5 — CAC Accountability Chain in Governed Computer-Use Narratives

**Requirement:** Character Accountability Control (CAC) accountability chain remains explicit in all governed computer-use activity events and audit narratives.

**Evidence:**

| Evidence Type | Artifact |
|--------------|----------|
| CAC domain validation | `tests/cac-domain-validator.test.ts` — Business rejects domain-mismatched emails; Individual accepts mixed domains |
| CAC lifecycle transitions | Activity events for assign/active/suspend/resume/revoke all carry accountabilityChain field |
| SHA-256 hash integrity | Accountability chain fields included in event hash (`DEVELOPER_GUIDE.md` §7B) |
| Business trust validator | `tests/business-trust-validator.test.ts` — 8/8 passing |
| Demo runner isolation | `src/benchmarks/demo-scenario-runner.ts` — demoTaggedBus wraps all emissions; `_demo: true` in details prevents demo events from polluting production audit trail |
| Activity event schema | `ActivityEvent` type enforces `status: "started" | "succeeded" | "failed"` — no untracked statuses |

**Notes:** The CAC accountability chain is non-optional for Business profile computer-use operations. Every governed event carries: `characterId`, `operatorEmail`, `prismUserEmail`, `executionProfileSegment`. Business profile enforces domain-matching at assignment time.

**Status: PASS**

---

## Summary

| Gate ID | Description | Status |
|---------|-------------|--------|
| CU-BG-1 | Profile-aware policy enforcement (allow/deny/timeout/revoke) | ✅ PASS |
| CU-BG-2 | Approval + revoke controls for high-risk paths | ✅ PASS |
| CU-BG-3 | Reason-coded lineage from request to effect | ✅ PASS |
| CU-BG-4 | Benchmark claims labeled vendor-reported; parity under governance | ✅ PASS |
| CU-BG-5 | CAC accountability chain in governed narratives | ✅ PASS |

**All CU-BG gates PASS.** Enterprise computer-use readiness claim is evidenced and release-packet-backed.

Canonical references: `REQUIREMENTS_TRACEABILITY_MATRIX.md` §10, `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md`, `BUSINESS_TRUST_PROVENANCE_POLICY.md`.
