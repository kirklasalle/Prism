# Spectrum Refraction Showcase

A reproducible demo of PRISM's **Spectrum Refraction (SR)** generation: parallel multi-hemisphere LLM generation with consensus aggregation, hemisphere specialization profiles, and full audit trail.

## Run

```powershell
npm run demo:sr-showcase -- --dry-run
```

Or with a real provider configured:

```powershell
npm run demo:sr-showcase
```

## What it shows

1. **Multi-hemisphere fan-out**: 4 hemispheres run in parallel (`logic`, `creative`, `legal-analysis`, `code-review`) on the same prompt
2. **Cost gate**: refuses to spend more than $0.10 per generation by default
3. **Hemisphere transparency**: `showHemispheres: true` exposes each hemisphere's individual output alongside the consensus
4. **Audit trail**: every generation emits a signed `sr.generation` ActivityBus event with timing + cost + hemisphere config

## Dry-run output

`--dry-run` synthesizes hemisphere outputs locally (no LLM call, no cost) so the demo runs in CI and on machines without provider credentials. The dry-run validates:

- The multi-hemisphere fan-out shape
- The aggregation template
- The audit-event payload schema

## Live-run requirements

Set one of:

```powershell
$env:PRISM_OPENAI_API_KEY = "..."        # OpenAI
$env:PRISM_ANTHROPIC_API_KEY = "..."     # Anthropic
# or use a local Ollama running at http://localhost:11434
```

Then re-run without `--dry-run`.

## See also

- [`src/core/operator/model-capability-matrix.ts`](../../src/core/operator/model-capability-matrix.ts) — `HemisphereSpec` + `normalizeSRConfig`
- [`src/core/operator/sr-hemisphere-profiles.ts`](../../src/core/operator/sr-hemisphere-profiles.ts) — 8 specialization profiles
- [`docs/PAD_WHITEPAPER.md`](../../docs/PAD_WHITEPAPER.md) — Spectrum Refraction theory and design
