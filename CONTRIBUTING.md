# Contributing to PRISM

Thank you for your interest in contributing to PRISM! This document provides
guidelines and information for contributors.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and
inclusive environment for everyone. We expect all contributors to:

- Be respectful and considerate in all interactions
- Welcome newcomers and help them get started
- Focus on constructive feedback
- Accept responsibility for mistakes and learn from them

## How to Contribute

### Reporting Bugs

1. **Check existing issues** to avoid duplicates.
2. **Use the bug report template** when creating a new issue.
3. Include:
   - PRISM version (`npm run doctor` output is ideal)
   - Operating system and Node.js version
   - Steps to reproduce
   - Expected vs. actual behavior
   - Relevant log output (from the Logs & Debug tab or `prism-output/logs/`)

### Suggesting Features

Open a feature request issue with:

- A clear description of the proposed feature
- The problem it solves or the use case it enables
- Any relevant context or alternatives considered

### Submitting Pull Requests

1. **Fork the repository** and create a feature branch from `main`.
2. **Install dependencies**: `npm ci`
3. **Build**: `npm run build`
4. **Run tests**: `npm test`
5. **Ensure your changes compile cleanly** — the TypeScript build must produce
   zero errors.
6. **Follow the existing code style** — the project uses Prettier and ESLint.
   Run `npm run format:fix && npm run lint:fix` before committing.
7. **Write tests** for new functionality. PRISM uses Node's built-in test
   runner and Mocha for integration tests.
8. **Update documentation** if your change affects user-facing behavior.
9. **Submit a pull request** against `main` with a clear description of
   your changes.

### Development Workflow

```bash
# Install dependencies
npm ci

# Build (includes PAD hash prebuild)
npm run build

# Run full test suite
npm test

# Run specific test categories
npm run test:tui          # TUI component tests
npm run test:e2e          # End-to-end Playwright tests

# Lint and format
npm run lint
npm run format

# Release validation (what CI runs)
npm run release:validate
```

### Commit Messages

Use clear, descriptive commit messages. We follow a conventional format:

```
type(scope): short description

Longer description if needed.
```

Types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`, `security`

Examples:

- `feat(browser): add tab screenshot capture`
- `fix(policy): correct tier2 approval timeout handling`
- `docs(readme): update quick-start instructions`
- `security(auth): upgrade password hashing to argon2`

### CI Gates

All pull requests must pass the CI pipeline before merge:

1. **Build** — TypeScript compilation with zero errors
2. **PAD integrity** — Permanent Active Directives hash must match
3. **Plugin signing** — Ed25519 keypair validation
4. **Directive integrity tests** — 24-case governance suite
5. **Security tests** — CORS, CSRF, and rate-limiter validation
6. **Governance tests** — Policy engine, trust validator, release validation

See `.github/workflows/ci.yml` for the full gate list.

## Architecture Overview

Before contributing, familiarize yourself with the project structure:

- `src/core/` — Core runtime (policy, activity bus, memory, agents, operator)
- `src/adapters/` — Tool adapters (system, protocol, application, network)
- `src/tui/` — Terminal UI (Ink/React)
- `src/ptac/` — Testing & Active Control framework
- `tests/` — Test suites (unit, integration, E2E)
- `docs/` — Documentation

Key docs for contributors:

- [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) — Development workflows
- [`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md) — Testing philosophy
- [`docs/CI_GATING_POLICY.md`](docs/CI_GATING_POLICY.md) — CI gate details

## Permanent Active Directives (PAD)

PRISM's 10 Laws are cryptographically enforced. If you modify
`Permanent_Active_Directives.txt`, the prebuild step will regenerate the
hash constant. The CI pipeline verifies this hash on every build. Do not
modify the PAD without understanding the governance implications — see
[`docs/PAD_WHITEPAPER.md`](docs/PAD_WHITEPAPER.md).

## Security

If you discover a security vulnerability, **do not** open a public issue.
Follow the responsible disclosure process in [`SECURITY.md`](SECURITY.md).

## License

By contributing to PRISM, you agree that your contributions will be licensed
under the [Apache License 2.0](LICENSE).

## Questions?

- Open a discussion issue for general questions
- Check [`docs/PRISM_FAQ.md`](docs/PRISM_FAQ.md) for common questions
- Review [`docs/PRISM_GLOSSARY.md`](docs/PRISM_GLOSSARY.md) for terminology
