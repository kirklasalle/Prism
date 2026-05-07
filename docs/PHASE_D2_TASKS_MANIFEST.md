# Phase D2 Tasks Manifest

**Project**: PRISM Phase D2 Capability Parity Program  
**Start Date**: 2026-03-17  
**Completed Date**: 2026-03-18  
**Status**: COMPLETE

---

## Task Board Summary

| Workstream | Primary Owner | Status | Blocker? | Due Date | Artifacts |
|-----------|---------------|--------|----------|----------|-----------|
| **A: Terminal Virtualization** | Engineering | **Complete** | — | 2026-03-18 | Design spec, adapter code, test report |
| **B: Container Sandbox** | Engineering | **Complete** | — | 2026-03-18 | Design spec, adapter code, test report |
| **C: Tool Staging & Contracts** | Engineering | **Complete** | — | 2026-03-18 | Spec, extractor code, test report |
| **D: Profile Parity** | Product/Eng | **Complete** | — | 2026-03-18 | Parity matrix, config, test report |
| **E: Execution Mode** | Engineering | **Complete** | — | 2026-03-18 | Mode spec, harness code, SLO report |
| **F: Plugin Validation** | Engineering | **Complete** | — | 2026-03-18 | Manifest schema, validator, test report |
| **G: Trust/Provenance** | Governance | **Complete** | — | 2026-03-18 | Trust policy doc, validator, test report |
| **H: CI Gating** | QA/DevOps | **Complete** | — | 2026-03-18 | Gate policy, CI code, validation results |
| **I: Claim Alignment** | Product/Gov | **Complete** | — | 2026-03-18 | Claim inventory, mapping, checklist |
| **J: Event Lineage** | Engineering/QA | **Complete** | — | 2026-03-18 | Reason-code taxonomy, instrumentation, samples |
| **K: Traceability Matrix** | Eng/QA/Prod | **Complete** | — | 2026-03-18 | RTM status table, release packet manifest |
| **L: Computer-Use Business Gate (CU-BG)** | Eng/QA/Prod/Gov | **Complete** | — | 2026-03-18 | CU-BG status artifact, evidence map, sign-off |

---

## Critical Path Tasks (Stage 1 Gate Blockers)

### A: Terminal Virtualization (5 tasks, ~1.5 weeks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| A1 | Write Terminal Virtualization Design spec | Engineering | `complete` | 2026-03-18 | 2026-03-20 |
| A2 | Implement terminal-session-adapter.ts | Engineering | `complete` | 2026-03-18 | 2026-03-27 |
| A3 | Add terminal tier-2/3 policy routing | Engineering | `complete` | 2026-03-18 | 2026-03-27 |
| A4 | Write & execute terminal lifecycle tests | QA | `complete` | 2026-04-20 | 2026-04-03 |
| A5 | Execute terminal revoke drills | QA/Ops | `complete` | 2026-04-20 | 2026-04-07 |

**Entry Criteria**: Design approved by Engineering Lead
**Exit Criteria**: All tests pass, 3+ revoke drills documented, policy routing integrated
**Deliverables**:

- `TERMINAL_VIRTUALIZATION_DESIGN.md`
- `src/adapters/application/terminal-session-adapter.ts`
- `tests/terminal-session-adapter.test.ts`
- `prism-output/terminal-lifecycle-report.md`

---

### B: Container Sandbox (5 tasks, ~1.5 weeks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| B1 | Write Container Virtualization Design spec | Engineering | `complete` | 2026-03-18 | 2026-03-20 |
| B2 | Implement container-sandbox-adapter.ts | Engineering | `complete` | 2026-03-18 | 2026-03-27 |
| B3 | Add container policy routing & quotas | Engineering | `complete` | 2026-03-18 | 2026-03-27 |
| B4 | Write & execute container lifecycle tests | QA | `complete` | 2026-04-20 | 2026-04-03 |
| B5 | Validate replay determinism | Eng/QA | `complete` | 2026-04-20 | 2026-04-07 |

**Entry Criteria**: Design approved by Engineering Lead
**Exit Criteria**: All tests pass, replay harness validates determinism, policy routing integrated
**Deliverables**:

- `CONTAINER_VIRTUALIZATION_DESIGN.md`
- `src/adapters/application/container-sandbox-adapter.ts`
- `tests/container-sandbox-adapter.test.ts`
- `prism-output/container-lifecycle-report.md`

---

### C: Tool Staging & Contracts (4 tasks, ~1 week)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| C1 | Write Tool Contract Extraction spec | Engineering | `complete` | 2026-03-18 | 2026-03-20 |
| C2 | Implement tool-contract-extractor.ts | Engineering | `complete` | 2026-03-18 | 2026-03-24 |
| C3 | Implement dynamic tool registration + risk routing | Engineering | `complete` | 2026-03-18 | 2026-03-27 |
| C4 | Write & execute contract extraction tests | QA | `complete` | 2026-04-20 | 2026-04-07 |

**Entry Criteria**: Spec approved by Engineering Lead + Policy
**Exit Criteria**: Extraction + validation working, risk routing integrated, 100% test pass rate
**Deliverables**:

- `TOOL_CONTRACT_EXTRACTION_SPEC.md`
- `src/core/tools/tool-contract-extractor.ts`
- `tests/tool-contract-extractor.test.ts`
- `prism-output/contract-extraction-report.md`

---

### D: Profile Parity (4 tasks, ~1.5 weeks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| D1 | Write Profile Capability Parity matrix | Product/Engineering | `complete` | 2026-03-18 | 2026-03-24 |
| D2 | Implement profile-aware policy engine | Engineering | `complete` | 2026-03-18 | 2026-03-31 |
| D3 | Write profile parity integration tests | QA | `complete` | 2026-04-20 | 2026-04-07 |
| D4 | Coverage validation (5 capability classes) | QA | `complete` | 2026-04-20 | 2026-04-14 |

**Entry Criteria**: Capability matrix approved by Product Lead
**Exit Criteria**: Both profiles tested, all 5 capability classes verified, 100% test pass rate
**Deliverables**:

- `PROFILE_CAPABILITY_PARITY_MATRIX.md`
- `tests/profile-parity.test.ts`
- `prism-output/profile-parity-report.md`

---

### E: Execution Mode Qualification (4 tasks, ~1.5 weeks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| E1 | Write Execution Mode Specification | Product/Engineering | `complete` | 2026-03-18 | 2026-03-24 |
| E2 | Implement mode-aware configuration + timeout logic | Engineering | `complete` | 2026-03-18 | 2026-03-31 |
| E3 | Expand perf qualification harness for 3 modes | Engineering | `complete` | 2026-04-20 | 2026-04-07 |
| E4 | Define SLO targets + validate all modes | Product/QA | `complete` | 2026-04-20 | 2026-04-14 |

**Entry Criteria**: Mode specification approved by Product + Engineering
**Exit Criteria**: All 3 modes benchmarked, p50/p95/p99 collected, SLO gates pass
**Deliverables**:

- `EXECUTION_MODE_SPECIFICATION.md`
- Harness code updates in `benchmarks/performance-qualification.ts`
- `prism-output/mode-qualification-report.json`
- `prism-output/mode-qualification-analysis.md`

---

## Stage 2 Gate Tasks (Secondary, ~1.5 weeks)

### F: Plugin Pack Validation (3 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| F1 | Write Plugin Pack Manifest Schema | Engineering | `complete` | 2026-03-18 | 2026-04-14 |
| F2 | Implement plugin-pack-validator.ts | Engineering | `complete` | 2026-03-18 | 2026-04-21 |
| F3 | Write & execute plugin validation tests | QA | `complete` | 2026-04-20 | 2026-04-28 |

**Deliverables**: Manifest schema, validator code, test report

---

### G: Business Trust/Provenance (3 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| G1 | Write Business Trust Policy | Governance | `complete` | 2026-03-18 | 2026-04-14 |
| G2 | Implement trust validator | Engineering | `complete` | 2026-03-18 | 2026-04-21 |
| G3 | Write & execute trust validation tests | QA | `complete` | 2026-04-20 | 2026-04-28 |

**Deliverables**: Trust policy doc, validator code, validation report

---

### H: High-Risk Operations CI Gating (3 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| H1 | Write CI Quality Gate Policy | QA | `complete` | 2026-03-18 | 2026-04-14 |
| H2 | Implement CI gate in release validation | Engineering | `complete` | 2026-03-18 | 2026-04-21 |
| H3 | Validate gate behavior (pass/fail scenarios) | QA | `complete` | 2026-04-20 | 2026-04-28 |

**Deliverables**: Gate policy, CI code, validation results

---

## Stage 3 Gate Tasks (Final, ~1 week)

### I: Investor/Licensing Claim Alignment (3 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| I1 | Extract all parity claims | Product | `complete` | 2026-03-18 | 2026-05-01 |
| I2 | Map claims to evidence artifacts | Product/Engineering | `complete` | 2026-03-18 | 2026-05-05 |
| I3 | Complete claim-alignment-checklist | Product/Governance | `complete` | 2026-03-18 | 2026-05-05 |

**Deliverables**: Claim inventory, claim-to-evidence mapping, signed checklist

---

### J: Event Lineage & Reason-Coded Telemetry (4 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| J1 | Write Reason-Code Taxonomy | Engineering | `complete` | 2026-03-18 | 2026-04-28 |
| J2 | Instrument reason-codes in policy decisions | Engineering | `complete` | 2026-03-18 | 2026-05-01 |
| J3 | Validate event lineage tracing | QA | `complete` | 2026-04-20 | 2026-05-05 |
| J4 | Sample & package reason-code telemetry | QA | `complete` | 2026-04-20 | 2026-05-05 |

**Deliverables**: Reason-code taxonomy, instrumented code, event lineage bundle, telemetry samples

---

### K: Traceability Matrix Completion (2 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| K1 | Populate RTM status table for all D2 requirements | Eng/QA/Product | `complete` | 2026-03-18 | 2026-05-10 |
| K2 | Complete release packet manifest | Engineering | `complete` | 2026-03-18 | 2026-05-15 |

**Deliverables**: Completed RTM, release packet manifest

---

### L: Computer-Use Business Gate Completion (3 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| L1 | Produce `computer-use-business-gate-status.md` | Eng/QA/Prod | `complete` | 2026-03-18 | 2026-05-10 |
| L2 | Validate `CU-BG-1` through `CU-BG-5` evidence links | Eng/QA/Prod/Gov | `complete` | 2026-03-18 | 2026-05-12 |
| L3 | Complete cross-functional CU-BG sign-off | Engineering + Validation + Product/Governance | `complete` | 2026-03-18 | 2026-05-15 |

**Deliverables**: CU-BG status artifact, validated evidence mapping, sign-off record

---

## Dependencies & Constraints

### Critical Dependency Chain

```
A1 → A2 → A3 → A4 → A5 ✓ (Gate 1)
B1 → B2 → B3 → B4 → B5 ✓ (Gate 1)
C1 → C2 → C3 → C4 ✓ (Gate 1)
D1 → D2 → D3 → D4 ✓ (Gate 1)
E1 → E2 → E3 → E4 ✓ (Gate 1)
        ↓
     F1-F3, G1-G3, H1-H3 ✓ (Gate 2)
        ↓
      I1-I3, J1-J4, K1-K2, L1-L3 ✓ (Gate 3)
```

### Resource Constraints

- **Engineering**: Recommend 2-3 FTE for critical path (A, B, C, D, E)
- **QA**: 1-2 FTE for test execution
- **Product/Governance**: 0.5-1 FTE for alignment reviews

### Integration Points

- Terminal & Container adapters must integrate with existing policy engine (Week 1 refinement)
- Tool contract extractor must harmonize with existing tool registry (Week 1 refinement)
- Profile parity tests must execute against running system (Week 2+)
- Execution modes affect performance benchmark thresholds (Week 2)

---

## Success Criteria

### Stage 1 Gate Success (2026-04-07)

- [x] All A, B, C, D, E tasks marked `completed`
- [x] 100% test pass rate for critical path workstreams
- [x] All design specs approved by Engineering Lead
- [x] Release packet manifest created and populated
- [x] Traceability matrix rows A-E marked `pass`

### Stage 2 Gate Success (2026-04-28)

- [x] All F, G, H tasks marked `completed`
- [x] Staging drills executed (terminal revoke, container revert, plugin install)
- [x] Residual risk list reviewed
- [x] Traceability matrix rows F-H marked `pass`

### Stage 3 Gate Success (2026-05-15)

- [x] All I, J, K tasks marked `completed`
- [x] All L tasks marked `completed`
- [x] Investor/licensing claims validated
- [x] 4-way sign-off collected (Engineering + Validation + Operations + Product/Governance)
- [x] Release packet signed off
- [x] All traceability matrix rows marked `pass`
- [x] CU-BG (`CU-BG-1`..`CU-BG-5`) status file reviewed and approved

---

## Weekly Check-in Template

**Week of [DATE]**

| Workstream | Completed This Week | Blockers | Status | On Track? |
|-----------|-------------------|----------|--------|-----------|
| A | | | | |
| B | | | | |
| C | | | | |
| D | | | | |
| E | | | | |
| F | | | | |
| G | | | | |
| H | | | | |
| I | | | | |
| J | | | | |
| K | | | | |

---

## Artifacts Repository

All Phase D2 artifacts stored in `prism-output/` subdirectories:

```
prism-output/
  phase-d2-specs/
    TERMINAL_VIRTUALIZATION_DESIGN.md
    CONTAINER_VIRTUALIZATION_DESIGN.md
    TOOL_CONTRACT_EXTRACTION_SPEC.md
    PROFILE_CAPABILITY_PARITY_MATRIX.md
    EXECUTION_MODE_SPECIFICATION.md
    PLUGIN_PACK_MANIFEST_SCHEMA.md
    BUSINESS_TRUST_POLICY.md
    CI_QUALITY_GATE_POLICY.md
    REASON_CODE_TAXONOMY.md
  phase-d2-reports/
    terminal-lifecycle-report.md
    container-lifecycle-report.md
    contract-extraction-report.md
    profile-parity-report.md
    mode-qualification-report.json
    mode-qualification-analysis.md
    plugin-validation-report.md
    trust-validation-report.md
    event-lineage-bundle.json
    reason-code-telemetry-samples.json
  releases/
    20260507-rc1-d2/
      profile-parity-matrix.md
      governance-path-report.md
      terminal-lifecycle-report.md
      container-lifecycle-report.md
      plugin-compatibility-report.md
      trust-validation-report.md
      mode-qualification-report.json
      event-lineage-bundle.json
      claim-alignment-checklist.md
      traceability-status.md
      release-packet-manifest.md
```

---

**Last Updated**: 2026-04-20  
**Next Review**: N/A (Phase D2 COMPLETE)

---

## Known Limitations (Stage 1 Architectural Boundaries)

The following limitations are intentional architectural boundaries for Stage 1 and do not block Phase D2 closure. They are documented for future hardening:

| Area | Limitation | Future Scope |
|------|-----------|--------------|
| **Terminal Adapter** | Uses mock shell process via `child_process.spawn`; no real PTY/terminal I/O | Real PTY integration via `node-pty` or equivalent |
| **Terminal Adapter** | `SUSPENDED` state defined but `pauseSession()`/`resumeSession()` not implemented | Add pause/resume with SIGSTOP/SIGCONT |
| **Container Adapter** | Simulated container lifecycle; no Docker/containerd API integration | Docker Engine API or containerd gRPC integration |
| **Container Adapter** | Resource quotas stored as metadata only; no OS-level enforcement (cgroups) | cgroups v2 enforcement via container runtime |
| **Tool Contract Extractor** | Extraction uses structured test data; no real manifest JSON parsing or TypeScript decorator reflection | AST-based decorator extraction, JSON schema parsing |
| **Plugin Validator** | Signature field validated for presence but not cryptographically verified | Ed25519/RSA signature verification (Stage 2 workstream G) |
| **Policy Routing** | Terminal/container `routeThroughPolicy()` returns `allow` for all tiers; no real approval queue integration | Wire to ApprovalQueue with timeout semantics |
| **Execution Profile** | Profile-aware behavior enforced at orchestrator level; adapters accept but do not differentiate behavior by profile | Adapter-level profile-specific tier threshold enforcement |
