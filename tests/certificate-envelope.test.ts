/**
 * Phase 1 Security Test Suite — Canonical Certificate Envelope v1.0 & DPAPI Protection
 *
 * Tests:
 * 1. JCS RFC 8785 canonical serialization determinism.
 * 2. `issueCertificateV1` and `verifyCertificateV1` end-to-end lifecycle.
 * 3. Identity tuple tampering detection (IC-04).
 * 4. Machine-readable protocol discriminator enforcement (IC-09).
 * 5. DPAPI private key protection roundtrip (IC-01).
 * 6. Audited key rotation ceremony lineage (IC-01, IC-02, IC-12).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    issueCertificateV1,
    verifyCertificateV1,
    getOrGenerateKeyPair,
    verifyCertificateContent,
} from "../src/core/security/initialization-signature.js";
import {
    serializeCanonicalCertificate,
    parseCertificateEnvelopeV1,
    type InitializationCertificateEnvelopeV1,
} from "../src/core/security/certificate-envelope.js";
import {
    protectPrivateKeyPEM,
    unprotectPrivateKeyPEM,
} from "../src/core/security/dpapi-key-store.js";
import {
    loadOrCreateRegistry,
    performKeyRotationCeremony,
    isKeyTrusted,
} from "../src/core/security/key-registry.js";

describe("Phase 1 Trust Root Repair Suite", () => {
    let tmpDir: string;
    const originalEnv = process.env.PRISM_CONFIG_DIR;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-phase1-test-"));
        process.env.PRISM_CONFIG_DIR = tmpDir;
    });

    afterEach(() => {
        if (originalEnv) {
            process.env.PRISM_CONFIG_DIR = originalEnv;
        } else {
            delete process.env.PRISM_CONFIG_DIR;
        }
        if (existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── 1. Canonical Envelope Serialization (JCS RFC 8785) ────────────────

    describe("1. Canonical Envelope v1.0 & JCS Serialization (IC-04, IC-09)", () => {
        it("produces deterministic canonical JSON string regardless of key insertion order", () => {
            const envelope1: InitializationCertificateEnvelopeV1 = {
                format: "prism-initialization-certificate",
                version: "1.0",
                issuerKeyId: "abc1234567890def",
                sequence: 1,
                createdAt: "2026-07-31T22:00:00.000Z",
                identity: {
                    operatorEmail: "operator@example.com",
                    operatorName: "Kirk LaSalle",
                    cacEmail: "cac@example.com",
                    cacName: "CAC Main Agent",
                    locationName: "Engineering Dept",
                },
                provenance: {
                    padDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                    covenantVersion: "1.0",
                    covenantDigest: "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
                    workspaceRoot: "D:\\Projects\\PrismRefraction",
                },
            };

            const json1 = serializeCanonicalCertificate(envelope1);

            // Reconstruct object with reverse insertion order
            const envelope2: InitializationCertificateEnvelopeV1 = {
                provenance: { ...envelope1.provenance },
                identity: { ...envelope1.identity },
                createdAt: envelope1.createdAt,
                sequence: envelope1.sequence,
                issuerKeyId: envelope1.issuerKeyId,
                version: "1.0",
                format: "prism-initialization-certificate",
            };

            const json2 = serializeCanonicalCertificate(envelope2);

            assert.strictEqual(json1, json2, "Canonical serialization must be identical regardless of insertion order");
            assert.ok(!json1.includes("\n"), "Canonical JSON must not contain newlines");
            assert.ok(json1.startsWith('{"createdAt":'), "Keys must be sorted lexicographically");
        });

        it("issues and verifies a valid v1.0 certificate end-to-end", () => {
            const result = issueCertificateV1({
                operatorEmail: "kirk@example.com",
                operatorName: "Kirk LaSalle",
                cacEmail: "cac@prism.local",
                cacName: "CAC Main Assistant",
                locationName: "HQ Desktop",
                workspaceRoot: "D:\\Projects\\PrismRefraction",
            });

            assert.ok(result.markdown.includes("```json:prism-certificate-v1"));
            assert.ok(result.signatureBase64);
            assert.ok(result.publicKeyBase64);

            const verifyResult = verifyCertificateV1(result.markdown);
            assert.strictEqual(verifyResult.valid, true, "Certificate should be valid");
            assert.strictEqual(verifyResult.trusted, true, "Certificate issuer key should be trusted");
            assert.ok(verifyResult.envelope);
            assert.strictEqual(verifyResult.envelope.identity.operatorEmail, "kirk@example.com");
            assert.strictEqual(verifyResult.envelope.identity.operatorName, "Kirk LaSalle");
            assert.strictEqual(verifyResult.envelope.identity.cacEmail, "cac@prism.local");
            assert.strictEqual(verifyResult.envelope.identity.cacName, "CAC Main Assistant");
        });

        it("detects identity tuple tampering and rejects verification (IC-04)", () => {
            const result = issueCertificateV1({
                operatorEmail: "legit@example.com",
                operatorName: "Legit Operator",
                cacEmail: "cac@example.com",
                cacName: "Legit CAC",
                workspaceRoot: "D:\\Projects\\PrismRefraction",
            });

            // Tamper with operator email in Markdown envelope block
            const tamperedMarkdown = result.markdown.replace(
                '"operatorEmail": "legit@example.com"',
                '"operatorEmail": "attacker@example.com"',
            );

            const verifyResult = verifyCertificateV1(tamperedMarkdown);
            assert.strictEqual(verifyResult.valid, false, "Tampered identity tuple must fail signature verification");
            assert.ok(verifyResult.reason.includes("failed verification"));
        });
    });

    // ── 2. Windows DPAPI Key Protection (IC-01) ───────────────────────────

    describe("2. DPAPI Key Protection (IC-01)", () => {
        it("encrypts and decrypts PEM private keys without data corruption", () => {
            const pair = getOrGenerateKeyPair();
            const encrypted = protectPrivateKeyPEM(pair.privateKeyPem);

            if (process.platform === "win32") {
                assert.ok(!encrypted.includes("-----BEGIN PRIVATE KEY-----"), "DPAPI output must not contain raw PEM header on Windows");
            }

            const decrypted = unprotectPrivateKeyPEM(encrypted);
            assert.strictEqual(decrypted, pair.privateKeyPem, "Decrypted PEM must match original private key");
        });
    });

    // ── 3. Audited Key Rotation Ceremony (IC-01, IC-02, IC-12) ─────────────

    describe("3. Key Rotation Ceremony Lineage (IC-01, IC-12)", () => {
        it("performs rotation ceremony, revokes old key, and links supersedesKeyId lineage", () => {
            // First key pair
            const key1 = getOrGenerateKeyPair();
            const registry1 = loadOrCreateRegistry();
            const active1 = registry1.keys.find((k) => k.status === "active");
            assert.ok(active1);

            // Perform rotation ceremony
            const { publicKey } = generateKeyPairSync("ed25519");
            const newPubKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
            const rotation = performKeyRotationCeremony(newPubKeyBase64, "Audited Phase 1 key rotation");

            assert.ok(rotation.oldKey);
            assert.strictEqual(rotation.oldKey.status, "compromised");
            assert.strictEqual(rotation.oldKey.revocationReason, "Audited Phase 1 key rotation");

            assert.strictEqual(rotation.newKey.status, "active");
            assert.strictEqual(rotation.newKey.supersedesKeyId, rotation.oldKey.keyId);

            // Verify old key is no longer trusted
            const trustOld = isKeyTrusted(rotation.registry, key1.publicKeyBase64);
            assert.strictEqual(trustOld.trusted, false);
            assert.ok(trustOld.reason.includes("compromised"));

            // Verify new key is trusted
            const trustNew = isKeyTrusted(rotation.registry, newPubKeyBase64);
            assert.strictEqual(trustNew.trusted, true);
        });
    });
});
