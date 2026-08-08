# PAD Governance Erratum Update Runbook

This runbook applies a previously ratified, exact PAD correction without treating an arbitrary Law edit as an amendment. The active PAD remains authoritative until the candidate, prior detached signature, erratum record, and governance private key all pass verification.

## Files

- Active signed PAD: `Permanent_Active_Directives.txt`
- Candidate correction: `Permanent_Active_Directives-corrected.txt`
- Erratum record: `config/governance-errata/E-2026-001.json`
- Detached signature: `config/permanent-active-directives.signature.json`
- Public key registry: `config/governance-signing-keys.json`

The private governance key must remain outside the repository.

## 1. Inspect

```powershell
npm run governance:erratum:status
```

`status` never modifies files and always reports the blocking conditions. The active PAD must match `previousPadHash` and its existing detached signature. The candidate must match `correctedPadHash` and contain the registered corrected Law 4 text.

## 2. Blocking Preflight

```powershell
npm run governance:erratum:check
```

Do not proceed unless it reports `ready=true`. A file with restored wording but changed metadata, whitespace, encoding, or line endings is not the signed prior artifact and will be rejected.

If the active file is not the exact signed prior artifact, locate a matching version in Git history:

```powershell
npm run governance:erratum:locate-base
```

For `E-2026-001`, the signed base is the Windows CRLF checkout of `Permanent_Active_Directives.txt` from commit `6f45e41fed4ec451737c8c75fc87200222dafde5`. The locator derives checkout line endings deterministically and accepts the result only when both `previousPadHash` and the detached Ed25519 signature verify.

Restore only that cryptographically matched version, with the current local files backed up automatically:

```powershell
npm run governance:erratum:restore-base
npm run governance:erratum:check
```

`restore-base` refuses any historical file whose bytes do not match `previousPadHash` or whose detached signature does not verify. An explicit commit may be supplied as `npm run governance:erratum:restore-base -- --commit <sha>`.

## 3. Apply And Sign

Mount or otherwise make the original private PEM available outside the repository, then run:

```powershell
npm run governance:erratum:apply -- --private-key "E:\secure\governance-pad-signing.pem"
```

The command verifies that the private key derives the public key registered under `prism-governance-pad-2026-07`. It then:

1. Creates a timestamped backup under `state/governance-erratum-backups/`.
2. Atomically replaces the active PAD with the exact candidate bytes.
3. Regenerates the embedded directive hash.
4. Creates the detached Ed25519 PAD signature.
5. Regenerates the governance artifact manifest.
6. Runs the directive integrity and signature gate.
7. Restores all backed-up governed files if any step fails.

The command does not generate, rotate, copy, or commit the private key.

### Lost Or Compromised Signing Key

Do not substitute an unrelated key or overwrite the public-key registry. After explicit Founder authorization, generate a successor key outside the repository and apply the correction transactionally:

```powershell
npm run governance:erratum:rotate-apply -- `
  --private-key "$HOME\.prism\governance\prism-governance-pad-2026-08-r1.pem" `
  --confirm-founder-authorization
```

The command refuses to overwrite an existing key. It preserves the prior public key for historical verification, revokes it for new signatures, creates `R-2026-001`, self-signs the canonical rotation payload, applies and signs the exact registered correction, and rolls back both repository artifacts and the newly generated key on failure.

After success, restrict and back up the private key in an operator-controlled encrypted secret store. Verify public continuity evidence at any time:

```powershell
npm run governance:key-rotation:verify
```

## 4. Validate And Commit

```powershell
npm run build
npm run governance:artifacts:check
npm run security:directive-integrity
npm test
git diff --check
```

Review the coordinated governance diff, then create an authorized GPG- or SSH-signed Git commit. The erratum remains `approved_pending_signature` until both the detached PAD signature and the authorized Git commit have been independently verified and recorded as effective.

## Recovery

An application failure rolls back automatically. Do not manually mix a corrected PAD with the prior detached signature or generated hash. If manual recovery is required, use the latest timestamped directory under `state/governance-erratum-backups/` as a complete governed-file set.
