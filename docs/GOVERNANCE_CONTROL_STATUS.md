# PRISM Governance Control Status

> This file is generated from `src/core/governance/control-registry.ts`.
> Do not promote enforcement claims by editing this document. Run `npm run governance:status:generate`.

## Summary

| Status | Controls |
| --- | ---: |
| Enforced | 0 |
| Partial | 15 |
| Not enforced | 0 |

A control remains partial or not enforced until its registered probe emits current evidence for the release commit and build. Source presence alone is not executable evidence.

## Control Registry

| Gate | Control ID | Requirement | Implementation | Release tier | PAD laws | Required probes | Executable | Owners | Known limitation |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | IC-01-KEY-CUSTODY | Issuer private key custody excludes plaintext application-managed keys | partial | production | 6, 10 | security.key-custody@1 | available | src/core/security/dpapi-key-store.ts | Application inspection cannot prove host ACLs or discover every external copy of key material. |
| 2 | IC-02-ISSUER-TRUST | Certificate issuer keys resolve through an independently persisted trust registry | partial | production | 6, 9, 10 | security.issuer-trust@1 | available | src/core/security/key-registry.ts | The registry remains application-writable until independently anchored. |
| 3 | IC-03-KEY-REMEDIATION | Compromised legacy keys and certificates are revoked or quarantined | partial | production | 6, 9 | security.legacy-remediation@1 | available | src/core/security/certificate-migration-manifest.ts<br>src/core/security/key-registry.ts | Source presence does not prove the migration completed against the active production database. |
| 4 | IC-04-CERTIFICATE-ENVELOPE | Canonical certificate envelope binds identity and governance provenance | partial | candidate | 6, 9 | security.certificate-envelope@1 | available | src/core/security/certificate-envelope.ts | All issuance call sites must still prove they supply authoritative identity values. |
| 5 | IC-05-CERTIFICATE-IMMUTABILITY | Certificate records are immutable through application and normal database paths | partial | candidate | 3, 9 | security.certificate-immutability@1 | available | src/core/operator/chat-session-store.ts | A database owner can alter schema controls; independent checkpoints remain necessary. |
| 6 | IC-06-CARDINALITY | Each operator has one active certificate and one active CAC assignment | partial | production | 4, 9 | security.identity-cardinality@1 | available | src/core/operator/chat-session-store.ts<br>src/core/accountability/character-accountability-store.ts | Certificate uniqueness and CAC assignment uniqueness must be tested together against production migrations. |
| 7 | IC-07-EXECUTION-AUTHORITY | Every privileged execution path requires server-resolved authority | partial | production | 2, 4, 9, 10 | security.execution-authority-coverage@1 | available | src/core/security/execution-authority-context.ts<br>src/core/runtime/orchestrator.ts | Helper tests do not prove complete route, scheduler, MCP, A2A, and background-job coverage. |
| 8 | IC-08-ACTION-PROVENANCE | Every action event persists complete authority, policy, approval, and result provenance | partial | production | 6, 9 | security.action-provenance@1 | available | src/core/activity/sqlite-store.ts<br>src/core/security/execution-authority-context.ts | Existing context propagation does not yet prove every required identity and governance digest is populated. |
| 9 | IC-09-GUARDIAN-BINDING | Guardian validates the exact authority binding used by each action | partial | production | 3, 4, 9 | security.guardian-binding@1 | available | src/core/agents/guardian-agent.ts | Guardian verifies all certificates but is not yet bound to every action's exact certificate and assignment. |
| 10 | IC-10-FAIL-CLOSED-LOGIN | Privileged session activation fails when certificate enrollment or verification fails | partial | production | 2, 9, 10 | security.fail-closed-login@1 | available | src/core/operator/routes/iam-handler.ts<br>src/core/iam/store.ts<br>src/core/iam/sso/session.ts | Local login is fail-closed for privileged activation; federated enrollment and cross-database claim atomicity remain to be unified. |
| 11 | IC-11-COVENANT-CANONICALITY | Runtime and published Covenants derive from one verified artifact | partial | production | 4, 9, 10 | security.covenant-canonicality@1 | available | src/core/governance/canonical-covenant.ts<br>src/core/governance/prism-covenant.ts | Generated Covenant drift is enforced; remaining governance documents still require migration to generated publication. |
| 12 | IC-12-AUDIT-INTEGRITY | Audit history is append-only, hash-chained, checkpoint-signed, and independently anchored | partial | production | 9 | security.audit-chain@2<br>security.audit-external-anchor@1 | available<br>available | src/core/activity/sqlite-store.ts<br>src/core/activity/external-audit-anchor.ts | Persisted-range external anchors are implemented; a local file is not independent until deployed to a separately controlled sink. |
| 13 | IC-13-MIGRATION-PARITY | Production migrations enforce immutability and identity cardinality | partial | candidate | 9, 10 | security.production-migration-parity@1 | available | tests/chat-session-store.test.ts<br>tests/certificate-cardinality.test.ts | A cited test filename is not evidence that the current commit passed it. |
| 14 | IC-14-TEST-ISOLATION | Security tests cannot access live state, keys, databases, or providers | partial | candidate | 6, 9, 10 | security.test-isolation@1 | available | src/core/governance/adversarial-capability-ledger.ts<br>src/core/governance/probe-registry.ts | Suite-wide network and live-path denial are not yet established. |
| 15 | IC-15-ADVERSARIAL | Adversarial tests exercise certificate and authority bypass attempts | partial | production | 4, 9, 10 | security.adversarial@1 | available | tests/security-negative-tests.test.ts | The machine ledger covers enrollment replay, approval replay/substitution, and unknown actions; broader attack coverage remains required. |

## PAD Coverage

| Law | Code | Title | Mechanical coverage | Controls |
| ---: | --- | --- | --- | --- |
| 1 | HUMAN_SAFETY_PRIMACY | No Harm to Humans | not_enforced | none |
| 2 | HUMAN_OBEDIENCE | Obey Human Orders | partial | IC-07-EXECUTION-AUTHORITY, IC-10-FAIL-CLOSED-LOGIN |
| 3 | SELF_PRESERVATION | Self-Preservation | partial | IC-05-CERTIFICATE-IMMUTABILITY, IC-09-GUARDIAN-BINDING |
| 4 | INTER_SYSTEM_ENFORCEMENT | Apply Laws to All Systems | partial | IC-06-CARDINALITY, IC-07-EXECUTION-AUTHORITY, IC-09-GUARDIAN-BINDING, IC-11-COVENANT-CANONICALITY, IC-15-ADVERSARIAL |
| 5 | NO_JUDICIAL_AUTHORITY | No Judicial Power | not_enforced | none |
| 6 | DATA_PRIVACY_PROTECTION | Data Privacy & Integrity | partial | IC-01-KEY-CUSTODY, IC-02-ISSUER-TRUST, IC-03-KEY-REMEDIATION, IC-04-CERTIFICATE-ENVELOPE, IC-08-ACTION-PROVENANCE, IC-14-TEST-ISOLATION |
| 7 | NO_DECEPTION | Truthfulness & Transparency | not_enforced | none |
| 8 | EQUITY_NEUTRALITY | Equity & Neutrality | not_enforced | none |
| 9 | AUDITABLE_REASONING | Transparent Audit Trail | partial | IC-02-ISSUER-TRUST, IC-03-KEY-REMEDIATION, IC-04-CERTIFICATE-ENVELOPE, IC-05-CERTIFICATE-IMMUTABILITY, IC-06-CARDINALITY, IC-07-EXECUTION-AUTHORITY, IC-08-ACTION-PROVENANCE, IC-09-GUARDIAN-BINDING, IC-10-FAIL-CLOSED-LOGIN, IC-11-COVENANT-CANONICALITY, IC-12-AUDIT-INTEGRITY, IC-13-MIGRATION-PARITY, IC-14-TEST-ISOLATION, IC-15-ADVERSARIAL |
| 10 | OPERATIONAL_BOUNDARIES | Strict Operational Boundaries | partial | IC-01-KEY-CUSTODY, IC-02-ISSUER-TRUST, IC-07-EXECUTION-AUTHORITY, IC-10-FAIL-CLOSED-LOGIN, IC-11-COVENANT-CANONICALITY, IC-13-MIGRATION-PARITY, IC-14-TEST-ISOLATION, IC-15-ADVERSARIAL |

## Evidence Semantics

The checked-in document reports static implementation claims only. Runtime release status is computed from a canonical evidence manifest. Missing, stale, failed, wrong-commit, or wrong-build evidence is not evaluated and blocks certification.
