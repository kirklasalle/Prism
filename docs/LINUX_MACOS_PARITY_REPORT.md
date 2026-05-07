# Linux/macOS Parity Report (Phase F-H)

PRISM is developed primarily on Windows but ships with explicit
Linux/macOS support. This document tracks Windows-only code paths and
their classification, as produced by `scripts/platform-parity-audit.cjs`.

## Run the audit

```powershell
npm run audit:platform-parity
```

Reports land in `prism-output/parity/{run-id}.{md,json}`.

## Classification meaning

| Class | Meaning |
| --- | --- |
| `gated` | Wrapped in `process.platform === 'win32'` (intentional branch). |
| `cross-platform` | Has a non-Windows branch nearby (e.g. handles `darwin`/`linux`). |
| `needs-fix` | Windows-only with no cross-platform fallback — must be remediated. |

## Annotation

Lines that legitimately must reference a Windows construct without a
fallback (e.g. Windows-specific framebuffer capture in
`screengrab/` adapters that are skipped on non-Windows) may carry the
inline annotation `// @parity-allow` to suppress the finding.

## Closure plan

`needs-fix` findings drive PRs that introduce a cross-platform
abstraction. Strict mode in CI is opt-in:

```powershell
$env:PRISM_PARITY_STRICT="1"; npm run audit:platform-parity
```

Strict mode exits non-zero when any `needs-fix` finding remains.

## Baseline

Initial baseline is captured on first run. Track `counts.needs-fix`
trending toward zero release-over-release.
