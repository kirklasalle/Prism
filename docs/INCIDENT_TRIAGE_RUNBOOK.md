# PRISM Incident Triage Runbook

Operator playbook for triaging, capturing evidence on, and escalating production
incidents on a PRISM operator deployment. Pairs with [`READINESS_RUNBOOK.md`](READINESS_RUNBOOK.md)
(release readiness) and [`ADMIN_SRE_GUIDE.md`](ADMIN_SRE_GUIDE.md) (day-2 ops).

Audience: on-call SRE, dashboard operator, security responder.

---

## 1. Severity Matrix

| Sev | Symptom                                                                 | Response time | Decision authority      |
|-----|-------------------------------------------------------------------------|---------------|-------------------------|
| S1  | Dashboard offline; agents unable to act; data loss suspected            | < 5 min       | On-call + security lead |
| S2  | Policy denials spiking; approval queue stuck; auth failures > 5%/min    | < 15 min      | On-call                 |
| S3  | Single tool/adapter degraded; SLO p95 breach without functional impact  | < 1 hour      | On-call                 |
| S4  | Cosmetic UI bug; non-blocking telemetry gap                              | Next business day | On-call                |

Default to one severity higher when CAC accountability or PAD integrity is in
question.

---

## 2. First-Five-Minutes Checklist

1. **Acknowledge** the alert in your paging channel.
2. **Hit `/health`** on the dashboard host. Confirm `status: ok`, dependency
   detail, and that `uptime_seconds` is plausible (no surprise restart).
3. **Hit `/metrics`** (Prometheus exposition) and eyeball:
   - `prism_active_sessions` — non-zero?
   - `prism_approval_queue_depth` — bounded? Stuck > 50?
   - `prism_errors_total{layer=...}` — recent rate?
4. **Open the dashboard Telemetry tab** → confirm SLO gauge panel is green/yellow,
   not red.
5. **Capture an incident evidence bundle** before doing anything mutating
   (see §3).
6. **Declare severity** and notify stakeholders.

---

## 3. Evidence Bundle Capture

PRISM ships a one-click evidence bundle endpoint that snapshots the active
session's activity events, policy decisions, and session trace.

### From the dashboard

1. Navigate to **Logs** tab.
2. Click **Capture Incident Bundle**.
3. The browser downloads `prism-incident-bundle-<timestamp>.json`.

This invokes `captureIncidentBundle()` in
[`src/core/operator/public/tab-logs.js`](../src/core/operator/public/tab-logs.js)
which posts to `/api/incidents/bundle`.

### From the CLI

```powershell
curl -X POST http://localhost:7070/api/incidents/bundle `
     -H "Authorization: Bearer $env:PRISM_AUTH_TOKEN" `
     -o prism-incident-bundle.json
```

### Bundle contents

The bundle is JSON and includes:

- `session.sessionId`, `session.characterId`, `session.profile`
- `trace` — `SessionTraceBundle` from
  [`session-trace-explorer.ts`](../src/core/operator/session-trace-explorer.ts)
  (chronological activity events, tool calls, agent dispatches)
- `policyAudit` — `PolicyAuditBundle` from
  [`policy-audit-exporter.ts`](../src/core/operator/policy-audit-exporter.ts)
  (every policy decision with input, decision, reason)
- `metrics` — point-in-time snapshot of MetricsStore counters/histograms
- `version`, `uptime_seconds`, `generatedAt`

**Always capture the bundle before restarting the dashboard or rotating
credentials.** Bundles are the primary forensic artifact.

---

## 4. Common Symptom Playbooks

### 4.1 Approval queue stuck (`prism_approval_queue_depth` rising)

1. Capture evidence bundle (§3).
2. List pending approvals: `GET /api/approvals/pending`.
3. For each stuck request, decide:
   - **Approve** if intent is verified: `POST /api/tools/stage` with
     `decision: "approved"`.
   - **Deny** if suspicious: `POST /api/tools/stage` with `decision: "denied"`.
   - **Wait** if user is reachable; the queue auto-times-out per the request's
     `timeoutMs` (default 120 s).
4. If depth keeps rising despite decisions: check
   `dashboard-service.ts` logs for `[APPROVAL]` warnings, and inspect the
   `ApprovalQueue.list()` output for orphaned entries.
5. Escalate to S2 if approvals are not draining within 5 minutes.

### 4.2 Policy denials spiking

1. Capture evidence bundle.
2. Open the Policy Audit export from the bundle (`policyAudit.decisions[]`).
3. Group by `decision.reason` — look for a single dominant reason
   (e.g., `business_no_rollback`, `risk_high_no_approval`, `pad_hash_mismatch`).
4. **PAD hash mismatch** → S1: PAD has been tampered with or
   `directive-hash.generated.ts` is stale. Run `npm run prebuild` to
   regenerate; if hash still differs from
   [`Permanent_Active_Directives.txt`](../Permanent_Active_Directives.txt)
   contents, escalate to security lead — do not restart with mismatched hash.
5. **Profile misconfiguration** (Business denials on benign reads) → check
   `PRISM_PROFILE` env var and the active character's profile assignment in
   the CAC chain (`/api/cac/chain`).

### 4.3 SLO p95 breach (red gauge in Telemetry tab)

1. Identify which gauge is red (policy / retrieval / event delivery / approval
   pathway / telemetry overhead / persistence overhead).
2. Cross-reference the corresponding histogram in `/metrics`:
   - `prism_policy_latency_ms_*`
   - `prism_retrieval_latency_ms_*`
   - `prism_request_duration_ms_*`
3. If retrieval is slow → check SQLite WAL file size; consider
   `VACUUM` during a maintenance window.
4. If policy is slow → unusual; capture flame graph
   (`node --inspect-brk dist/index.js`) and file an incident report.
5. Roll back the most recent change (last `release:contract-diff-gate` artifact)
   if the breach started immediately after a release.

### 4.4 Authentication failures > 5%/min

1. Capture evidence bundle.
2. Confirm `PRISM_AUTH_DISABLED` is **not** set in production
   (it would log a startup warning).
3. Check `prism_errors_total{layer="auth"}` rate.
4. Inspect rate limiter: if 429s dominate, raise `PRISM_RATE_LIMIT` only after
   confirming the burst is legitimate.
5. Rotate JWT secret (`PRISM_AUTH_TOKEN`) per
   [`SECURITY_KEY_MANAGEMENT.md`](SECURITY_KEY_MANAGEMENT.md) if compromise
   suspected — capture bundle FIRST.

### 4.5 Tool/adapter degraded

1. Identify the failing tool from session trace (`trace.toolCalls[]`).
2. Check the tool's advisory field — `"simulated-mock"` indicates the optional
   dependency (e.g., `node-pty`) failed to load.
3. Inspect adapter health with the relevant integration test:
   `node dist/tests/index.js` and grep for the adapter name.
4. For terminal/PTY: confirm `node-pty` is installed; on Windows, `AttachConsole`
   warnings during shutdown are **expected** and suppressed by the test runner
   (see [`tests/index.ts`](../tests/index.ts) `uncaughtException` filter).

---

## 5. Escalation Paths

| Trigger                                               | Escalate to                |
|-------------------------------------------------------|----------------------------|
| PAD hash mismatch                                     | Security lead (immediate)  |
| Suspected data loss / corruption in `*.db` files      | DBA + security lead        |
| CAC chain integrity break (operator not in chain)     | Security lead + product    |
| Plugin signature failure on official-tier plugin      | Plugin maintainer + security |
| Sustained SLO red after rollback                      | Engineering on-call lead   |

---

## 6. Post-Incident

1. Attach the evidence bundle JSON to the incident ticket.
2. Update [`CHANGELOG.md`](../CHANGELOG.md) only after RCA is signed off.
3. If a runbook step was missing or wrong, file a PR amending **this** document
   in the same incident ticket.
4. If a recurring symptom emerges, add a new playbook to §4 and link it from
   the dashboard's Logs tab tooltip catalog
   ([`tab-tips-catalog.js`](../src/core/operator/public/tab-tips-catalog.js)).

---

## 7. Reference: Evidence Bundle Schema (informal)

```jsonc
{
  "version": "0.5.0",
  "generatedAt": "2026-04-20T12:34:56.789Z",
  "uptime_seconds": 86400,
  "session": {
    "sessionId": "...",
    "characterId": "aria-business",
    "profile": "business"
  },
  "trace": {
    "events": [ /* ActivityBus events, oldest-first */ ],
    "toolCalls": [ /* normalized tool invocations */ ],
    "agentDispatches": [ /* swarm/single dispatch records */ ]
  },
  "policyAudit": {
    "decisions": [
      { "operation": "...", "decision": "allow|deny|require_approval",
        "reason": "...", "input": { /* redacted */ }, "timestamp": "..." }
    ]
  },
  "metrics": {
    "counters": { "prism_requests_total": 1234, /* ... */ },
    "histograms": { "prism_policy_latency_ms": { "p50": 1.2, "p95": 7.4, "p99": 18.0 } },
    "gauges": { "prism_active_sessions": 1, "prism_approval_queue_depth": 0 }
  }
}
```

---

_Last updated: 2026-04-20 — keep current within the same release as any
behavior change to `dashboard-service.ts` incident or approval routes._
