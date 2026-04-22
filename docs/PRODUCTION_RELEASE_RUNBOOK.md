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
6. Validate Business Security Alignment Gate checklist for computer-use core
7. Create release packet directory using `PHASE_D2_RELEASE_PACKET_TEMPLATE.md`
8. Validate profile parity package completeness:

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
9. Validate computer-use Business gate scenarios and confirmation controls

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
  - Business Security Alignment Gate status review (`CU-BG-*`)

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
- Computer-use Business gate evidence archived (`CU-BG-*` checks)
- Investor/licensing appendix claims checked against validated release artifacts
- `REQUIREMENTS_TRACEABILITY_MATRIX.md` checked and signed by Product/Governance
- `PHASE_D2_RELEASE_PACKET_TEMPLATE.md` checklist completed and archived with candidate packet
- `release-packet-manifest.md` validated against packet contents

## Phase D3 / D4 Validation Drills

Run these drills before any Phase D3 or D4 release decision.

### D3 — Agent Control & Swarm

```bash
# Agent lifecycle round-trip
node --test dist/tests/agent-lifecycle.test.js

# Swarm topology (mesh / star / pipeline / broadcast)
node --test dist/tests/swarm-orchestration.test.js

# Chat-to-agent routing classifier
node --test dist/tests/chat-router.test.js

# Dashboard Agent Control tab real-data check
# Verify /api/agents returns non-mock data from a running session
curl -s http://localhost:3000/api/agents | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); JSON.parse(d); console.log('OK');"
```

### D4 — Spectrum Refraction Advanced

```bash
# Full D4c suite (20/20 required)
npm run build && node --test dist/tests/spectrum-refraction-advanced.test.js

# Verify SR catalog cache: two rapid getCatalog() calls should return same object reference
node -e "
const { LlmProviderManager } = require('./dist/src/core/operator/llm-provider-manager.js');
const m = new LlmProviderManager({});
Promise.all([m.getCatalog(), m.getCatalog()]).then(([a,b]) => {
  console.log('cache hit:', a === b ? 'PASS' : 'FAIL');
});
"

# Verify approval queue drains on graceful shutdown
node --test dist/tests/approval-queue-integration.test.js

# Verify demo scenario runner emits _demo: true on activity events
node --test dist/tests/demo-scenario-runner.test.js 2>/dev/null || echo "no demo-scenario tests; manual verify required"
```

### LLM Retry (F2)

```bash
# Verify exponential retry is exercised when provider returns error
node --test dist/tests/llm-provider-manager-cache.test.js
```

### Error requestId (F6)

```bash
# Verify any 4xx/5xx API error response contains requestId
curl -s -o /dev/null -D - http://localhost:3000/api/nonexistent | grep requestId
```

## Business Security Alignment Gate (Computer Use Core)

No enterprise-ready computer-use release decision is valid unless all are true:

1. Computer-use governance pathways pass (allow/deny/timeout/revoke).
2. CAC accountability requirements are present in governed computer-use audit samples.
3. Sensitive-action confirmation controls are validated for Business profile workflows.
4. External benchmark claims are clearly labeled `vendor-reported` unless reproduced in first-party qualification artifacts.

## Postmortem Requirements

For any production-impacting issue:

- capture exact timeline
- include affected session traces
- classify root cause category
- document corrective and preventive actions
- update test suites and runbooks accordingly
