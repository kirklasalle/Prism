# PRISM Readiness Runbook

**Date:** 2026-04-22
**Purpose:** Operator-facing checklist that turns [Phase R](PRISM_UPDATED_ROADMAP_2026_Q2.md#3-phase-r--readiness-new) into concrete, executable work.
**Audience:** Core engineering team preparing PRISM for user testing and production deployment.
**Exit criteria:** see §11.

---

## 1. How to use this runbook

- Work top to bottom. **R1 and R2 block everything else.**
- Each task has: a unique ID, a target file, an acceptance check, and an estimated effort band (S = < 2 h, M = half day, L = full day, XL = multi-day).
- Mark a task done only when the acceptance check passes.
- When a task produces a new file, commit it in the same PR as the supporting test.

---

## 2. R1 — Configuration and secrets hygiene (BLOCKING)

### R1-1 — `.env.example` (S)

**Create** `/.env.example` covering every env var the server reads.

Minimum variables to document (not exhaustive; verify against [src/index.ts](../src/index.ts) and [dashboard-service.ts](../src/core/operator/dashboard-service.ts)):

```bash
# --- MANDATORY in production ---
NODE_ENV=production
PRISM_JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
PRISM_MODE=server
PRISM_ENV_PROFILE=prod
PRISM_DATA_DIR=/var/lib/prism

# --- Dashboard transport ---
PRISM_DASHBOARD_PORT=7070
PRISM_TLS_CERT=
PRISM_TLS_KEY=

# --- Execution ---
PRISM_EXECUTION_PROFILE=business   # or individual
PRISM_LLM_PROVIDER=ollama          # or openai, anthropic, ...
PRISM_MCP_SERVERS=none             # allowlist or "none"
PRISM_WORKSPACE_ROOT=

# --- Security ---
PRISM_AUTH_DISABLED=false          # MUST be false in production
PRISM_RATE_LIMIT=50                # per window; stricter than default 200
PRISM_MAX_BODY_SIZE=10485760       # 10 MiB

# --- Logging ---
PRISM_LOG_FORMAT=json              # or text
PRISM_LOG_DIR=

# --- Optional provider keys ---
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
```

**Acceptance:** `.env.example` exists, every key in production config is documented with a one-line explanation.

### R1-2 — Automate `DIRECTIVE_SHA256` (M)

Add a `prebuild` npm script that computes the PAD hash and writes it to a single source of truth.

Pattern (adapt to existing code):

```json
"scripts": {
  "prebuild": "node scripts/compute-directive-hash.js",
  "build": "tsc -p tsconfig.json"
}
```

Where `scripts/compute-directive-hash.js` reads `Permanent_Active_Directives.txt`, computes SHA-256, and either:

- writes a generated module `src/core/security/directive-hash.generated.ts` imported by [directive-integrity.ts](../src/core/security/directive-integrity.ts), **or**
- rewrites the `DIRECTIVE_SHA256` constant in-place.

**Acceptance:** editing the directives file and running `npm run build` produces a matching hash without any manual source edit. CI Gate 9 continues to pass.

### R1-3 — Real Ed25519 plugin-signing keys (M)

1. Generate a new keypair: `node -e "const k=require('crypto').generateKeyPairSync('ed25519'); console.log(JSON.stringify({pub:k.publicKey.export({format:'pem',type:'spki'}).toString('base64'),priv:k.privateKey.export({format:'pem',type:'pkcs8'}).toString('base64')}))"`.
2. Store the **private** key in an operator-controlled secret manager (never committed).
3. Replace the placeholder in [config/plugin-signing-keys.json](../config/plugin-signing-keys.json) with the real public key and remove the `"_note"` field.
4. Document rotation in [ADMIN_SRE_GUIDE.md](ADMIN_SRE_GUIDE.md) §4.

**Acceptance:** `cat config/plugin-signing-keys.json | jq .` shows no `_note` field; verification unit test signs and verifies a sample payload.

### R1-4 — Enforce JWT secret in production (S)

In [src/index.ts](../src/index.ts), change the current warning to a fail-fast when `NODE_ENV === "production"`:

```typescript
if (process.env.NODE_ENV === "production") {
  const secret = process.env.PRISM_JWT_SECRET ?? "";
  if (secret.length < 32) {
    console.error("[FATAL] PRISM_JWT_SECRET must be set to a string of at least 32 chars in production");
    process.exit(1);
  }
}
```

**Acceptance:** booting with `NODE_ENV=production` and no / short `PRISM_JWT_SECRET` exits with code 1 and the exact message above.

### R1-5 — Validate TLS at startup (S)

In [dashboard-service.ts](../src/core/operator/dashboard-service.ts) startup path, if `PRISM_TLS_CERT` or `PRISM_TLS_KEY` are set, read both files and construct `tls.createSecureContext({cert, key})` once before `listen()`. Reject any error with a clear message.

**Acceptance:** booting with an invalid cert produces a startup error with the cert path, not a runtime TLS error on first request.

### R1-6 — Production readiness check (M)

Add a `validateProductionReadiness()` function called from the server entry. Fail-fast on:

- `NODE_ENV === "production"` but `PRISM_AUTH_DISABLED === "true"` (already partly done; unify the check).
- Plugin signing keys file has `_note` placeholder.
- PAD hash does not match file.
- Workspace root is not writable.
- SQLite stores pass integrity check (`PRAGMA integrity_check`).

**Acceptance:** a production boot with any failing check exits with code 1 and lists every failing check, not just the first.

---

## 3. R2 — Security hardening (BLOCKING)

### R2-1 — CSRF tokens (L)

Add a CSRF middleware that:

1. Issues a token on first `GET /` request, sets it in a `__Host-csrf` cookie (`HttpOnly=false`, `Secure`, `SameSite=Strict`).
2. Requires the header `X-CSRF-Token` to match the cookie on every `POST`, `PUT`, `DELETE` to `/api/*` except the public allowlist (`/api/health`, `/metrics`, `/api/v1/openapi.json`).
3. Rejects mismatches with 403 and a clear error body.

Update [public/dashboard-app.js](../src/core/operator/public/dashboard-app.js) to read the cookie and attach the header on all fetches.

**Acceptance:** `tests/e2e-smoke.test.ts` gains a CSRF test: `POST /api/chat` without header → 403; with matching header → 200.

### R2-2 — Explicit CORS (S)

Add explicit CORS headers on every response. Default: `Access-Control-Allow-Origin` = only the configured dashboard origin (or `http://localhost:7070`). Reject cross-origin `OPTIONS` preflights from non-allowlisted origins.

**Acceptance:** smoke test: browser fetch from `http://evil.example` is blocked at the CORS preflight.

### R2-3 — Tighten rate limiter (S)

In [rate-limiter.ts](../src/core/security/rate-limiter.ts), change default `maxRequests` from 200 to 50. Add a stricter bucket for `/api/auth/*` (10 per minute per IP).

**Acceptance:** brute-force test: 51 requests in 60 s from one IP → 429 on the 51st.

### R2-4 — zod input validation (M)

Add `zod` schemas for auth + approval request bodies. Reject malformed input with 400 and a structured error response before the handler runs.

**Acceptance:** malformed JSON / missing fields produces 400 with a field-level error list.

---

## 4. R3 — Setup wizard UX uplift

### R3-1 — Provider connectivity test (M)

In [src/cli/setup-wizard.ts](../src/cli/setup-wizard.ts) and the web setup template, after the user enters provider + API key, make a real test call (e.g., list models). On failure, show the error and loop back to the provider step.

**Acceptance:** entering an invalid OpenAI key shows `401 invalid_api_key` and does not persist configuration.

### R3-2 — Workspace integrity probe (M)

In [workspace-resolver.ts](../src/core/config/workspace-resolver.ts), after `ensureWorkspaceStructure()`, run:

- A write + read round-trip test on `workspace/state/.write-probe`.
- `PRAGMA integrity_check` on every SQLite file present.

Fail with a specific error if any check fails.

**Acceptance:** a workspace with a corrupted SQLite file is rejected at wizard-completion time, not at first runtime use.

### R3-3 — Success screen (S)

After a successful wizard, show an explicit "Setup Complete" screen with:

- Workspace path.
- Dashboard URL.
- Direct "Open Dashboard" button.
- A short "Next Steps" list linking to [USER_GUIDE.md](USER_GUIDE.md) and [CHARACTER_SELECTION_GUIDE.md](CHARACTER_SELECTION_GUIDE.md).

### R3-4 — Rollback on failure (M)

If any wizard step fails before the final confirmation, delete any partial files written (keys, config, workspace init) so the user is returned to a clean state.

### R3-5 — Optional TLS step (M)

Add an advanced wizard step to paste cert/key paths. Validate at entry time using the same code path as R1-5.

### R3-6 — Post-setup OAuth handoff (M, blocked on E2)

Once E2 OAuth is live, add a wizard step 3b that initiates Gmail / Outlook consent. Store tokens via `ProviderSecretStore`.

---

## 5. R4 — User-flow E2E tests

Create these files under `tests/`.

### R4-1 through R4-5 — `tests/e2e-user-flow.test.ts` (L)

Scenarios:

1. Boot a fresh workspace, run wizard non-interactively, start the server, open a chat session, send a message, verify response.
2. With profile `individual`, invoke `shell_exec` of `echo hi`, expect success.
3. Verify denial messaging on a tier-3 operation without approval.
4. Enqueue an approval, approve it, verify the execution completes.
5. Kill the server mid-chat, expect client auto-reconnect within 5 s.

### R4-3 — `tests/business-scenario.test.ts` (M)

With profile `business`, attempt `shell_exec`. Expect policy denial with reason `tier_exceeds_profile_cap` or equivalent. Confirm activity event recorded.

### R4-6 — `tests/stability.test.ts` (XL, scheduled weekly)

Run 10 k mixed operations (chat, approval, tool invocation) and assert:

- Heap growth is bounded.
- File-descriptor count is stable.
- No unhandled rejections.

Skip in default `npm test`; run in a dedicated CI schedule.

### R4-7 — Wire `perf:qualify` into default `npm test` (S)

As a warning gate, not a failure gate initially.

---

## 6. R5 — Operations and data safety

### R5-1 — Backup / restore scripts (M)

`scripts/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
WORKSPACE="${PRISM_WORKSPACE_ROOT:-$HOME/Prism_Refraction}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="${1:-./prism-backup-$STAMP.tgz}"
tar czf "$OUT" -C "$(dirname "$WORKSPACE")" "$(basename "$WORKSPACE")"
echo "Backup: $OUT"
```

`scripts/restore.sh` — reverse operation with safety prompt.

**Acceptance:** backup → wipe workspace → restore → `/api/health` returns 200 within 60 s.

### R5-2 — DB migration framework (L)

Add a lightweight migration runner:

- `src/core/db/migrations/` holds versioned SQL files.
- `migrations` table in each SQLite DB tracks applied versions.
- Runner applied at store init before any query.

No ORM; just versioned SQL.

### R5-3 — Log rotation (M)

Adopt a simple daily rotation (winston-daily-rotate-file or a hand-rolled rotator). 30-day retention default, configurable via `PRISM_LOG_RETENTION_DAYS`.

### R5-4 — Structured JSON logs (M)

Respect `PRISM_LOG_FORMAT=json`. Emit one JSON object per log line with `ts`, `level`, `msg`, `op`, and any contextual fields.

---

## 7. R6 — Observability completeness

### R6-1 — `/metrics` Prometheus endpoint (L)

Expose counters and histograms:

- `prism_activity_events_total{op,status}`
- `prism_approvals_total{decision}`
- `prism_tier_denials_total{tier,reason}`
- `prism_tool_latency_ms` histogram by tool name
- `prism_session_cost_usd` histogram by profile

Public endpoint (no auth) — PROMETHEUS convention.

### R6-2 — Health widget (M)

A small card on the default dashboard tab showing uptime, heap, RSS, DB size, active sessions, pending approvals.

### R6-3 — Approval queue UI (L)

In the Telemetry tab, render the pending approval list with approve/deny buttons. Wire to `/api/approval/*`.

### R6-4 — Log tail over WebSocket (M)

A new WS topic `logs.tail` streams new lines appended to `workspace/logs/*.log`. Logs tab subscribes and renders.

---

## 8. R7 — CI/CD automation

### R7-1 — `.github/workflows/ci.yml` (L)

Jobs:

1. `lint` — `npm run lint` (add if absent)
2. `build` — `npm run build`
3. `unit` — `npm test` (default node:test + mocha)
4. `integration` — with skip-guards for PTY + Docker
5. `e2e` — R4 scenarios
6. `contracts` — `npm run contracts:snapshot`
7. `release-validate` — `npm run release:validate:strict`
8. `cu-bg` — `npm run cu:bg:check`
9. `directive-integrity` — verify PAD hash

Matrix: Windows + Ubuntu LTS.

### R7-2 — `.github/workflows/release.yml` (L)

Manual dispatch. Runs all 9 gates. Produces a release packet artifact (tgz) signed with cosign or similar.

### R7-3 — Branch protection (S)

GitHub repo settings:

- `main`: require CI green, require 1 review, require up-to-date branch.
- `feat/*`: require lint + unit green.

---

## 9. R8 — User-facing documentation

Complete in parallel with R1–R7. Already produced by this plan:

- [BUSINESS_VS_INDIVIDUAL_GUIDE.md](BUSINESS_VS_INDIVIDUAL_GUIDE.md)
- [ERROR_RECOVERY.md](ERROR_RECOVERY.md)
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- [ADMIN_SRE_GUIDE.md](ADMIN_SRE_GUIDE.md)
- [CHARACTER_SELECTION_GUIDE.md](CHARACTER_SELECTION_GUIDE.md)

Additional:

- Serve Swagger UI at `/api/v1/docs` using existing openapi.json.
- Update screenshots in [USER_GUIDE.md](USER_GUIDE.md) after Simple Mode ships (E3a-5).

---

## 10. Suggested sequencing (reference schedule)

Assume a small core team. Adjust as needed.

| Week | Focus |
|---|---|
| 1 | R1 end-to-end. R8 starts (first guides land). |
| 2 | R2 security hardening. R4 test skeletons. |
| 3 | R3 wizard UX. R5 backup + migrations. |
| 4 | R4 E2E test fleshed out. R6 observability. |
| 5 | R7 CI/CD. R8 screenshot + guide polish. |
| 6 | Bug-bash, dry-run onboarding with a non-team member, release-packet dry run. |

---

## 11. Exit criteria (gate to Phase F)

All of the following must be demonstrably true:

1. **Fresh-clone deployability.** On a clean machine, following only [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md), an operator can reach a working `/api/health` response within 30 minutes.
2. **New-user onboarding.** A non-team member completes setup → first chat → denied operation → approval → success in under 15 minutes using only the new user guides.
3. **CI green on `main`.** R7 pipelines pass end-to-end.
4. **Security baseline.** R2 items all green in smoke tests; CSRF, CORS, rate-limit, and input-validation tests pass.
5. **Backup / restore demonstrated** in a live drill.
6. **Release packet artifact** produced by the release workflow.
7. **All G-1 through G-17 gaps** from [PRISM_FULL_AUDIT_2026_Q2.md](PRISM_FULL_AUDIT_2026_Q2.md) §5 resolved.

Upon satisfying all seven, Phase R is closed and Phase F may begin.
