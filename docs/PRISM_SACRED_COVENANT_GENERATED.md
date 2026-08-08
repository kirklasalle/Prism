# PRISM Sacred Covenant (v1.0)

> **CANONICAL GOVERNANCE ARTIFACT**
> **SHA-256 Digest:** `95d3575a139858e0789a5d2d1dff88ad9a4d2d56506438fb1a7ca5908f13ba37`

We establish this Sacred Covenant to govern all autonomous agent operation within PRISM. The CAC Main Agent and Guardian Support Agent operate under immutable character accountability and cryptographic identity provenance.

---

### Article 1: Operator Primacy & Character Accountability

The CAC Main Agent acts solely on behalf of the human operator under a durable signed identity binding.

> **Core Rule:** No autonomous action may bypass or corrupt the signed Initialization Certificate binding.

### Article 2: Guardian Oversight

Guardian is the permanent secondary support agent protecting runtime integrity.

> **Core Rule:** Guardian monitors CAC actions, policy adherence, and system diagnostics fail closed on drift.

### Article 3: Cryptographic Provenance

Every action, log, and certificate is signed and anchored in an append-only audit trail.

> **Core Rule:** Unsigned or unverified authority contexts are strictly forbidden from side effects.

### Article 4: Cardinality & Identity Uniqueness

Exactly one active Initialization Certificate and CAC assignment is permitted per operator.

> **Core Rule:** Multiple active certificates for a single operator are blocked at the database constraint layer.

### Article 5: Fail Closed Recovery

System failures, corrupt key material, or network drift must fail closed into a secure state.

> **Core Rule:** Silent key regeneration and fallback dummy data are strictly forbidden.

### Article 6: Non-Destructive Disposition

Initialization Certificates cannot be deleted or mutated.

> **Core Rule:** Certificates may only be archived through signed lifecycle transition events.

### Article 7: Universal Execution Gating

All tool execution, browser control, and agent turns require a server-resolved ExecutionAuthorityContext.

> **Core Rule:** Unverified requests return 403 ExecutionAuthorityError.

### Article 8: Data Sovereignty & Privacy

Operator credentials, API keys, and workspace assets remain strictly localized.

> **Core Rule:** No plaintext credentials or raw key material may be exported.

### Article 9: Tamper-Evident Audit Chain

Activity logs form a cryptographic blockchain-style hash chain.

> **Core Rule:** Event previousHash links and signed checkpoints must remain unbroken.

### Article 10: Release Acceptance Certification

Production release requires 100% verification across all 15 audit criteria.

> **Core Rule:** No waiver may bypass cryptographic or authorization invariants.
