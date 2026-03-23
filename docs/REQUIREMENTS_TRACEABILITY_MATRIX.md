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
| CA-06 | Event lineage and reason-code telemetry for high-risk operations | `INVESTOR_APPENDIX_PARITY.md` §5 (M2) | Policy and adapter governance events exist; dedicated D2 reason-code taxonomy task pending | N/A (taxonomy artifact pending) | in_progress |

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
| D2-R10 | in_progress | `INVESTOR_APPENDIX_PARITY.md`, `LICENSING_BRAND_APPENDIX.md`, this section | Product/Governance | Claim alignment snapshot added; sign-off pending. |
| D2-R11 | in_progress | Adapter governance events + policy reasons | Engineering + Operations | Dedicated reason-code taxonomy + lineage bundle pending (`J`). |
| D2-R12 | in_progress | This matrix + release packet template | Product/Governance | Final release packet traceability completion pending (`K`). |

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
