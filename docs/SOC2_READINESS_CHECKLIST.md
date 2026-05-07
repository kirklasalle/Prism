# SOC 2 Type II Readiness Checklist (PRISM)

**Status:** Phase G — pre-audit readiness (May 2026). Not an attestation.
**Audience:** Engineering + Security + Compliance leads preparing for an external SOC 2 Type II audit.
**Living document:** Update the *Status* column as evidence accumulates.

This checklist maps existing PRISM controls to the five **Trust Services Criteria** (TSC). Each row links to the implementation, the evidence path, and a current readiness assessment.

---

## Legend

| Status | Meaning |
|--------|---------|
| ✅ Ready | Control implemented, evidence captured, runbook documented |
| 🔶 Partial | Control implemented; evidence collection incomplete or runbook missing |
| ❌ Gap | Control not implemented; remediation required pre-audit |
| ➖ N/A | Not applicable to PRISM scope |

---

## TSC 1 — Security (Common Criteria)

### CC6 — Logical and Physical Access

| Control | Implementation | Evidence | Status |
|---------|---------------|----------|--------|
| CC6.1 — Authentication gate | `PRISM_AUTH_TOKEN` enforced on all HTTP + WebSocket routes; `PRISM_AUTH_DISABLED` blocked in production | [`dashboard-service.ts`](../src/core/operator/dashboard-service.ts) auth middleware | ✅ Ready |
| CC6.2 — Token lifecycle | Per-session tokens; revocation via dashboard | [`tab-settings.js`](../src/core/operator/public/tab-settings.js) | 🔶 Partial — rotation runbook pending |
| CC6.3 — Rate limiting | Per-IP fixed-window 200 req/min, configurable via `PRISM_RATE_LIMIT` | dashboard-service.ts rate limiter | ✅ Ready |
| CC6.6 — TLS | `PRISM_TLS_CERT` + `PRISM_TLS_KEY` env vars | DEPLOYMENT_GUIDE.md §TLS | ✅ Ready |
| CC6.7 — Privileged access | CAC chain binds operator → character → session | [`character-accountability-manager.ts`](../src/core/operator/character-accountability-manager.ts) | ✅ Ready |

### CC7 — System Operations

| Control | Implementation | Evidence | Status |
|---------|---------------|----------|--------|
| CC7.1 — Vulnerability management | OWASP Top 10 scan + `npm audit` | `npm run security:owasp`; [OWASP_TOP_10_CHECKLIST.md](OWASP_TOP_10_CHECKLIST.md) | ✅ Ready |
| CC7.2 — Anomaly detection | ActivityBus + IncidentTrendStore | [`incident-trend-store.ts`](../src/core/memory/incident-trend-store.ts) | ✅ Ready |
| CC7.3 — Incident response | Runbook + evidence-bundle capture | [INCIDENT_TRIAGE_RUNBOOK.md](INCIDENT_TRIAGE_RUNBOOK.md), `POST /api/incidents/bundle` | ✅ Ready |
| CC7.4 — Backup & recovery | `npm run backup` / `npm run restore` | `scripts/prism-backup.cjs`, `scripts/prism-restore.cjs` | 🔶 Partial — DR drill cadence undocumented |

### CC8 — Change Management

| Control | Implementation | Evidence | Status |
|---------|---------------|----------|--------|
| CC8.1 — Change authorization | PR review + signed CHANGELOG | `.github/workflows/quality-gates.yml` | ✅ Ready |
| CC8.1 — Release artifact integrity | Ed25519 signed releases | [`artifact-signature.ts`](../src/core/security/artifact-signature.ts), `npm run release:sign-artifact` | ✅ Ready |
| CC8.1 — Contract regression gate | Auto-block breaking contract diffs | `npm run release:contract-diff-gate` | ✅ Ready |

### CC9 — Risk Mitigation

| Control | Implementation | Evidence | Status |
|---------|---------------|----------|--------|
| CC9.1 — Risk assessment | Tier-based governance + ApprovalQueue | [`policy-engine.ts`](../src/core/policy/policy-engine.ts) | ✅ Ready |
| CC9.2 — Vendor management | Plugin signing tier enforcement | [`plugin-pack-validator.ts`](../src/core/plugins/plugin-pack-validator.ts), [MARKETPLACE_CURATION_POLICY.md](MARKETPLACE_CURATION_POLICY.md) | ✅ Ready |

---

## TSC 2 — Availability

| Control | Implementation | Evidence | Status |
|---------|---------------|----------|--------|
| A1.1 — Capacity monitoring | SLO gauges, MetricsStore Prometheus export | `GET /metrics`, [tab-telemetry.js](../src/core/operator/public/tab-telemetry.js) | ✅ Ready |
| A1.2 — Soak testing | 72h staging soak harness | `npm run soak:staging` | ✅ Ready |
| A1.2 — Stress testing | 10-concurrent-session stress | `npm run stress:concurrent` | ✅ Ready |
| A1.2 — Performance regression gate | Profile-differentiated trend history | `npm run perf:trend-gate` | ✅ Ready |
| A1.3 — Disaster recovery | Backup + restore tooling | `scripts/prism-backup.cjs` | 🔶 Partial — RPO/RTO targets not formally documented |

---

## TSC 3 — Processing Integrity

| Control | Implementation | Evidence | Status |
|---------|---------------|----------|--------|
| PI1.1 — Input validation | Tool contracts + JSON schema | [`tool-contracts.ts`](../src/core/tool-contracts/tool-contracts.ts) | ✅ Ready |
| PI1.2 — Audit trail | ActivityBus signed events | [`activity-bus.ts`](../src/core/activity/activity-bus.ts) | ✅ Ready |
| PI1.3 — Approval ledger | ApprovalQueue with deny/approve/timeout audit | [`approval-queue.ts`](../src/core/operator/approval-queue.ts) | ✅ Ready |
| PI1.5 — Output integrity | Tool contract diff gate | `npm run release:contract-diff-gate` | ✅ Ready |

---

## TSC 4 — Confidentiality

| Control | Implementation | Evidence | Status |
|---------|---------------|----------|--------|
| C1.1 — Secret management | `ProviderSecretStore` (file-encrypted) | [`provider-secret-store.ts`](../src/core/operator/provider-secret-store.ts) | 🔶 Partial — KMS integration deferred |
| C1.2 — Cross-tenant isolation | TenantContext + `tenantSubroot` | [`tenant-context.ts`](../src/core/config/tenant-context.ts) | ✅ Ready |
| C1.2 — Data classification | Profile-aware policy (Individual / Business / Enterprise) | [`policy-engine.ts`](../src/core/policy/policy-engine.ts) | ✅ Ready |

---

## TSC 5 — Privacy

| Control | Implementation | Evidence | Status |
|---------|---------------|----------|--------|
| P1 — Notice | Privacy notice in setup wizard | `setup-wizard.ts` privacy step | 🔶 Partial — formal policy doc pending |
| P3 — Choice | OAuth scope consent + character permission scopes | E5 wiring in CAC | ✅ Ready |
| P4 — Collection minimization | Local-first architecture; opt-in cloud sync | [`sync/`](../src/core/sync/) | ✅ Ready |
| P6 — Disclosure to third parties | Plugin tier enforcement + curation review | [MARKETPLACE_CURATION_POLICY.md](MARKETPLACE_CURATION_POLICY.md) | ✅ Ready |
| P8 — Quality | Identity audit export | `GET /api/v1/cac/export?format=csv\|json` | ✅ Ready |

---

## Outstanding gaps (pre-audit remediation)

1. **Token rotation runbook** — document the `PRISM_AUTH_TOKEN` rotation cadence and procedure.
2. **DR drill cadence** — formalize quarterly backup/restore drill with evidence retention.
3. **RPO/RTO targets** — publish recovery objectives in [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).
4. **KMS integration** — migrate `ProviderSecretStore` from file-encrypted to KMS-backed for Enterprise profile.
5. **Privacy policy** — publish a public-facing privacy policy distinct from the in-product privacy step.

These gaps do not block private beta; they are scheduled for resolution before the SOC 2 Type II observation window opens.

## References

- AICPA TSP Section 100 (2017 TSC)
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md), [INCIDENT_TRIAGE_RUNBOOK.md](INCIDENT_TRIAGE_RUNBOOK.md)
- Evidence bundle: `POST /api/incidents/bundle` produces a SOC-2-aligned audit package
