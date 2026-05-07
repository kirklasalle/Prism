/**
 * Phase F-F — Release artifact signing round-trip tests.
 */

import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    sha256Hex,
    signArtifact,
    verifyArtifactSignature,
    verifyArtifactWithSidecar,
    findReleaseKey,
    type ReleaseSigningKeyRegistry,
} from "../src/core/security/artifact-signature.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testArtifactSignature(): Promise<void> {
    const tmp = mkdtempSync(join(tmpdir(), "prism-artifact-sig-"));
    try {
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
        const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

        const artifactBytes = Buffer.from("Phase F-F sample release tarball contents 0123456789", "utf-8");
        const { signature, manifest } = signArtifact(artifactBytes, privateKeyPem, "test-key", "sample.tar.gz");

        assert(manifest.algorithm === "ed25519", "ed25519 alg");
        assert(manifest.sha256 === sha256Hex(artifactBytes), "sha256 matches");
        assert(manifest.formatVersion === 1, "format v1");
        assert(verifyArtifactSignature(artifactBytes, signature, publicKeyBase64), "signature verifies");

        // Tampered artifact must fail.
        const tampered = Buffer.concat([artifactBytes, Buffer.from("X")]);
        assert(!verifyArtifactSignature(tampered, signature, publicKeyBase64), "tampered fails");

        // Registry-based verification.
        const registry: ReleaseSigningKeyRegistry = {
            version: 1,
            keys: [
                {
                    keyId: "test-key",
                    tier: "release",
                    algorithm: "ed25519",
                    publicKeyBase64,
                    addedAt: new Date().toISOString(),
                },
            ],
        };
        const verdict = verifyArtifactWithSidecar({ artifactBytes, signature, manifest, registry });
        assert(verdict.ok, `registry verify ok: ${verdict.reason}`);

        // Revoked key → reject.
        registry.keys[0].revokedAt = new Date().toISOString();
        const after = verifyArtifactWithSidecar({ artifactBytes, signature, manifest, registry });
        assert(!after.ok, "revoked key rejected");
        assert(findReleaseKey(registry, "test-key") === null, "revoked key not findable");
    } finally {
        try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
}
