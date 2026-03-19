# PRISM Production Release Runbook

Date: 2026-03-11

## Purpose

Provide a step-by-step path from staging-ready build to production deployment with safety and rollback guarantees.

## Release Stages

### Stage 1: Candidate Preparation

1. Confirm branch/build provenance
2. Run full build and full test suite
3. Verify documentation synchronization
4. Generate release notes and risk summary
5. Run automated release validation gate: `npm run release:validate:strict`
6. Create release packet directory using `PHASE_D2_RELEASE_PACKET_TEMPLATE.md`
7. Validate profile parity package completeness:

- profile parity matrix,
- governance-path evidence for shell/container/plugin operations,
- execution mode qualification report (`fast`, `balanced`, `governed`)

1. Verify `REQUIREMENTS_TRACEABILITY_MATRIX.md` status table is completed for all D2 requirement IDs
2. Verify `release-packet-manifest.md` is present and matches actual packet contents

Exit:

- Candidate artifact produced and signed off for staging
- `prism-output/release-validation.json` generated with gate outcomes and build metadata
- Phase D2 release packet generated under `prism-output/releases/<candidate-id>/`

### Stage 2: Staging Qualification

1. Deploy candidate to staging
2. Execute governance-critical test scenarios
3. Run latency and throughput checks against SLO targets
4. Validate retrieval diagnostics and alert behavior
5. Execute denial/timeout operational drills
6. Execute revoke drills for long-running terminal and container sessions
7. Validate plugin/adaptor pack compatibility and trust-policy behavior
8. Validate release packet completeness against `PHASE_D2_RELEASE_PACKET_TEMPLATE.md` Section 4

Exit:

- Staging report with pass/fail and residual risk list

### Stage 3: Production Go/No-Go

Required attendees:

- Engineering lead
- Validation lead
- Operations lead
- Product/governance owner

Decision input:

- Staging report
- Open risks and mitigations
- Rollback readiness
- Strict release gate report (`npm run release:validate:strict`)
- Phase D2 evidence package:
  - parity matrix validation,
  - governance-path report,
  - mode qualification report,
  - investor/licensing claim alignment check,
  - completed traceability matrix review,
  - release packet manifest review,
  - release packet validation checklist

Decision:

- Go or No-Go

### Stage 4: Controlled Production Rollout

1. Deploy using controlled window
2. Enable monitoring and alert channels
3. Observe high-priority health metrics for warmup period
4. Confirm no governance regression

Exit:

- Rollout promoted from monitoring to normal operations

### Stage 5: Post-Release Validation

1. Run smoke operations
2. Verify cohort diagnostics snapshots and trend signals
3. Confirm operator approval surfaces responsive
4. Capture deployment summary and lessons learned

## Rollback Procedure

Trigger conditions:

- Governance misclassification
- Approval gate failure
- Severe latency regression
- Data/persistence corruption indicators
- Profile parity regression (capability mismatch between Individual and Business)
- Plugin trust-policy bypass or compatibility validation failure in production

Steps:

1. Halt forward traffic to new build
2. Roll back to previous known-good artifact
3. Validate baseline health checks
4. Open incident record with timeline and event trace references

## Mandatory Production Metrics

- Workflow success rate
- Policy decision p95
- Retrieval p95 and p99 latency
- Event delivery p95
- Approval pathway p99
- SQLite write latency p95

## On-Call Escalation Priority

P0:

- Unsafe execution bypass
- Approval gate bypass or incorrect enforcement

P1:

- Persistent workflow failures above threshold
- Severe retrieval degradation affecting decision quality

P2:

- Non-critical observability/reporting failures

## Pre-Production Checklist

- Build and tests green
- Staging validation passed
- Rollback plan rehearsed
- Runbooks and docs current
- Release owner assigned
- Incident commander on-call aware
- Profile parity matrix validated and archived
- Governance-path evidence archived for shell/container/plugin operations
- Investor/licensing appendix claims checked against validated release artifacts
- `REQUIREMENTS_TRACEABILITY_MATRIX.md` checked and signed by Product/Governance
- `PHASE_D2_RELEASE_PACKET_TEMPLATE.md` checklist completed and archived with candidate packet
- `release-packet-manifest.md` validated against packet contents

## Postmortem Requirements

For any production-impacting issue:

- capture exact timeline
- include affected session traces
- classify root cause category
- document corrective and preventive actions
- update test suites and runbooks accordingly
