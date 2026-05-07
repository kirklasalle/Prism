# PRISM Security Key Management

**Audience:** PRISM operators preparing for production deployment.
**Scope:** Plugin signing keys, JWT signing secrets, OAuth client secrets, PAD hash custody.
**Authority:** Permanent Active Directives, Law 4 (Security) and Law 10 (Directive Integrity).

---

## 1. Plugin signing keys (Ed25519)

PRISM verifies every plugin pack against an Ed25519 public key registered in [`config/plugin-signing-keys.json`](../config/plugin-signing-keys.json). The repository ships a **bootstrap** key for development. Operators MUST regenerate the keypair before production.

### 1.1 Generate a new keypair

```powershell
npm run keys:generate-plugin -- --out C:\secrets\prism-plugin-2026-q3.priv.pem
```

The script prints the registry entry to stdout and writes the private key in PKCS#8 PEM at the path you specify. The private key file is created with mode `0600` on POSIX systems; on Windows, follow §1.4 to apply equivalent ACLs.

### 1.2 Register the public key

Replace the `bootstrap` entry in `config/plugin-signing-keys.json` with the new entry, set `tier` to `official`, and set `productionReady: true`:

```json
{
    "keyId": "prism-official-2026-q3",
    "tier": "official",
    "label": "PRISM Official Release Key (2026-Q3)",
    "algorithm": "ed25519",
    "publicKeyBase64": "<paste-from-script>",
    "addedAt": "<ISO-8601>",
    "expiresAt": null,
    "productionReady": true
}
```

Commit this change. The public key is safe to commit; it is not a secret.

### 1.3 Custody of the private key

Store the private key in **one** of the following, in descending order of preference:

1. A managed HSM (AWS KMS, Azure Key Vault, GCP KMS, YubiHSM 2). Sign plugin packs by API; the private key never leaves the HSM.
2. A hardware token (YubiKey 5 with PIV applet). Sign plugin packs offline at release time.
3. An encrypted vault (HashiCorp Vault, 1Password Business). Acceptable for small teams. Add a CI-only role with read access to the signing operation, never the raw key.

Never:

- Commit the private key to git.
- Copy it to a developer workstation.
- Share it over email, Slack, or any other channel that retains history.

### 1.4 Windows ACL example

```powershell
$path = "C:\secrets\prism-plugin-2026-q3.priv.pem"
icacls $path /inheritance:r
icacls $path /grant:r "$($env:USERNAME):(R)"
icacls $path /grant:r "SYSTEM:(R)"
```

### 1.5 Rotation

Rotate at least every 12 months and immediately after any suspected compromise:

1. Generate a new keypair (step 1.1).
2. Add the new public key to the registry **alongside** the previous entry.
3. Re-sign all currently distributed plugin packs with the new key.
4. After a 30-day overlap window, set `expiresAt` on the previous entry and remove it on the next release.

Document each rotation in [`CHANGELOG.md`](../CHANGELOG.md) with the new `keyId` and the operator who performed the rotation.

---

## 2. JWT signing secret

`PRISM_JWT_SECRET` signs every dashboard auth token. Generate a fresh value per environment:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Production startup refuses to boot if `PRISM_JWT_SECRET` is unset or shorter than 32 characters (see `src/index.ts`). Rotate at least every 90 days. Rotation invalidates all outstanding tokens; coordinate with active operators before rotating in business profiles.

---

## 3. OAuth client secrets

Gmail and Outlook OAuth client IDs and secrets are read from the environment. The `.env.canary` file (gitignored) is the supported home for local canary credentials. CI uses a GitHub OIDC trust to pull short-lived tokens from Azure Key Vault; `PRISM_CANARY_*` variables are never written to disk in CI.

Refresh tokens are stored in the OAuth token store (`src/core/operator/oauth-token-store.ts`) which encrypts at rest using `PRISM_JWT_SECRET` as the derivation seed. Rotating `PRISM_JWT_SECRET` therefore invalidates persisted refresh tokens; PRISM will re-prompt the operator for OAuth on next use.

---

## 4. PAD integrity hash

The Permanent Active Directives SHA-256 is computed by `scripts/compute-directive-hash.cjs` on every `npm run prebuild` and persisted to `src/core/security/directive-hash.generated.ts`. Any intentional change to `Permanent_Active_Directives.txt` MUST be accompanied by:

1. The committed regeneration of `directive-hash.generated.ts` (CI fails otherwise).
2. A `CHANGELOG.md` entry under "Governance" describing the amendment.
3. Approval from the Governance Council recorded in the PR description per Law 10.

---

## 5. Incident response

If a private key, JWT secret, OAuth client secret, or PAD hash is suspected to be compromised:

1. Rotate the affected secret immediately per the rotation steps above.
2. File an incident under [`docs/ERROR_RECOVERY.md`](ERROR_RECOVERY.md) §"Security Incidents."
3. Run `npm run release:validate:strict` to confirm no signed artifact references the compromised key.
4. If a plugin pack signed with a compromised key has been distributed, publish a revocation entry under `config/plugin-signing-keys.json` with `expiresAt` set to a past date and notify all known operators.
