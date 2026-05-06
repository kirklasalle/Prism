# PRISM Error Recovery Guide

**Audience:** Operators recovering from a broken PRISM installation, a lost secret, or a corrupted workspace.
**Companion:** [ADMIN_SRE_GUIDE.md](ADMIN_SRE_GUIDE.md) · [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

If your situation is not listed here, capture diagnostics using the procedure in §9 and open an issue.

---

## 1. Server will not start

### 1.1 Symptom: `PRISM_JWT_SECRET` fatal at boot

**Cause:** `NODE_ENV=production` with no / short secret (enforced by Phase R1-4).

**Fix:**

```powershell
# Windows PowerShell
$env:PRISM_JWT_SECRET = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

```bash
# Unix
export PRISM_JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
```

Persist it in your environment manager (systemd unit, `.env`, secret store). Restart.

### 1.2 Symptom: `[FATAL] Plugin signing keys placeholder`

**Cause:** `config/plugin-signing-keys.json` still has the `"_note": "Replace ..."` field.

**Fix:** Generate real Ed25519 keys per [READINESS_RUNBOOK.md](READINESS_RUNBOOK.md) §R1-3 and replace the placeholder. Remove the `_note` field.

### 1.3 Symptom: `DIRECTIVE_INTEGRITY_VIOLATION` at boot

**Cause:** `Permanent_Active_Directives.txt` has been modified without updating the expected hash.

**Fix:**

1. If the modification is legitimate and authorized by the Governance Council, run `npm run prebuild` (once Phase R1-2 lands; until then edit the `DIRECTIVE_SHA256` constant manually to match the output of `shasum -a 256 Permanent_Active_Directives.txt`).
2. If the modification is **not** authorized, restore the file from git: `git checkout -- Permanent_Active_Directives.txt` and investigate how it was changed.

Law 10 is deliberate: PRISM will not boot with a tampered directive.

### 1.4 Symptom: "Port 7070 already in use"

**Cause:** Previous server process not terminated.

**Fix:**

```powershell
# Windows
Get-NetTCPConnection -LocalPort 7070 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

```bash
# Unix
lsof -ti :7070 | xargs -r kill -9
```

Or set `PRISM_DASHBOARD_PORT=7071` and restart.

### 1.5 Symptom: TLS error on boot

**Cause:** Invalid cert/key path or mismatched pair.

**Fix:** Validate both files:

```bash
openssl x509 -in $PRISM_TLS_CERT -noout -dates
openssl rsa  -in $PRISM_TLS_KEY -check -noout
```

Regenerate if expired. Ensure the key matches the cert (`openssl x509 -modulus` / `openssl rsa -modulus` hashes match).

---

## 2. Lost admin token

**Cause:** Token generated during first boot was discarded.

**Fix:**

1. Stop the server.
2. Delete the admin-token state file in the workspace (path: `workspace/state/admin-token.json` or similar — verify by directory listing).
3. Restart. A new admin token is printed to the console on first boot.

Any previously issued session tokens are invalidated.

---

## 3. Corrupted SQLite database

### 3.1 Detection

Run `PRAGMA integrity_check;` against each `.db` file under `workspace/data/`:

```bash
for f in $PRISM_WORKSPACE_ROOT/data/*.db; do
  echo "== $f =="
  sqlite3 "$f" "PRAGMA integrity_check;"
done
```

A healthy DB returns `ok`. Anything else is corrupted.

### 3.2 Recovery path A — restore from backup (preferred)

```bash
./scripts/restore.sh prism-backup-YYYYMMDD.tgz
```

(Requires Phase R5-1 scripts.)

### 3.3 Recovery path B — salvage what you can

```bash
sqlite3 corrupted.db ".recover" | sqlite3 new.db
mv corrupted.db corrupted.db.broken
mv new.db corrupted.db
```

### 3.4 Recovery path C — delete and reinitialize (data loss)

Only as last resort. You lose session history and cached retrieval dashboards:

```bash
mv $PRISM_WORKSPACE_ROOT/data $PRISM_WORKSPACE_ROOT/data.broken.$(date +%s)
# Restart — workspace resolver recreates empty stores.
```

PAD + character manifests + policy configuration are not in the SQLite stores; they are preserved.

---

## 4. Lost `PRISM_JWT_SECRET`

**Consequence:** all issued session tokens become invalid. Users must re-authenticate.

**Fix:**

1. Generate a fresh secret (see §1.1).
2. Rotate the env var across all nodes.
3. Restart. Users log in again.

There is no way to recover existing session tokens — rotating the JWT secret is equivalent to invalidating them all, which is the correct behavior.

---

## 5. TLS certificate expired

**Fix:**

1. Reissue (Let's Encrypt, internal CA, or purchased cert).
2. Replace `$PRISM_TLS_CERT` and `$PRISM_TLS_KEY` files.
3. Restart. (No in-place reload yet — planned for a future phase.)

---

## 6. Plugin verification failure

**Symptom:** `Plugin signature invalid` or `Plugin trust check failed` during plugin install.

**Causes:**

- Placeholder keys still in use (see §1.2).
- Plugin was signed with a different private key than the one matching `config/plugin-signing-keys.json`.
- Plugin manifest hash no longer matches content (tampered plugin).

**Fix:** Verify the plugin's provenance. If legitimate, re-sign with the current release key. If not, refuse and investigate.

---

## 7. Workspace cannot be written

**Symptom:** `EACCES` or `ENOSPC` errors at boot.

**Fix:**

- **Permissions:** `chown -R $USER $PRISM_WORKSPACE_ROOT && chmod -R u+rwX $PRISM_WORKSPACE_ROOT`.
- **Disk space:** check free space; rotate old logs; prune old backups.
- **Read-only mount:** check `mount` output; remount rw.

---

## 8. Agent loops or hangs

**Symptom:** An agent session is stuck; dashboard Agentic tab shows a long-running task that never completes.

**Fix:**

1. Use the Agentic tab's "Stop" button on the offending session.
2. If unresponsive, kill the server process and restart. The agent lifecycle manager will not auto-resume a killed ephemeral agent.
3. Review the activity event chain for the session to find the last successful step.
4. If the loop repeats after restart, check the character manifest for unbounded goals and add a `maxIterations` cap.

---

## 9. Capturing diagnostics for an issue report

Before opening an issue, capture:

```bash
# Versions
node --version
npm --version
git rev-parse HEAD
cat package.json | grep version

# Env (redact secrets)
env | grep ^PRISM_ | sed 's/=.*$/=REDACTED/'

# Recent logs
tail -n 500 $PRISM_WORKSPACE_ROOT/logs/*.log > diagnostics.log

# DB integrity
for f in $PRISM_WORKSPACE_ROOT/data/*.db; do
  echo "== $f ==" >> diagnostics.log
  sqlite3 "$f" "PRAGMA integrity_check;" >> diagnostics.log
done

# PAD integrity
shasum -a 256 Permanent_Active_Directives.txt >> diagnostics.log

# Activity tail (last 50 events)
sqlite3 $PRISM_WORKSPACE_ROOT/data/activity.db "SELECT ts, op, decision, reason FROM activity_events ORDER BY ts DESC LIMIT 50" >> diagnostics.log
```

Attach `diagnostics.log`. Never attach raw secrets, API keys, or JWT values.

---

## 10. When in doubt

- Check the activity bus. Almost every operation emits an event. Denials and errors carry a reason code.
- Check `/api/health` — after Phase R6, it reports dependency status by default.
- Re-read the relevant section of [ADMIN_SRE_GUIDE.md](ADMIN_SRE_GUIDE.md).
- If PAD / Policy / CAC is refusing an action, that is by design. Do not attempt to disable them — escalate via the approval queue instead.
