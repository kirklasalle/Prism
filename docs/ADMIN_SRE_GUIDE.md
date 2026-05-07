# PRISM Administrator and SRE Guide

**Audience:** Operators running PRISM beyond initial deployment — day-2 work: monitoring, rotation, incident response, capacity planning.
**Companion:** [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) · [ERROR_RECOVERY.md](ERROR_RECOVERY.md) · [PRODUCTION_RELEASE_RUNBOOK.md](PRODUCTION_RELEASE_RUNBOOK.md) · [CI_GATING_POLICY.md](CI_GATING_POLICY.md)

---

## 1. Key paths and files

| Path | Purpose | Size guidance |
|---|---|---|
| `$PRISM_DATA_DIR/` | Workspace root (configurable) | Grows with usage |
| `$PRISM_DATA_DIR/data/*.db` | SQLite stores (activity, sessions, retrievals, chat) | Monitor size, vacuum monthly |
| `$PRISM_DATA_DIR/state/` | Persisted agent and CAC state | Small, keep |
| `$PRISM_DATA_DIR/logs/` | Rotating log files | 30-day retention (R5-3) |
| `$PRISM_DATA_DIR/config/` | Workspace-scoped config | Small |
| `$PRISM_DATA_DIR/prism-workspace.json` | Workspace manifest | < 1 KiB |
| `config/plugin-signing-keys.json` | Plugin public-key registry | Version with git; rotate yearly |
| `Permanent_Active_Directives.txt` | 10 Laws — the constitutional root | Hash-verified at boot and every 600 s |
| `.mcp/mcp-settings.json` | MCP server definitions | Hand-edited; restart required |

---

## 2. Health, metrics, observability

### 2.1 `/api/health`

Public. Returns JSON with component statuses: `db`, `providers`, `sr_enabled`, `guardian`, `pending_approvals`. Expected `status: "ok"` under normal operation. Integrate with your uptime monitor.

### 2.2 `/metrics` (Phase R6-1)

Public Prometheus endpoint once Phase R6 lands. Scrape every 15–60 s. Useful alerts:

```yaml
# Alertmanager sample rules
- alert: PRISMApprovalBacklog
  expr: prism_approvals_pending > 10
  for: 10m
- alert: PRISMHighDenialRate
  expr: rate(prism_tier_denials_total[5m]) > 1
  for: 15m
- alert: PRISMLatencyRegression
  expr: histogram_quantile(0.95, rate(prism_tool_latency_ms_bucket[5m])) > 5000
  for: 10m
```

### 2.3 Activity bus queries

The activity bus is the authoritative audit log. Useful SQL:

```sql
-- Denials in the last hour
SELECT ts, op, reason FROM activity_events
 WHERE decision='deny' AND ts > datetime('now','-1 hour')
 ORDER BY ts DESC;

-- Top tools by invocation count
SELECT op, count(*) AS n FROM activity_events
 WHERE decision='allow' GROUP BY op ORDER BY n DESC LIMIT 20;

-- Hash-chain continuity check
SELECT count(*) FROM activity_events WHERE prev_hash IS NULL;
-- expect exactly 1 (genesis row)
```

Any discontinuity in the hash chain is a critical incident — escalate and see §8.

---

## 3. Log management

- Default output: stderr (text) or structured JSON via `PRISM_LOG_FORMAT=json`.
- File output (when `PRISM_LOG_DIR` is set): daily-rotated files in `$PRISM_LOG_DIR/` (R5-3).
- Tail from the dashboard Logs tab (R6-4) or `tail -F $PRISM_DATA_DIR/logs/*.log`.
- For ELK / Loki ingestion, prefer JSON format. Useful keys: `ts`, `level`, `op`, `sessionId`, `characterId`, `reason`, `durationMs`.

**Do not log secrets.** The logger redacts known-sensitive keys; still audit new log statements for leakage.

---

## 4. Rotations

### 4.1 Rotate `PRISM_JWT_SECRET`

Impact: all session tokens invalidated; users re-authenticate.

```bash
# Generate
NEW_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# Update env manager (systemd EnvironmentFile / compose .env / secret store)
# Restart all nodes
systemctl restart prism
```

### 4.2 Rotate admin token

Delete `workspace/state/admin-token.json`, restart, capture new token from the startup log. Store in your secret manager.

### 4.3 Rotate plugin signing keys

1. Generate new Ed25519 keypair.
2. Add the new public key to `config/plugin-signing-keys.json` alongside the old one (dual-trust window).
3. Re-sign all plugins with the new private key.
4. After all installed plugins are re-signed, remove the old public key and restart.

Plan a quarterly or yearly cadence.

### 4.4 Rotate TLS certs

Replace `$PRISM_TLS_CERT` / `$PRISM_TLS_KEY` files. Restart (no in-place reload yet).

### 4.5 Update PAD

Modifying `Permanent_Active_Directives.txt` is a governance event. Process:

1. Governance Council approves the amendment in writing.
2. Edit the file.
3. Run `npm run prebuild` (or manually update `DIRECTIVE_SHA256`) — see [READINESS_RUNBOOK.md](READINESS_RUNBOOK.md) §R1-2.
4. Commit both changes in the same PR. CI Gate 9 will pass only when the hash matches the file content.
5. Document the amendment in the changelog with council signatures.

Unauthorized modification causes boot failure. This is by design.

---

## 5. Backups, restore, retention

### 5.1 Cadence

- **Full workspace tarball daily** (automated via cron/scheduler).
- **Retain 30 days** on hot storage.
- **Retain 12 months** on cold / offline storage (legal / compliance).

### 5.2 Drill

Schedule a restore drill quarterly: restore from a recent backup into a disposable environment, boot, verify `/api/health`, run a chat scenario. Document the result.

### 5.3 Procedure

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) §9 and [ERROR_RECOVERY.md](ERROR_RECOVERY.md) §3.

---

## 6. Capacity planning

| Metric | Healthy | Warning | Action |
|---|---|---|---|
| Activity DB size | < 1 GiB | 1–5 GiB | Vacuum + consider archiving old events |
| Session count | < 500 active | 500–2000 | Monitor pool saturation; consider HA path (Phase H) |
| Pending approvals | < 5 | 5–20 | Review approvers' responsiveness |
| Tool latency p95 | < 2 s | 2–5 s | Check provider latency, MCP health |
| Heap used | < 2 GiB | 2–4 GiB | Check for leaks; stability test (R4-6) |

Vacuum DB when size crosses threshold:

```bash
sqlite3 $PRISM_DATA_DIR/data/activity.db "VACUUM;"
```

---

## 7. Security posture checklist

- [ ] `PRISM_AUTH_DISABLED` is `false` everywhere.
- [ ] `PRISM_JWT_SECRET` ≥ 32 chars, rotated within last 180 days.
- [ ] `PRISM_RATE_LIMIT` set to 50 or lower in production.
- [ ] CSRF middleware enabled (Phase R2-1).
- [ ] CORS allowlist configured (Phase R2-2).
- [ ] Plugin signing keys real, not placeholder.
- [ ] PAD hash matches file (CI Gate 9 green).
- [ ] TLS terminated end to end.
- [ ] `/api/health` and `/metrics` are the only public endpoints.
- [ ] Log redaction confirmed — no secrets / tokens in logs.
- [ ] Backups tested restorable in the last quarter.

Run this checklist monthly.

---

## 8. Incident response runbook

### 8.1 Severity classification

- **SEV1:** PAD integrity violation, hash-chain discontinuity, data loss, auth bypass.
- **SEV2:** Approval queue stuck, policy engine misclassifying, SR isolation failure in production.
- **SEV3:** High latency, elevated denial rate without policy change, single-provider outage.
- **SEV4:** UX bug, docs issue, non-blocking warning.

### 8.2 SEV1 procedure (condensed)

1. Declare. Notify the on-call rotation.
2. **Preserve evidence.** Do not modify the workspace. Take a snapshot of `$PRISM_DATA_DIR` and the activity DB before any corrective action.
3. Stop the server if the violation is active.
4. Investigate: activity bus, logs, git history of `Permanent_Active_Directives.txt` and `config/plugin-signing-keys.json`.
5. Follow the relevant section of [ERROR_RECOVERY.md](ERROR_RECOVERY.md).
6. Post-incident: write a timeline, root-cause analysis, and preventive actions. File in `docs/incidents/`.

### 8.3 Rollback

Per [PRODUCTION_RELEASE_RUNBOOK.md](PRODUCTION_RELEASE_RUNBOOK.md) §6, rollback triggers include:

- Governance misclassification
- Approval bypass
- Latency regression beyond SLO
- Data corruption
- Profile parity regression
- Plugin trust bypass

Rollback means: deploy the previous known-good tag; restore workspace from before the upgrade (if schema changed).

---

## 9. Upgrading

1. Read the CHANGELOG entries between your current version and the target.
2. Back up the workspace.
3. On a staging clone, run the upgrade; verify CI gates green against the new build.
4. Apply DB migrations (R5-2) if any; review the migration output.
5. Deploy to production during a change window.
6. Verify `/api/health` and a scripted smoke test.
7. Watch `/metrics` for 30 minutes.

Do not skip phases. v0.4.2 → v0.5.0 implies applying v0.5.0 migrations, not a clean install.

---

## 10. Governance hygiene

- PAD amendments: §4.5.
- Policy rule changes: review in [D2_PROFILE_AWARE_POLICY_ENGINE.md](D2_PROFILE_AWARE_POLICY_ENGINE.md). Changes are tracked in git; CI gates must pass.
- New risk-tier assignments for tools: update the contract snapshot (`npm run contracts:snapshot`) and reviewers from multiple roles must sign off.
- New character manifest: review for least-privilege denylist; run [tests/business-scenario.test.ts](../tests/business-scenario.test.ts) if it is a Business variant.

---

## 11. Metrics of a healthy deployment

After 30 days of operation, a healthy PRISM deployment looks like:

- `/api/health` uptime > 99.5%.
- Denial rate stable ± 30% day over day (unexplained spikes warrant investigation).
- No activity-chain discontinuities.
- No PAD integrity violations.
- Approval-queue p95 resolution time < 5 minutes.
- Tool-invocation p95 latency within SLO for the relevant execution profile.
- Backup restore drill green in the last quarter.

Anything outside those bands is a signal, not necessarily an incident — investigate and log the outcome.
