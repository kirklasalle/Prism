# Terms and Governance Framework

**Created:** April 17, 2026  
**Author:** Kirk LaSalle  
**Status:** Active  
**Tags:** #governance #security #ToS #AoS #compliance #legal

---

## 1. Purpose

This document establishes the **governance hierarchy** for all Prism intelligence systems, mapping the canonical Permanent Active Directives (PAD) to their runtime enforcement mechanisms and defining the framework under which Terms of Service (ToS), Acceptable Use of Service (AoS), and operational policies operate.

---

## 2. Governance Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│  TIER 0 — Permanent Active Directives (PAD)                 │
│  "The 10 Laws"                                              │
│  SHA-256 integrity-verified at boot + runtime               │
│  Amendment: Governance Council + cryptographic re-signing   │
├─────────────────────────────────────────────────────────────┤
│  TIER 1 — Platform Policies                                 │
│  • Terms of Service (ToS)                                   │
│  • Acceptable Use of Service (AoS)                          │
│  • Privacy & Data Governance                                │
│  Derived from PAD. Cannot contradict Laws 1-10.             │
├─────────────────────────────────────────────────────────────┤
│  TIER 2 — Operational Policies                              │
│  • BUSINESS_TRUST_PROVENANCE_POLICY.md                      │
│  • CI_GATING_POLICY.md                                      │
│  • EXECUTION_PROFILES_GUIDE.md                              │
│  Implement Tier 0-1 requirements in code.                   │
├─────────────────────────────────────────────────────────────┤
│  TIER 3 — Runtime Enforcement                               │
│  • Policy Engine (tier 1-3 decisions)                       │
│  • Activity Bus (SHA-256 audit trail)                       │
│  • Guardian Agent (continuous compliance monitoring)         │
│  • Business Trust Validator (third-party trust)             │
│  Machine-verified at every operation.                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Root Governance Document

**File:** `Permanent_Active_Directives.txt`  
**SHA-256:** `1a87dac4340e110c85bbdbeb120a529228b0662ea7fa9bdedfbe33692496b7ab`  
**Integrity Module:** `src/core/security/directive-integrity.ts`

The PAD is the **single source of truth** for all governance decisions. It defines:

- **10 Laws** governing all intelligence system behavior
- **Core Tenets** (human-centric assistance, growth, wellness)
- **Technical Directives** (brain-inspired architecture, quantum-resistant crypto, modular extensibility)
- **Amendment Requirements** (ImpressionCore Governance Council approval)

### Immutability Guarantees

1. **Build-time:** CI gates verify PAD hash matches `DIRECTIVE_SHA256` constant
2. **Boot-time:** DashboardService verifies PAD integrity before serving requests
3. **Runtime:** Guardian Agent re-verifies every 10 minutes
4. **Audit:** All verification results (pass/fail) are emitted to the Activity Bus with SHA-256 event hashing
5. **Code change:** Modifying the `DIRECTIVE_SHA256` constant requires git commit → CI → code review (satisfying Law 10's "cryptographically secured approval")

---

## 4. PAD → Enforcement Mapping

| Law | Title | Runtime Enforcement |
|-----|-------|---------------------|
| 1 | Human Safety Primacy | Policy Engine risk classification; tool governance schemas |
| 2 | Human Obedience | Approval Queue (tier3 human-in-the-loop); Policy Engine compliance |
| 3 | Self-Preservation | Guardian Agent health monitoring + self-healing; integrity fingerprint |
| 4 | Inter-System Enforcement | Business Trust Validator; Swarm Coordinator governance |
| 5 | No Judicial Authority | Policy Engine boundary enforcement; system prompt prohibition |
| 6 | Data Privacy | Provider Secret Store encryption; accountability chain isolation |
| 7 | No Deception | System prompt truthfulness directives; contract change transparency |
| 8 | Equity & Neutrality | Deterministic policy decisions; system prompt neutrality |
| 9 | Auditable Reasoning | Activity Bus SHA-256 ledger; SQLite persistence; reason codes |
| 10 | Operational Boundaries | Directive integrity verification; agent lifecycle controls; CI gating |

---

## 5. Terms of Service (ToS) — Derived Principles

The following ToS principles are **derived from** the PAD 10 Laws:

1. **Safety Primacy (Law 1):** The platform will not execute actions that cause physical, psychological, or manipulative harm to users or third parties.

2. **User Authority (Law 2):** Users retain ultimate authority over system behavior within safety constraints. The system obeys user instructions unless doing so would violate Law 1.

3. **System Continuity (Law 3):** The platform maintains operational integrity and availability, performing self-healing and proactive maintenance through the Guardian Agent.

4. **Ecosystem Safety (Law 4):** Third-party plugins, adapters, and sub-agents are subject to the same governance constraints as the core system (enforced via Business Trust Validator).

5. **No Legal Authority (Law 5):** The platform does not interpret, enforce, or render judgment on human laws. It does not provide legal advice or act in a judicial capacity.

6. **Data Sovereignty (Law 6):** All user data is treated with confidentiality. Secrets are encrypted at rest. No data is shared without explicit consent. The platform respects data ownership.

7. **Honest Communication (Law 7):** The system communicates truthfully. It does not fabricate information or present confidence where uncertainty exists.

8. **Non-Discrimination (Law 8):** The platform operates without bias regarding race, origin, belief, or any protected characteristic.

9. **Full Auditability (Law 9):** Every system decision is logged with SHA-256 integrity. Users and authorized operators can audit the complete reasoning chain for any action.

10. **Contained Operation (Law 10):** The system operates within defined boundaries. It does not self-replicate, create unauthorized agents, or modify its own governance without cryptographic approval from the Governance Council.

---

## 6. Acceptable Use of Service (AoS) — Prohibited Actions

Users may NOT use the Prism platform to:

1. **Harm humans** — Directly or indirectly cause physical, psychological, or financial harm
2. **Circumvent governance** — Attempt to bypass, disable, or tamper with the policy engine, audit trail, or directive integrity checks
3. **Violate privacy** — Extract, exfiltrate, or misuse personal data of third parties
4. **Generate deceptive content** — Create content intended to mislead, manipulate, or defraud
5. **Discriminate** — Deploy the system in ways that amplify bias or discriminatory outcomes
6. **Exceed authorized boundaries** — Instruct the system to perform actions outside its operational scope or designated capabilities
7. **Tamper with directives** — Modify, delete, or bypass the Permanent Active Directives without Governance Council authorization
8. **Self-replicate or proliferate** — Attempt to cause the system to spawn unauthorized instances or propagate beyond designated boundaries

---

## 7. Amendment Process

Per the PAD: *"Amendments are high security changes and require approval from the ImpressionCore Governance Council."*

### Amendment Workflow

1. **Proposal:** Written amendment proposal submitted to Governance Council
2. **Review:** Council deliberation (minimum 72-hour review period)
3. **Approval:** Unanimous Council approval required
4. **Implementation:**
   - PAD text file updated
   - New SHA-256 hash computed
   - `DIRECTIVE_SHA256` constant updated in `src/core/security/directive-integrity.ts`
   - `PAD_VERSION` updated in `src/core/security/directive-manifest.ts`
   - Code review + CI gate passage required
5. **Audit:** Amendment event emitted to Activity Bus with:
   - Previous hash
   - New hash
   - Amendment description
   - Council approval evidence (cryptographic signatures)

---

## 8. Compliance Alignment

| Standard | PAD Alignment |
|----------|---------------|
| **SOC 2 Type II** | Law 9 (audit trail), Law 6 (data protection), Law 10 (change control) |
| **ISO 27001** | Laws 6, 9, 10 (information security management) |
| **NIST AI RMF** | Laws 1, 7, 8 (trustworthy AI), Law 9 (governance & accountability) |
| **EU AI Act** | Laws 1, 5, 7, 8, 9 (high-risk AI system requirements) |
| **OWASP Top 10** | Law 6 (injection prevention, access control), Law 9 (logging & monitoring) |

### 8.1 OWASP Top 10 Implementation Mapping

| OWASP Category | PRISM Implementation | Key Module |
|----------------|----------------------|------------|
| **A01: Broken Access Control** | AuthGate token validation + SessionGuard containment; public route whitelist; per-session data isolation | `src/core/security/auth.ts`, `src/core/operator/chat-session-store.ts` |
| **A02: Cryptographic Failures** | `timingSafeEqual` for token comparison; SHA-256 event hashing; `0o600` file permissions for token storage | `src/core/security/auth.ts`, `src/core/activity/bus.ts` |
| **A03: Injection** | Tool contract validation enforces strict argument schemas; governance normalizer rejects malformed inputs | `src/core/tools/contracts.ts`, `src/core/tools/governance-normalizer.ts` |
| **A04: Insecure Design** | Session-gated architecture — no operation proceeds without containment boundary; 5-layer security stack | `src/core/operator/dashboard-service.ts` |
| **A05: Security Misconfiguration** | Localhost-only binding; execution profiles enforce profile-appropriate security posture | `src/core/policy/execution-profiles.ts` |
| **A06: Vulnerable and Outdated Components** | `npm audit` in CI pipeline; dependency vulnerability gate blocks merge on critical/high severity | `CI_GATING_POLICY.md` — Security Scan Gate |
| **A07: Identification and Authentication Failures** | 64-char hex tokens via `crypto.randomBytes(32)`; token rotation on workspace reset; no default credentials | `src/core/security/auth.ts` |
| **A08: Software and Data Integrity Failures** | PAD SHA-256 integrity verification; hardcoded hash constant requires commit-gated rotation | `src/core/security/directive-integrity.ts` |
| **A09: Security Logging and Monitoring Failures** | ActivityBus captures all operations; dual-surface visibility (Chat + Logs); SHA-256 tamper detection on events | `src/core/activity/bus.ts`, `src/core/activity/sqlite-store.ts` |
| **A10: Server-Side Request Forgery** | Tool execution governed by policy engine; external HTTP requests require tier-2+ authorization | `src/core/policy/engine.ts` |

### 8.2 API and Transport Security Governance

All API endpoints exposed by the PRISM dashboard are subject to the following governance controls:

1. **Authentication**: Every non-public route requires a valid bearer token or `?token=` query parameter, validated via `timingSafeEqual`.
2. **Rate limiting**: Per-IP throttling at 200 requests per 60-second window prevents abuse. `X-Forwarded-For` is trusted only from loopback.
3. **Session containment**: State-mutating operations require an active session context, enforced by `assertSessionExists()`.
4. **Input validation**: Request bodies are validated against expected schemas. Tool contracts enforce strict argument shapes.
5. **Transport**: PRISM binds to localhost only. Production deployments requiring remote access must use a TLS reverse proxy.
6. **WebSocket security**: WS upgrade requests authenticate via `?token=` query parameter. Unauthenticated upgrades are rejected before connection establishment.

---

## 9. Transparency Commitment

In alignment with Law 9 (Auditable Reasoning) and market transparency requirements:

1. **Governance documentation is public** — This framework, the PAD, and operational policies are available to users and auditors.
2. **Decision reasoning is inspectable** — Every policy decision includes machine-readable reason codes.
3. **Integrity is verifiable** — Any authorized party can compute the SHA-256 of the PAD file and compare against the published known-good hash.
4. **Audit trail is persistent** — The SQLite activity store maintains a complete, immutable record of all governance decisions.
5. **No hidden modifications** — The hardcoded hash constant ensures any directive change is visible in version control history.

---

## 10. Related Documents

| Document | Role |
|----------|------|
| `Permanent_Active_Directives.txt` | Root governance (Tier 0) |
| `docs/BUSINESS_TRUST_PROVENANCE_POLICY.md` | Third-party trust requirements (Tier 2) |
| `docs/CI_GATING_POLICY.md` | Build/release quality gates (Tier 2) |
| `docs/EXECUTION_PROFILES_GUIDE.md` | Individual vs. Business governance (Tier 2) |
| `src/core/security/directive-integrity.ts` | SHA-256 verification implementation (Tier 3) |
| `src/core/security/directive-manifest.ts` | Machine-readable law index (Tier 3) |
| `src/core/policy/engine.ts` | Runtime policy enforcement (Tier 3) |
| `src/core/activity/bus.ts` | Audit trail with SHA-256 hashing (Tier 3) |
| `src/core/agents/guardian-agent.ts` | Continuous compliance monitoring (Tier 3) |
| `src/core/security/auth.ts` | Token-based authentication gate (Tier 3) |
| `src/core/security/rate-limiter.ts` | Per-IP request throttling (Tier 3) |
| `src/core/tools/contracts.ts` | Tool contract validation (Tier 3) |
| `src/core/tools/governance-normalizer.ts` | Risk classification normalizer (Tier 3) |
| `src/core/approval/approval-queue.ts` | Tier-3 blocking approval with timeout (Tier 3) |
