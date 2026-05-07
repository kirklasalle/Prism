# PRISM Marketplace Curation Policy

**Status:** Phase G — Public Launch (May 2026)
**Owners:** PRISM Curation Team (initially: maintainer rotation)
**Companion docs:** [PLUGIN_SDK_AUTHORING_GUIDE.md](PLUGIN_SDK_AUTHORING_GUIDE.md), [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)

---

## 1. Purpose

The marketplace catalog is the **default surface** users see when they enable plugins. PRISM-curated entries (`curated: true`, ledgered `approved`) are presented as the trusted default; uncurated entries surface only when the user explicitly opts in.

This document is the contract between plugin authors and reviewers.

## 2. Roles

| Role | Responsibilities |
|------|------------------|
| **Author** | Submits the pack via PR. Owns signing, semver discipline, and the deprecation path. |
| **Reviewer** | Validates the pack against the criteria below. Records a `MarketplaceReviewDecision` in the ledger. |
| **Lead reviewer** | Tie-breaks split decisions. Manages reviewer rotation. |

A reviewer **must not** review their own pack.

## 3. Review criteria

A pack is `approved` only if **all** of the following pass:

### 3.1 Manifest

- [ ] `formatVersion: 1` and `id` follows reverse-DNS convention
- [ ] `version` is semver
- [ ] `minPrismVersion` is set and at least the current LTS
- [ ] `license` is OSI-approved (Apache-2.0, MIT, BSD-*, MPL-2.0, ISC)
- [ ] All `capabilities[]` declare `tier`, `scopes`, and a meaningful `description`
- [ ] No capability declares `tier: 0` while requiring scopes outside `["read"]`

### 3.2 Signature

- [ ] `signature.sig` and `signature.sig.json` are present
- [ ] Sidecar `keyId` resolves in [`config/plugin-signing-keys.json`](../config/plugin-signing-keys.json)
- [ ] Verification passes via `node scripts/verify-plugin-manifest.cjs --pack <path>`
- [ ] For `verified` trust tier, the signing key is on the PRISM-trusted list

### 3.3 Code quality

- [ ] No use of `eval`, `Function(...)`, or dynamic `require()` outside the documented capability boundary
- [ ] No write access outside `{workspace}/plugins/<id>/state/`
- [ ] No direct child-process spawning (delegate to `terminal-session-tool` or `container-sandbox-adapter`)
- [ ] OWASP Top 10 sweep passes against the pack source

### 3.4 Cross-platform

- [ ] No hardcoded backslash paths (`platform-parity-audit` clean)
- [ ] No `cmd.exe` / `powershell.exe` direct invocations without a fallback
- [ ] CI runs the pack's `npm test` on Linux + Windows + macOS

### 3.5 Documentation

- [ ] `README.md` describes purpose, capabilities, and example invocation
- [ ] `CHANGELOG.md` exists and starts at `0.1.0`
- [ ] If `version >= 1.0.0`, a `MIGRATION.md` exists for breaking-change releases

## 4. Decision process

1. Author opens a PR adding a `CatalogEntry` to the marketplace catalog.
2. Reviewer pulls the pack, runs `npm run plugin:scaffold` for comparison, and validates against §3.
3. Reviewer records a decision in the review ledger:

   ```jsonc
   {
     "entryId": "my-org.research-helper",
     "version": "0.2.1",
     "status": "approved",       // or "rejected" | "deprecated" | "pending"
     "reviewer": "alice@example.com",
     "reviewedAt": "2026-05-12T14:30:00Z",
     "notes": "Verified signature; capability scopes match manifest."
   }
   ```

4. On `approved`: PR is merged with `curated: true` flag set on the entry.
5. On `rejected`: PR is closed with `notes` populated explaining required fixes.
6. On `deprecated`: existing entry is retained for backward compatibility but excluded from `listEntries({ curated: true })`.

## 5. Escalation and revocation

- Any reviewer or maintainer may **revoke** an `approved` decision by recording a new `deprecated` decision. Revocation requires `notes`.
- A revoked pack stays installed for existing users (data preserved) but is hidden from new installs.
- Critical security issues escalate to the lead reviewer within 24 hours.

## 6. Conflict of interest

- Reviewers must not review packs they authored or commercially sponsor.
- Reviewers with a >5% stake in a vendor whose pack is under review must recuse.
- The lead reviewer manages a recusal log alongside the review ledger.

## 7. Re-review cadence

- All `approved` packs are re-reviewed when:
  - The author publishes a new minor or major version
  - PRISM ships a new major version
  - 12 months have elapsed since last review
- The ledger's `reviewedAt` field drives the cadence query.

## 8. References

- Ledger schema: [`src/core/plugins/marketplace-review-ledger.ts`](../src/core/plugins/marketplace-review-ledger.ts)
- Catalog API: [`src/core/plugins/plugin-marketplace.ts`](../src/core/plugins/plugin-marketplace.ts) (`listEntries({ curated: true })`)
- Author guide: [PLUGIN_SDK_AUTHORING_GUIDE.md](PLUGIN_SDK_AUTHORING_GUIDE.md)
