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

## CI Failure Semantics

- Any required gate failure blocks merge/release progression.
- Artifact upload still runs with `if: always()` to preserve diagnostics.
- Gate summary is authoritative for pass/fail traceability in CI.

## Uploaded CI Evidence

- `perf-qualification.json`
- `tool-contract-snapshot.json`
- `e-stage2-qualification-summary.json`
- `release-validation.json`
- `ci-gate-summary.json`

## Governance Notes

- Business profile trust/provenance checks are mandatory in CI for release-bound changes.
- Stage 2 aggregate qualification is required to ensure E1-E4 continuity and deterministic profile behavior.
