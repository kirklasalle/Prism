# PRISM CI Gating Policy

Date: 2026-03-18  
Status: ACTIVE

## Purpose

This policy defines mandatory CI checks that must pass before merge/release promotion. The objective is deterministic evidence for quality, performance, governance, and trust.

## Required CI Gates

1. **Core Test Gate**
   - Command: `npm test`
   - Must pass all unit/integration suites.

2. **Performance Qualification Gate**
   - Command: `npm run perf:qualify` (staging profile in CI)
   - Artifact: `prism-output/perf-qualification.json`
   - Must report `passed: true`.

3. **Tool Contract Snapshot Gate**
   - Command: `npm run contracts:snapshot`
   - Artifact: `prism-output/tool-contract-snapshot.json`

4. **Stage 2 Qualification Gate**
   - Command: `npm run e:qualify:stage2`
   - Artifact: `prism-output/e-stage2-qualification-summary.json`
   - Must report `passed: true`.

5. **Business Trust Qualification Gate**
   - Command: `npm run g:trust:qualify`
   - Must pass trust/provenance validator tests.

6. **Release Validation Gate**
   - Command: `npm run release:validate:strict`
   - Artifact: `prism-output/release-validation.json`
   - Must report `passed: true`.

7. **Artifact Integrity Gate**
   - Command: `npm run ci:gate:check`
   - Artifact: `prism-output/ci-gate-summary.json`
   - Confirms all required artifacts exist and required pass flags are true.

8. **Computer-Use Business Alignment Gate**
   - Command: `npm run cu:bg:check` (automatically run by strict release validation)
   - Artifacts:
     - workspace: `artifacts/ci-gates/computer-use-business-gate-validation.json`
     - CI copy: `prism-output/computer-use-business-gate-validation.json`
   - Requirement IDs: `CU-BG-1` through `CU-BG-5`
   - Required for release-bound branches when computer-use surfaces are impacted
   - Must verify that release evidence includes Business gate status and artifact linkage

9. **Directive Integrity Gate**
   - Verification: SHA-256 of `Permanent_Active_Directives.txt` must match `DIRECTIVE_SHA256` constant in `src/core/security/directive-integrity.ts`
   - Enforces Law 10: core directives cannot be modified without cryptographically secured approval
   - Any mismatch indicates unauthorized directive modification and blocks merge/release
   - If the PAD was intentionally amended (per Governance Council approval), the `DIRECTIVE_SHA256` constant must be updated in the same commit

## CI Failure Semantics

- Any required gate failure blocks merge/release progression.
- Artifact upload still runs with `if: always()` to preserve diagnostics.

## Security Scan Gate

1. **Dependency Vulnerability Gate**
    - Run `npm audit --production` on every PR and release branch.
    - Any `critical` or `high` severity vulnerability blocks merge.
    - `moderate` vulnerabilities generate warnings but do not block (unless in security-critical paths).

2. **Secret-in-Code Detection Gate**
    - Scan for hardcoded API keys, tokens, and credentials in source files.
    - Pattern: high-entropy strings in assignment contexts, common key prefixes (`sk-`, `pk_`, `AKIA`).
    - Any detection blocks merge with a clear remediation message.

3. **API Security Regression Gate**
    - Verify all protected endpoints return `401` without a valid token.
    - Verify session-guarded endpoints return `400` without an active session.
    - Verify rate limiter returns `429` when threshold is exceeded.
    - Verify directive integrity check passes with the committed PAD hash.
    - These checks run as part of the integration test suite and must pass for merge.

- Gate summary is authoritative for pass/fail traceability in CI.

## Uploaded CI Evidence

- `perf-qualification.json`
- `tool-contract-snapshot.json`
- `e-stage2-qualification-summary.json`
- `release-validation.json`
- `ci-gate-summary.json`
- `computer-use-business-gate-validation.json`

## Governance Notes

- Business profile trust/provenance checks are mandatory in CI for release-bound changes.
- Stage 2 aggregate qualification is required to ensure E1-E4 continuity and deterministic profile behavior.
- Computer-use enterprise claims are blocked in CI unless Business gate evidence is present and marked pass.
- Directive integrity (Gate 9) is non-negotiable: the PAD hash must match at all times. This is the cryptographic guarantee that Prism's governance has not been tampered with.

## Suggested GitHub Actions job (example)

Add the following job to your CI workflows to enforce Gate 9 and the CI gate checks. This example mirrors `.github/workflows/quality-gates.yml` in this repository.

```yaml
name: Quality Gates

on:
   pull_request:
      branches: [ main ]
   push:
      branches: [ main ]

jobs:
   quality-gates:
      name: Run quality gates
      runs-on: ubuntu-latest
      steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
            with:
               node-version: '20'
         - run: npm ci
         - run: npm run prebuild
         - run: npm run ci:gate:check
         - uses: actions/upload-artifact@v4
            with:
               name: ci-gate-summary
               path: prism-output/ci-gate-summary.json
```

Place this job in your PR and release workflows and ensure branch protection requires the job to be green before merging.
