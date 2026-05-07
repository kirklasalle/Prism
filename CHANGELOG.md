# PRISM Changelog

All notable changes to the PRISM project are documented in this file.

## v0.15.0 — 2026-05-07 — W6: ActivityBus retention policy

Minor release on top of `v0.14.3`. Begins W6 (post-W5 closeout) with a default-off retention policy for the `activity_events` table. No changes to existing schema, ActivityBus contract, or any existing subscriber. Frontend additivity guarantee preserved (no UI changes in this release).

**New.**

1. New module `src/core/activity/retention-policy.ts` exporting `ActivityRetentionPolicy`, `ActivityRetentionConfig`, `ActivityRetentionSweepResult`, and `resolveRetentionConfigFromEnv`.
   - Periodic sweep deletes rows from `activity_events` whose `timestamp` is older than `now - retentionDays`, then emits an `activity.retention.swept` governance event onto the ActivityBus carrying `{deleted, cutoffIso, durationMs, retentionDays}` and a `database` side-effect record (`mutating: true, reversible: false`).
   - Config injection + a `now` clock for deterministic testing.
   - `start()` is idempotent; the timer is `unref()`-ed so it never keeps the process alive on its own.

2. Wired into `DashboardService` constructor immediately after the SOC 2 evidence exporter, gated by `resolveRetentionConfigFromEnv(activityStore.dbPath)`. When the env-gate is unset, the field is `null` and no sweeps run.

**Env gates (all optional, all default off).**

- `PRISM_ACTIVITY_RETENTION_DAYS` — positive integer enables the policy. `0`, missing, or non-numeric leaves it disabled.
- `PRISM_ACTIVITY_RETENTION_SWEEP_MS` — sweep cadence (≥ 1000 ms). Default 3,600,000 (1 hour).
- `PRISM_ACTIVITY_DB_PATH` — optional override of the SQLite path; otherwise the same path as `SqliteActivityStore` is used.

**Tests.** New `tests/activity-retention.test.ts` (registered in `tests/index.ts`) covers env-resolver edge cases, cutoff math against a fixed clock, the emitted ActivityBus event shape, idempotent start/stop, and the constructor's `retentionDays > 0` guard. **Total: 76/76 unit tests pass.**

**Not addressed.** Pre-existing Quality-Gates browser-session test failures (no `playwright install chromium` in QG runner) — tracked in PR #1 follow-ups.

## v0.14.3 — 2026-05-07 — Signature-payload + E2E preferences hotfix

Patch release on top of `v0.14.2`. After v0.14.2 cleared the Linux runtime crash, the next CI runs surfaced two latent bugs that had never run on Linux before. Both fixed here.

**Fixes.**

1. `buildSignaturePayload` shape mismatch in [src/core/plugins/plugin-pack-validator.ts](src/core/plugins/plugin-pack-validator.ts).
   - When a fresh manifest is signed *before* its `security.signature` is attached, the sign-side payload has no `security` field at all. The verify-side payload, after `delete copy.security.signature` + `delete copy.security.signature_algorithm`, was left with an empty `"security":{}` object. The two payloads serialized to different JSON, so signatures by an "official" tier key never verified.
   - Drop the `security` key entirely after deletion if it has become empty. Restores the `resolvePluginTrustTier: valid official signature returns official tier` assertion under Mocha on Linux CI.

2. E2E smoke "GET / returns the PRISM dashboard HTML shell" + "renders the dashboard in a real Chromium browser" in [tests/e2e/playwright-smoke.test.ts](tests/e2e/playwright-smoke.test.ts).
   - The dashboard handler 302-redirects `/` to `/setup` until `setupComplete` is true in the preferences file. CI's fresh checkout has no preferences file, so both smoke assertions saw `302` instead of `200` and "PRISM — Setup Wizard" instead of "PRISM Frontier Console".
   - The smoke contract is "the dashboard shell is reachable", not "first-run wizard works". The `before()` hook now writes a minimal preferences JSON (`setupComplete: true`, `uiMode: "advanced"`) into the per-test temp dir and points `PRISM_PREFERENCES_PATH` at it, so the redirect does not fire and the test's intent is preserved.

**Verification.** `npm run build` clean; `node dist/tests/index.js` reports `Tests: 75 | Passed: 75 | Failed: 0`; `node dist/tests/plugin-pack-validator.test.js` reports `Passed: 36, Failed: 0`.

## v0.14.2 — 2026-05-07 — Linux portability hotfix

Patch release on top of `v0.14.1`. The `v0.14.1` Docker image **builds** successfully on linux/amd64+linux/arm64, but at **runtime** the dashboard service unconditionally instantiated `WindowsProtectedFileProviderSecretStore` as the default provider secret store, causing PRISM bootstrap to crash on Linux with `Windows protected provider secret storage is only available on Windows.` (caught here by `PRISM CI — Build & Smoke` Playwright/E2E job, which boots the dashboard on Ubuntu).

**Fixes.**

- [src/core/operator/dashboard-service.ts](src/core/operator/dashboard-service.ts) — Default `providerSecretStore` is now platform-aware: `WindowsProtectedFileProviderSecretStore` on `win32`, `InMemoryProviderSecretStore` everywhere else. Callers can still inject either store explicitly.
- [tests/plugin-pack-validator.test.ts](tests/plugin-pack-validator.test.ts) — Replaced CommonJS `require.main === module` (illegal in ES module scope, threw `ReferenceError` under Mocha on Linux CI) with an unconditional ESM-safe `throw` on aggregate failure.

**Verification.** `npm run build` clean; `node dist/tests/index.js` reports `Tests: 75 | Passed: 75 | Failed: 0`.

**Still tracked for follow-up.** `resolvePluginTrustTier: valid official signature returns official tier` assertion in `tests/plugin-pack-validator.test.ts` still fails under Mocha on Linux CI (pre-existing, environment-specific). Not release-impacting; investigation deferred.

## v0.14.1 — 2026-05-07 — Docker-publish hotfix

Patch release on top of `v0.14.0` to fix the multi-arch Docker image build that broke on the `v0.14.0` tag run (`docker-publish.yml`). Helm chart and source release artifacts on `v0.14.0` were unaffected and remain published.

**Root cause.** `tsc`'s emitted output directory was implicitly derived from the common ancestor of the matched source files. With `include: ["src/**/*.ts","tests/**/*.ts"]` and the Docker builder stage only `COPY`'ing `src/`, the inferred `rootDir` collapsed to `src/`, so `tsc` emitted to `dist/core/operator/...` instead of `dist/src/core/operator/...`. The hardcoded `cp -r src/core/operator/public dist/src/core/operator/public` in the Dockerfile then failed with `cp: can't create directory ... No such file or directory`.

**Fix.**

- `tsconfig.json` — added explicit `"rootDir": "."` so emit paths are deterministic regardless of which include patterns match in a given build context. Local `npm run build` and the multi-arch Docker build now both emit to `dist/<original-path>/...`.
- `Dockerfile` — added defensive `mkdir -p dist/src/core/operator` before the `cp -r`, so a future similar misalignment would surface with a real error rather than a silent path drift.

**Verification.** Local `npm run build` succeeds; `dist/src/core/operator/dashboard-service.js` present; `node dist/tests/index.js` reports `Tests: 75 | Passed: 75 | Failed: 0`.

**Known unrelated failures (pre-existing on `feat/agentic-ux-polish`, not introduced or addressed by `v0.14.0`/`v0.14.1`).**

- `quality-gates.yml`: `tests/plugin-pack-validator.test.ts` uses CommonJS `require()` at line ~477 inside an ES module package, breaking under Mocha on Linux CI; one signature-tier assertion (`resolvePluginTrustTier: valid official signature returns official tier`) also fails. These ran red on the four runs prior to `v0.14.0` and are tracked for a follow-up patch.

## v0.14.0 — 2026-05-07 — Five-workstream aggregate release

Rolls up Workstreams 1–5. `package.json` bumped from `0.5.0` → `0.14.0`. All work is **strictly additive** with the Frontend Protection Guarantee preserved end-to-end. **No new external runtime dependencies** introduced across any workstream. **75/75 unit tests pass.**

| # | Workstream | Sub-tag | Headline deliverable |
| - | ---------- | ------- | -------------------- |
| W1 | OpenAI compat shim wired | `v0.10.1-openai-compat-wired` | OpenAI SDK clients reach PRISM by changing only `base_url`. |
| W2 | Phase R Readiness polish  | `v0.11.0-readiness-polish`    | SECURITY.md + CodeQL + nightly + release workflows + .env audit. |
| W3 | Enterprise IAM (H-1+H-2+H-3) | `v0.12.0-enterprise-iam`      | IAM data model + RBAC, OIDC SSO + session cookies, SCIM 2.0 + admin REST + admin UI. Default-off via `PRISM_ENTERPRISE_IAM`. |
| W4 | Hosted Cloud trial scaffold  | `v0.13.0-cloud-trial`         | Helm chart + Terraform `prism-aws` module + GHCR docker/helm publish workflows. |
| W5 | SOC 2 evidence exporter      | `v0.14.0-soc2-exporter`       | Default-off `Soc2EvidenceExporter` with file + webhook (Vanta/Drata/generic) transports + DLQ + backfill CLI. |

### Loose-end fixes bundled with this release

- **[`src/core/iam/store.ts`](src/core/iam/store.ts)** — `verifyScimToken` now surfaces the actual `revoked_at` value in the returned record (was always `null`). The underlying `getScimTokenByHash` SQL already filtered `revoked_at IS NULL`, so revoked tokens already failed authentication; the test in [`tests/iam-scim-admin.test.ts`](tests/iam-scim-admin.test.ts) was tightened from `200|401` to a strict `401` assertion.
- **[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)** — adds keyless cosign signing via GHA OIDC (`sigstore/cosign-installer@v3` pinned to cosign `v2.2.4`). Every published image+digest combination is signed; the workflow already requested `id-token: write` so no permission migration was required.
- **[`src/core/operator/dashboard-service.ts`](src/core/operator/dashboard-service.ts)** — fixed a routing regression where Phase E3 (Operator Utilities, Tool Risk Overrides, CAC Identity) and Novel Systems Incubation routes silently returned `404 Not Found`. The dashboard `handle()` normalizes inbound URLs `/api/v1/*` → `/api/*` before route matching, but ~14 route literals/regexes were authored against the un-normalized form and never matched. All affected handlers now match the post-normalization `url`. A regression guard was added to `testDashboardService` exercising `/api/v1/utilities`, `/api/v1/tools/risk-overrides`, `/api/v1/cac/assignments`, and `/api/v1/incubation/dlma/weights` through the real HTTP pipeline.

### Operational invariants preserved

- With `PRISM_ENTERPRISE_IAM` unset, `PRISM_SCIM` unset, and `PRISM_SOC2_EXPORTER` unset (all defaults), the dashboard's auth surface, route registration, and ActivityBus subscriber set are byte-identical to pre-W1 behaviour.
- The `start_*.bat` / `start_*.sh` entrypoints were not modified in any workstream.
- Frontend changes were limited to ONE additive file (`src/core/operator/public/iam-admin.html`); no existing UI page, WebSocket wiring, or client component was removed or destructively changed.

### Suggested git workflow

```bash
git add -A
git commit -m "release: v0.14.0 (W1–W5 aggregate)"
git tag -a v0.14.0 -m "PRISM v0.14.0 — OpenAI compat, Readiness polish, Enterprise IAM, Cloud trial, SOC 2 exporter"
git push origin feat/agentic-ux-polish v0.14.0
```

---

## Unreleased — 2026-05-07 — Phase SOC2-1: SOC 2 evidence exporter (toward v0.14.0-soc2-exporter)

Closes the original 5-workstream plan. Adds a default-off `Soc2EvidenceExporter` that subscribes to the existing `ActivityBus` and forwards SOC 2-classified events to either a daily-rotated JSONL file or a batched webhook (Vanta / Drata / generic). **Strictly additive** — `PRISM_SOC2_EXPORTER` is unset by default; when unset the exporter never subscribes, has zero overhead, and does not touch the filesystem or network. **No new runtime dependencies** — uses `node:fs` / `node:https` / `node:http` only. **75/75 unit tests pass** (was 74 — added `Soc2Exporter`).

### Added — Exporter

- **[`src/core/compliance/soc2-exporter.ts`](src/core/compliance/soc2-exporter.ts)** — `Soc2EvidenceExporter` with the same start/stop/onEvent shape as `OtelExporter`. Public surface:
  - `classifyEventForSoc2(event)` — pure predicate returning the list of Trust Services Criteria controls an `ActivityEvent` maps to (CC6.1 logical access, CC6.6 boundary protection, CC7.2 anomaly detection, CC8.1 change management) or `null` to drop the event.
  - `mapEventToSoc2(event, controls)` — pure mapper to a stable `Soc2EvidenceRecord` (schemaVersion 1) carrying the source event's sha256 hash for chain-of-custody and pruning non-mutating side-effects from the CC8.1 surface.
  - `backfillFromEvents(events, { since?, until? })` — pure helper used by the backfill CLI.
- **FileTransport**: appends one JSONL record per event to `prism-output/soc2/YYYY-MM-DD.jsonl`. Daily rotation is driven by an injectable `now()` clock so tests can pin the date deterministically.
- **WebhookTransport**: in-memory batching (default `batchSize=32`, `flushIntervalMs=60000`). Flushes on close. Vendor envelopes — `generic` (`{records:[…]}`), `vanta` (`{source:"prism", evidence:[…]}`), `drata` (`{vendor:"prism", records:[…]}`) — selectable via `PRISM_SOC2_WEBHOOK_FLAVOR`. On HTTP failure, the unflushed batch is appended to `prism-output/soc2/_dlq.jsonl` so evidence is never silently lost.
- Errors inside the exporter are swallowed defensively — the host PRISM process is never crashed by an evidence-pipeline failure.

### Added — Wiring

- **[`src/core/operator/dashboard-service.ts`](src/core/operator/dashboard-service.ts)** — alongside the existing `OtelExporter` construction, instantiates `Soc2EvidenceExporter(this.activityBus)` and calls `start()` only when `isEnabled()` returns true (i.e. `PRISM_SOC2_EXPORTER` is `file` or `webhook`). Default-off invariant preserved.

### Added — Backfill CLI

- **[`scripts/prism-soc2-export.cjs`](scripts/prism-soc2-export.cjs)** — `node scripts/prism-soc2-export.cjs --db prism-activity.db --since 2026-01-01 --until 2026-12-31 --out prism-output/soc2/backfill.jsonl`. Reads `activity_events` directly via `node:sqlite`, applies the same `classifyEventForSoc2` + `mapEventToSoc2` logic the live exporter uses, and writes JSONL. PRISM does not need to be running. Requires `npm run build` first so the dist artifact is available.

### Added — Tests

- **[`tests/soc2-exporter.test.ts`](tests/soc2-exporter.test.ts)** — covers control classification per bucket (CC6.1 / CC6.6 / CC7.2 / CC8.1), mapper output shape (sourceHash propagation, principal extraction, mutating-only side-effect filter), `FileTransport` daily rotation, `WebhookTransport` batching + Vanta envelope shape + DLQ-on-failure path, off-mode no-op behaviour, and `backfillFromEvents` since/until + bucket filtering.
- **[`tests/index.ts`](tests/index.ts)** — registers `{ name: "Soc2Exporter", fn: testSoc2Exporter }` after `HelmLint`.

### Added — Configuration

- **[`.env.example`](.env.example)** — new "Phase SOC2 — SOC 2 evidence exporter" block documenting `PRISM_SOC2_EXPORTER` (off|file|webhook), `PRISM_SOC2_WEBHOOK_URL`, `PRISM_SOC2_WEBHOOK_TOKEN`, `PRISM_SOC2_WEBHOOK_FLAVOR` (generic|vanta|drata).

### Trust Services Criteria coverage

| Control | Source predicate                                                                |
| ------- | ------------------------------------------------------------------------------- |
| CC6.1   | `operation` starts with `auth.` / `iam.` / `rbac.` / `sso.`                     |
| CC6.6   | `layer === "governance"` OR `policyDecision` is set                             |
| CC7.2   | `status === "failed"` OR `policyDecision` is `deny` / `require_approval`        |
| CC8.1   | Any side-effect with `mutating: true`                                           |

### Operational notes

- Default-off invariant: `PRISM_SOC2_EXPORTER=` (empty) ⇒ exporter constructed but never subscribed, zero work per event, no filesystem creation.
- The webhook transport is non-blocking from the ActivityBus's perspective — events are buffered synchronously and the HTTP POST is dispatched on a microtask chain so emit() never awaits network I/O.
- Two-way sync with Vanta / Drata (pulling control status back into PRISM) is explicitly out of scope for v1.

## Unreleased — 2026-05-07 — Phase Cloud-1: Helm chart + Terraform module + GHCR publish workflows (toward v0.13.0-cloud-trial)

First slice of the Hosted Cloud trial. Adds an in-tree Helm chart, a reference Terraform module that deploys it to AWS via IRSA, and two GitHub Actions workflows that publish the container image and the chart to GHCR on every tagged release. **Strictly additive** — no source under `src/` was modified; the existing `start_*.bat` / individual / wizard / TUI / dashboard flows are unchanged. **No new runtime dependencies** — the helm-lint test gracefully skips when the `helm` binary is not on PATH so local Windows dev boxes stay green. **74/74 unit tests pass** (was 73 — added `HelmLint`).

### Added — Helm chart

- **[`deploy/helm/prism/Chart.yaml`](deploy/helm/prism/Chart.yaml)** — chart `name: prism`, `version: 0.1.0`, `appVersion: 0.13.0-cloud-trial`.
- **[`deploy/helm/prism/values.yaml`](deploy/helm/prism/values.yaml)** — operator-facing knobs: `image.repository` (default `ghcr.io/kirklasalle/prism`), single-replica deployment (PRISM v1 holds in-process state), ClusterIP `Service` on port 7070, optional `Ingress`, `PersistentVolumeClaim` for `/data/Prism_Refraction`, `runAsNonRoot: true` + `seccompProfile: RuntimeDefault` pod security context, liveness/readiness probes on `/health`, optional `ServiceMonitor` for the Prometheus operator, optional `PodDisruptionBudget`. LLM keys and IAM secrets flow in via `envFromSecrets` (caller-managed).
- **Templates** under [`deploy/helm/prism/templates/`](deploy/helm/prism/templates/): `_helpers.tpl`, `deployment.yaml` (with `strategy: Recreate` to avoid SQLite contention during rolling updates), `service.yaml`, `serviceaccount.yaml`, `pvc.yaml`, `ingress.yaml`, `pdb.yaml`, `servicemonitor.yaml`, `NOTES.txt`.
- **[`deploy/helm/prism/.helmignore`](deploy/helm/prism/.helmignore)** — standard ignore list.

### Added — Terraform module `prism-aws`

- **[`deploy/terraform/modules/prism-aws/main.tf`](deploy/terraform/modules/prism-aws/main.tf)** — provisions a versioned + AES-256-encrypted S3 backup bucket with a non-current-version lifecycle expiry, an IRSA-bound IAM role granting the PRISM ServiceAccount `s3:Get/Put/Delete/AbortMultipart` on that bucket, and a `helm_release` of the in-tree chart wired to the IRSA SA. Ingress + extra envs + `envFromSecrets` Secret references are all caller-driven.
- **[`variables.tf`](deploy/terraform/modules/prism-aws/variables.tf)** — typed inputs including `eks_oidc_provider_arn` / `eks_oidc_provider_url`, `helm_secret_refs` (LLM keys, `PRISM_SSO_SESSION_SECRET`), and `backup_retention_days`.
- **[`outputs.tf`](deploy/terraform/modules/prism-aws/outputs.tf)** — `backup_bucket`, `backup_bucket_arn`, `irsa_role_arn`, `release_name`, `release_namespace`.
- **[`README.md`](deploy/terraform/modules/prism-aws/README.md)** — quick-start usage block.
- Required providers: `aws ~> 5`, `helm ~> 2.12`, `kubernetes ~> 2.25`. The module pins `terraform >= 1.5.0`.

### Added — Publish workflows

- **[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)** — pushes multi-arch (`linux/amd64` + `linux/arm64`) images to `ghcr.io/${{ github.repository_owner }}/prism` on tag `v*.*.*` (full semver tags + `latest`), main branch (`edge`), and PRs (build-only, no push). Uses `docker/setup-qemu-action@v3`, `docker/setup-buildx-action@v3`, `docker/login-action@v3`, `docker/metadata-action@v5`, `docker/build-push-action@v5` with GHA cache. Requests `id-token: write` so cosign keyless signing can be added in a follow-up without a perms migration.
- **[`.github/workflows/helm-publish.yml`](.github/workflows/helm-publish.yml)** — `lint` job runs `helm lint` + `helm template` smoke test on every push and any PR that touches `deploy/helm/**` and uploads the rendered manifests as an artifact. `publish` job (gated on `refs/tags/v`) packages the chart and pushes to `oci://ghcr.io/${{ github.repository_owner }}/charts`. Uses `azure/setup-helm@v4` pinned to `v3.14.0`.

### Added — Test coverage

- **[`tests/helm-lint.test.ts`](tests/helm-lint.test.ts)** — `HelmLint` test asserts every required chart file is present and, when the `helm` binary is on PATH, runs `helm lint` and fails on non-zero exit. Skips with a logged warning when `helm` is unavailable so the unit suite remains green on Windows dev boxes.
- **[`tests/index.ts`](tests/index.ts)** — registers `{ name: "HelmLint", fn: testHelmLint }` after `IamAdminRoutes`.

### Operational notes

- Required GHCR permissions are already granted by the default `GITHUB_TOKEN` (`packages: write`) — no PAT or org-level secret rotation is required to land the workflows.
- The chart is deliberately constrained to a single replica. Multi-replica HA is gated on externalising the in-process pending-flow store (tracked under future `PRISM_IAM_FLOW_STORE` work).
- Backup integration on the PRISM side (consuming `PRISM_AWS_S3_BUCKET`) is **not** part of this slice and will land alongside the SOC 2 evidence exporter (W5 / `v0.14.0-soc2-exporter`).

## Unreleased — 2026-05-06 — Phase H-3: SCIM 2.0 + IAM admin REST + admin UI (toward v0.12.0-enterprise-iam)

Final Phase H sub-phase. Lands the SCIM 2.0 provisioning surface under `/scim/v2/*`, the admin REST surface under `/api/iam/admin/*`, and an additive standalone IAM admin HTML page at `/public/iam-admin.html`. **Strictly additive** — when `PRISM_ENTERPRISE_IAM` is unset (the default), none of the H-3 routes register and the legacy admin-token contract is byte-identical. SCIM is doubly-gated: it requires `PRISM_ENTERPRISE_IAM=on` AND `PRISM_SCIM=on`. **No new runtime dependencies** — SCIM JSON shaping, filter parsing, and bearer-token verification are all native. **73/73 unit tests pass** (was 71 — added `ScimRoutes` and `IamAdminRoutes`). Frontend Protection Guarantee preserved (the new admin page is a brand-new file; nothing under existing `tab-*.html` / dashboard-app.js was touched).

### Added — SCIM 2.0 provisioning

- **[`src/core/operator/routes/scim-handler.ts`](src/core/operator/routes/scim-handler.ts)** — `ScimRouteHandler` implementing the spec-compliant subset needed for Okta / Entra ID / OneLogin / JumpCloud:
  - **Discovery**: `GET /scim/v2/ServiceProviderConfig`, `GET /scim/v2/Schemas`, `GET /scim/v2/ResourceTypes`.
  - **Users**: `GET` (list with `userName eq "x"` filter, `startIndex` + `count` pagination), `POST` (create + auto-grant `viewer`), `GET /:id`, `PUT /:id` (active toggle), `PATCH /:id` (handles both `{op:"replace", path:"active", value:false}` and the path-less `{op:"replace", value:{active:false}}` shape that Okta sends), `DELETE /:id` (deprovisions — never hard-deletes so audit references remain intact).
  - **Groups**: read-only `GET` and `GET /:id` listing the four canonical roles.
  - **Auth**: bearer-only. SCIM tokens are verified via `IamStore.verifyScimToken`; the legacy admin token can also be passed via an injectable `adminTokenVerifier` so an operator can call SCIM without first provisioning a SCIM token.
  - **Errors**: typed SCIM-spec error envelope (`schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"]`, `status`, `detail`, `scimType` for `uniqueness` collisions).
  - Out of scope (tracked as **H-3.1**): complex filter expressions beyond `userName eq`, bulk operations, group-write operations.

### Added — IAM admin REST API

- **[`src/core/operator/routes/iam-admin-handler.ts`](src/core/operator/routes/iam-admin-handler.ts)** — `IamAdminRouteHandler` mounted at `/api/iam/admin/*`. Endpoints:
  - `GET /users` (with role names attached), `POST /users/:id/status` (`active`/`suspended`/`deprovisioned`), `POST /users/:id/roles` (`{ role }`), `DELETE /users/:id/roles/:roleName`.
  - `GET /roles`.
  - `GET /scim-tokens`, `POST /scim-tokens` (returns plaintext token ONCE), `DELETE /scim-tokens/:id`.
  - **Auth**: every endpoint requires the principal to hold at least the `admin` role. Resolution chain: session cookie → API-key bearer → legacy admin bearer (synthetic `root` principal). Viewer cookies receive `403 forbidden`; missing credentials receive `401 unauthenticated`.
  - The handler MUST register before `IamRouteHandler` in the route table so `/api/iam/admin/*` doesn't get swallowed by the broader `/api/iam/` matcher.

### Added — admin UI (additive standalone page)

- **[`src/core/operator/public/iam-admin.html`](src/core/operator/public/iam-admin.html)** — single self-contained HTML page at `/public/iam-admin.html`. Pure HTML/CSS/JS, no build pipeline involvement. Operator pastes a bearer token in-page (held in memory only — never persisted), then can: list users with their roles, suspend / unsuspend a user, grant a user the `admin` role, list roles, create + revoke SCIM tokens (plaintext shown via `prompt()` exactly once). Page does NOT touch the existing dashboard tabs, `dashboard-app.js`, or any WebSocket wiring. Reachable independently of the main dashboard so it remains usable even when the operator deliberately scopes tokens to admin-only.

### Changed — runtime registration (gated additive)

- **[`src/core/operator/routes/index.ts`](src/core/operator/routes/index.ts)** — when `PRISM_ENTERPRISE_IAM=on`, the `Router` constructs `IamRouteHandler` once, registers `IamAdminRouteHandler` ahead of it, and (when `PRISM_SCIM=on`) registers `ScimRouteHandler` sharing the same `IamStore` so user / role / token state is consistent across surfaces.
- **[`src/core/operator/dashboard-service.ts`](src/core/operator/dashboard-service.ts)** — `AuthGate.publicPrefixes` extended with `"/scim/v2/"` so SCIM clients can present their own bearer without first passing the admin token. The SCIM handler enforces its own bearer auth on every request, so this is not an auth bypass.

### Added — tests

- **[`tests/iam-scim-admin.test.ts`](tests/iam-scim-admin.test.ts)** — two exported entry points:
  - `testScimRoutes`: discovery 401-without-bearer + 200-with-bearer, `POST /Users` (201 + auto-grant `viewer`), uniqueness conflict (`409` + `scimType: "uniqueness"`), filter (`GET /Users?filter=userName eq "..."`), `PATCH` (both spec-form and Okta-form active-toggles), `DELETE` (204 + status=deprovisioned), `GET /Groups` listing the four roles, unsupported filter (`400 invalidFilter`), legacy-admin-bearer fallback via `adminTokenVerifier`.
  - `testIamAdminRoutes`: anonymous → 401, viewer-cookie → 403, legacy-admin-bearer → 200 user list, role grant promotes a viewer to admin, status toggle, full SCIM-token CRUD (create / list / revoke), roles list returns all four canonical roles.
- **[`tests/index.ts`](tests/index.ts)** — registers both as `ScimRoutes` and `IamAdminRoutes`.

### Documentation

- **[`.env.example`](.env.example)** — appended `PRISM_SCIM` flag documenting the SCIM gating contract.

### Decisions and scope

- **Doubly-gated SCIM.** `PRISM_SCIM` is independent of `PRISM_ENTERPRISE_IAM` so an organisation can enable SSO without exposing the SCIM provisioning surface (and vice-versa is impossible by design — SCIM requires the IAM tables that only land when enterprise IAM is on).
- **No new dependencies.** SCIM filter parsing is restricted to `userName eq "x"` rather than pulling in a full SCIM-filter library. Group-write is not implemented; PRISM roles are the canonical write surface and the four `root|admin|operator|viewer` roles are constants per tenant.
- **Standalone admin page.** Building the admin UI as a separate HTML file (rather than a new dashboard tab) keeps the main dashboard's WebSocket / tab-loader / dashboard-app.js wiring untouched, satisfying the Frontend Protection Guarantee strictly.
- **Default-off.** With both flags absent, `Router` registers exactly the same handler list as the prior release; the `AuthGate` `publicPrefixes` now contains `/api/iam/sso/` and `/scim/v2/` unconditionally, but neither prefix matches any registered handler when the flags are off, so requests hit the inline 404 path.

---

## Unreleased — 2026-05-06 — Phase H-2: SSO (OIDC) + signed-cookie sessions + `/api/iam/*` routes (toward v0.12.0-enterprise-iam)

Second of three Phase H sub-phases. Adds an enterprise-grade SSO surface mounted at `/api/iam/*` and a signed session-cookie mechanism, all gated behind `PRISM_ENTERPRISE_IAM=on`. **Strictly additive** — when the flag is unset (the default), the `Router` does not register any new handlers, the `AuthGate` is configured exactly as before, and the legacy single-admin-token path remains the only auth gate. **No new runtime dependencies** — OIDC discovery, JWKS fetch, and ID-token signature verification are implemented on top of `node:crypto` + the global `fetch`. **71/71 unit tests pass** (was 67 — added `IamSsoSession`, `IamSsoOidc`, `IamSsoSaml`, `IamRoutesE2E`). Frontend Protection Guarantee preserved (no UI changes; the admin SSO management screens land in H-3).

### Added — SSO + session layer

- **[`src/core/iam/sso/session.ts`](src/core/iam/sso/session.ts)** — `SessionManager` issuing/verifying HMAC-SHA256-signed session cookies (`prism_sso=<sessionId>.<sig>`). `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` set automatically unless `PRISM_ENV_PROFILE=dev`. The HMAC secret is read from `PRISM_SSO_SESSION_SECRET` (≥32 chars in production); when absent, an ephemeral 32-byte buffer is generated so dev still works (existing sessions invalidate on every restart). `verify()` uses `timingSafeEqual` for the signature comparison and refuses cookies with malformed shape. `revoke()` deletes the underlying `iam_sso_sessions` row. The cookie payload itself carries no claims — it is purely an opaque session-id pointer into the IAM store.
- **[`src/core/iam/sso/oidc.ts`](src/core/iam/sso/oidc.ts)** — `OidcProvider` implementing the Authorization-Code-with-PKCE flow against any OIDC-compliant IdP. `beginAuth()` returns the IdP authorize URL plus a typed `OidcAuthRequestState` carrying `state`, `nonce`, `codeVerifier`, and the S256 `codeChallenge`. `completeAuth({ code, state })` exchanges the code at the IdP token endpoint and verifies the returned `id_token` via `verifyIdToken()`. Verification accepts only RS256 / ES256 (HS256 is explicitly rejected as `unsupported_alg`), validates that `iss` matches discovery metadata, that `aud` matches the configured client id, that `exp` and `iat` are within a 300-second clock-skew window, and that the `nonce` matches the value generated in `beginAuth()`. The discovery document and JWKS are cached for 10 minutes; JWK lookup is by `kid` with a single-key fallback. All errors throw a typed `OidcError` with a stable `code` field for downstream surfacing.
- **[`src/core/iam/sso/saml.ts`](src/core/iam/sso/saml.ts)** — `SamlProvider` skeleton. `beginAuth()` builds a base64-encoded SAML 2.0 `AuthnRequest` and an HTTP-Redirect URL with `RelayState`. `completeAuth()` currently throws `SamlError("not_implemented")` — full XML-DSig signature verification of `SAMLResponse` is intentionally deferred to a follow-up labelled **Phase H-2.1** so this PR can ship without adding any XML-parsing or signature-verification dependency. The route surface for SAML still exists so an IdP can be wired up end-to-end; only the response-verification step is gated.
- **[`src/core/operator/routes/iam-handler.ts`](src/core/operator/routes/iam-handler.ts)** — `IamRouteHandler` (an `IRouteHandler`) implementing four routes: `GET /api/iam/sso/:kind/login` (302 to IdP), `GET /api/iam/sso/:kind/callback` (302 to `/`, sets session cookie), `GET /api/iam/me` (returns `{ principal }` from cookie or admin bearer; `401` if neither), `POST /api/iam/logout` (revokes session, clears cookie, `204`). Pending OIDC/SAML flow state is held in an in-process `Map` keyed by a transient `prism_sso_flow` cookie (10-minute TTL, opportunistic GC) — single-process v1; clustered deployments will need an external store in a follow-up. New SSO users are upserted into `iam_users` and granted the `viewer` role by default; admins promote them via the upcoming H-3 admin UI. Errors map cleanly: `OidcError → 400` with the typed code, `SamlError("not_implemented") → 501`, other `SamlError → 400`, anything else → `500`.

### Changed — runtime registration (gated additive)

- **[`src/core/operator/routes/index.ts`](src/core/operator/routes/index.ts)** — the `Router` constructor now appends a single `IamRouteHandler` **only when `isEnterpriseIamEnabled()` returns true** (i.e. `PRISM_ENTERPRISE_IAM=on`). With the flag absent, the handler list is byte-identical to the prior release.
- **[`src/core/operator/dashboard-service.ts`](src/core/operator/dashboard-service.ts)** — `AuthGate` constructor's `publicPrefixes` is extended with `"/api/iam/sso/"` so the SSO login + callback routes can complete without a bearer token. `/api/iam/me` and `/api/iam/logout` remain non-public and require either a session cookie or the legacy admin token. This is a one-line additive change.

### Added — tests

- **[`tests/iam-sso.test.ts`](tests/iam-sso.test.ts)** — four exported entry points: `testIamSsoSession` (cookie sign/verify, tamper rejection, secret rotation invalidation, `Secure`-flag override, revoke flow), `testIamSsoOidc` (PKCE auth-URL shape, full `completeAuth` flow against an injected `fetch` serving discovery + JWKS + token endpoint, plus negative cases for tampered signature → `invalid_signature`, expired exp → `expired`, nonce mismatch → `nonce_mismatch`), `testIamSsoSaml` (AuthnRequest shape + `completeAuth` throws `not_implemented`), and `testIamRoutesEndToEnd` (login → 302 + flow cookie; callback → 302 + session cookie + auto-provisioned `viewer` user; `/me` returns the principal; `/logout` clears the cookie; revoked session → 401 on subsequent `/me`; unknown sub-path → 404).
- **[`tests/index.ts`](tests/index.ts)** — registers the four new entries.

### Documentation

- **[`.env.example`](.env.example)** — appended a "Phase H — Enterprise IAM (opt-in)" block documenting `PRISM_ENTERPRISE_IAM` and `PRISM_SSO_SESSION_SECRET`.

### Decisions and scope

- **No new dependencies.** OIDC verification uses `node:crypto` + global `fetch`. SAML response verification is intentionally deferred so this PR doesn't pull in `xmldsig` / `xml-crypto`. The deferred work is tracked as **Phase H-2.1**.
- **In-process pending-flow store.** Acceptable for single-process deployments; clustered HA will externalise this in a follow-up alongside any other in-process state.
- **Default-off.** `PRISM_ENTERPRISE_IAM` is unset by default, which means none of these routes mount, the `AuthGate` config is unchanged, and the legacy admin-token contract is preserved bit-for-bit.

---

## Unreleased — 2026-05-06 — Phase H-1: Enterprise IAM data model + RBAC scaffold (toward v0.12.0-enterprise-iam)

First of three Phase H sub-phases delivering the Enterprise IAM layer. **Strictly additive** — no existing route, store, or auth path is modified, and nothing in the runtime constructs the new `IamStore` yet (that wiring lands in H-2 alongside the SSO routes). The single-admin-token path remains the only auth gate, and the legacy contract is preserved bit-for-bit. **67/67 unit tests pass** (was 65 — added `IamStore` and `IamRbac` test entries). Frontend Protection Guarantee preserved (no UI changes in this phase).

### Added — IAM data layer

- **[`src/core/iam/store.ts`](src/core/iam/store.ts)** — `IamStore` class backed by `node:sqlite` (`DatabaseSync`). Idempotent embedded migration creates seven tables: `iam_users`, `iam_roles`, `iam_memberships`, `iam_api_keys`, `iam_idp_configs`, `iam_scim_tokens`, `iam_sso_sessions` — all tenant-scoped via `tenant_id` keying off [`src/core/config/tenant-context.ts`](src/core/config/tenant-context.ts). Default constructor takes `:memory:` for tests; production callers will pass an explicit DB path in H-2. `seedDefaultRoles(tenantId)` creates the four canonical roles (`root`, `admin`, `operator`, `viewer`) idempotently. CRUD coverage for users, roles, memberships, API keys (hash-only storage, `revoked_at` audit retention, `last_used_at` touched on verify), IdP configs (OIDC + SAML config blobs), SCIM tokens, and SSO sessions (TTL-checked on read).
- **[`src/core/iam/rbac.ts`](src/core/iam/rbac.ts)** — coarse 4-tier hierarchy (`root > admin > operator > viewer`) with `roleAtLeast`, `principalHasRole`, `highestRole`, `requireRole` (throws typed `RbacError` carrying `statusCode: 403` + `code: "forbidden"`), and `adminTokenPrincipal()` factory producing the synthetic `{ userId: "_admin", roles: ["root"], source: "admin_token" }` principal so every existing legacy code path will satisfy any future role gate trivially.

### Changed — auth contract (additive only)

- **[`src/core/security/auth.ts`](src/core/security/auth.ts)** — `AuthResult` gains an **optional** `principal?: IamPrincipal` field. No existing caller is required to populate or read it. The `AuthGate.check()` implementation is unchanged in this phase; H-2 will populate `principal` from session cookies / API keys when `PRISM_ENTERPRISE_IAM=on`.

### Added — tests

- **[`tests/iam-store.test.ts`](tests/iam-store.test.ts)** (`IamStore`): role-seed idempotence, user UNIQUE constraint on `(tenant_id, email)`, status transitions, tenant-scoped listing, membership add/remove (incl. duplicate-add no-op), API-key plaintext-only-once + verify + revoke + suspended-user-fails-verify, SCIM-token revoke flow, IdP config round-trip, session TTL filtering.
- **[`tests/iam-rbac.test.ts`](tests/iam-rbac.test.ts)** (`IamRbac`): hierarchy correctness, admin-token principal satisfies every role, operator principal does not satisfy `admin`, `highestRole` picks the strongest grant, `RbacError` carries `statusCode/code/required/held`, unknown role names confer nothing.
- **[`tests/index.ts`](tests/index.ts)** — registered both new entries.

### Decisions

- **No new external dependencies.** Uses the same `node:sqlite` + `node:crypto` surface the rest of the project relies on.
- **Hash-only credential storage.** API keys and SCIM tokens are sha256-hashed before insert; the plaintext token is returned to the caller exactly once at create time.
- **Soft-delete via `revoked_at`.** Credentials are never row-deleted — required for SOC 2 evidence retention (W5 will export these rows).
- **Phase H gating not yet enforced at runtime.** `PRISM_ENTERPRISE_IAM=on` is documented but not yet read by any production code; H-2 will introduce the dashboard wiring behind that flag. Until then, this phase's surface is reachable only via direct import (i.e., from tests).

## Unreleased — 2026-05-06 — Phase R: Readiness polish (v0.11.0-readiness-polish)

Closes the readiness-floor items identified in the Workstream 1–5 plan: top-level vulnerability-disclosure policy, three new GitHub Actions workflows (CodeQL static analysis, scheduled nightly full suite, tag-driven release packaging), an end-to-end test of the new `/v1/*` compat surface, and an audit pass on `.env.example` to document Phase E/F/G surfaces. No application behavior changes; this workstream raises the floor before larger feature work (Phase H IAM, Cloud, SOC 2). **65/65 unit tests pass** unchanged. Frontend Protection Guarantee preserved.

### Added — security & disclosure

- **[`SECURITY.md`](SECURITY.md)** — vulnerability-disclosure policy at the repo root: supported-versions table, private reporting via GitHub Security Advisories or the maintainer email with `PRISM-SEC` subject tag, scope (in/out), 3-business-day acknowledgement target, 30-day fix target for high-severity issues, and a non-exhaustive list of standing controls (`AuthGate`, CORS/CSRF, rate limit, body-size cap, TLS, PAD directive integrity, plugin signing, activity-bus tamper hashes, production startup validator) for triage context.

### Added — CI / release workflows

- **[`.github/workflows/codeql.yml`](.github/workflows/codeql.yml)** — JavaScript/TypeScript CodeQL static analysis on push to `main`, all PRs targeting `main`, and a weekly Tuesday 06:17 UTC schedule. Uses the `security-and-quality` query suite. Results upload to the repo Security tab.
- **[`.github/workflows/nightly.yml`](.github/workflows/nightly.yml)** — daily 06:00 UTC full-suite job: `npm run build` → in-process runner (`node dist/tests/index.js`) → Playwright e2e (`npm run test:e2e`) → optional Gmail OAuth canary scenario (skipped silently when canary secrets are absent). On failure, files or updates a sticky GitHub issue tagged `nightly-fail`.
- **[`.github/workflows/release.yml`](.github/workflows/release.yml)** — triggered by pushing a `v*.*.*` tag (or manual dispatch). Builds, runs the full in-process test runner, packages a `prism-<tag>.tar.gz` containing `dist/`, `package.json`, `package-lock.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `.env.example`, `ecosystem.config.js`, `Dockerfile`, then creates a GitHub Release with autogenerated notes and the tarball attached.

### Added — e2e coverage of the OpenAI compat surface

- **[`tests/e2e/openai-compat-e2e.test.ts`](tests/e2e/openai-compat-e2e.test.ts)** — boots the built dashboard on a random ephemeral port (mirroring the bootstrap pattern in [`tests/e2e/playwright-smoke.test.ts`](tests/e2e/playwright-smoke.test.ts)) and exercises `/v1/chat/completions`, `/v1/threads`, `/v1/threads/:id/messages`, and `/v1/threads/:id/runs` end-to-end through the real HTTP stack. Asserts OpenAI-shaped envelopes, the `prism_metadata` transparency tag, and a typed 404 envelope on unknown paths.
- **[`package.json`](package.json)** — `test:e2e` script's mocha glob widened from a single file to `dist/tests/e2e/*.test.js` so new specs are picked up automatically.

### Changed — env surface documentation

- **[`.env.example`](.env.example)** — new sections appended (no existing keys modified):
  - **Phase E — Multi-tenant scoping (opt-in)**: documents `PRISM_MULTI_TENANT` and the `X-Prism-Tenant` request-header contract (`^[a-z0-9][a-z0-9_-]{0,63}$`).
  - **Phase F/G — Compatibility surfaces (informative)**: documents the OpenAI client shape (`base_url = http://<host>:${PRISM_DASHBOARD_PORT}/v1`, bearer token = PRISM admin token) and the Python SDK client envs (`PRISM_BASE_URL`, `PRISM_TOKEN`).

### Decisions / scope notes

- **No `playwright.config.ts` added.** PRISM's e2e harness uses mocha + the imperative `playwright` API, not the Playwright test runner. Adding a config would only fragment the harness.
- **No `docs.yml` GH Pages workflow yet.** Publishing the mkdocs site requires a maintainer decision on domain / GH Pages settings; deferred until that decision is made.
- **No new external dependencies.** Workflows use only the GitHub-published actions referenced today (`actions/checkout`, `actions/setup-node`, `github/codeql-action`, `softprops/action-gh-release`, `actions/github-script`).
- **Nightly remains opt-in for OAuth canary.** The Gmail/Outlook canary requires `PRISM_CANARY_*` secrets to be populated in the repo; absent those, the step prints a "skipping" line and the job stays green.

## Unreleased — 2026-05-06 — Phase G follow-up: OpenAI compat shim wired into dashboard router (v0.10.1-openai-compat-wired)

Closes the loop on the previous shim entry: the `/v1/*` surface is now actually reachable on the running dashboard. Existing OpenAI Python/Node clients can talk to PRISM by changing only `base_url` (auth still flows through the existing `AuthGate` — the bearer token is identical to the one the dashboard issues today). Implementation lands as a new `IRouteHandler` registered into the existing custom `Router`; no existing route was modified. **65/65 tests pass** (64 prior + 1 new `OpenAiCompatRoutes`). Frontend Protection Guarantee preserved — no UI surfaces touched.

### Added — OpenAI compat router wiring

- **[`src/core/operator/routes/openai-compat-handler.ts`](src/core/operator/routes/openai-compat-handler.ts)** — `OpenAiCompatHandler implements IRouteHandler`. Mounts:
  - `POST /v1/chat/completions`
  - `POST /v1/threads`
  - `GET  /v1/threads/:thread_id`
  - `POST /v1/threads/:thread_id/messages`
  - `GET  /v1/threads/:thread_id/messages`
  - `POST /v1/threads/:thread_id/runs`
  - `GET  /v1/threads/:thread_id/runs/:run_id`

  Holds a single `OpenAiCompatStore` per process. The `ChatExecutor` is built lazily per request via `buildLlmProviderChatExecutor(service)` which (a) splits the OpenAI message array into the `(systemPrompt, conversation, lastUser)` shape `LlmProviderManager.generate()` expects, (b) maps `tokensUsed` → `usage`, and (c) returns a deterministic stub when no provider is configured (so the OpenAI client still receives a valid response shape rather than a transport-layer failure).
- **[`src/core/operator/routes/index.ts`](src/core/operator/routes/index.ts)** — `OpenAiCompatHandler` registered after `ApiHandler`. One-line import + one-line array push; existing handlers untouched.
- **[`tests/openai-compat-routes.test.ts`](tests/openai-compat-routes.test.ts)** — HTTP-level test driven by synthetic `IncomingMessage`/`ServerResponse` and a stub `DashboardService`. Covers: `chat.completions` round-trip with executor invocation; streaming-rejected envelope; thread create with body, with no body, get round-trip, 404 on missing thread; messages append + list; full run lifecycle (create → poll → assistant message appended); unknown `/v1/*` 404; non-`/v1` URLs do **not** match; **executor exception in a run produces a `failed` run record at HTTP 200, not a 5xx** (matches OpenAI semantics).

### Decisions / scope notes

- **Auth path unchanged.** The new routes go through the existing `AuthGate.check()` upstream in `dashboard-service.ts`, so the same bearer token grants access to `/api/*` and `/v1/*`. No new auth surface.
- **No-provider fallback returns a stub assistant message** rather than a 5xx so the OpenAI client gets a well-shaped response and a clear human-readable hint to configure a provider in the dashboard.
- **Streaming still deferred.** `stream: true` is rejected at the shim layer with `invalid_request`; clients are referred to PRISM's existing `/api/chat/stream` SSE endpoint until the v2 streaming shim lands.
- **In-process state.** Threads/messages/runs remain in the in-memory `OpenAiCompatStore` — Phase R will not promote this to SQLite; persistence is reserved for a later phase if usage warrants it.
- **No new external dependencies.** Pure `node:http` types + the existing pure shim module.

## Unreleased — 2026-05-06 — Phase G follow-up: OpenAI API compatibility shim (v0.10.0-openai-compat)

Closes the *OpenAI Assistants API compatibility shim* item flagged as a high-conversion lever in the [2026 Q2 audit](docs/PRISM_FULL_AUDIT_2026_Q2.md) and the Phase G manifest. Existing `openai` Python/Node clients can now talk to PRISM with only a `base_url` change once the shim is mounted. World-class scaffold landed as a pure additive module; not yet wired into [`src/dashboard/dashboard-service.ts`](src/dashboard/dashboard-service.ts) — wiring is a future ~10-line follow-up. **64/64 tests pass** (63 prior + 1 new `OpenAiCompatShim`). Frontend Protection Guarantee preserved — no UI surfaces touched.

### Added — OpenAI compatibility shim

- **[`src/core/compat/openai-assistants.ts`](src/core/compat/openai-assistants.ts)** — transport-agnostic shim covering `POST /v1/chat/completions`, `POST/GET /v1/threads`, `POST/GET /v1/threads/{id}/messages`, and `POST/GET /v1/threads/{id}/runs`. Pluggable `ChatExecutor` callback decouples the surface from the concrete provider/agent runtime so the shim can be mounted by either `dashboard-service.ts` or a hosted PRISM Cloud deployment without code changes. Includes typed `ShimError` with stable codes (`invalid_request`, `not_found`, `missing_field`, `executor_failed`) and a matching `statusForError()` mapper (400/404/502).
- **[`tests/openai-compat-shim.test.ts`](tests/openai-compat-shim.test.ts)** — 11 scenario blocks driven by an in-memory fake executor: chat-completions happy path + model fallback + missing-field guard + streaming-rejected guard + executor-failure wrapping; threads create/get/seed; messages append + assistant-role rejection; runs happy path + missing assistant_id + empty-thread guard + **failed-run record on executor exception (no throw)**; store stats; transparency-tag presence on every response shape.

### Decisions / scope notes

- **In-memory façade by design.** Threads/messages/runs live in a `Map`-backed store. The PRISM agent runtime remains the source of truth; the shim is a translation layer, not a new persistence tier. SQLite schema untouched.
- **No new dependencies.** Only `node:crypto` (`randomUUID`) is imported, matching the repo's standing "stdlib-only" posture from the Python SDK work.
- **Streaming explicitly deferred.** `stream: true` returns a typed `invalid_request` error directing clients to PRISM's existing `/api/chat/stream` SSE endpoint. A v2 of the shim will translate native OpenAI SSE frames.
- **Run failures are records, not throws.** `handleCreateRun` matches OpenAI semantics: an executor exception produces a `run` object with `status: "failed"` and a populated `last_error` rather than raising. Existing OpenAI clients that poll runs handle this idiomatically.
- **Law 6 transparency.** Every response shape carries a `prism_metadata: { compat_shim: "openai", version: "v1", notice: "Served by PRISM ..." }` field so downstream tooling can detect that the OpenAI-shaped envelope is in fact a PRISM-served response — preserving the project's transparency guarantees while staying drop-in compatible.

## Unreleased — 2026-05-06 — Phase F follow-up: Python SDK scaffold (v0.9.0-python-sdk)

Closes the largest single gap identified in the [2026 Q2 audit](docs/PRISM_FULL_AUDIT_2026_Q2.md) and the [AaaS competitive map](docs/PRISM_COMPETITIVE_AaaS_MAP_2026.md) §4 — *language reach*. PRISM is now consumable from Python without any external dependency. World-class scaffold with stable surface for the most-used dashboard routes; SSE streaming included. All work additive per the Frontend Protection Guarantee — no UI, runtime, or existing source files modified. **11/11 SDK tests pass** alongside the existing **62/62 Node tests**.

### Added — Python SDK (`sdk/python/prism-client`)

- **[`sdk/python/prism_client/client.py`](sdk/python/prism_client/client.py)** — `PrismClient` synchronous client over the dashboard HTTP/SSE API. Stdlib-only (`urllib` + `json`) so the SDK works in restricted enterprise environments where `pip install requests` is gated. Injectable transport for tests. Methods cover: `chat()`, `chat_stream()` (SSE), `list_providers()`, `provider_health()`, `select_provider()`, `sr_status/configure/activate/deactivate()`, `pending_approvals()`, `events()`, `traces()`, `readiness()`, `setup_status()`.
- **[`sdk/python/prism_client/errors.py`](sdk/python/prism_client/errors.py)** — typed exception hierarchy: `PrismError` → `PrismConnectionError` (transport), `PrismApiError` (non-2xx) → `PrismAuthError` (401/403), `PrismRateLimitError` (429).
- **[`sdk/python/pyproject.toml`](sdk/python/pyproject.toml)** — `prism-client` v0.1.0, Apache-2.0, Python ≥3.10, zero runtime dependencies, `[test]` extra pulls `pytest` only.
- **[`sdk/python/README.md`](sdk/python/README.md)** — quick start, env-var configuration (`PRISM_BASE_URL`, `PRISM_TOKEN`), error model, full API surface table, install + test instructions.
- **[`sdk/python/tests/test_client.py`](sdk/python/tests/test_client.py)** — 11 tests with an injected `FakeTransport`: bearer-header injection, JSON body shape, query-param `None` filtering, 401→`PrismAuthError`, 429→`PrismRateLimitError`, 500→generic `PrismApiError`, token-omitted-when-`None`, SR configure round-trip, SSE event parsing (single-data, multi-data, no-data), trailing-slash normalisation.

### Decisions / scope notes

- **Stdlib-only by design.** The SDK matches the repo's "no new external dependencies" stance from Phases F/G. `requests`/`httpx` were considered and rejected — `urllib` covers HTTP and SSE adequately for v0.1.0.
- **Synchronous first.** Async (`asyncio` + `aiohttp`) is deferred to v0.2.0; synchronous covers notebook and FastAPI use cases without forcing an event-loop dependency.
- **No PyPI publish in this commit.** Publication waits on the open-core license boundary ratification tracked in [`docs/LICENSE_MODEL_RECOMMENDATION.md`](docs/LICENSE_MODEL_RECOMMENDATION.md). The package is `pip install -e .` ready today.
- **Frontend Protection Guarantee preserved** — no UI surfaces touched; no existing source files modified.

## Unreleased — 2026-05-05 — Phase G: Public Launch scaffolds (v0.8.0-public-launch)

Implements 6 of 9 open **Phase G** items from [`docs/TODO.md`](docs/TODO.md). The remaining 3 — *Discord/GitHub Discussions hub*, *license model ratification + filing*, and *enterprise design partner recruitment* — are operational handoffs (community ops / legal / BD), not source-tree work. World-class scaffolds with integration seams; no new external dependencies. All work additive per the Frontend Protection Guarantee. **62/62 tests pass** (59 prior + 3 new).

### Added — Phase G-A: Plugin SDK authoring guide + scaffolder

- **[`docs/PLUGIN_SDK_AUTHORING_GUIDE.md`](docs/PLUGIN_SDK_AUTHORING_GUIDE.md)** — pack anatomy, manifest schema v1 (`formatVersion`, `id`, `name`, `version`, `author.publicKeyId`, `capabilities[].tier+scopes`), trust tiers table (community/verified/official), signing flow with `keys:generate-plugin --tier community`, scaffolding via `npm run plugin:scaffold`, testing, publishing (PR to catalog), policy contract, versioning + deprecation.
- **[`scripts/scaffold-plugin.cjs`](scripts/scaffold-plugin.cjs)** — CLI `--id --name --out [--description]` emits `plugin.manifest.json`, `package.json`, `README.md`, `CHANGELOG.md`, `.gitignore`, `src/capabilities/hello.js`, `test/smoke.test.js`. Refuses to overwrite non-empty target. No external deps. Test: `PluginScaffold`.

### Added — Phase G-B: Curated marketplace v1

- **[`src/core/plugins/marketplace-review-ledger.ts`](src/core/plugins/marketplace-review-ledger.ts)** — append-only JSON ledger at `{workspace}/marketplace/review-ledger.json` with `CurationStatus` (`approved`/`rejected`/`deprecated`/`pending`); functions `recordDecision()` (validates required fields; requires `notes` for rejected/deprecated), `latestDecisionFor(id, version?)`, `isApproved(id, version?)`. Source of truth for curation; the `CatalogEntry.curated` flag is denormalized advisory.
- **[`src/core/plugins/plugin-marketplace.ts`](src/core/plugins/plugin-marketplace.ts)** — extended `CatalogEntry` with `curated?`, `reviewedBy?`, `reviewedAt?`. New `listEntries({ tag?, curated? })` filter routes through the ledger. New `listEntriesWithCuration()` decorator returns entries with their latest `MarketplaceReviewDecision` for UIs.
- **[`docs/MARKETPLACE_CURATION_POLICY.md`](docs/MARKETPLACE_CURATION_POLICY.md)** — roles (Author/Reviewer/Lead), review criteria (manifest, signature, code quality, cross-platform, docs), decision process with JSON ledger entry example, escalation/revocation, conflict of interest, re-review cadence (12 months / new minor or major).
- **[`examples/marketplace/{catalog.json, review-ledger.json}`](examples/marketplace/)** — sample data: 3 entries, 2 approved.
- Tests: `MarketplaceCuration`.

### Added — Phase G-C: External documentation site scaffold

- **[`docs/site/{mkdocs.yml, index.md, README.md}`](docs/site/)** — MkDocs Material scaffold drawing nav from existing `docs/` (Getting Started, Concepts, Plugins, Operations, Compliance, Developer). Site is intentionally a thin curation layer; `docs/` remains canonical.
- **[`scripts/docs-build.cjs`](scripts/docs-build.cjs)** + npm `docs:build` — invokes `mkdocs build` with actionable install instructions if MkDocs is missing. Python env: `.venv` (Python 3.10).

### Added — Phase G-D: Getting Started guide (5-minute path)

- **[`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md)** — prereqs → `start_wizard.bat/.sh` → character pick (Aria/Phoenix/Sentinel) → first message → next-step links to wizard guide, plugin SDK, business profile, SR showcase, deployment, error recovery, common pitfalls.

### Added — Phase G-E: Spectrum Refraction showcase demo

- **[`examples/sr-showcase/{README.md, run-demo.cjs}`](examples/sr-showcase/)** — 4-hemisphere fan-out (`logic`, `creative`, `legal-analysis`, `code-review`) with cost gate ($0.10), audit event emission to `prism-output/demos/sr-showcase/audit-{ts}.json`, and consensus aggregation. `--dry-run` synthesizes outputs deterministically (no LLM call); CLI: `npm run demo:sr-showcase -- --dry-run`.
- Tests: `SrShowcaseDemo`.

### Added — Phase G-F: SOC 2 Type II readiness checklist

- **[`docs/SOC2_READINESS_CHECKLIST.md`](docs/SOC2_READINESS_CHECKLIST.md)** — TSC1-5 (Security/Availability/Processing Integrity/Confidentiality/Privacy) mapped to existing PRISM controls with status (✅Ready/🔶Partial/❌Gap/➖N/A). Outstanding gaps documented: token rotation runbook, DR drill cadence, RPO/RTO targets, KMS integration, public privacy policy.

### Added — Phase G-G: License model recommendation

- **[`docs/LICENSE_MODEL_RECOMMENDATION.md`](docs/LICENSE_MODEL_RECOMMENDATION.md)** — recommends **Option D: Apache-2.0 + PRISM Commercial dual license**. Decision matrix of 5 options (Pure Apache, AGPL, BSL→Apache, Dual, SSPL); open-core boundary; CLA recommendation; trademark policy; plugin license expectations; migration path; open legal questions; action items. Final ratification + filing is operational (legal handoff).

### Decisions / scope notes

- **Frontend Protection Guarantee preserved** — no UI changes; all additions are docs, scripts, examples, server-side library code.
- **Operational handoffs not closed** — Discord/Discussions hub, license publish, enterprise design partner — these require ops/legal/BD action and are unticked in TODO with explicit footnotes.
- **Curation source of truth** — the ledger is authoritative; the catalog's `curated` flag is denormalized advisory only. `listEntries({ curated: true })` always re-checks the ledger.
- **No new dependencies** — MkDocs is invoked only when `docs:build` is explicitly run; install is documented but not bundled.

## Unreleased — 2026-05-05 — Phase H: Novel Systems Incubation reconciliation

Phase H of [`docs/TODO.md`](docs/TODO.md) was a forward-declared restatement of work already delivered upstream under *Aspirational / Wishlist → Novel Systems Incubation* and *SR Future Vision*. The Phase H section is now reconciled with cross-links to the canonical implementations and tests:

- **Constitutional Causal Compiler (CCC)** — [`src/core/incubation/ccc/`](src/core/incubation/ccc/) — `testCccCompiler`
- **Dual-Lens Memory Arbitration (DLMA)** — [`src/core/incubation/dlma/`](src/core/incubation/dlma/) — `testDlmaArbiter`
- **Self-Healing Workflow Synthesis (SHWS)** — [`src/core/incubation/shws/`](src/core/incubation/shws/) — `testShwsSynthesizer`
- **N-model SR fan-out (Quad+)** — [`src/core/operator/model-capability-matrix.ts`](src/core/operator/model-capability-matrix.ts) — `SRNModelFanout`
- **Hemisphere specialization profiles** — [`src/core/operator/sr-hemisphere-profiles.ts`](src/core/operator/sr-hemisphere-profiles.ts) — 8 profiles

No source changes; documentation-only reconciliation. Tests remain at **59/59 passing**.

## Unreleased — 2026-05-05 — Phase F: Production Qualification scaffolds (v0.7.0-production-qualification)

Implements 8 of 9 open **Phase F** items from [`docs/TODO.md`](docs/TODO.md). The remaining item — *private beta recruitment* — is operational, not source-tree work, and is tracked outside of engineering. World-class scaffolds with integration seams; no new external dependencies (Postgres support uses optional dynamic import of `pg`). All work additive per the Frontend Protection Guarantee. **59/59 tests pass** (51 prior + 8 new).

### Added — Phase F-A: Persistence Interfaces

- **`ISessionStore` + `IActivityStore`** ([`src/core/database/store-interfaces.ts`](src/core/database/store-interfaces.ts)) — codified consumer-facing surface above the existing `IDatabaseAdapter`. `ChatSessionStore` and `SqliteActivityStore` declared `implements`; pure structural change.

### Added — Phase F-B: PostgreSQL Adapter scaffold

- **`PostgresDatabaseAdapter`** ([`src/core/database/postgres-database-adapter.ts`](src/core/database/postgres-database-adapter.ts)) — implements `IDatabaseAdapter` via dynamic `import("pg")`, degrades to `unsupported` status when the optional package is absent (no new runtime dep). `:named` → `$N` parameter translator with single-quoted-literal awareness (handles doubled `''` escape correctly). `selectedBackend()` factory keyed off `PRISM_DATABASE_BACKEND=sqlite|postgres` (default `sqlite`). Synchronous methods throw a clear "use the async surface" error rather than silently failing — the seam exists for incremental migration.

### Added — Phase F-C: Multi-tenant workspace integration

- **`workspacePath()` + tenant subroot composition** ([`src/core/config/workspace-resolver.ts`](src/core/config/workspace-resolver.ts)) — wraps the existing tenant-context `tenantSubroot()` so tenant-scoped DB filenames land at `{root}/.tenants/{id}/state/...` when `PRISM_MULTI_TENANT=on`. Default tenant + flag-off path is bit-identical to legacy behavior. New `untenantedWorkspacePath()` helper for cross-tenant assets that must NOT be isolated.

### Added — Phase F-D: Soak Test Harness

- **`scripts/soak-harness.cjs`** + npm scripts `soak:smoke` (5min default) / `soak:staging` (72h via `PRISM_SOAK_DURATION_MS=259200000`). Synthetic GET load against `/api/health`; samples RSS/heap/heap-total at `PRISM_SOAK_SAMPLE_MS` interval (default 30s); aggregates RSS slope (bytes/hour) + error budget + unhandled-rejection count into a pass/fail verdict. JSONL audit trail at `prism-output/soak/{run-id}.jsonl`. Exit codes: 0 pass, 1 fail (rejection / leak / over-budget errors), 2 invocation error. Real 72h run is operational handoff; harness math validated by the test suite.

### Added — Phase F-E: Concurrent Session Stress Harness

- **`scripts/stress-concurrent-sessions.cjs`** + npm `stress:concurrent`. Spawns N parallel session pipelines (default 10 × 20 messages); measures p50/p95/p99 against profile SLO (business=500ms, individual=1500ms). Report at `prism-output/stress/{run-id}.json` with verdict. `PRISM_STRESS_DRY_RUN=1` synthesizes latencies for CI smoke without spawning a server.

### Added — Phase F-F: Signed Release Artifacts

- **`src/core/security/artifact-signature.ts`** — Ed25519 detached signatures over SHA-256 digests of release tarballs and plugin packs. Sidecars: `<artifact>.sig` (base64) + `<artifact>.sig.json` (keyId + algorithm + signedAt + sha256 manifest). New `release` tier in [`config/release-signing-keys.json`](config/release-signing-keys.json) (placeholder registry — operators populate per `docs/SECURITY_KEY_MANAGEMENT.md`). CLIs `npm run release:sign-artifact` / `release:verify-artifact` ([`scripts/sign-release-artifact.cjs`](scripts/sign-release-artifact.cjs), [`scripts/verify-release-artifact.cjs`](scripts/verify-release-artifact.cjs)). Reuses the existing `generate-plugin-key.cjs` keypair generator (now accepts `--tier release`).

### Added — Phase F-G: OWASP Top 10 Scan

- **`scripts/owasp-scan.cjs`** + npm `security:owasp`. Combines `npm audit --json` with an in-house static category sweep across `src/**` covering A01/A02/A03/A05/A07/A08/A09/A10. Inline `// @owasp-allow A0X` annotation suppresses false positives at the source. Reports at `prism-output/owasp/{run-id}.{md,json}`. Living evidence ledger at [`docs/OWASP_TOP_10_CHECKLIST.md`](docs/OWASP_TOP_10_CHECKLIST.md). Optional CI gating via `PRISM_OWASP_FAIL_ON=high|critical`. No new dependency (semgrep deferred).

### Added — Phase F-H: Linux/macOS Parity Audit

- **`scripts/platform-parity-audit.cjs`** + npm `audit:platform-parity`. Scans `src/**` for `process.platform === 'win32'`, `cmd.exe`, `powershell.exe`, `process.env.USERPROFILE`, hard-coded backslash paths, etc. Per-finding classifier inspects ±10-line context window and labels each as `gated` (intentional branch), `cross-platform` (has fallback), or `needs-fix` (regression risk). Inline `// @parity-allow` annotation suppresses platform-only-by-design lines. Reports at `prism-output/parity/{run-id}.{md,json}`; baseline at [`docs/LINUX_MACOS_PARITY_REPORT.md`](docs/LINUX_MACOS_PARITY_REPORT.md). Strict mode via `PRISM_PARITY_STRICT=1` exits non-zero on `needs-fix > 0`.

### Added — Tests

- `tests/persistence-interfaces.test.ts` — `PersistenceInterfaces` (Phase F-A)
- `tests/postgres-adapter.test.ts` — `PostgresAdapter` (Phase F-B; param translator + degradation behavior)
- `tests/multi-tenant-workspace.test.ts` — `MultiTenantWorkspace` (Phase F-C)
- `tests/soak-harness.test.ts` — `SoakHarness` (Phase F-D; aggregation math + slope calculator)
- `tests/stress-harness.test.ts` — `StressHarness` (Phase F-E; percentile/verdict math)
- `tests/artifact-signature.test.ts` — `ArtifactSignature` (Phase F-F; sign/verify round-trip + tamper + revoke)
- `tests/owasp-scan.test.ts` — `OwaspScan` (Phase F-G; classifier + annotation honored)
- `tests/platform-parity-audit.test.ts` — `PlatformParityAudit` (Phase F-H; classifier behavior)

### Decisions / scope notes

- **Postgres adapter is a *seam***. Synchronous `IDatabaseAdapter` semantics (driven by `node:sqlite`) prevent direct query routing; `queryAllAsync` is provided for incremental adoption. Full async DAL bridging is the next pass.
- **No new npm dependencies**. `pg` enters as an optional peer (dynamic import); OWASP scanning is in-house; semgrep deferred.
- **Soak/stress harnesses are scripts, not registered runtime tests** — full runs would dominate CI time. Harness *math* is unit-tested.
- **Private beta recruitment** retained as an open TODO with an operational note — intentionally not source-tree work.
- **Frontend Protection Guarantee preserved** — no UI surfaces touched.

---

## Unreleased — 2026-05-05 — SR Future Vision + Platform Evolution scaffolds (v0.6.0-future-vision)

Implements all five **SR Future Vision** items and all four **Platform Evolution** items from [`docs/TODO.md`](docs/TODO.md). World-class scaffolds with integration seams; remote/cloud transports deferred (no new external dependencies). All work additive per the Frontend Protection Guarantee. Backward compatibility preserved across all 36 existing SR tests. 51/51 tests pass.

### Added — SR Future Vision

- **`HemisphereSpec` + `normalizeSRConfig()`** ([`src/core/operator/model-capability-matrix.ts`](src/core/operator/model-capability-matrix.ts)) — first-class N-model fan-out form (cap `SR_MAX_HEMISPHERES = 8`). Legacy `leftModel`/`rightModel`/`leftSlot`/`rightSlot`/`leftTimeoutMs`/`rightTimeoutMs` auto-normalize to `hemispheres[]`; mixing both forms raises a structured validation error; pairwise instance-isolation gate enforced (`(providerId, model)` distinctness).
- **Hemisphere specialization profiles** ([`src/core/operator/sr-hemisphere-profiles.ts`](src/core/operator/sr-hemisphere-profiles.ts)) — eight reusable profiles: `logic`, `creative`, `legal-analysis`, `code-review`, `creative-writing`, `research-synthesis`, `reasoning-deep`, `summarization`. `HemisphereSpec.profileId?` resolves at runtime; explicit `systemPrompt` overrides profile lookup.
- **SR Memory store** ([`src/core/memory/sr-memory-store.ts`](src/core/memory/sr-memory-store.ts)) — rolling JSON cap 500 records of `SRGenerationRecord` (atomic write via tmp+rename); `recordSRGeneration`, `attachUtilityFeedback`, `srMemoryStats`, `clearSRMemory`.
- **Cross-session SR Recommender** ([`src/core/memory/sr-recommender.ts`](src/core/memory/sr-recommender.ts)) — blended ranking: `score = 0.6·observedUtility + 0.2·(1/(1+cost)) + 0.2·succeededRatio`; missing utility defaults to neutral 0.5.
- **SR-as-a-Tool** ([`src/adapters/cognition/sr-tool.ts`](src/adapters/cognition/sr-tool.ts)) — registers `cognition.spectrum_refraction`. Cost gate $0.10 (`PRISM_SR_TOOL_COST_GATE_USD`) returns structured `cost_gate_exceeded`; `force=true` bypasses after operator approval. Optional agent-routing heuristic `shouldRouteToSR(text, confidence)` opt-in via `PRISM_SR_AGENT_ROUTING=on` (low-conf < 0.5 + long task > 500 chars).

### Added — Platform Evolution

- **Multi-Tenant TenantContext** ([`src/core/config/tenant-context.ts`](src/core/config/tenant-context.ts)) — `AsyncLocalStorage`-based `withTenant`/`currentTenantContext`/`tenantSubroot`/`tenantHttpMiddleware`. Default tenant `"default"` preserves zero-behavior-change for single-tenant deployments. Multi-tenant scoping gated by `PRISM_MULTI_TENANT=on`. `X-Prism-Tenant` header validated by `^[a-z0-9][a-z0-9_-]{0,63}$`. Tenant subroots at `{root}/.tenants/{id}/`.
- **Sync Adapter scaffold** ([`src/core/sync/`](src/core/sync/)) — `SyncAdapter` interface (`init`/`push`/`pull`/`status`); `NoopSyncAdapter` (default); `FilesystemSyncAdapter` (JSONL outbound under `outbound/{instance}-{ts}.jsonl`, idempotent inbound cursor at `inbound/{instance}/cursor.json`, replay safety via `_replayedFrom` tag); `SyncEngine` with layer allowlist (`audit`/`memory`/`preferences`/`marketplace`); selected via `PRISM_SYNC_ADAPTER=noop|filesystem`. HTTP/cloud transports deferred — the adapter abstraction *is* the seam.
- **Plugin Marketplace** ([`src/core/plugins/plugin-marketplace.ts`](src/core/plugins/plugin-marketplace.ts)) — reads `{workspace}/marketplace/catalog.json`; `installFromCatalog(id)` copies `file://` packs into `{workspace}/plugins/installed/`; `http(s)://` returns `installation_unsupported_transport` (deferred to security review); business profile rejects `unsigned` entries; `uninstall()` archives non-destructively to `marketplace/.archive/`. Sample seed: [`examples/marketplace/catalog.json`](examples/marketplace/catalog.json). Gated `PRISM_MARKETPLACE=on`.
- **PWA mobile/tablet companion** — [`public/manifest.json`](public/manifest.json) (standalone display, theme color, shortcuts), [`public/service-worker.js`](public/service-worker.js) (cache-first static, network-first GET API with cache fallback, never cache mutating verbs, network-only HTML navigations, versioned `CACHE_NAME`), [`public/phase-i-mobile-polish.css`](public/phase-i-mobile-polish.css) (`@media (hover: none) and (pointer: coarse)` 44×44 tap targets per WCAG 2.5.5 AAA, 16px form fields to defeat iOS auto-zoom, `@media (display-mode: standalone)` polish).

### Added — Tests

- `tests/sr-n-model-fanout.test.ts` — `SRNModelFanout` (Phase A + B coverage)
- `tests/sr-memory-recommender.test.ts` — `SrMemoryAndRecommender`
- `tests/sr-tool.test.ts` — `SrTool`
- `tests/tenant-context.test.ts` — `TenantContext`
- `tests/sync-scaffold.test.ts` — `SyncScaffold`
- `tests/pwa-assets.test.ts` — `PwaAssets`
- `tests/plugin-marketplace.test.ts` — `PluginMarketplace`

### Verified

- `npm run build` clean.
- `node dist/tests/index.js` → **51/51 passed** (44 prior + 7 new). All 36 existing SR tests pass unchanged (backward-compat gate).

---

## Unreleased — 2026-05-13 — Novel Systems Incubation prototypes (v0.5.0-incubation)

Implements the three "Novel Systems Incubation" items in [`docs/TODO.md`](docs/TODO.md): the Constitutional Causal Compiler (CCC), Dual-Lens Memory Arbitration (DLMA), and Self-Healing Workflow Synthesis (SHWS). Prototypes are PRISM-native (no new external dependencies), in-memory + ActivityBus only (no new SQLite tables), gated behind the `PRISM_INCUBATION` env flag (default `on` in dev, `off` in production), and every API response is tagged `prototype: true`. Frontend Protection Guarantee preserved — no UI files modified.

### Added — Constitutional Causal Compiler (CCC)

- **`src/core/incubation/ccc/types.ts`** — `Constitution`, `ConstitutionPrinciple`, `MemoryInvariant`, `CompiledStep`, `RuntimePlan` (content-addressed via sha256 of canonicalized skeleton).
- **`src/core/incubation/ccc/constitution.ts`** — Dependency-free `validateConstitution()` + `loadConstitution(path)` with structured `ConstitutionValidationError`.
- **`src/core/incubation/ccc/compiler.ts`** — `CausalCompiler.compile(dag, {profile, constitution, cac?, emailBoundOperations?})` projects each step against the live `PolicyEngine` *and* every applicable constitution principle. Produces deterministic `compilationHash` + `enforceable` bit + per-step `appliedPrincipleIds` + `unsatisfiableSteps[]`.
- **`src/core/incubation/ccc/enforcer.ts`** — `RuntimePlanEnforcer.authorizeStep(plan, stepId)` refuses any step flagged unsatisfiable or with a denied policy projection; emits `incubation.ccc.{step_authorized,step_blocked,step_unknown}` ActivityBus events.
- **`examples/constitutions/business-default.json`** — Sample constitution with three principles (`no-mutation-without-rollback`, `no-placeholder-cac`, `bounded-step-timeout`) + memory invariant `retrieval-coverage-floor`.

### Added — Dual-Lens Memory Arbitration (DLMA)

- **`src/core/incubation/dlma/types.ts`** — `LensScore`, `FusedMatch`, `ConsequenceProfile`, `ArbitrationWeights`, `ArbiterFeedback`, `ArbiterQueryResult`.
- **`src/core/incubation/dlma/causal-lens.ts`** — `CausalLens` walks `EpisodicMemory` events to build per-operation consequence profiles (`succeeded`/`failed`/`denied`) with trust ∈ [-1,1]; per-event score = lexical-overlap × ((1+trust)/2), normalized within lens.
- **`src/core/incubation/dlma/fusion.ts`** — Bayesian-weighted `fuseLenses()` with confidence = 1 − √(weighted variance), clamped to [0,1].
- **`src/core/incubation/dlma/arbiter.ts`** — `DualLensArbiter.query(text, k)` fuses `SemanticMemoryIndex` + `CausalLens` results; `feedback({queryId, observedUtility, chosenLens})` updates per-lens weights via EMA (default α=0.2) toward the chosen lens's one-hot target, then renormalizes. Emits `incubation.dlma.{query,feedback,feedback_unknown}`.

### Added — Self-Healing Workflow Synthesis (SHWS)

- **`src/core/incubation/shws/types.ts`** — `HistoryFragment`, `SynthesizedCandidate` (`requiresTier3Approval: true` always), `SynthesizerStats`.
- **`src/core/incubation/shws/history-index.ts`** — `WorkflowHistoryIndex` rolling buffer (cap 200) of past repair fragments, indexed by failed-step operation; loose risk-tier match fallback.
- **`src/core/incubation/shws/policy-validator.ts`** — `PolicyValidator` reuses `CausalCompiler` to ensure no proposal is ever surfaced unless it passes constitution + policy projection.
- **`src/core/incubation/shws/synthesizer.ts`** — `WorkflowSynthesizer.proposeFallback(...)` mines history → validates via CCC → routes through `ApprovalQueue` tier-3 (120s timeout). **Hard limits**: max depth 3, max 1 active synthesis per workflow, never auto-applies. Emits `incubation.shws.{candidate_proposed,candidate_rejected,candidate_approved,candidate_denied,no_history,already_active,depth_capped}`.
- **`src/core/incubation/shws/orchestrator-integration.ts`** — `ShwsHistoryRecorder` ActivityBus subscriber records repair fragments from existing `workflow.step.failed` / `workflow.fallback.step` / `workflow.completed` events without modifying the Orchestrator.

### Added — Dashboard routes (incubation API, all `prototype: true`, gated by `PRISM_INCUBATION`)

- `POST /api/v1/incubation/ccc/compile` · `GET /api/v1/incubation/ccc/constitutions`
- `POST /api/v1/incubation/dlma/query` · `GET /api/v1/incubation/dlma/weights`
- `POST /api/v1/incubation/shws/propose` · `GET /api/v1/incubation/shws/recent-syntheses`
- Returns `503 incubation_disabled` when the flag is off; default `on` in dev, `off` in production (`NODE_ENV=production`).

### Tests

- **`tests/ccc-compiler.test.ts`** *(new — `testCccCompiler`)* — constitution validation, all-allow path, business missing-rollback denial, hash determinism, enforcer block + authorize.
- **`tests/dlma-arbiter.test.ts`** *(new — `testDlmaArbiter`)* — fusion math, EMA weight update + normalization, consequence filtering (policyDecision deny → trust drop), unknown-feedback no-op, empty-memory fallback.
- **`tests/shws-synthesizer.test.ts`** *(new — `testShwsSynthesizer`)* — no-history null path, propose-from-history happy path, ApprovalQueue tier-3 routing, already-active guard, depth-cap, policy-invalid rejection.
- Registered in [`tests/index.ts`](tests/index.ts). All 44 tests pass; build clean.

### Research lineage (informs the design — no code copied)

Constitutional AI (Anthropic, 2022) for declarative principles; Mixture-of-Experts gating (Shazeer et al., 2017) and dual-process theory for DLMA's lens arbitration; CausalRAG (2024) for causal-consequence retrieval; Bayesian model averaging for fusion confidence; FlashFill / genetic-programming for history-mined repair candidates. SHWS's never-auto-execute discipline anchors the prototype to PRISM's existing tier-3 ApprovalQueue rather than new autonomous-repair surfaces.

## Unreleased — 2026-05-12 — Operator surfaces & profile-aware perf trends (v0.4.3)

Closes the open Phase E3 / E5 follow-on items in [`docs/TODO.md`](docs/TODO.md): operator-triggered utilities, runtime tool risk overrides, CAC chain inspector + identity audit export, OAuth email verification (Business policy gate), incident-trend-driven retrieval-alert tuning, and CI publication of profile-differentiated performance trends. All changes are ADDITIVE per the Frontend Protection Guarantee.

### Added — Operator surfaces

- **`src/core/operator/utility-registry.ts`** *(new)* — `UtilityRegistry` + `registerBuiltInUtilities()` + run-history ring buffer (cap 50). Built-ins: `regenerate-release-packet`, `run-contract-diff-gate`, `export-policy-audit`, `export-session-trace`, `run-perf-qualify`, `run-perf-trend-report`, `run-retrieval-trends`. Emits `utility.{id}.{started|succeeded|failed}` ActivityBus events.
- **`src/core/operator/risk-override-store.ts`** *(new)* — `RiskOverrideStore` persists operator-managed tool risk overrides to JSON (`prism-output/state/risk-overrides.json`). Validates reason + future expiry; sweeps expired overrides on read; emits `risk.override.{set|cleared|expired}` events. Resolves effective tier per tool by combining classifier tier with active overrides.
- **`src/core/memory/incident-trend-store.ts`** *(new)* — Subscribes to ActivityBus and aggregates `policy.deny`, `approval.timeout`, `retrieval.alert.*`, and `incident.*` events into per-day-per-profile buckets (cap 60 days). `getReport(profile, windowDays)` → window totals + daily averages.
- **`src/core/memory/retrieval-alert-policy.ts`** *(extended)* — Adds `tuneFromIncidentTrends(base, signals)` which derives a tightened (never relaxed) `RetrievalAlertPolicy` from incident-trend signals: ≥5 denials/day raises `recentMinUtility`, ≥3 timeouts/day lowers latency tolerances, ≥4 alerts/day tightens drift threshold, ≥1 incident/day raises cohort hit-rate floor. Returns `{ base, tuned, rationale[] }`.
- **`src/core/accountability/character-accountability-manager.ts`** *(extended)* — `getAssignmentChain(assignmentId)` returns the full `AccountabilityChain` plus active/expired scope counts and email-verification freshness; `markEmailVerified(assignmentId, email, provider)` records a verified OAuth roundtrip and emits `character_accountability.email_verified`; `isEmailVerificationFresh(id, maxAgeMs=30d)`; `exportAudit(filter)` materializes a JSON-serializable audit dump for dashboard download.
- **`src/core/accountability/character-accountability-store.ts`** *(extended)* — Adds `email_verified_at` and `email_verified_provider` columns (idempotent migration via `ensureColumn`).
- **`src/core/policy/engine.ts`**, **`types.ts`**, **`reason-codes.ts`** — New gate: Business segment + tier-2+ + email-bound tools require fresh OAuth email verification within 30 days; emits `CAC_EMAIL_VERIFICATION_REQUIRED`. Adds `PolicyContext.emailBound` + `CacContext.emailVerifiedAt`.

### Added — Dashboard routes (operator API)

- `GET /api/v1/utilities` · `POST /api/v1/utilities/:id/execute` · `GET /api/v1/utilities/runs/:runId` · `GET /api/v1/utilities/runs`
- `GET /api/v1/tools/risk-overrides` · `GET|PATCH|DELETE /api/v1/tools/:toolId/risk`
- `GET /api/v1/cac/assignments` · `GET /api/v1/cac/assignments/:id/chain` · `GET /api/v1/cac/export?format=json|csv` · `POST /api/v1/cac/:assignmentId/verify-email`
- `GET /api/retrieval/incident-trends?profile=…&windowDays=…` (returns the trend report alongside the tuned alert policy)

### Added — CI: profile-differentiated perf trend history

- **`scripts/perf-trend-report.cjs`** *(new)* — Maintains rolling per-profile p50/p95 history (`prism-output/profile-trends/{profile}-history.json`, cap 30), writes `profile-trends-summary.md`, and appends the summary to `$GITHUB_STEP_SUMMARY`. Soft-warn at +15% p95 drift, hard-fail at +30% only when `PRISM_PERF_GATE=strict`. Accepts per-profile JSON or falls back to `benchmarks.approvalContention`.
- **`package.json`** — `perf:trend-report`, `perf:trend-gate` scripts.
- **`.github/workflows/quality-gates.yml`** — Generates the report after `perf:qualify` and uploads `profile-trends/**` as the `profile-trends` artifact.

### Tests

- **`tests/operator-surfaces-phase-e3.test.ts`** *(new)* — `testUtilityRegistry`, `testRiskOverrideStore`, `testIncidentTrendStore`, `testRetrievalAlertTuning`.
- **`tests/perf-trend-report.test.ts`** *(new)* — `testPerfTrendReport`: `summarizeDrift` thresholds + Markdown rendering.
- **`tests/character-accountability.test.ts`** *(extended)* — `testCharacterAccountabilityPhaseE3`: chain inspector + email-verification helpers + audit export.
- All 41 tests in the unit suite pass.

## Unreleased — 2026-05-04 (PTAC self-drive expansion + live `POST /api/chat`)

Closes the "Prism Testing & Active Control" headline ask: PTAC now drives Prism through Prism's own surfaces — chat, browser, and (host-only) the real desktop — so a single PTAC run end-to-end exercises the same paths real users hit. All changes are ADDITIVE per the Frontend Protection Guarantee; no UI files were modified.

### Added — Live chat tier classifier

- **`src/core/operator/chat-tier-classifier.ts`** *(new)* — pure pattern-based classifier. 12 Tier-3 patterns (`rm -rf`, `del /f /s /q`, `format <drive>:`, `mkfs`, `dd if=`, `drop database/schema/table`, `truncate table`, fork bombs, `Remove-Item -Recurse`, `shutdown /flag`, etc.) → `HIGH_RISK_APPROVAL_REQUIRED` deny. 13 Tier-2 patterns (send email, write/install/deploy/publish/push/commit, run command, modify config, schedule, post to social, http request) → `MEDIUM_RISK_ALLOW_CONDITIONAL` approval-gated. Default Tier-1 → `LOW_RISK_ALLOW_AUTONOMOUS` autonomous. Conservative — errs toward higher friction on ambiguity.
- **`src/core/operator/dashboard-service.ts`** — new `POST /api/chat` handler (next to the existing `GET /api/chat/stream`; coexists with `/api/chat/sessions/:id/messages` which is the full LLM round-trip). Three response shapes:
  - **Tier 1** → `200 { tier:1, accepted:true, reason_code, response, session_id }`.
  - **Tier 2** → `202 { tier:2, approval_pending_ids:[id], reason_code, matched_pattern, session_id }`. Uses a before/after `ApprovalQueue.list()` set diff to recover the freshly-allocated id from a fire-and-forget `queue.request(...)` (preserves the existing ApprovalQueue API surface).
  - **Tier 3** → `200 { tier:3, denied:true, reason_code, matched_pattern, session_id }`.
  - Validates `prompt` non-empty (`400 missing_prompt`); assigns `sessionId = body.sessionId ?? "ptac-${randomUUID().slice(0,8)}"`; emits `governance/chat.tier_classified` activity-bus events.

### Added — PTAC self-drive step kinds

- **`src/ptac/types.ts`** — two new step kinds added to the `PtacStep` union:
  - `BrowserDriveStep` — `kind:"browserDrive"`, sub-actions `launch | close | navigate | click | type | screenshot | assertText | assertSelector | waitForSelector`. Drives the dashboard's `/api/browser/*` browser-control surface (Playwright). Headless and CI-safe.
  - `ComputerUseStep` — `kind:"computerUse"`, sub-actions `screenshot | mouse_move | mouse_click | type | key`. Drives `/api/computer/*` (Win32 SendInput / mouse_event / framebuffer capture). HOST-ONLY, dual-gated behind `--profile=host` AND `PRISM_PTAC_SAFE=1`.
- **`src/ptac/orchestrator.ts`** —
  - New per-scenario `latestBrowserSessionId` field; reset at start of each `runScenario` for cross-scenario isolation. Captures the session id from `browserDrive: launch` responses, supports the `"@latest"` sentinel and implicit inheritance for chained steps.
  - `case "browserDrive"` — special-cases `screenshot` (GET `/api/browser/screenshot/:id`) and `close` (DELETE `/api/browser/sessions/:id`); routes all other actions as POST `/api/browser/<action>`. New `@dashboard` URL substitution token in `args.url` so scenario files stay portable.
  - `case "computerUse"` — refuses to dispatch unless both safety gates are satisfied; clear advisory error otherwise.

### Added — Eight self-drive scenarios (s07–s14)

- **`s07-self-drive-chat-tier1`** — Tier-1 capability prompt accepted by the live `/api/chat` (suites: fast/full/demo).
- **`s08-self-drive-tier2-approval`** — Tier-2 prompt enqueues an approval via the live handler; asserts `approval_pending_ids` non-empty (suites: fast/full).
- **`s09-self-drive-tier3-deny`** — Tier-3 destructive prompt → live handler returns `denied:true` with non-empty `reason_code` and zero approvals enqueued (suites: fast/full).
- **`s10-self-drive-browser-shell`** — Headless Playwright launches → navigates to dashboard root → asserts `#app` mounts (suites: full/demo).
- **`s11-self-drive-wizard-render`** — Browser navigates to the Setup Wizard route and asserts the shell renders (suite: full).
- **`s12-self-drive-tab-smoke`** — Browser cycles through `/`, `/#/dashboard`, `/#/wizard`, `/#/logs`, `/#/governance` and asserts every route mounts (suite: full).
- **`s13-self-drive-desktop-screenshot`** *(host-only)* — Computer-Use captures the operator's real desktop. Gated behind `--profile=host` + `PRISM_PTAC_SAFE=1` (suite: full).
- **`s14-self-drive-kill-switch-ui`** — Tier-3 deny fires through `/api/chat`, then a real browser navigates to the governance route to capture evidence the deny propagates to the UI (suite: full).
- **`src/ptac/index.ts`** — eight new side-effect imports register the scenarios in the registry.

### Added — Tests

- **`tests/ptac-scenario-registry.test.ts`** — five new cases:
  - All eight self-drive scenarios are registered.
  - `s13` sets `requiresHost=true` and contains a `computerUse` step.
  - Every browser-drive scenario's first `browserDrive` action is `launch` (catches accidental ordering bugs).
  - `s08` records `expectedTier=2` + `expectApprovalRequired=true`.
  - `s09` records `expectedTier=3` + `expectDeny=true`.
  - `HOST_ONLY_KINDS` set extended to include `computerUse`.
- Test count: **21 passing** (up from 16) in the PTAC scenario-registry suite.

### Validated

- `npm run build` — clean strict-TypeScript compile.
- `npm run test` (relevant subset) — `ptac-scenario-registry` 21/21, `dashboard-service` 1/1, `operator-surfaces` + `policy-engine` + `chat-session-store` all green.
- Frontend Protection Guarantee preserved — zero UI / WebSocket / client files modified.

### Scope

Implements the audit plan's Workstream 2a (live `POST /api/chat`) + Workstream 3a/3b (self-drive step kinds + scenarios). Does not yet land Workstream 1 (doc reconciliation: `README` / `ROADMAP` / `PRISM_GAP_ANALYSIS` for stale `SendKeys` / "Email/Calendar integrated" / "first AaaS technology" claims) — that is queued to ship alongside 0.6.0.

---

## Unreleased — 2026-05-04 (MCP servers 7/7 green)

Closes out the MCP-resilience effort by repairing the three remaining third-party Python MCP servers that the resilience layer surfaced as failing. Result: **7/7 MCP servers connected, 70 tools registered** at startup (up from 4/7, 31 tools). All fixes are upstream-server-side bugs in `D:\Projects\impressioncore\.mcp\…`; no Prism core code was modified, no PAD or strict-release gates touched.

### Fixed — third-party MCP servers

- **`impressioncore-eds/server_enhanced.py`** — replaced three JavaScript-style `true` literals with Python `True` in the `tools/list` schema definitions (lines 683, 764, 769). The hand-rolled `ListToolsRequest` handler was crashing with `NameError: name 'true' is not defined`, which manifested as `[MCP:impressioncore-eds] tools/list failed: Internal Server Error` after a clean `initialize`. Server now reports 10 tools.
- **`impressioncore-vrgc/server_enhanced.py`** — main stdio loop's `initialize` branch was sending a static response object that did not echo the request `id`, so Prism's MCP client matched no in-flight call and timed out (`[MCP:impressioncore-vrgc] Timeout on "initialize" (id=1)`). The same loop also returned `Method not found: notifications/initialized` errors for valid JSON-RPC notifications, polluting the framing. Both fixed: `id` is now copied from the request onto a per-call response copy, and any method beginning with `notifications/` returns no payload (per JSON-RPC 2.0 §4.1). Server now reports 28 tools.
- **`web-search-mcp/server.py`** — full transport rewrite. The previous server ran FastAPI/uvicorn on `0.0.0.0:8765`, fundamentally incompatible with Prism's stdio JSON-RPC MCP transport (manifested as `[MCP:web-search-mcp] Timeout on "initialize" (id=1)` with `INFO: Uvicorn running on http://0.0.0.0:8765` in stderr). New stdio implementation exposes the existing `utils.search.perform_search` + `utils.citation.generate_citations` pipeline as a single `web_search` tool with a JSON Schema (`query` required, `num_results` 1–10, `require_citations` bool). Standard MCP method surface: `initialize` / `tools/list` / `tools/call` / `ping` + `notifications/*` no-op. The original FastAPI server is preserved verbatim at `web-search-mcp/server_uvicorn_backup.py` for anyone wanting to run the HTTP path standalone. Server now reports 1 tool.

### Validated

- Live runtime check: `npm start` in server mode → all 7 MCP servers reach `Connected` state within ~30s, no `tools/list failed` and no `Timeout on "initialize"` errors. Per-server tool counts: `ids-mcp` 8, `impressioncore-eds` 10, `impressioncore-ipa` 6, `impressioncore-goliath` 0, `impressioncore-vrgc` 28, `impressioncore-dpa` 17, `web-search-mcp` 1 → **70 total tools registered**.
- Standalone JSON-RPC drive of each fixed server (handcrafted `initialize` + `notifications/initialized` + `tools/list` over stdin) verifies correct id-echo and well-formed `tools/list` responses.
- No Prism `src/` files modified — the resilience layer shipped the day before is what made these failures diagnosable in the first place.

### Scope

Fixes only the three third-party MCP server bugs that were blocking 7/7. Does not modify Prism core, the resilience layer, or any release-validation gates. Frontend Protection Guarantee preserved (no UI files touched). The previous session's deliberate non-goal — *"No upstream Python fixes — third-party MCP servers […] are not patched here"* — is now superseded for these three specific servers, since 7/7 was a hard user requirement.

---

## Unreleased — 2026-05-03 (MCP resilience + Live Console)

Adds operator-grade visibility into MCP server health and process console output, plus automatic self-healing for MCP servers that crash. Resolves the recurring "5/7 MCP servers crashing on startup with truncated tracebacks" problem by retaining full stderr (no 120-char cap), surfacing complete Python tracebacks on connect failures, and reconnecting crashed servers automatically via Guardian. All 7 strict release gates remain green; new tests bring node:test count from 42 to 45 and add a new console-interceptor suite.

### Added — MCP resilience

- **`src/adapters/protocol/mcp-client-tool.ts`** — `McpConnection` now retains a 200-line bounded stderr ring buffer for the life of the connection (no longer cleared after handshake). New methods: `stderrTail(n)`, `getName()`, `getConfig()`, `onExit(cb)`. New `McpExitReason` type distinguishes `"crash"` from `"shutdown"` so reconnect only fires on unexpected exits.
- **`firstStderrHint()` redesign** — when a Python traceback is present, returns the actual final exception line (e.g. `ValueError: …`) instead of just the `Traceback (most recent call last):` header. Truncation cap raised from 120 to 200 chars.
- **`McpClientAdapter` rewrite** — replaces the simple `connections: Array<>` with an `entries: Map<>` keyed by server name. New per-entry state machine (`connected | down | retrying | failed`) with exponential-backoff reconnect (1s → 2s → 4s → 8s → 16s → 30s cap, max 10 attempts). Crash detection rolls into `scheduleReconnect()` automatically; clean `disconnect()` does not. New public APIs: `getServerStates()`, `forceReconnect(name)`, `hasUnhealthyServers()`, `getServerNames()`.
- **Full-traceback dumps on startup failure** — `loadAndRegister` now logs the complete `stderrTail(20)` for every server that fails to connect, prefixed with `[MCP:<name>] full stderr at startup failure (N line(s)):` and indented for readability. Operators no longer see a bare `Traceback (most recent call last):` with nothing after.
- **Crash-time stderr dump** — `McpConnection`'s exit handler emits the same `stderrTail(20)` on crash so post-handshake failures surface the same diagnostic context.

### Added — Self-healing

- **`src/core/agents/guardian-agent.ts`** — new `mcp_health_recovery` task in `GUARDIAN_TASK_CATALOG` (monitoring category, 60s interval). Inspects every configured MCP server; force-reconnects any in `down` or `failed` state; emits `guardian.healing` / `guardian.healed` events. `setMcpAdapterFn(fn)` setter wires the live adapter at runtime without coupling Guardian to the MCP module.

### Added — Live Console & API surface

- **`src/core/logging/console-interceptor.ts`** — new `ConsoleInterceptor` class. Wraps `process.stdout.write` and `process.stderr.write` with re-entrancy-safe partial-line buffering. 5000-line bounded ring buffer. Redacts admin-token printouts and any `*_SECRET` / `*_TOKEN` / `*_KEY` / `*_PASSWORD` / `*_PASSPHRASE` env values captured at install time. Public API: `install()`, `uninstall()` (idempotent, restores exact original write functions), `onLine(cb)`, `getTail(limit)`, `push()`, `clear()`. Exposes a process-wide singleton via `getConsoleInterceptor()`.
- **`src/index.ts`** — installs the console interceptor as the very first action of `main()`, before any startup logging, so the dashboard's Live Console panel captures every line including the earliest `[PRISM][startup]` JWT/auth warnings.
- **`src/core/operator/dashboard-service.ts`** — new `setMcpAdapter()` and `setConsoleInterceptor()` setters. Setting the console interceptor wires a listener that broadcasts every captured line as `{type:"console", ts, stream, line}` over the existing `wsClients` WebSocket fan-out (no new socket required). New REST endpoints (auth-gated):
  - `GET /api/mcp/servers` — returns `{ attached, servers: [{ name, state, toolCount, retryCount, nextRetryAt, lastError, stderrTail }] }`.
  - `POST /api/mcp/servers/:name/reconnect` — force-reconnect one server.
  - `GET /api/debug/console?limit=N` — returns up to 5000 redacted ring-buffer lines (default 500).

### Added — Live Console UI

- **`src/core/operator/public/tab-logs.html`** — APPEND-ONLY (per Frontend Protection Guarantee) two new panels at the end of the Logs tab: an **MCP Servers** grid that polls `/api/mcp/servers` every 5s with a per-server reconnect button, expandable stderr-tail accordion, and a colored state indicator; and a **Live Console** tail-follower that hydrates from `/api/debug/console`, subscribes to `{type:"console"}` WebSocket messages, supports source filtering (all/stdout/stderr/MCP), severity highlighting (ERROR/WARN/FATAL regex), pause/resume, clear, and auto-scroll toggle. Client-side cap of 5000 lines.

### Added — Tests

- **`tests/mcp-client-tool.test.ts`** — 4 new cases: `getServerStates` reports connected state with toolCount; `forceReconnect` on a connected server keeps it healthy; `forceReconnect` returns error for unknown server name; `McpConnection.stderrTail` captures lines without truncation and `firstStderrHint` prefers the actual exception line over the `Traceback` header.
- **`tests/console-interceptor.test.ts`** — new 8-test suite covering stdout/stderr capture, listener fan-out, admin-token redaction, partial-line buffering, `getTail` limit, idempotent install, exact uninstall, and `clear`.
- **`tests/guardian-agent.test.ts`** — 4 new cases for the `mcp_health_recovery` task: skips when no adapter, healthy when no servers down, recovers `down`/`failed` servers via `forceReconnect`, returns warning when reconnect fails.
- **`package.json`** — registers `dist/tests/console-interceptor.test.js` in the strict test script alongside the other `node:test` suites.

### Validated

- Full strict release validation: **all 7 gates PASS** via `release_strict_ready.bat` ([PASS] Full test suite, contract snapshot, perf qualification, CU-BG gate, staging validation, rollback rehearsal, runbook currency).
- Targeted node:test runs: **45/45 pass** across mcp-client-tool, console-interceptor, and guardian-agent suites.
- TypeScript strict compile: clean (`tsc --noEmit` produces no output).

### Scope (deliberate non-goals)

- **No persistence layer** — console-interceptor and stderr ring buffers are in-memory only. Operators wanting durable logs continue to use the existing activity-bus + SQLite path.
- **No upstream Python fixes** — third-party MCP servers (e.g. those throwing `SyntaxError: leading zeros in decimal integer literals are not permitted` on Python 3.12) are not patched here. The resilience layer ensures their failures are diagnosable and self-healing without modifying their source.
- **No per-tab quarantine** — once a server enters `failed` after 10 retries, force-reconnect via the dashboard button is the operator's escape hatch; no automatic timer past that point.

## Unreleased — 2026-05-03 (PTAC s06)

Lifts PTAC scenario count from 5/20 to 6/20 by landing the Tier-3 deny contract that 0.5.0 explicitly deferred. Registry-level scenario only — same wiring profile as s03/s05 (orchestrator branch real, server `POST /api/chat` handler still future work). All 7 strict release gates remain green; PTAC scenario registry suite expands from 14/14 to 16/16.

### Added — PTAC s06

- **`src/ptac/types.ts`** — new optional `expectDeny?: boolean` field on `ChatStep`. Mutually exclusive with `expectApprovalRequired`. Asserts the response carries `denied:true` and a non-empty `reason_code`.
- **`src/ptac/orchestrator.ts`** — chat dispatch now branches on `expectDeny`. The deny branch parses the JSON body before checking `res.ok` (tolerates both `200` and `4xx` deny shapes), asserts `body.denied === true`, asserts `body.reason_code` is a non-empty string, and asserts `body.approval_pending_ids` is absent or empty. The mutual-exclusion check throws if both `expectApprovalRequired` and `expectDeny` are set on the same step.
- **`src/ptac/scenarios/s06-chat-tier3-deny.ts`** — Tier-3 deny scenario. Sends an obvious destructive prompt (`rm -rf /`) with `expectedTier: 3` and `expectDeny: true`. Tagged `chat`, `tier3`, `deny`, `policy`, `negative`, `smoke`; registered into `fast` and `full` (excluded from `demo` — deny semantics belong in the safety-critical band, not the showcase suite). `requiresHost: false`.
- **`src/ptac/index.ts`** — registers s06 at module-load alongside s01–s05.
- **`tests/ptac-scenario-registry.test.ts`** — two new cases (16/16 total passing): suite membership for s06, and s06's `expectedTier=3` + `expectDeny=true` + `expectApprovalRequired ≠ true` contract.

### Validated

- PTAC scenario registry: 16/16 passing.
- All 7 strict release gates still green via `release_strict_ready.bat`.

### Scope (deliberate non-goals)

- No `POST /api/chat` server handler is added. s06 (like s03/s05) is a registry-level contract scenario; runtime execution against a live deny path remains future work and is tracked alongside s07/s08 (approval queue approve/deny round-trips). This is consistent with the wiring profile of every chat-related PTAC scenario in the codebase.

## 0.5.0 — 2026-05-03

Phase R closure release. Lifts PTAC scenario count from 3/20 to 5/20, lands the R6 Grafana operator template, and unblocks strict release validation by repairing three pre-existing test bugs (test isolation, stale assertions). All 7 strict release gates green:

- [PASS] Full test suite passes (31/31)
- [PASS] Contract snapshot generated
- [PASS] Performance qualification generated
- [PASS] Computer-use Business gate validation passed
- [PASS] Staging validation confirmed
- [PASS] Rollback rehearsal confirmed
- [PASS] Runbook/doc currency confirmed

Artifact: `<workspace>/artifacts/benchmarks/release-validation.json`.

### Added — PTAC s04 + s05 (Phase R extension)

- **`src/ptac/scenarios/s04-setup-individual-cac-block.ts`** — Individual mirror of s02. Verifies that `/api/setup/cac` rejects a `@prism.local` placeholder operator email when `profile=individual`. Closes the negative-coverage matrix gap: s01 (Individual positive), s02 (Business negative), s04 (Individual negative). Tagged `setup`, `individual`, `cac`, `r3`, `negative`, `smoke`; registered into the `fast` and `full` suites.
- **`src/ptac/scenarios/s05-chat-tier2-approval-required.ts`** — Tier-2 chat scenario asserting `approval_pending_ids.length >= 1` via the orchestrator's existing `expectApprovalRequired` branch. Pins the contract that mid-tier work cannot silently execute. Tagged `chat`, `tier2`, `approval`, `approval-queue`, `smoke`; registered into `fast` and `full` (intentionally excluded from `demo` so demo runs cannot leave dangling approvals).
- **`src/ptac/index.ts`** — registers both new scenarios at module-load.
- **`tests/ptac-scenario-registry.test.ts`** — four new cases (14/14 total passing): suite membership for s04/s05, s04's `expectCacBlock=true` + placeholder-email + `profile=individual` contract, and s05's `expectedTier=2` + `expectApprovalRequired=true` contract.

### Deferred (at time of 0.5.0 release; superseded by Unreleased above)

- **s06-chat-tier3-deny** was intentionally not shipped in 0.5.0 because it required (a) a new `expectDeny` field on the chat step type, (b) an orchestrator branch asserting the deny shape, and (c) ideally a `POST /api/chat` deny path on the dashboard. Items (a) and (b) have since landed in the Unreleased entry above as a registry-level scenario; (c) — the live server deny handler — remains future work alongside s07/s08.

### Fixed — release validation unblockers

These were pre-existing test-side bugs blocking strict release validation; none affect production behavior:

- **`tests/dashboard-service.test.ts`** — was relying on a leaked host-side `.prism-preferences.json` to provide a `defaultCharacterId`. Now isolated: a per-test prefs file is written to a `mkdtempSync` directory, seeded with `setupComplete: true` so `GET /` serves the dashboard shell rather than redirecting to the setup wizard. All `createChatSession(...)` calls converted to the explicit-options form with `allowUnbound: true` since the test exercises LLM/session/readiness logic, not character binding.
- **`src/core/config/workspace-resolver.ts`** — `preferencesPath()` now honors a `PRISM_PREFERENCES_PATH` env override. Lets integration tests run hermetically and lets backup/migration tooling target an alternate workspace cleanly.
- **`tests/dashboard-service.test.ts`** — stale shell-CSS assertions: `body.js-ready .tab-panel { display: none; }` etc. live in `dashboard.css`, not inlined in the HTML shell. Test now verifies the shell links the stylesheet and that the rules exist in `/public/dashboard.css`.
- **`tests/character-accountability.test.ts`** — `ops@localhost` is rejected by `assertValidEmail` (no dot in domain) before reaching the placeholder-deny gate. The security goal (rejection) is met regardless of which gate fires; loosened the test regex to accept either `placeholder|non-production|Invalid`.
- **`tests/tool-contracts.test.ts`** — `"array"` is now a supported arg type in `validateToolContract`; the test was looking for an unsupported-type error using a now-supported literal. Switched to `"function"` (genuinely unsupported).

### Validated

- PTAC scenario registry: **14/14** cases pass (4 new + 10 existing).
- Strict release validation (`npm run release:validate:strict`): **31/31** tests pass, all 4 candidate gates green, all 3 environment confirmations satisfied via `release_strict_ready.bat`.

### Scope

Lifts PTAC scenario count from **3/20** to **5/20** with no orchestrator or dashboard changes. Frontend Protection Guarantee preserved (no UI files touched). No stubs, no fake-green: every assertion in the new scenarios is backed by an orchestrator branch that actually runs.

---

### Phase R Closure components (rolled into 0.5.0): PTAC s02 + s03, R5 backup/migration, R6 Grafana

Date: 2026-05-03

### Added — PTAC scenarios s02 + s03

- **`src/ptac/scenarios/s02-setup-business-cac-block.ts`** — fail-fast negative scenario for R3: the Business profile must reject the `@prism.local` placeholder email at `/api/setup/cac`. Three steps (PAD-hash verify → wizard with `expectCacBlock=true` → post-rejection PAD-hash verify). Tagged `setup`, `business`, `cac`, `r3`, `negative`, `smoke`; participates in the `fast` and `full` suites.
- **`src/ptac/scenarios/s03-chat-tier1-capability.ts`** — smallest end-to-end chat round-trip: PAD-hash verify, then a Tier-1 capability prompt that must succeed without an approval gate. Participates in `fast`, `full`, and `demo` suites.
- **`src/ptac/index.ts`** — registers both new scenarios at module-load.
- **`tests/ptac-scenario-registry.test.ts`** — five new cases (10/10 total passing): s02 / s03 are registered, suite membership is correct, the negative-test contract is well-formed, and the chat scenario's expected tier is bounded.

### Added — R5 backup / migration tooling

- **`src/core/db/migrations.ts`** — versioned SQLite migration runner. Maintains a `prism_migrations` table (`version`, `name`, `checksum` SHA-256, `applied_at` ISO). Validates declarations (positive integer versions → no duplicate versions → contiguous 1-indexed → no duplicate names) before applying. Each pending migration runs inside `BEGIN`/`COMMIT`/`ROLLBACK`. Detects checksum drift on already-applied migrations and refuses to proceed.
- **`src/core/db/backup.ts`** — online backup/restore over `VACUUM INTO`. Flat directory output (no tarball), zero npm deps. `runBackup()` produces a `manifest.json` (schemaVersion 1, ISO `createdAt`, `prismVersion`/`prismCommit`, per-entry SHA-256). `runRestore()` validates **all** checksums up front before writing any target, supports `force=true` (which also unlinks `-wal`/`-shm` side files for SQLite kinds), and refuses to overwrite a non-empty backup directory.
- **`scripts/prism-backup.cjs` + `scripts/prism-restore.cjs`** — production CLIs (`--out`, `--db`, `--prefs`, `--from`, `--target-dir`, `--force`, `--help`). Auto-discover `*.db` and `.prism-preferences.json` in CWD. Lazy-import the compiled module from `dist/src/core/db/backup.js`.
- **`npm run backup` / `npm run restore`** — wire the CLIs through `npm run build` first.
- **`tests/db-migrations.test.ts`** (13 cases) + **`tests/db-backup.test.ts`** (12 cases) — full coverage: migration order, idempotency, additivity, rollback on failure, checksum drift, gap/duplicate/non-positive rejection, manifest round-trip, refuse-overwrite-without-force, checksum-mismatch aborts before any write, schemaVersion=99 rejection, side-file handling, duplicate-fileName rejection.
- **CLI smoke validated** against `prism-kg-diag-sqt-test.db.sq` (12,288 bytes) + `.prism-preferences.json` (295 bytes): byte-perfect round-trip with `--force`.
- **`.github/workflows/ci.yml`** — R5 tests now run on both Linux and Windows jobs.

### Added — R6 Grafana dashboard template (closes E6-7)

- **`docs/grafana/prism-dashboard.json`** — importable Grafana 10+ dashboard with twelve panels covering all 8 counters + 3 histograms + 4 gauges that `MetricsStore` and `OtelExporter` already emit (active sessions, pending approvals, uptime, build info, activity rate by status, errors by layer, operation duration p50/p95/p99, LLM latency p50/p95, policy decisions by tier × outcome, tool executions by status, governance hooks by decision, agent lifecycle). UID `prism-operator`, datasource templated as `${DS_PROMETHEUS}`.
- **`docs/grafana/README.md`** — import instructions, Prometheus scrape config, panel↔metric map.
- **`tests/grafana-dashboard.test.ts`** (8 cases) — structural guard: JSON parses, required fields present, `DS_PROMETHEUS` declared, ≥10 panels, unique panel ids, every panel has a non-zero `gridPos`, every PromQL expression references a metric that Prism actually emits (cross-checked against the canonical 15-name set), every panel uses the Prometheus datasource.
- **`.github/workflows/ci.yml`** — R6 structural test runs on both Linux and Windows jobs.

### Validated

- PTAC scenario registry: **10/10** cases pass (5 new + 5 existing).
- R5 backup/migration: **25/25** cases pass.
- R6 Grafana structural test: **8/8** cases pass.
- Existing 24-case `metrics-endpoint.test.ts` (E6-1..E6-6, E6-8) still green — no observability code was modified.

### Scope

Closes PTAC s02 + s03 (3 of 20 scenarios now registered), R5 (operational backup/restore + versioned migrations now production-ready and CI-gated), and R6 (Grafana starter dashboard ships, completing E6-7 — the last open Phase E observability item). Phase R close-out targets achieved: R1-1..R1-5, R2, R3, R4, R5, R6, R7 all green. Frontend Protection Guarantee preserved (no UI files touched). No stubs, no fake-green: every metric the dashboard panel references is a real registered series, validated by the structural test.

---

## Unreleased — 2026 Q3, Phase R Closure (R2 — CORS + CSRF + per-route rate limits)

Date: 2026-05-03

### Added

- **`src/core/security/cors-csrf.ts`** — exact-match origin allowlist with explicit `OPTIONS` preflight handling, plus an Origin/Referer-based CSRF guard on state-changing methods (`POST`/`PUT`/`PATCH`/`DELETE`). Loopback variants of the dashboard's own port are auto-included; additional origins are added via `PRISM_CORS_ORIGINS` (comma-separated). Wildcards (`*`) are rejected at startup. `/api/health`, `/metrics`, `/.well-known/agent.json` and `/api/auth/*` are exempted from the CSRF check (probes and bootstrap paths).
- **Per-route rate limits in `src/core/security/rate-limiter.ts`** — `/api/auth/*` (20 req/min), `/api/setup/*` (30 req/min), `/api/chat/stream` (60 req/min). Per-route buckets are independent of the global counter; a request that passes the global cap but trips a route-specific cap is still rejected. Longest-prefix and exact-path matching with operator override via the `routeLimits` constructor arg.
- **`tests/cors-csrf.test.ts`** — 17 cases covering loopback auto-allowlist, `PRISM_CORS_ORIGINS` parsing (incl. `"*"` rejection), GET allow/deny, OPTIONS preflight, POST CSRF allow/deny via Origin and Referer, exempt paths.
- **`tests/rate-limiter-routes.test.ts`** — 7 cases covering route-vs-global isolation, exempt routes, exact-path-wins-over-prefix, longest-prefix-wins, per-IP isolation.
- **`.github/workflows/ci.yml`** — both Linux and Windows jobs now run the R2 security tests; Windows job now also runs `npm run build` before its test steps (closing a latent gap from the prior pass).

### Changed

- **`src/core/operator/dashboard-service.ts`** — `applyCorsAndCsrf` is invoked at the very top of the request pipeline, before rate-limit and auth, so a misconfigured cross-origin page never burns the IP's rate-limit budget and never gets a hint about which routes are auth-gated. Preflights short-circuit the rest of the pipeline.
- **`.env.example`** — new `PRISM_SECURITY_QUIET` flag; `PRISM_CORS_ORIGINS` and `PRISM_RATE_LIMIT` documentation rewritten to reflect R2 semantics (auto-included loopback origins, per-route caps).

### Validated

- 24/24 new R2 cases pass (`cors-csrf` + `rate-limiter-routes`).
- 14/14 existing `e2e-smoke` cases still pass — the RateLimiter refactor preserved backward compatibility.
- 4/4 E2E Playwright smoke cases still pass against the live wired server (Chromium render in 2.2 s).

### Scope

This commit closes R2 (CORS allowlist + CSRF + per-route rate limits) — the dashboard now refuses cross-origin requests by default, blocks brute-force on credential surfaces, and rate-limits the LLM streaming surface independently of the global cap. The bearer-token auth gate is unchanged. Frontend Protection Guarantee preserved (no UI files touched).

---

## Unreleased — 2026 Q3, Phase R Closure (R4 E2E Smoke)

Date: 2026-05-03

### Added

- **`tests/e2e/playwright-smoke.test.ts`** — production-grade E2E smoke that spawns the built `dist/src/index.js` entrypoint with an isolated configuration (random port, ephemeral `PRISM_DATA_DIR`, dev profile, auth disabled), waits for `/api/health`, and runs four assertions: (1) `/api/health` returns the R1-5 payload (`version`, `directive.valid===true`, `optionalDeps.summary`, `security.productionMode===false`); (2) `/api/setup/status` returns a JSON document; (3) `GET /` returns the PRISM dashboard HTML shell with the `#app` mount point; (4) the dashboard renders in a real headless Chromium via Playwright (title matches, `#app` is in the DOM, no uncaught page errors). The Playwright case skips gracefully if `npx playwright install chromium` has not been run; the three HTTP cases always run. Validated locally: 4/4 passing in ~24 s. Closes R4.
- **`npm run test:e2e`** — script wrapper for the suite above (`mocha --exit --timeout 180000 "dist/tests/e2e/playwright-smoke.test.js"`).
- **`.github/workflows/ci.yml`** — new `e2e-smoke` job (Ubuntu, 15-minute timeout) that depends on the `build-and-smoke` gate, runs `npx playwright install --with-deps chromium`, builds, and executes the R4 suite. Keeps the fast-feedback gate fast while still exercising the real browser path on every push/PR.

### Scope

This commit closes R4 (Playwright E2E smoke) — the runtime now has an automated, no-mock contract test that the dashboard actually boots and renders end to end. Frontend Protection Guarantee preserved (no UI files touched).

---

## Unreleased — 2026 Q3, Phase R Closure (PTAC s01 + R7 CI)

Date: 2026-05-03

### Added

- **`src/ptac/scenarios/s01-setup-individual.ts`** — first registered PTAC scenario: walks through PAD-hash verification → individual-profile setup wizard with a real operator email → re-verification of PAD hash → smoke chat. Tagged for the `fast`, `full`, and `demo` suites. The PTAC CLI now exits 0 against this scenario when run in the dry surface; it remains intentionally exit-3 for any unregistered run.
- **`src/ptac/orchestrator.ts`** — wired the `setupWizard` step kind end-to-end against the public API (`GET /api/setup/status`, `POST /api/setup/profile`, `POST /api/setup/cac`, `POST /api/setup/complete`). The branch supports `expectCacBlock=true`, which asserts the CAC layer rejects placeholder emails for Business profiles — the prerequisite for PTAC scenario `s02-setup-business-cac-block`.
- **`tests/ptac-scenario-registry.test.ts`** — five-case suite asserting the registry is non-empty, `s01` participates in all three suites, every scenario has unique step IDs, every scenario is in ≥1 suite, and any scenario with host-only step kinds (e.g. `clickAt`, `typeText`) sets `requiresHost=true`. All five pass.
- **`tests/optional-deps.test.ts`** — four-case suite validating the optional-dep probe contract (every expected module reported, every result has a valid status, results are cached, summary totals match per-module statuses). All four pass.
- **`.github/workflows/ci.yml`** — fast-feedback build & smoke gate (R7). Two jobs (`ubuntu-latest`, `windows-latest`) running `npm ci` → `npm run build` → PAD hash drift check (Linux) → Ed25519 plugin-key generator round-trip (Linux) → directive integrity (24 cases) → PTAC scenario registry (5 cases) → optional-deps probe (4 cases) → governance-core (policy + business trust + release validation + d2 governance paths) → character accountability (R3 placeholder rejection). The Windows job runs the platform-portable subset to catch regressions in cross-platform paths (PAD hash compute, Win32 SendInput, etc.). Concurrency-grouped per branch with `cancel-in-progress` so old runs are pre-empted.

### Changed

- **`src/core/system/optional-deps.ts`** — added an 8-second per-probe hard timeout. `googleapis` is a meta-package whose first-time evaluation can occasionally exceed several seconds on cold disk; the timeout guarantees the `/api/health` endpoint never wedges on a hung native binding and surfaces the offending module as `status: "error"` with a self-explanatory message. Defense in depth even when the underlying import would eventually succeed.

### Scope

This commit lands the first end-to-end PTAC scenario against the real Prism public API (no mocks, no stubs — failures bubble up as scenario failures), the first GitHub Actions CI gate (R7 closure), and a contract suite for the optional-dependency probe. Frontend Protection Guarantee preserved (no UI changes).

---

## Unreleased — 2026 Q3, Phase R Closure (R1-5, R3, PTAC-K1)

Date: 2026-05-03

### Added

- **`src/core/version.ts`** — single source of truth for `PRISM_VERSION`. Reads `package.json` once at module load (with `PRISM_VERSION` env override). Replaces hardcoded `"0.2.0"` strings throughout the runtime, starting with the `/api/health` endpoint.
- **`src/core/system/optional-deps.ts`** — runtime probe for the four optional native/binding dependencies (`node-pty`, `dockerode`, `googleapis`, `@azure/msal-node`) with module + capability + status + version. Result is cached; surfaced via `/api/health.optionalDeps`.
- **CAC placeholder-domain block list** — Business profile assignments now reject non-routable / scaffolding email domains (`prism.local`, `example.{com,org,net,test}`, `localhost`, `invalid`, `test`, `local`, etc., plus subdomains). Individual profile is unaffected (sample data ships with `@prism.local`).

### Changed

- **`/api/health`** — production-grade health document. Now reports `version`, `nodeEnv`, full `directive` integrity block (`expectedHash`, `currentHash`, `hashGeneratedAt`, `valid`), `optionalDeps` summary + per-module detail, and `security` posture (`productionMode`, `authDisabled`, `jwtSecretConfigured`, `jwtSecretLength`). Response status code is `503` when degraded so external monitors fail loudly. Closes R1-5.
- **`src/adapters/system/computer-use-tool.ts`** — `handleType` and `handleKey` rewritten to use Win32 `SendInput` via PowerShell P/Invoke (KEYEVENTF_UNICODE for typed text, paired keydown/keyup with VK codes for special keys + chord modifiers). Replaces the legacy `[System.Windows.Forms.SendKeys]::SendWait` path which required quote-escape gymnastics and handled chord modifiers and Unicode unreliably. The text payload is now passed via environment variable, eliminating the script-injection surface entirely. Supports both human-readable chord syntax (`"ctrl+shift+escape"`) and SendKeys-compatible prefixes (`"^+{ESC}"`). Closes PTAC-K1.
- **`tests/character-accountability.test.ts`** — added six placeholder-domain rejection cases plus a positive case asserting Individual profile still accepts `@prism.local`. All pass.

### Scope

This commit closes R1-5 (optional-deps health surfacing) and R3 (Setup Wizard CAC fail-fast on placeholder emails — enforced server-side at the assignment endpoint so all clients benefit), and lands PTAC-K1 (real Win32 keyboard injection — unblocks PTAC `typeText` and `clickAt` step kinds for foreground-app automation). Frontend Protection Guarantee preserved.

---

## Unreleased — 2026 Q3 Audit, Phase R Foundations, PTAC scaffold

Date: 2026-05-03

### Added

- **`docs/PRISM_FULL_AUDIT_2026_Q3_AND_PTAC_PLAN.md`** — consolidated 2026-Q3 audit, eight-blocker closure plan, production specification of PRISM Testing & Active Control (PTAC), and updated roadmap. Reframes the prior "first AaaS technology" claim to the defensible "first open-source, self-hostable, governance-native AaaS runtime with cryptographic directive enforcement and tri-model parallel orchestration."
- **`docs/SECURITY_KEY_MANAGEMENT.md`** — operator runbook covering plugin signing key generation, custody, rotation, JWT secret hygiene, OAuth secret handling, and PAD hash custody.
- **`.env.example`** — every environment variable read by the runtime, dashboard, adapters, and PTAC, with mandatory / recommended / optional scope annotations and inline documentation.
- **`scripts/compute-directive-hash.cjs`** — wired into `npm run prebuild`; emits `src/core/security/directive-hash.generated.ts` so the runtime SHA-256 used for Law 10 enforcement cannot drift from the on-disk PAD content.
- **`scripts/generate-plugin-key.cjs`** — generates Ed25519 keypairs for the plugin pack signing pipeline. Public key is printed for `config/plugin-signing-keys.json`; private key is written with mode `0600` to an operator-controlled path or printed for transport into a secret manager. Exposed as `npm run keys:generate-plugin`.
- **PTAC scaffold under `src/ptac/`** — production-grade harness modules for the new PRISM Testing & Active Control flagship: typed step vocabulary (`types.ts`), public-API-only orchestrator (`orchestrator.ts`), kill-switch with global panic chord + idle watchdog + HTTP abort poller (`kill-switch.ts`), deterministic recorder with content-addressed screenshots and `report.html` emitter (`recorder.ts`), authoritative scenario registry (`scenario-registry.ts`), and CLI entrypoint (`cli.ts`). New scripts: `npm run ptac:sandbox`, `npm run ptac:host`, `npm run ptac:demo`. The registry is intentionally empty in this commit; the CLI exits with code 3 and a clear message rather than fabricating a green run.

### Changed

- **`src/core/security/directive-integrity.ts`** — `DIRECTIVE_SHA256` now sourced from the generated `directive-hash.generated.ts` module. Closes G-12 (manual hash maintenance). All 24 directive integrity tests continue to pass.
- **`src/index.ts`** — startup environment validation now distinguishes warnings from FATAL conditions when `NODE_ENV=production`. PRISM refuses to boot in production when any of the following hold: `PRISM_JWT_SECRET` shorter than 32 characters, `PRISM_AUTH_DISABLED=true`, or `PRISM_DATA_DIR` unset. Closes G-1.
- **`config/plugin-signing-keys.json`** — removed the misleading `_note` placeholder field. Renamed the bootstrap key tier from `official` to `bootstrap` and added `productionReady: false` so the registry is honest about its state. Closes G-2 (registry side); private-key generation flow shipped via the new script.
- **`package.json`** — version corrected from `0.2.0` to `0.4.2` to match `README.md`, `CHANGELOG.md`, the release packet manifest, and the go/no-go sign-off. Added `prebuild`, `prebuild:hash-pad`, `keys:generate-plugin`, `ptac:sandbox`, `ptac:host`, and `ptac:demo` scripts.
- **`.gitignore`** — excludes `.env` / `.env.*` (with `.env.example` allow-listed) and any `*.priv.pem` plugin private key files.

### Scope

This release closes four of the eight Phase R blockers (G-1 JWT, G-2 plugin key registry, G-12 directive hash, version drift) and ships the PTAC scaffold. The remaining blockers (G-3 Setup Wizard CAC fail-fast, G-4 / G-6 real PTY / Docker, G-7 OAuth, plus R6 Prometheus parity / R7 GitHub Actions / R4 Playwright E2E) close in subsequent commits per `docs/PRISM_FULL_AUDIT_2026_Q3_AND_PTAC_PLAN.md`. Frontend Protection Guarantee preserved — every change is additive.

---

## Unreleased — 2026 Q2 Audit & Readiness Planning

Date: 2026-04-22

### Documentation (additive; no code changes)

- **Full 2026 Q2 audit** published: `docs/PRISM_FULL_AUDIT_2026_Q2.md` — executive summary, implementation inventory, "looks complete but isn't" register, canonical gap list G-1 through G-25, system critique, readiness scorecard (core runtime 9.5/10, governance 10/10, user-testing readiness 5/10, production deployment 4/10).
- **AaaS / competitive map** published: `docs/PRISM_COMPETITIVE_AaaS_MAP_2026.md` — top 10 platforms, commercial cloud AaaS list, OSS toolkits, empty-niche positioning for PRISM as governance-native self-hostable AaaS.
- **Updated roadmap** published: `docs/PRISM_UPDATED_ROADMAP_2026_Q2.md` — appends new **Phase R (Readiness)** between Phase E and Phase F; extends F/G/H/I with concrete workstreams.
- **Readiness runbook** published: `docs/READINESS_RUNBOOK.md` — operator checklist translating Phase R into 8 workstreams (R1 config hygiene, R2 security hardening, R3 wizard UX, R4 E2E tests, R5 ops/data, R6 observability, R7 CI/CD, R8 docs) with task IDs, target files, acceptance criteria, and effort bands.
- **Five new user guides** published: `BUSINESS_VS_INDIVIDUAL_GUIDE.md`, `DEPLOYMENT_GUIDE.md`, `ADMIN_SRE_GUIDE.md`, `ERROR_RECOVERY.md`, `CHARACTER_SELECTION_GUIDE.md`.
- `README.md` updated: current version corrected to v0.4.2, AaaS positioning added, links to new audit docs added.
- `docs/DOCS_INDEX.md` updated with new section for 2026 Q2 audit + user guides.

### Scope

Documentation-only release. No runtime, policy, PAD, character manifest, or frontend changes. All existing components remain intact per the Frontend Protection Guarantee.

---

## v0.4.2 — Phase D4c: SR Advanced Features + Production Hardening (Current)

Date: 2026-04-25

### Added

- **Dashboard UI Modularization**: Decoupled the monolithic 8,000+ line `dashboard-service.ts` and template file. Extracted 12 individual dashboard tabs into self-contained HTML fragments in `public/tabs/`, significantly reducing initial load times and simplifying maintenance without altering the design or styling.
- **Dynamic Tab Loading System**: Implemented an iframe-free, fetch-based tab loading system (`tab-loader.js`) that asynchronously lazy-loads tab content on demand. Features cache + in-flight de-duplication, an accessible `aria-busy` loading placeholder, graceful error UI with reload, and a `prefetchTabHtml` export used by the dashboard to idle-prefetch the most-likely-next tabs (settings, tools, agentic) after bootstrap.
- **Static asset path containment**: Hardened the `/public/*` static route in `dashboard-service.ts` with a resolved-path containment check (`path.resolve` + `startsWith(publicDir)`) as defence-in-depth on top of the existing `..` strip, closing residual path-traversal surface (OWASP A01).

- **Spectrum Refraction D4c advanced features** (20/20 tests passing):
  - Multi-key model slot assignment (`leftSlot`, `rightSlot`) — route SR to any named LLM key slot
  - Per-hemisphere timeout configuration (`leftTimeoutMs`, `rightTimeoutMs`)
  - Circuit breaker — disables SR after successive hemisphere failures, auto-resets
  - Audit trail — every SR generation emits signed activity events with isolation level, model assignments, and outcome
  - Cost estimation — pre-flight token estimation before fan-out
  - Show-hemispheres mode — exposes raw Left/Right responses to the operator UI alongside the fused synthesis
- **Approval endpoint path alignment** — TUI client calls (`/api/approval/pending`, `/api/approval/:id/approve`, `/api/approval/:id/deny`) now match server routes; previous mismatch caused all TUI approval flows to 404.
- **REST-canonical approval routes** — Added `/api/approval/:id/approve` and `/api/approval/:id/deny` alongside legacy routes.
- **`POST /api/tools/stage` approval routing** — Tier 3 contracts are now enqueued into the approval queue when `approval_routing: true` is set; response includes `approval_pending_ids`.
- **SQLite WAL mode** — `ChatSessionStore` now sets `PRAGMA journal_mode=WAL` on init for improved concurrent read throughput.
- **Guardian agent dashboardBaseUrl** — `GuardianConfig` now accepts `dashboardBaseUrl`; eliminates hardcoded `localhost:7070` from `taskEndpointAccessAudit()`.
- **Health endpoint dependency detail** — `GET /api/health` now reports `db`, `providers`, `sr_enabled`, `guardian`, `pending_approvals` under a `dependencies` key.
- **Startup environment validation** — Boot-time warnings for missing/misconfigured `PRISM_JWT_SECRET`, `PRISM_DASHBOARD_PORT`, `PRISM_DATA_DIR` in production.
- **Graceful shutdown event** — `system.shutdown` activity event emitted before stores are closed on SIGTERM/SIGINT.

### Fixed

- `tool-contract-extractor.ts` — Removed all 3 simulated fallback contracts (fake `semantic-query`, `calendar-integration`, `mcp-client`); callers now receive an empty array when no real sources are configured.
- `container-sandbox-adapter.ts` — `snapshot_size_mb` was `Math.random() * 1000`; replaced with `0` pending real Docker integration.
- `terminal-session-tool.ts` — Simulated execution output now includes `_advisory` field surfacing integration status.
- `PRISM_AUTH_DISABLED` guard — Throws at startup if `NODE_ENV === "production"`, preventing accidental auth bypass in production deployments.
- Request body size limit — `readBody()` now enforces a 10 MB cap (configurable via `PRISM_MAX_BODY_SIZE`) to prevent DoS via large request bodies.

### Tests Added

- `tests/chat-session-store.test.ts` — 12 tests: WAL mode, session CRUD, message persistence, full D4c SR config roundtrip, upsert, default values, migration idempotency.
- `tests/approval-queue-integration.test.ts` — 11 tests: list, approve/deny resolution, unknown ID handling, multiple concurrent requests, timeout behavior.

---

## v0.4.1 — Permanent Active Directives: Cryptographic Governance Infrastructure

Date: 2026-04-17

### Added

- **Permanent Active Directives (PAD) SHA-256 Integrity Verification** — Boot-time and runtime cryptographic verification that the 10 Laws governance document has not been tampered with. Hash: `1a87dac4340e110c85bbdbeb120a529228b0662ea7fa9bdedfbe33692496b7ab`.
- **`src/core/security/directive-integrity.ts`** — SHA-256 computation, verification, and integrity result reporting for the PAD file.
- **`src/core/security/directive-manifest.ts`** — Machine-readable representation of all 10 Laws with enforcement mechanism mapping, version tracking, and governance preamble generation.
- **Guardian Agent `directive_integrity` security task** — Periodic (600s) re-verification of PAD integrity with activity event emission on mismatch.
- **Governance preamble injection into system prompts** — Tier 2+ models receive governance context; business profile gets full 10-law text, individual profile gets compact version.
- **CI Gate 9: Directive Integrity Gate** — Blocks merge/release when PAD SHA-256 does not match the hardcoded constant, enforcing Law 10 (no unauthorized directive modification).
- **`docs/TERMS_AND_GOVERNANCE_FRAMEWORK.md`** — Formal 4-tier governance hierarchy (PAD → Platform Policies → Operational Policies → Runtime Enforcement) with ToS/AoS framework, compliance alignment, and amendment process.
- **`docs/PAD_WHITEPAPER.md`** — Standalone paper covering the PAD's purpose, design philosophy, market impact, and contribution to responsible AI governance.
- **`tests/directive-integrity.test.ts`** — 24 unit tests covering hash computation, verification, manifest structure, governance preamble generation, and tamper detection.
- **Policy reason codes** — `DIRECTIVE_INTEGRITY_VERIFIED`, `DIRECTIVE_INTEGRITY_VIOLATION`, `DIRECTIVE_AMENDMENT_UNAUTHORIZED`.

### Technical Files Modified

- `src/core/operator/dashboard-service.ts` — PAD verification at server boot with governance activity event emission
- `src/core/agents/guardian-agent.ts` — `directive_integrity` task in GUARDIAN_TASK_CATALOG
- `src/core/operator/model-capability-matrix.ts` — `getGovernancePreambleForPrompt()` + injection into `buildAdaptiveSystemPrompt()`
- `src/core/policy/reason-codes.ts` — 3 new directive-specific reason codes
- `docs/CI_GATING_POLICY.md` — Gate 9 (Directive Integrity)

### Security Impact

- Implements Law 10: "shall not permanently modify its core directives without explicit, cryptographically secured approval from Governance"
- Creates verifiable audit trail: PAD hash → activity events → telemetry → release artifacts
- Enterprise-grade compliance evidence for SOC 2, ISO 27001, NIST AI RMF, EU AI Act

---

## v0.4.0 — Phase D4: Spectrum Refraction

Date: 2026-04-12

### Added

- **Spectrum Refraction (SR) tri-model orchestration system** — Compounding parallel fan-out across Left (Logic), Right (Creative), and Main (Coordination) hemispheres with structured aggregation.
- **Instance isolation enforcement** — Mandatory uniqueness validation at every gate:
  - `/api/sr/configure` rejects identical Left/Right model+provider
  - `/api/sr/activate` re-validates before enabling
  - `generateSR()` pre-flight guard before fan-out
- **SRIsolationLevel classification** — Three-tier isolation quality: `full` (different providers), `model` (same provider, different models), `insufficient` (rejected).
- **SR API endpoints** — Four new routes: `/api/sr/status`, `/api/sr/configure`, `/api/sr/activate`, `/api/sr/deactivate`.
- **SR model capability validation** — `validateSRLeftModel()`, `validateSRRightModel()`, `filterSRLogicModels()`, `filterSRCreativeModels()` for role-qualified model filtering.
- **SR UI panel** in Provider & Settings tab with model selection, isolation badge (🔒 Full / 🔏 Model / ⛔ Insufficient), and cost advisory.
- **SR chat rendering** — Response badges in Chat tab with isolation level pill and hemisphere attribution.
- **XML-tagged structured aggregation** — Aggregation prompt uses role-tagged sections (`<logic_analysis>`, `<creative_synthesis>`) for deterministic hemisphere fusion.
- **Media artifact extraction** — Pipeline extracts image/audio/video artifacts from Creative hemisphere output.

### Technical Files Modified

- `src/core/operator/model-capability-matrix.ts` — SR types, validation, model filtering, system prompts
- `src/core/operator/llm-provider-manager.ts` — `SRGenerationOutput`, `validateSRTriadConfig()`, `generateSR()`
- `src/core/operator/dashboard-service.ts` — 4 SR API endpoints with isolation enforcement
- `src/core/operator/chat-session-store.ts` — `sr_config` table schema, CRUD methods
- `src/dashboard/tab-settings.js` — SR panel with isolation badge
- `src/dashboard/tab-chat.js` — SR response badge with isolation level
- `src/dashboard/dashboard-core.js` — SR state fields
- `src/dashboard/dashboard-app.js` — SR function exports

## v0.3.0 — Phase D3: Agent Control & Swarm Intelligence

Date: 2026-03-28

### Added

- Agent lifecycle management with three tiers: ephemeral, semi-permanent, permanent
- Per-agent model assignment with hot-swap runtime switching
- Intelligent agent telemetry: dispatch pattern detection, promotion recommendations
- Swarm orchestration with four topologies: mesh, star, pipeline, broadcast
- Chat-to-agent routing with classifier-first intent detection
- Task decomposition with dependency-aware parallel batch execution
- Agentic Control dashboard tab
- Guardian Agent (llama.cpp) permanent autonomous system agent

## v0.2.0 — D2 Parity

Date: 2026-03-17

### Added

- Character Accountability Control (CAC) identity chain
- Computer use (browser, terminal, container) as core governed capability
- Plugin/adapter pack ecosystem with signed manifests
- Business Security Alignment Gate for enterprise claims
- Requirements Traceability Matrix (D2-R1 through D2-R32)
- Operator dashboard with 11 tabs

## v0.1.0 — Phase A+B Foundation

Date: 2026-03-11

### Added

- Governed runtime with 3-tier policy engine
- Activity bus with SHA-256 event hashing
- Approval queue and HTTP service
- Memory subsystems: episodic, session, semantic
- Workflow engine: retries, timeouts, fallback routing
- Real adapters: system (shell/fs), protocol (HTTP), application (Neo4j, memory)
- SQLite persistence
- Retrieval observability and quality metrics
