# PRISM Business Trust & Provenance Policy

Date: 2026-03-18  
Status: ACTIVE  
Scope: Plugin/adaptor pack install and staging for `PRISM Business`

## Purpose

This policy defines minimum trust and provenance requirements for plugin packs in business profile execution. It prevents untrusted or untraceable packages from entering governed runtime paths.

## Mandatory Requirements (Business Profile)

1. **Minimum Trust Level**
   - Effective pack trust level must be at least `verified`.
   - Effective trust level is computed as the **lowest trust level** across all adapters in the pack.

2. **Security Review Requirement**
   - `security.review_status` is required.
   - Allowed values: `community-reviewed`, `security-reviewed`.

3. **Cryptographic Signature Requirement**
   - `security.signature` and `security.signature_algorithm` are required.
   - Allowed algorithms: `rsa-2048`, `rsa-4096`, `ecdsa-256`, `ecdsa-384`.
   - Signature must verify against the provided business-trust public key.

4. **Repository Provenance Requirement**
   - `repository.url` is required.
   - URL must use `https://`.
   - Host must be allow-listed:
     - `github.com`
     - `gitlab.com`
     - `dev.azure.com`
     - `bitbucket.org`

5. **Author Traceability Requirement**
   - `author.email` is required.

6. **Known Issue Blocking Requirement**
   - Unmitigated critical issues allowed: `0`
   - Unmitigated high issues allowed: `0`

7. **Release Timestamp Integrity**
   - `metadata.released` must not be in the future.

## Decision Model

- Business trust validator produces:
  - `decision`: `allow` or `deny`
  - `tier`: `tier3_approval` (governance-critical path)
  - `reasonCodes`: deterministic machine-readable denial reasons

### Reason Codes

- `TRUST_LEVEL_BELOW_MIN`
- `AUTHOR_EMAIL_MISSING`
- `REVIEW_STATUS_MISSING`
- `REVIEW_STATUS_NOT_ALLOWED`
- `SIGNATURE_REQUIRED`
- `SIGNATURE_ALGORITHM_INVALID`
- `PUBLIC_KEY_MISSING`
- `SIGNATURE_VERIFICATION_FAILED`
- `REPOSITORY_REQUIRED`
- `REPOSITORY_PROTOCOL_NOT_HTTPS`
- `REPOSITORY_HOST_NOT_ALLOWED`
- `RELEASE_DATE_IN_FUTURE`
- `UNMITIGATED_CRITICAL_ISSUES`
- `UNMITIGATED_HIGH_ISSUES`

## Individual Profile Behavior

For `PRISM Individual`, trust validation runs in **advisory mode**:

- Result defaults to `allow`
- Warnings are emitted when business-grade requirements are not met
- No hard deny from trust/provenance checks in individual mode

## Identity and Domain Validation (CAC Integration)

When Character Accountability Control (CAC) is active, the following identity validation rules extend the trust posture:

### Business Profile

- Prism user and operator email domains must match (configurable via `BusinessEmailValidationPolicy.requireMatchingDomains`).
- An optional `allowedDomains` list can further restrict acceptable email domains.
- Domain mismatch at character assignment time produces a structured rejection before any tool dispatch occurs.
- Expected reason codes for identity-related denials:
  - `IDENTITY_DOMAIN_MISMATCH` — Prism user and operator emails have different domains in business profile.
  - `IDENTITY_DOMAIN_NOT_ALLOWED` — email domain is not in the configured allowed-domains list.
  - `IDENTITY_EMAIL_INVALID` — email address fails format validation.

### Individual Profile

- No domain constraints are enforced.
- Any valid email address is accepted for both Prism user and operator.
- Identity validation runs in permissive mode (warnings only, no hard deny).

## Enforcement Target

- Install-time validation for plugin packs
- Staging-time validation before contract activation
- Release evidence capture for trust decision outcomes

## Computer-Use Enterprise Alignment Addendum (2026-03-25)

Business trust/provenance controls also apply to computer-use-adjacent enablement and release messaging:

1. No Business computer-use readiness claim without trust/provenance evidence alignment.
2. High-risk computer-use pathways must remain tied to governance and accountability artifacts.
3. External benchmark claims must remain labeled `vendor-reported` unless reproduced internally.

Cross-doc gate references:

- `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md`
- `REQUIREMENTS_TRACEABILITY_MATRIX.md` (`CU-BG-*`)
- `PRODUCTION_RELEASE_RUNBOOK.md`
