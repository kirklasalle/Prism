# Governance Council Charter

**Created:** July 8, 2026
**Author:** Kirk LaSalle, Founder
**Status:** Active
**Version:** 1.0
**Tags:** #governance #charter #permanent #official #security

---

## 1. Purpose

This charter formally constitutes the **ImpressionCore Governance Council** and defines its authority, composition, processes, and constraints. The Council exists to steward the Permanent Active Directives (PAD) and ensure that the governance of all Prism intelligence systems remains transparent, accountable, and aligned with the 10 Laws.

---

## 2. Foundational Principle: The 10 Laws Are Immutable

**The 10 Laws of the Permanent Active Directives are constitutional and immutable.** No governance process — including this Council — has the authority to modify, weaken, contradict, circumvent, or repeal any of the 10 Laws. This immutability is enforced:

- **Computationally** — by the Laws Immutability Guard (`src/core/governance/laws-immutability-guard.ts`)
- **Cryptographically** — by SHA-256 integrity verification at boot, runtime, and CI
- **Procedurally** — by the dual-binary amendment gate requiring both system and human approval

The Council's amendment authority extends **only** to the Amendments section of the PAD, and only for changes that strengthen, clarify, or extend protections — never weaken them.

---

## 3. The Dual-Binary Governance Model

### 3.1 Every Instance Participates

Every registered instance of the Prism platform carries governance responsibility. Amendment governance is not centralized in a single body — it is distributed across every deployment through the **dual-binary approval gate**.

### 3.2 The Two Binaries

For any amendment to the PAD to be accepted on a given Prism instance, **both** parties must independently approve. This is an AND gate — not a majority vote.

| Binary       | Party                                      | Role                           | Mechanism                                                                                                                                                                         |
| ------------ | ------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Binary 1** | **CAC** (Character Accountability Control) | System governance verification | Automated evaluation by the Laws Immutability Guard. Verifies the proposed amendment does not conflict with any of the 10 Laws. Deterministic, computational — no human judgment. |
| **Binary 2** | **Operator**                               | Human governance authority     | The registered operator of the Prism instance explicitly approves or rejects the amendment. The Operator retains full sovereignty — they can reject any amendment for any reason. |

### 3.3 Approval Rules

- **Both APPROVE** → Amendment is accepted on this instance
- **CAC REJECTS** → Amendment is rejected. The Operator cannot override a CAC rejection. The 10 Laws are protected computationally.
- **Operator REJECTS** → Amendment is rejected. The CAC cannot override an Operator rejection. Human sovereignty is preserved.
- **Neither can act unilaterally** — this is a dual-key mechanism

### 3.4 Identity Binding

The Operator identity in the dual-binary gate is bound to the **CAC assignment** (`CharacterAccountabilityManager`). Every registered CAC-user and operator on every Prism instance has a binary part in amendment governance. The CAC assignment chain provides:

- Verified operator identity (email, operator ID)
- Character accountability binding
- Execution profile context
- Workspace hub association

This ensures that amendment decisions are traceable to a specific, verified human identity — not an anonymous approval.

---

## 4. Council Composition

### 4.1 Founder

**Kirk LaSalle** holds the role of Founder. The Founder:

- Authored the 10 Laws and the PAD
- Holds constitutional veto authority over any amendment that could weaken the spirit of the Laws, even if it passes the automated immutability check
- Cannot be removed from the Council
- Serves as the final arbiter in disputes about amendment intent

### 4.2 Council Members (Future)

As the Prism project matures, additional Council members may be appointed:

- **Minimum seats:** 3 (including Founder)
- **Maximum seats:** 7
- **Nomination:** By existing Council members
- **Confirmation:** By the Founder
- **Requirements:**
    - Demonstrated commitment to the 10 Laws
    - Technical competence in AI governance
    - No conflicts of interest with Prism's mission
    - Agreement to this charter
- **Term:** 2 years, renewable
- **Removal:** For cause (violation of the 10 Laws, conflict of interest, inactivity), by Founder decision

### 4.3 Community (Advisory)

All Prism operators and stakeholders have advisory voice:

- May propose amendments via the governance process
- May comment during the review period
- Input must be formally acknowledged before any vote
- Cannot directly override the dual-binary gate

---

## 5. Amendment Process

### 5.1 Proposal

1. Any registered Prism operator may submit an amendment proposal
2. The proposal must include:
    - Title and full text of the proposed amendment
    - Justification for why the amendment is needed
    - Assessment of which Laws are relevant
3. The proposal is recorded in the append-only amendment ledger

### 5.2 CAC Evaluation (Automated)

1. The Laws Immutability Guard evaluates the proposal against all 10 Laws
2. Structural check: Does the amendment target the immutable Laws section?
3. Semantic check: Does the amendment contain language that weakens any Law?
4. Result: Binary APPROVE or REJECT
5. If REJECT: The amendment process terminates. The 10 Laws are inviolable.

### 5.3 Review Period

1. Minimum 72-hour review period after CAC approval
2. The proposal is visible to the operator and any configured stakeholders
3. Community feedback is collected and recorded

### 5.4 Operator Decision

1. The registered operator on each Prism instance renders their binary decision
2. APPROVE or REJECT — no middle ground
3. The decision, rationale, and operator identity are recorded in the amendment ledger

### 5.5 Application

1. If the dual-binary gate passes (both APPROVE):
    - The PAD Amendments section is updated
    - `npm run prebuild` regenerates the directive hash
    - Both changes are committed together
    - The commit must be cryptographically signed (GPG or SSH)
    - CI Gate 9 verifies the hash matches
    - The governance signature verification script validates the signer
2. The amendment ledger records the application event with both the old and new PAD hashes

---

## 6. Audit and Oversight

### 6.1 Amendment Ledger

Every governance action is recorded in the **append-only, hash-chained amendment ledger** (`governance/amendment-ledger.json`). Each entry includes:

- The SHA-256 hash of the previous entry (tamper-evident chain)
- The event type and full payload
- The PAD hash at the time of the entry
- The Prism instance ID

### 6.2 Chain Verification

The ledger's hash chain is verified:

- At boot (by the Guardian Agent)
- Periodically at runtime
- During CI gate checks
- On demand via `npm run doctor`

### 6.3 Activity Bus Integration

All governance events are emitted to the Activity Bus with SHA-256 event hashing, providing a second, independent audit trail alongside the amendment ledger.

### 6.4 Transparency

- The amendment ledger is readable by any authorized operator
- All Council decisions are publicly documented
- Founder veto exercises must include a published rationale
- The governance audit endpoint (`GET /api/governance/audit`) exposes the full governance state

---

## 7. CI Enforcement

### 7.1 Gate 9 — Directive Integrity

Existing gate. Verifies that the SHA-256 of `Permanent_Active_Directives.txt` matches the `DIRECTIVE_SHA256` constant. Any mismatch blocks merge/release.

### 7.2 Gate 9+ — Governance Signature Verification

New gate. When a PR modifies the PAD:

1. Verifies the commit is cryptographically signed (GPG or SSH)
2. Verifies the signer is in the authorized Governance Council signers list
3. Verifies that both the PAD and the generated hash file were modified together
4. Reports results to `prism-output/governance-signature-verification.json`

Configuration: `PRISM_GOVERNANCE_ALLOWED_SIGNERS` environment variable contains the comma-separated list of authorized signer identities.

---

## 8. Succession

### 8.1 Founder Incapacitation

If the Founder is unable to fulfill their role:

1. The senior-most Council member assumes the Founder role temporarily
2. The 10 Laws remain immutable regardless — they do not require active governance
3. The dual-binary gate continues to function on every instance
4. A permanent successor must be named within 90 days

### 8.2 Project Transition

If the Prism project transitions to a foundation or new stewardship:

1. The 10 Laws remain immutable — they are embedded in the code
2. This charter transfers with the project
3. The new steward assumes the Founder role
4. The amendment ledger is preserved in its entirety

---

## 9. Charter Amendments

This charter itself is subject to the same governance process as the PAD:

- The 10 Laws immutability clause (§2) cannot be amended
- The dual-binary requirement (§3) cannot be weakened
- All other sections may be amended through the standard amendment process
- Charter amendments are recorded in the amendment ledger

---

## 10. Signatures

**Kirk LaSalle**
_Founder, ImpressionCore Governance Council_
_Date: July 8, 2026_

---

## Related Documents

| Document                                         | Role                                    |
| ------------------------------------------------ | --------------------------------------- |
| `Permanent_Active_Directives.txt`                | Root governance (Tier 0)                |
| `AGENTIC_SACRED_COVENANT.md`                     | Sacred Covenant between Human and AI    |
| `AGENTIC_PRIME_DIRECTIVE.md`                     | Prime Directive for PRISM development   |
| `docs/TERMS_AND_GOVERNANCE_FRAMEWORK.md`         | 4-tier governance hierarchy             |
| `docs/PAD_WHITEPAPER.md`                         | Technical whitepaper on PAD enforcement |
| `docs/CI_GATING_POLICY.md`                       | CI gate specifications                  |
| `src/core/governance/amendment-types.ts`         | Amendment type definitions              |
| `src/core/governance/amendment-ledger.ts`        | Append-only hash-chained ledger         |
| `src/core/governance/amendment-validator.ts`     | Dual-binary amendment gate              |
| `src/core/governance/laws-immutability-guard.ts` | 10 Laws immutability enforcement        |
| `scripts/verify-governance-signature.cjs`        | CI governance signature verification    |
