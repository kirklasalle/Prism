# OWASP Top 10 Checklist (Phase F-G)

PRISM tracks OWASP Top 10 (2021) coverage as a living evidence ledger. The
heuristic scan in `scripts/owasp-scan.cjs` produces machine-checkable signal;
this document captures the human review and current evidence per category.

Run the scan:

```powershell
npm run security:owasp
```

Reports land in `prism-output/owasp/{run-id}.{md,json}`.

| Category | Status | Evidence |
| --- | --- | --- |
| **A01 — Broken Access Control** | partial | Token-based auth gate + per-route middleware (`dashboard-service.ts`); CAC-bound mutating routes; risk-tier overrides. |
| **A02 — Cryptographic Failures** | covered | Ed25519 plugin signing + Phase F-F release artifact signing; SHA-256 digests; no MD5/SHA-1 in security paths. |
| **A03 — Injection** | covered (annotated) | Stores use prepared statements with named/positional params. Known-safe template-literal SQL builders (e.g. `chat-session-store.ts`) carry `// @owasp-allow A03` annotations referencing allowlisted table names. |
| **A04 — Insecure Design** | partial | PolicyEngine + ApprovalQueue tier-3 gating; defense-in-depth via PRISM_AUTH_DISABLED production guard. |
| **A05 — Security Misconfiguration** | partial | Production guards (`PRISM_AUTH_DISABLED`); env-var defaults reviewed via scan; rate limiter defaults need review (audit doc). |
| **A06 — Vulnerable & Outdated Components** | automated | `npm audit` integrated into the OWASP scan; CI gating opt-in via `PRISM_OWASP_FAIL_ON=high`. |
| **A07 — Identification & Authentication Failures** | partial | Token gate + JWT secret strength check in scan; OAuth flows for email/calendar; CAC accountability chain. |
| **A08 — Software & Data Integrity Failures** | covered | Plugin pack signature verification (`PluginPackValidator`); release artifact signing (Phase F-F); contract diff gate. |
| **A09 — Security Logging & Monitoring Failures** | covered | ActivityBus events + SqliteActivityStore + OtelExporter + Prometheus `/metrics`; Grafana starter dashboard. |
| **A10 — SSRF** | partial | Outbound HTTP through governed adapters with allowlists (`NetworkTool`); browser/MCP transports follow the same envelope. |

## Closure plan

Per-category remediation lives in operational follow-ups (not source-tree work
in Phase F):

- A01: complete CAC-required-on-mutation audit per route group.
- A04: extend ApprovalQueue contention tests with privilege-escalation cases.
- A05: add `.env.example` + secrets-baseline document.
- A07: rotate JWT secret SOP (link to `docs/SECURITY_KEY_MANAGEMENT.md`).
- A10: enumerate remaining unhardened outbound surfaces.
