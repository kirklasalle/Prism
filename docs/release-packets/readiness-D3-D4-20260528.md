% Release Readiness Packet: Phase D3 / D4

Date: 2026-05-28
Status: Draft

Summary
-------

This packet collects the evidence and checklist required to validate Phase D3 (Agent Control & Swarm) and Phase D4 (Spectrum Refraction) readiness per PRISM gating policy. Use this as the canonical artifact for go/no-go review and CI evidence bundling.

How to use
----------

- Follow the Gate Checklist below.
- Produce the listed artifacts and upload them to `prism-output/` before marking a gate as passed.
- Attach this file to the PR that promotes the release candidate; include generated artifacts via CI artifact upload.

Gate Checklist (high level)
--------------------------

1. Directive Integrity Gate (Gate 9)
   - Must pass: `npm run prebuild` -> `npm run ci:gate:check`
   - Artifacts: `prism-output/ci-gate-summary.json`, `src/core/security/directive-hash.generated.ts`

2. Phase D3 Capability Parity
   - Must pass: `npm test` and targeted D3 tests
   - Artifacts: `prism-output/profile-parity-report.md`, `prism-output/agent-lifecycle-report.json`

3. Phase D4 Coverage Gate (Spectrum Refraction)
   - Must pass: `node --test dist/tests/spectrum-refraction-advanced.test.js` (20 tests)
   - Artifacts: `prism-output/sr-coverage.json`, `docs/D4_COVERAGE_VALIDATION.md`

4. Performance and Staging
   - Must pass: `npm run perf:qualify` (staging)
   - Artifacts: `prism-output/perf-qualification.json`

5. Release Validation
   - Must pass: `npm run release:validate:strict`
   - Artifacts: `prism-output/release-validation.json`

Required Artifact Manifest (minimum)
-----------------------------------

- `prism-output/ci-gate-summary.json`
- `prism-output/release-validation.json`
- `prism-output/perf-qualification.json`
- `prism-output/sr-coverage.json` (for D4)
- `prism-output/agent-lifecycle-report.json` (for D3)
- `prism-output/profile-parity-report.md`
- `src/core/security/directive-hash.generated.ts`

Commands to reproduce locally
----------------------------

Run prebuild (computes PAD hash and generates source):

```bash
npm run prebuild
```

Run CI gate checks (build + CI gate):

```bash
npm run ci:gate:check
```

Run core tests + D3/D4 suites:

```bash
npm test
npm run perf:qualify
node --test dist/tests/spectrum-refraction-advanced.test.js
```

Go/No-Go signoff template
-------------------------

- Engineering lead: __________
- QA lead: __________
- Product/Governance: __________
- Ops/SRE: __________
- Date: YYYY-MM-DD
- Gate status: PASS / FAIL
- Remarks: (include artifact links and failure summaries)

Notes
-----

This packet is derived from `docs/PHASE_D2_RELEASE_PACKET_TEMPLATE.md` and extended for D3/D4 scope. For CI automation, ensure `.github/workflows/quality-gates.yml` is present and runs `npm run prebuild` and `npm run ci:gate:check` as part of the release-validate flow.
