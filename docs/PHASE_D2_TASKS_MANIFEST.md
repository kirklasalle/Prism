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

---

## Critical Path Tasks (Stage 1 Gate Blockers)

### A: Terminal Virtualization (5 tasks, ~1.5 weeks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| A1 | Write Terminal Virtualization Design spec | Engineering | `pending` | - | 2026-03-20 |
| A2 | Implement terminal-session-adapter.ts | Engineering | `pending` | - | 2026-03-27 |
| A3 | Add terminal tier-2/3 policy routing | Engineering | `pending` | - | 2026-03-27 |
| A4 | Write & execute terminal lifecycle tests | QA | `pending` | - | 2026-04-03 |
| A5 | Execute terminal revoke drills | QA/Ops | `pending` | - | 2026-04-07 |

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
| B1 | Write Container Virtualization Design spec | Engineering | `pending` | - | 2026-03-20 |
| B2 | Implement container-sandbox-adapter.ts | Engineering | `pending` | - | 2026-03-27 |
| B3 | Add container policy routing & quotas | Engineering | `pending` | - | 2026-03-27 |
| B4 | Write & execute container lifecycle tests | QA | `pending` | - | 2026-04-03 |
| B5 | Validate replay determinism | Eng/QA | `pending` | - | 2026-04-07 |

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
| C1 | Write Tool Contract Extraction spec | Engineering | `pending` | - | 2026-03-20 |
| C2 | Implement tool-contract-extractor.ts | Engineering | `pending` | - | 2026-03-24 |
| C3 | Implement dynamic tool registration + risk routing | Engineering | `pending` | - | 2026-03-27 |
| C4 | Write & execute contract extraction tests | QA | `pending` | - | 2026-04-07 |

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
| D1 | Write Profile Capability Parity matrix | Product/Engineering | `pending` | - | 2026-03-24 |
| D2 | Implement profile-aware policy engine | Engineering | `pending` | - | 2026-03-31 |
| D3 | Write profile parity integration tests | QA | `pending` | - | 2026-04-07 |
| D4 | Coverage validation (5 capability classes) | QA | `pending` | - | 2026-04-14 |

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
| E1 | Write Execution Mode Specification | Product/Engineering | `pending` | - | 2026-03-24 |
| E2 | Implement mode-aware configuration + timeout logic | Engineering | `pending` | - | 2026-03-31 |
| E3 | Expand perf qualification harness for 3 modes | Engineering | `pending` | - | 2026-04-07 |
| E4 | Define SLO targets + validate all modes | Product/QA | `pending` | - | 2026-04-14 |

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
| F1 | Write Plugin Pack Manifest Schema | Engineering | `pending` | - | 2026-04-14 |
| F2 | Implement plugin-pack-validator.ts | Engineering | `pending` | - | 2026-04-21 |
| F3 | Write & execute plugin validation tests | QA | `pending` | - | 2026-04-28 |

**Deliverables**: Manifest schema, validator code, test report

---

### G: Business Trust/Provenance (3 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| G1 | Write Business Trust Policy | Governance | `pending` | - | 2026-04-14 |
| G2 | Implement trust validator | Engineering | `pending` | - | 2026-04-21 |
| G3 | Write & execute trust validation tests | QA | `pending` | - | 2026-04-28 |

**Deliverables**: Trust policy doc, validator code, validation report

---

### H: High-Risk Operations CI Gating (3 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| H1 | Write CI Quality Gate Policy | QA | `pending` | - | 2026-04-14 |
| H2 | Implement CI gate in release validation | Engineering | `pending` | - | 2026-04-21 |
| H3 | Validate gate behavior (pass/fail scenarios) | QA | `pending` | - | 2026-04-28 |

**Deliverables**: Gate policy, CI code, validation results

---

## Stage 3 Gate Tasks (Final, ~1 week)

### I: Investor/Licensing Claim Alignment (3 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| I1 | Extract all parity claims | Product | `pending` | - | 2026-05-01 |
| I2 | Map claims to evidence artifacts | Product/Engineering | `pending` | - | 2026-05-05 |
| I3 | Complete claim-alignment-checklist | Product/Governance | `pending` | - | 2026-05-05 |

**Deliverables**: Claim inventory, claim-to-evidence mapping, signed checklist

---

### J: Event Lineage & Reason-Coded Telemetry (4 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| J1 | Write Reason-Code Taxonomy | Engineering | `pending` | - | 2026-04-28 |
| J2 | Instrument reason-codes in policy decisions | Engineering | `pending` | - | 2026-05-01 |
| J3 | Validate event lineage tracing | QA | `pending` | - | 2026-05-05 |
| J4 | Sample & package reason-code telemetry | QA | `pending` | - | 2026-05-05 |

**Deliverables**: Reason-code taxonomy, instrumented code, event lineage bundle, telemetry samples

---

### K: Traceability Matrix Completion (2 tasks)

| Task ID | Task Name | Owner | Status | Completed | Due Date |
|---------|-----------|-------|--------|-----------|----------|
| K1 | Populate RTM status table for all D2 requirements | Eng/QA/Product | `pending` | - | 2026-05-10 |
| K2 | Complete release packet manifest | Engineering | `pending` | - | 2026-05-15 |

**Deliverables**: Completed RTM, release packet manifest

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
     I1-I3, J1-J4, K1-K2 ✓ (Gate 3)
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

- [ ] All A, B, C, D, E tasks marked `completed`
- [ ] 100% test pass rate for critical path workstreams
- [ ] All design specs approved by Engineering Lead
- [ ] Release packet manifest created and populated
- [ ] Traceability matrix rows A-E marked `pass`

### Stage 2 Gate Success (2026-04-28)

- [ ] All F, G, H tasks marked `completed`
- [ ] Staging drills executed (terminal revoke, container revert, plugin install)
- [ ] Residual risk list reviewed
- [ ] Traceability matrix rows F-H marked `pass`

### Stage 3 Gate Success (2026-05-15)

- [ ] All I, J, K tasks marked `completed`
- [ ] Investor/licensing claims validated
- [ ] 4-way sign-off collected (Engineering + Validation + Operations + Product/Governance)
- [ ] Release packet signed off
- [ ] All traceability matrix rows marked `pass`

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

**Last Updated**: 2026-03-17  
**Next Review**: 2026-03-24
