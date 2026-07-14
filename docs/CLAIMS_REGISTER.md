# PRISM Claims Register

Last updated: 2026-07-14
Authoritative source seed: docs/PRISM_CRITICAL_AUDIT_2026.md Appendix A

## Purpose

This register maps major README and charter claims to current implementation evidence and verification status.
It is intended to be updated as remediation work lands so claim language stays aligned with runtime reality.

## Status Legend

- `true`: claim is implemented and evidenced.
- `partly_true`: claim has real implementation but still has a material gap.
- `false`: claim is currently inaccurate relative to code behavior.
- `relabel_required`: claim text should be narrowed for accuracy even if implementation is strong.

## Claims

| Claim | Status | Evidence | Next action |
| :-- | :-- | :-- | :-- |
| Cryptographically enforced 10 Laws (SHA-256, CI-gated) | partly_true | Runtime boot gate verifies both hash and Ed25519 signature via src/core/security/directive-integrity.ts, src/core/security/directive-signature.ts, and src/index.ts. CI artifact gate enforces the same in scripts/directive-integrity-gate.cjs and src/benchmarks/ci-gate-check.ts. | Add governance custody controls and map each law to hard enforcement where currently prompt-level. |
| Verified at boot | true | Boot gate calls in src/index.ts invoke enforceDirectiveIntegrityBootGate() and enforceDirectiveSignatureBootGate() before runtime initialization. | Keep regression tests green in tests/directive-integrity.test.ts and tests/directive-signature.test.ts. |
| Guardian re-checks integrity every 10 min | true | Guardian task catalog and integrity task execution in src/core/agents/guardian-agent.ts. | Keep periodic task validation in guardian tests. |
| Self-heals crashed model slots | partly_true | Guardian has recovery paths, but generic self-heal remains fallback/stub in some code paths. | Complete non-fallback self-heal flows and add deterministic tests. |
| Tri-model parallel fan-out with structured aggregation | true | Parallel Promise.all fan-out and aggregation in src/core/operator/llm-provider-manager.ts. | Maintain runtime tests for fan-out and aggregation failures. |
| Mandatory Left!=Right isolation at config/activation/runtime | true | Triad validation in src/core/operator/model-capability-matrix.ts and API guards. | Keep isolation checks in SR API and runtime tests. |
| N-model fan-out (up to 8 hemispheres) | false | Runtime still uses legacy left/right/main fields only in src/core/operator/llm-provider-manager.ts. | Implement hemispheres[] execution path or relabel feature as experimental. |
| No competing framework offers native multi-model fan-out | relabel_required | Architectural value is real, but novelty claim is broader than evidence standard. | Relabel to emphasize governance-enforced orchestration and isolation guarantees. |
| 3-tier policy engine with approval queues, timeouts, denial paths | true | Enforcement at orchestrator gate in src/core/runtime/orchestrator.ts and approval queue implementation. | Maintain policy-path regression tests for mutating operations. |
| API keys never in SQLite, never returned; DPAPI/OS keychain | partly_true | Windows path is protected; non-Windows still needs encrypted-at-rest implementation parity. | Implement macOS/Linux secure stores and update docs when complete. |
| Token-based auth on all endpoints | false | Remaining public/bootstrap route model still needs full hardening audit despite E1 progress. | Complete public route closure audit and add endpoint-level auth contract tests. |
| Production guard: PRISM_AUTH_DISABLED throws in prod | true | Environment validation and startup checks enforce production guard. | Keep startup guard tests in CI. |
| 195 discovered suites passing | true | Canonical test execution now uses auto-discovery in package.json (`test` -> `test:discover`), `ci:gate:check` exercises the discovered suite path, `prism-output/test-discovery-report.json` records 195 discovered suites green, and README test-count text now syncs from the discovery runner. The TUI smoke test in [tests/tui-e2e.test.ts](../tests/tui-e2e.test.ts) now exits cleanly under direct execution. | Broaden the same CI reconciliation pattern to feature-status tables and coverage-floor reporting. |
| Optional deps degrade gracefully, no crash | true | Optional dependency probing and graceful adapter fallback in src/core/system/optional-deps.ts. | Keep optional-dep smoke tests in release gate. |

## Operating rule

A claim should move from `partly_true` or `false` to `true` only when both conditions are met:

1. The implementation exists on the runtime path.
2. A repeatable automated test or CI gate verifies it.

## Operator note

The TUI smoke test is now a clean-exit process test under direct execution; the coverage gate remains deterministic and the discovered-suite count stays synchronized with README.
