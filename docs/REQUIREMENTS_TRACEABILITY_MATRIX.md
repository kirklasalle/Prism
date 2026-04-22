# PRISM Requirements Traceability Matrix (Parity Program)

Date: 2026-03-17  
Scope: Phase D2 Capability Parity Program (`PRISM Individual` + `PRISM Business`)

## 1. Purpose

This matrix maps parity requirements to:

- validation tests,
- required release artifacts,
- ownership,
- and go/no-go gate decisions.

It is the authoritative checklist for verifying that parity claims are implemented and evidence-backed.

## 2. Matrix Columns

- **Requirement ID**: stable identifier for requirement tracking.
- **Source**: originating document section.
- **Requirement**: implementable requirement statement.
- **Verification Method**: test or validation method.
- **Evidence Artifact(s)**: concrete output required for release review.
- **Owner**: accountable function.
- **Gate**: release gate where evidence is required.

## 3. Requirement-to-Evidence Matrix

| Requirement ID | Source | Requirement | Verification Method | Evidence Artifact(s) | Owner | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| D2-R1 | `PRISM_PRD.md` §8.6 | Individual and Business expose equivalent capability surface | Profile-equivalence integration tests | Profile parity matrix, integration test report | Engineering + QA | Phase D2 / Stage 1 |
| D2-R2 | `PRISM_PRD.md` §8.6 | Terminal virtualization lifecycle (`start`, `stop`, `timeout`, `revoke`) | Lifecycle integration tests + revoke drills | Terminal lifecycle test logs, governance-path report | Engineering | Phase D2 / Stage 2 |
| D2-R3 | `PRISM_PRD.md` §8.6 | Container sandbox lifecycle and snapshot/revert | Container scenario tests + replay checks | Container scenario report, replay lineage samples | Engineering + QA | Phase D2 / Stage 2 |
| D2-R4 | `PRISM_PRD.md` §8.6 | Dynamic staged tools require contract extraction and risk routing | Contract extraction tests + policy routing tests | Contract extraction logs, policy reason-code evidence | Engineering | Phase D2 / Stage 1 |
| D2-R5 | `PRISM_PRD.md` §8.6 | Plugin/adaptor packs require compatibility metadata and scope checks | Compatibility validation tests | Compatibility check report, blocked-install samples | Engineering + QA | Phase D2 / Stage 2 |
| D2-R6 | `PRISM_PRD.md` §8.6 | Business profile requires trust/provenance validation before enable | Business trust-policy tests | Trust validation report, audit event samples | Engineering + Governance | Phase D2 / Stage 2 |
| D2-R7 | `TEST_STRATEGY.md` Phase D2 scenarios | Governance paths must pass `allow`, `deny`, `timeout`, `revoke` | Governance-path regression suite | Governance-path test report | QA/Validation | Phase D2 / Stage 1 |
| D2-R8 | `PRISM_PRD.md` §8.6 + `DEVELOPER_GUIDE.md` §10 | Execution modes (`fast`, `balanced`, `governed`) must be qualified | Performance qualification by mode | Mode qualification report, perf JSON summary | Engineering + QA | Phase D2 / Stage 1 |
| D2-R9 | `PRISM_PRD.md` §9 | Business high-risk parity operations keep 100% governance-path pass rate | Gated test policy in CI and release validation | CI gate output, release validation report | QA/Validation | Stage 3 Go/No-Go |
| D2-R10 | `PRODUCTION_RELEASE_RUNBOOK.md` Stage 3 | Investor/licensing claims align to validated capability evidence | Documentation evidence review checklist | Claim alignment checklist, signed review notes | Product/Governance | Stage 3 Go/No-Go |
| D2-R11 | `PHASE_EXECUTION_PLAN.md` Phase D2 | Event lineage and reason-coded telemetry for high-risk ops | Replay and telemetry validation | Replay lineage bundle, reason-code telemetry samples | Engineering + Operations | Phase D2 / Stage 2 |
| D2-R12 | `PHASE_EXECUTION_PLAN.md` Phase D2 | Traceability matrix must link claims to tests and artifacts | Documentation and release review | This document + release packet cross-reference | Product/Governance | Stage 1-3 |

## 4. Required Release Packet Structure

For Phase D2 promotion, release packet must include at minimum:

Use `PHASE_D2_RELEASE_PACKET_TEMPLATE.md` as the authoritative packet format and checklist.

1. Profile parity matrix (`Individual` vs `Business`)
2. Governance-path report (`allow`, `deny`, `timeout`, `revoke`)
3. Terminal/container lifecycle test report
4. Plugin compatibility and trust-policy report
5. Execution mode qualification report (`fast`, `balanced`, `governed`)
6. Replay lineage and reason-code telemetry sample bundle
7. Investor/licensing claim alignment checklist
8. This traceability matrix with status column completed
9. Release packet manifest

## 5. Status Tracking Template

Use this table per candidate release:

| Requirement ID | Status (`pass`/`fail`/`waived`) | Evidence Link | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| D2-R1 |  |  |  |  |
| D2-R2 |  |  |  |  |
| D2-R3 |  |  |  |  |
| D2-R4 |  |  |  |  |
| D2-R5 |  |  |  |  |
| D2-R6 |  |  |  |  |
| D2-R7 |  |  |  |  |
| D2-R8 |  |  |  |  |
| D2-R9 |  |  |  |  |
| D2-R10 |  |  |  |  |
| D2-R11 |  |  |  |  |
| D2-R12 |  |  |  |  |

## 5.1 Claim Alignment Snapshot (2026-03-18)

This snapshot links investor/licensing-facing claims to validated implementation evidence now present in the repository.

| Claim ID | External Claim | Source Document | Implementation/Test Evidence | Artifact Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| CA-01 | "Capability parity without governance surrender" | `INVESTOR_APPENDIX_PARITY.md` §1-3 | `tests/profile-parity.test.ts` + policy engine profile routing | `prism-output/e1-individual-qualification.json`, `prism-output/e2-business-qualification.json`, `prism-output/e-stage2-qualification-summary.json` | pass |
| CA-02 | Business enforces approval-gated high-risk operations | `INVESTOR_APPENDIX_PARITY.md` §3.2 | `tests/d2-governance-paths.test.ts`, `tests/tool-contract-extractor.test.ts`, `tests/business-trust-validator.test.ts` | `prism-output/e3-policy-stress.json`, `prism-output/release-validation.json` | pass |
| CA-03 | Parity capability package includes terminal/container/tool staging depth | `LICENSING_BRAND_APPENDIX.md` §3 | `tests/terminal-session-adapter.test.ts`, `tests/container-sandbox-adapter.test.ts`, `tests/tool-contract-extractor.test.ts` | `prism-output/e-stage2-qualification-summary.json` | pass |
| CA-04 | Business trust metadata + signed distribution controls for adapters | `LICENSING_BRAND_APPENDIX.md` §5 | `src/core/plugins/business-trust-validator.ts`, `tests/business-trust-validator.test.ts` | `BUSINESS_TRUST_PROVENANCE_POLICY.md` | pass |
| CA-05 | No production release without evidence artifacts mapped to claims | `LICENSING_BRAND_APPENDIX.md` §4 | `.github/workflows/quality-gates.yml`, `src/benchmarks/ci-gate-check.ts` | `prism-output/ci-gate-summary.json`, `prism-output/release-validation.json` | pass |
| CA-06 | Event lineage and reason-code telemetry for high-risk operations | `INVESTOR_APPENDIX_PARITY.md` §5 (M2) | `tests/d2-governance-paths.test.ts`, `src/core/policy/reason-codes.ts`, event lineage tracker | `prism-output/event-lineage-bundle.json`, `prism-output/reason-code-telemetry-samples.json` | pass |

## 5.2 Candidate Status (2026-03-18)

| Requirement ID | Status (`pass`/`fail`/`waived`/`in_progress`) | Evidence Link | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| D2-R1 | pass | `tests/profile-parity.test.ts`, `PROFILE_CAPABILITY_PARITY_MATRIX.md` | Engineering | Parity tests and matrix in place. |
| D2-R2 | pass | `tests/terminal-session-adapter.test.ts` | Engineering | Lifecycle + revoke coverage passing. |
| D2-R3 | pass | `tests/container-sandbox-adapter.test.ts` | Engineering + QA | Snapshot/revert/lifecycle validated. |
| D2-R4 | pass | `tests/tool-contract-extractor.test.ts` | Engineering | Extraction + risk routing validated. |
| D2-R5 | pass | `src/core/plugins/plugin-pack-validator.ts`, `tests/plugin-pack-validator.test.ts` | Engineering + QA | Plugin compatibility validator delivered (25/25). |
| D2-R6 | pass | `src/core/plugins/business-trust-validator.ts`, `tests/business-trust-validator.test.ts` | Engineering + Governance | Trust/provenance validator delivered (8/8). |
| D2-R7 | pass | `tests/d2-governance-paths.test.ts` | QA/Validation | Allow/deny/timeout/revoke paths validated. |
| D2-R8 | pass | `src/benchmarks/performance-qualification.ts` | Engineering + QA | Perf qualification and gates passing. |
| D2-R9 | pass | `.github/workflows/quality-gates.yml`, `src/benchmarks/ci-gate-check.ts` | QA/Validation | CI gating enforced + artifact integrity check. |
| D2-R10 | pass | `prism-output/claim-alignment-checklist.md`, `INVESTOR_APPENDIX_PARITY.md`, `LICENSING_BRAND_APPENDIX.md` | Product/Governance | Claim alignment checklist complete — 27/27 claims verified. |
| D2-R11 | pass | `prism-output/reason-code-telemetry-samples.json`, `prism-output/event-lineage-bundle.json`, `src/core/policy/reason-codes.ts` | Engineering + Operations | Reason-code taxonomy implemented + lineage bundle generated. |
| D2-R12 | pass | `prism-output/release-packet-manifest.md`, this matrix | Product/Governance | Release packet manifest indexes 40 artifacts with full traceability. |

## 6. Governance Rule

No Phase D2 Go decision is valid if any high-risk requirement (`D2-R2`, `D2-R3`, `D2-R6`, `D2-R7`, `D2-R9`, `D2-R11`) is marked `fail` without explicit risk acceptance signed by Product/Governance and Operations.

## 7. Phase D3 Agent Control & Swarm Requirements

| Requirement ID | Source | Requirement | Verification Method | Evidence Artifact(s) | Owner | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| D3-R1 | `PRISM_PRD.md` §8.8 | Agent lifecycle management (spawn, stop, promote, demote, reap, persist, restore) | Lifecycle integration tests | Agent lifecycle test report | Engineering | Phase D3 |
| D3-R2 | `PRISM_PRD.md` §8.8 | Per-agent model assignment with dynamic switching | Model override dispatch tests + telemetry verification | Model assignment test report, telemetry samples | Engineering | Phase D3 |
| D3-R3 | `PRISM_PRD.md` §8.8 | Swarm orchestration (mesh, star, pipeline, broadcast topologies) | Swarm topology integration tests | Swarm orchestration test report (4 topologies) | Engineering | Phase D3 |
| D3-R4 | `PRISM_PRD.md` §8.8 | Chat-to-agent routing via classifier-first intent detection | Routing integration tests | Routing distribution report | Engineering | Phase D3 |
| D3-R5 | `PRISM_PRD.md` §8.8 | Intelligent telemetry with pattern detection and promotion recommendations | Telemetry analysis tests | Telemetry pattern samples, promotion recommendation evidence | Engineering | Phase D3 |
| D3-R6 | `DEVELOPER_GUIDE.md` §7A | Dashboard Agent Control tab wired with real data (no mock handlers) | UI integration tests + manual verification | Dashboard screenshot evidence, API response samples | Engineering + QA | Phase D3 |
| D3-R7 | `PHASE_EXECUTION_PLAN.md` D3 | Workspace persistence survives server reboot | Restart round-trip test | Persistence verification report | Engineering | Phase D3 |
| D3-R8 | `PRISM_PRD.md` §8.8 | Agent state restored on boot (permanent lifecycle agents) | Boot restore integration test | Restore verification report | Engineering | Phase D3 |

## 8. Character Accountability Control (CAC) Requirements

| Requirement ID | Source | Requirement | Verification Method | Evidence Artifact(s) | Owner | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| CAC-R1 | `PRISM_PRD.md` §8.4A | Accountability chain present on all governed activity events | Activity event inspection tests | Event samples with accountability chain fields | Engineering | Phase C |
| CAC-R2 | `PRISM_PRD.md` §8.4A | Lifecycle transitions emit auditable activity events (assign, dispatch, suspend, resume, revoke) | Lifecycle integration tests | Lifecycle test report, event samples per state | Engineering | Phase C |
| CAC-R3 | `PRISM_PRD.md` §8.4A | Business profile rejects domain-mismatched emails at assignment time | Domain validation unit tests | Test report showing rejection for mismatched domains | Engineering | Phase C |
| CAC-R4 | `PRISM_PRD.md` §8.4A | Individual profile accepts mixed-domain email assignments | Permissive validation unit tests | Test report showing acceptance for any valid emails | Engineering | Phase C |
| CAC-R5 | `PRISM_PRD.md` §8.4A | Enterprise/corporate inputs resolve to business segment | Alias normalization unit tests | Test report showing alias resolution | Engineering | Phase C |
| CAC-R6 | `PRISM_PRD.md` §8.4A | Query APIs support filtering by characterId, operatorEmail, prismUserEmail, executionProfileSegment | Query filter integration tests | Query result samples filtered by each field | Engineering | Phase C |
| CAC-R7 | `DEVELOPER_GUIDE.md` §7B | Accountability chain included in SHA-256 event hash | Hash integrity tests | Hash comparison evidence with/without accountability fields | Engineering | Phase C |

## 9. Phase D4 — Spectrum Refraction Advanced Requirements

| Requirement ID | Source | Requirement | Verification Method | Evidence Artifact(s) | Owner | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| D4-R1 | `PRISM_PRD.md` §8.9 | Multi-key slot assignment: per-provider API key slots (`default`, named) persist independently | `tests/spectrum-refraction-advanced.test.ts` — sets/gets key for default slot, named slot, independent isolation | SR advanced test report (20/20) | Engineering | Phase D4 |
| D4-R2 | `PRISM_PRD.md` §8.9 | Per-hemisphere independent timeouts with partial-result fallback | `tests/spectrum-refraction-advanced.test.ts` — returns partial result when left/right hemisphere times out | SR advanced test report (20/20) | Engineering | Phase D4 |
| D4-R3 | `PRISM_PRD.md` §8.9 | Circuit breaker opens after consecutive failure threshold; resets on success | `tests/spectrum-refraction-advanced.test.ts` — circuit opens after threshold, resets after success, returns open=false for closed | SR advanced test report (20/20) | Engineering | Phase D4 |
| D4-R4 | `PRISM_PRD.md` §8.9 | `circuitBreakerEnabled=false` bypasses tracking entirely | `tests/spectrum-refraction-advanced.test.ts` — respects circuitBreakerEnabled=false | SR advanced test report (20/20) | Engineering | Phase D4 |
| D4-R5 | `PRISM_PRD.md` §8.9 | Signed audit trail: SR emits `sr.fanout_start`, `sr.fanout_complete`, `sr.generation_complete`, `sr.circuit_breaker_triggered` activity events | `tests/spectrum-refraction-advanced.test.ts` — emits sr.fanout_start/sr.fanout_complete/sr.generation_complete/sr.circuit_breaker_triggered | SR advanced test report (20/20) | Engineering | Phase D4 |
| D4-R6 | `PRISM_PRD.md` §8.9 | Parallel fan-out: total elapsed time ≈ max of hemispheres, not their sum | `tests/spectrum-refraction-advanced.test.ts` — total time ≈ max of hemispheres | SR advanced test report (20/20) | Engineering | Phase D4 |
| D4-R7 | `PRISM_PRD.md` §8.9 | Cost estimation: `SRCostEstimate` shape, `totalEstimatedCostUsd ≥ sum of parts`, aggregation uses expanded input | `tests/spectrum-refraction-advanced.test.ts` — cost estimate shape, total ≥ sum, aggregation cost | SR advanced test report (20/20) | Engineering | Phase D4 |
| D4-R8 | `PRISM_PRD.md` §8.9 | `show-hemispheres` and SR configuration persist and are queryable per session | `tests/spectrum-refraction-advanced.test.ts` — listSlots, clearApiKey, default and named slot independence | SR advanced test report (20/20) | Engineering | Phase D4 |
| D4-R9 | `docs/D4_COVERAGE_VALIDATION.md` | D4c SQLite schema and D4c API endpoints included in integration evidence | `tests/spectrum-refraction-advanced.test.ts` 20/20 passing; `D4_COVERAGE_VALIDATION.md` | D4 coverage validation doc | Engineering + QA | Phase D4 |
| D4-R10 | `docs/TEST_STRATEGY.md` D4c section | 20/20 D4c test coverage verified in CI and release evidence | Node test runner output with 20 pass, 0 fail | `docs/D4_COVERAGE_VALIDATION.md`, `tests/spectrum-refraction-advanced.test.ts` | QA/Validation | Phase D4 |

### 9.1 Candidate Status (Phase D4 — 2026-04-20)

| Requirement ID | Status | Evidence Link | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| D4-R1 | pass | `tests/spectrum-refraction-advanced.test.ts` L201-L242 | Engineering | 5 slot tests pass |
| D4-R2 | pass | `tests/spectrum-refraction-advanced.test.ts` L30-L65 | Engineering | Partial result on timeout verified |
| D4-R3 | pass | `tests/spectrum-refraction-advanced.test.ts` L68-L100 | Engineering | Circuit opens + resets confirmed |
| D4-R4 | pass | `tests/spectrum-refraction-advanced.test.ts` L103-L115 | Engineering | circuitBreakerEnabled=false bypasses tracking |
| D4-R5 | pass | `tests/spectrum-refraction-advanced.test.ts` L118-L165 | Engineering | All 4 SR audit events emitted |
| D4-R6 | pass | `tests/spectrum-refraction-advanced.test.ts` L168-L182 | Engineering | Parallel timing verified |
| D4-R7 | pass | `tests/spectrum-refraction-advanced.test.ts` L185-L199 | Engineering | Cost shape + ≥ sum + aggregation expansion |
| D4-R8 | pass | `tests/spectrum-refraction-advanced.test.ts` L201-L242 | Engineering | Slot isolation and list confirmed |
| D4-R9 | pass | `docs/D4_COVERAGE_VALIDATION.md` | Engineering + QA | Coverage doc created |
| D4-R10 | pass | `node --test dist/tests/spectrum-refraction-advanced.test.js` → 20/20 | QA/Validation | Zero failures in CI run |

## 10. Computer-Use Business Security Alignment Gate Requirements

| Requirement ID | Source | Requirement | Verification Method | Evidence Artifact(s) | Owner | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| CU-BG-1 | `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md` §3 | Computer-use high-risk pathways preserve deterministic allow/deny/timeout/revoke behavior | Governance-path integration tests | Computer-use governance-path report | Engineering + QA | Phase D2 |
| CU-BG-2 | `PRISM_PRD.md` §15 | Business profile requires sandboxed/least-privilege computer-use posture in release evidence | Release evidence review + runbook checks | Runbook checklist + staging qualification notes | Operations + Governance | Stage 2/3 |
| CU-BG-3 | `TEST_STRATEGY.md` Business gate checklist | Sensitive-action confirmation required for consequential Business computer-use operations | Scenario tests with approval/confirmation checkpoints | Confirmation-path scenario logs | QA/Validation | Phase D2 |
| CU-BG-4 | `PRISM_GAP_ANALYSIS.md` §9 | External computer-use benchmark claims labeled `vendor-reported` unless reproduced | Documentation + artifact review | Claim alignment checklist | Product/Governance | Stage 3 |
| CU-BG-5 | `BUSINESS_TRUST_PROVENANCE_POLICY.md` + CAC requirements | CAC accountability chain remains explicit in governed computer-use narratives | Event sample inspection | Activity samples with identity chain fields | Engineering + Governance | Phase D2 |

### 10.1 Candidate Status Template (Computer-Use Gate)

| Requirement ID | Status (`pass`/`fail`/`waived`/`in_progress`) | Evidence Link | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| CU-BG-1 |  |  |  |  |
| CU-BG-2 |  |  |  |  |
| CU-BG-3 |  |  |  |  |
| CU-BG-4 |  |  |  |  |
| CU-BG-5 |  |  |  |  |
