# Security Policy

PRISM ("Project Refraction Intelligent System Manager") is a self-hosted,
governance-native runtime for autonomous agents. Security is treated as a
first-class capability rather than a bolted-on layer — see
[`docs/OWASP_TOP_10_CHECKLIST.md`](docs/OWASP_TOP_10_CHECKLIST.md),
[`docs/SECURITY_KEY_MANAGEMENT.md`](docs/SECURITY_KEY_MANAGEMENT.md), and
[`docs/SOC2_READINESS_CHECKLIST.md`](docs/SOC2_READINESS_CHECKLIST.md) for
the standing controls.

## Supported versions

The project is in active development on the `main` branch. Security fixes
are landed there first and backported to the most recent tagged release on
request. Pre-release branches (`feat/*`) are not officially supported.

| Version line | Status                              |
| ------------ | ----------------------------------- |
| `0.x` (main) | ✅ Receiving security fixes          |
| `< 0.x`      | ❌ End of life — please upgrade      |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a suspected vulnerability.
Instead, report it privately so it can be triaged before disclosure:

1. Open a [GitHub private security advisory](https://github.com/kirklasalle/Prism/security/advisories/new)
   (preferred — gives us a private discussion thread and a CVE pathway), or
2. Email the maintainer at the address listed in the repository profile and
   include the word **"PRISM-SEC"** in the subject line.

Please include, when possible:

- A clear description of the issue and its impact.
- Repro steps (a minimal proof-of-concept is ideal).
- The PRISM version / commit SHA you reproduced against.
- Your environment (OS, Node version, deployment topology).
- Whether the issue is already public or known to other parties.

We aim to acknowledge a report within **3 business days** and to ship a
fix or mitigation within **30 days** for high-severity issues. Coordinated
disclosure on a mutually agreed timeline is welcome.

## Scope

In scope:

- The PRISM runtime, dashboard, TUI, CLI, plugin SDK, and Python client.
- Default container image and recommended deployment topology.
- Bundled docs that recommend security-relevant configuration.

Out of scope:

- Vulnerabilities in third-party LLM providers reached via configured
  adapters — please report those upstream.
- Issues that require already-compromised operator credentials, physical
  device access, or the ability to load arbitrary code on the host.
- Denial-of-service via resource exhaustion when running with documented
  limits disabled.
- Findings in archived branches or example code under `examples/` that is
  explicitly marked as illustrative.

## Hall of fame

Researchers who report valid vulnerabilities and follow coordinated
disclosure are credited (with permission) in the relevant CHANGELOG entry
and on the project security advisory page.

## Built-in security baselines

A non-exhaustive list of controls already enforced by the runtime, useful
context when scoping a report:

- Bearer-token auth gate on every dashboard route (`AuthGate`).
- Origin/Referer CSRF guard + CORS allowlist (`cors-csrf.ts`).
- Per-route rate limiter with retry-after surfacing.
- Request body size cap (`PRISM_MAX_BODY_SIZE`, default 10 MiB).
- TLS support via `PRISM_TLS_CERT` / `PRISM_TLS_KEY`.
- PAD directive integrity hash verified at boot — runtime refuses to start
  on a hash mismatch in production.
- Plugin code-signing with rotating Ed25519 keys and a revocation registry.
- Activity bus emits an audit event for every governance / policy / auth /
  run decision; events are sha256-hashed for tamper detection.
- Production guard: `NODE_ENV=production` requires a 32+ char
  `PRISM_JWT_SECRET` and refuses to boot with `PRISM_AUTH_DISABLED=true`.

Please reference the affected control by name in your report when
applicable — it speeds up triage considerably.
