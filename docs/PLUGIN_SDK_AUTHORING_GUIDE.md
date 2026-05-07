# PRISM Plugin SDK — Adapter Pack Authoring Guide

**Audience:** Plugin authors writing PRISM adapter packs (tools, capability bundles, MCP wrappers).
**Status:** Phase G — Public Launch (May 2026)
**Companion docs:** [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) §7C, [MARKETPLACE_CURATION_POLICY.md](MARKETPLACE_CURATION_POLICY.md)

---

## 1. Pack anatomy

A plugin pack is a tar.gz or zip containing:

```
pack-root/
  plugin.manifest.json     # required — declares pack metadata + capabilities
  signature.sig            # optional — Ed25519 detached signature over manifest.json
  signature.sig.json       # optional — sidecar with keyId + algorithm + signedAt
  src/                     # required — TypeScript or JavaScript source
  README.md                # required — describes the pack
  CHANGELOG.md             # recommended
  LICENSE                  # required for `signed`/`verified` trust tiers
```

### `plugin.manifest.json` schema (v1)

```jsonc
{
  "formatVersion": 1,
  "id": "my-org.research-helper",   // unique reverse-DNS id
  "name": "Research Helper",
  "version": "0.2.1",                // semver
  "author": { "name": "...", "url": "...", "publicKeyId": "ed25519-2026-05-01" },
  "description": "Web fetch + citation builders.",
  "license": "Apache-2.0",
  "minPrismVersion": "0.7.0",
  "capabilities": [
    {
      "id": "research.fetch",
      "name": "fetch_with_citation",
      "tier": 2,                     // 0..3 governance tier (see DEVELOPER_GUIDE §7B)
      "scopes": ["network.read"],
      "description": "Fetch a URL and emit a structured citation block."
    }
  ],
  "tags": ["research", "citations"],
  "tier": 0                          // marketplace tier (0=free)
}
```

## 2. Trust tiers and signing

PRISM enforces three trust classes at activation time:

| Tier | Definition | Business profile | Individual profile |
|------|-----------|------------------|--------------------|
| `verified` | Signed by a key in [`config/plugin-signing-keys.json`](../config/plugin-signing-keys.json) **and** PRISM-curated | accepted | accepted |
| `signed` | Signed by any key registered in `plugin-signing-keys.json` | accepted | accepted |
| `unsigned` | No detached signature | **rejected** | warning + explicit confirm |

### Signing flow

1. **Generate or rotate a key:**

   ```powershell
   npm run keys:generate-plugin -- --tier community --name "my-org-2026"
   ```

   Output: `tmp/keys/my-org-2026.private.pem` + `my-org-2026.public.pem`. Submit the **public** PEM to the curation team via the process documented in [`MARKETPLACE_CURATION_POLICY.md`](MARKETPLACE_CURATION_POLICY.md).

2. **Sign the manifest:**

   ```powershell
   node scripts/sign-plugin-manifest.cjs `
     --manifest plugin.manifest.json `
     --private-key tmp/keys/my-org-2026.private.pem `
     --key-id ed25519-my-org-2026
   ```

   This emits `signature.sig` (base64) and `signature.sig.json` (sidecar manifest).

3. **Verify locally before publishing:**

   ```powershell
   node scripts/verify-plugin-manifest.cjs --pack ./pack-root
   ```

## 3. Authoring a new pack from scratch

Use the scaffold helper:

```powershell
npm run plugin:scaffold -- --id my-org.demo-pack --name "Demo Pack" --out tmp/demo-pack
```

This emits the full pack-root layout above with a working capability stub, manifest, README, and a starter test that wires the capability into the in-process `ToolRegistry`.

## 4. Testing a pack

```powershell
cd tmp/demo-pack
npm install
npm test
```

The scaffolded test uses the `PluginPackValidator` to dry-load the pack against the local PRISM build, exercising:

- Manifest schema conformance
- Capability tier matches declared scope set
- Signature verification (when present)
- Cross-platform path normalization (Linux/macOS parity gate)

## 5. Publishing to the marketplace

Once the pack is signed and tested:

1. Open a PR against the marketplace catalog repo (or the local `examples/marketplace/catalog.json` for development) adding a `CatalogEntry` with:
   - `source: file://relative/path/inside/workspace`
   - `trust: signed`
   - `curated: false` (the curation team flips this to `true` after review)
2. The curation team validates the pack, reviews the manifest, and updates [`marketplace-review-ledger.json`](../examples/marketplace/marketplace-review-ledger.json) with a `MarketplaceReviewDecision`.

## 6. Policy contract

Plugins **may not**:

- Bypass `PolicyEngine` decisions
- Read secrets outside the scopes declared in their manifest
- Mutate other packs' state directories
- Spawn child processes outside the sandbox

PRISM enforces these via the policy engine and the runtime sandbox. Violations trip `tier-3` ApprovalQueue review.

## 7. Versioning and deprecation

- Use semver. Major-version bumps **must** include a `deprecation.md` in the pack with a migration path.
- The contract diff gate (`npm run release:contract-diff-gate`) runs on every PR and blocks `removed`/`schema_changed` capabilities without explicit `--allow-breaking` flag.

## 8. References

- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) — Architecture overview
- [MARKETPLACE_CURATION_POLICY.md](MARKETPLACE_CURATION_POLICY.md) — Review process and reviewer roles
- [plugin-pack-validator.ts](../src/core/plugins/plugin-pack-validator.ts) — Validator implementation
- [plugin-marketplace.ts](../src/core/plugins/plugin-marketplace.ts) — Marketplace API
