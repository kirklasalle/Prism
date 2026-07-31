/**
 * Negative Security Test Suite — Attack Scenarios & Boundary Gates (IC-10)
 *
 * Tests the 5 critical attack scenarios from Section 8 of the Security Audit:
 *   1. Scenario 8.1: Forged Replacement Certificate (Self-Embedded Key).
 *   2. Scenario 8.2: Forgery via Revoked Issuer Key.
 *   3. Scenario 8.3: Certificate Erasure Attempt.
 *   4. Scenario 8.4: Identity Substitution at Execution.
 *   5. Scenario 8.5: Silent Trust-Root Reset Prevention.
 *   6. Hash-Chain Audit Tampering Detection.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPrivateKey, sign } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    issueCertificateV1,
    verifyCertificateV1,
    getOrGenerateKeyPair,
    KeyMaterialError,
} from "../src/core/security/initialization-signature.js";
import {
    serializeCanonicalCertificate,
    type InitializationCertificateEnvelopeV1,
} from "../src/core/security/certificate-envelope.js";
import {
    loadOrCreateRegistry,
    saveRegistry,
    revokeKey,
    computeKeyFingerprint,
} from "../src/core/security/key-registry.js";
import {
    validateAuthorityContext,
    enforceAuthorityContext,
    ExecutionAuthorityError,
    type ExecutionAuthorityContext,
} from "../src/core/security/execution-authority-context.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import {
    verifyEventChain,
    createAuditCheckpoint,
    verifyAuditCheckpoint,
    GENESIS_PREVIOUS_HASH,
    type HashChainedEvent,
} from "../src/core/activity/hash-chained-audit.js";

describe("Negative Security & Attack Scenario Suite (IC-10)", () => {
    let tmpDir: string;
    let originalEnv: string | undefined;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-negative-test-"));
        originalEnv = process.env.PRISM_CONFIG_DIR;
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

    // ── Scenario 8.1: Forged Replacement Certificate ─────────────────────

    it("Scenario 8.1: Rejects certificate signed by self-embedded unpinned public key", () => {
        // Attacker generates their own key pair
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const attackerPubKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
        const attackerPrivateKey = createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }).toString());

        // Attacker signs a forged envelope using canonical JCS serialization
        const envelope: InitializationCertificateEnvelopeV1 = {
            format: "prism-initialization-certificate",
            version: "1.0",
            issuerKeyId: "forged1234567890",
            sequence: 1,
            createdAt: new Date().toISOString(),
            identity: {
                operatorEmail: "operator@prismrefraction.com",
                operatorName: "Legit Operator",
                cacEmail: "cac@prismrefraction.com",
                cacName: "CAC Main Agent",
                locationName: "HQ",
            },
            provenance: {
                padDigest: null,
                covenantVersion: "1.0",
                covenantDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                workspaceRoot: "D:\\Projects\\PrismRefraction",
            },
        };

        const canonicalPayload = serializeCanonicalCertificate(envelope);
        const sig = sign(null, Buffer.from(canonicalPayload, "utf-8"), attackerPrivateKey).toString("base64");
        const prettyJson = JSON.stringify(envelope, null, 2);

        const forgedMarkdown = `# Forged Certificate

\`\`\`json:prism-certificate-v1
${prettyJson}
\`\`\`

## Cryptographic Signature Verification
- **Public Key:** ${attackerPubKeyBase64}
- **Signature:** ${sig}
`;

        const verifyResult = verifyCertificateV1(forgedMarkdown);
        assert.strictEqual(verifyResult.valid, true, "Signature over self payload is valid");
        assert.strictEqual(verifyResult.trusted, false, "Must fail pinned trust check because attacker key is not in registry");
        assert.ok(verifyResult.reason.includes("Unknown issuer key"));
    });

    // ── Scenario 8.2: Forgery via Revoked Issuer Key ──────────────────────

    it("Scenario 8.2: Rejects certificate signed by a revoked issuer key", () => {
        const pair = getOrGenerateKeyPair();
        const cert = issueCertificateV1({
            operatorEmail: "kirk@prismrefraction.com",
            operatorName: "Kirk LaSalle",
            cacEmail: "cac@prismrefraction.com",
            cacName: "CAC Main Agent",
            workspaceRoot: "D:\\Projects\\PrismRefraction",
        });

        // Revoke the issuer key in the registry
        const registry = loadOrCreateRegistry();
        const fingerprint = computeKeyFingerprint(pair.publicKeyBase64);
        revokeKey(registry, fingerprint, "Revoked due to security incident", "compromised");
        saveRegistry(registry);

        // Verification must now fail trust check
        const verifyResult = verifyCertificateV1(cert.markdown);
        assert.strictEqual(verifyResult.valid, true);
        assert.strictEqual(verifyResult.trusted, false, "Certificate signed by revoked key must be untrusted");
        assert.ok(verifyResult.reason.includes("marked as compromised"));
    });

    // ── Scenario 8.3: Certificate Erasure Attempt ────────────────────────

    it("Scenario 8.3: Blocks certificate session deletion at trigger level", () => {
        const dbPath = join(tmpDir, "erasure.db");
        const store = new ChatSessionStore(dbPath);

        const session = store.createSession({
            title: "PRISM Initialization Certificate — Delete Test",
            operatorEmail: "kirk@prismrefraction.com",
        });

        // Attempting to delete session throws forbidden error
        assert.throws(
            () => store.deleteSession(session.sessionId),
            /Deletion of immutable Initialization Certificate session is forbidden/,
            "Session deletion must be blocked by SQLite trigger",
        );

        store.close();
    });

    // ── Scenario 8.4: Identity Substitution at Execution ─────────────────

    it("Scenario 8.4: Rejects caller-supplied authority context overrides", () => {
        const callerSupplied: ExecutionAuthorityContext = {
            certificateId: "cert-123",
            assignmentId: "asgn-456",
            operatorEmail: "forged@example.com",
            operatorName: "Forged User",
            cacEmail: "cac@example.com",
            cacName: "CAC",
            resolvedAt: new Date().toISOString(),
            resolvedBy: "caller",
        };

        const result = validateAuthorityContext(callerSupplied);
        assert.strictEqual(result.valid, false);
        assert.ok(result.reason.includes("caller-supplied identity is forbidden"));

        assert.throws(
            () => enforceAuthorityContext(callerSupplied),
            (err: any) => err instanceof ExecutionAuthorityError && err.message.includes("EXECUTION_BLOCKED"),
        );
    });

    // ── Scenario 8.5: Silent Trust-Root Reset ─────────────────────────────

    it("Scenario 8.5: Fails closed on corrupt key material on disk without silent regeneration", () => {
        // Write corrupt JSON to initialization_keys.enc
        const encPath = join(tmpDir, "initialization_keys.enc");
        writeFileSync(encPath, "{ corrupt: true }", "utf-8");

        assert.throws(
            () => getOrGenerateKeyPair(),
            (err: any) => err instanceof KeyMaterialError && err.message.includes("Failed to load DPAPI key store"),
            "Must throw KeyMaterialError on corrupt key material",
        );

        // Verify forensic file copy was created
        const files = readdirSync(tmpDir);
        const hasCorruptCopy = files.some((f) => f.includes(".corrupt."));
        assert.ok(hasCorruptCopy, "Corrupt key file must be preserved for forensic analysis");
    });

    // ── Hash-Chain Audit Tampering Detection ─────────────────────────────

    it("detects hash chain tampering when an event in the middle is altered", () => {
        const bus = new ActivityBus();

        bus.emit({ sessionId: "s1", layer: "agent", operation: "boot", status: "succeeded", details: {} });
        bus.emit({ sessionId: "s1", layer: "agent", operation: "login", status: "succeeded", details: {} });
        bus.emit({ sessionId: "s1", layer: "agent", operation: "tool", status: "succeeded", details: {} });

        const events = [...bus.listEvents()];
        const initialCheck = verifyEventChain(events);
        assert.strictEqual(initialCheck.valid, true, "Initial chain must be valid");

        // Create signed checkpoint
        const checkpoint = createAuditCheckpoint(events);
        assert.ok(verifyAuditCheckpoint(checkpoint), "Checkpoint signature must be valid");

        // Tamper with middle event (#2)
        const tamperedEvents = JSON.parse(JSON.stringify(events)) as HashChainedEvent[];
        (tamperedEvents[1] as any).operation = "unauthorized_admin_override";

        const tamperedCheck = verifyEventChain(tamperedEvents);
        assert.strictEqual(tamperedCheck.valid, false, "Tampered chain must fail verification");
        assert.strictEqual(tamperedCheck.brokenAtIndex, 1, "Must pinpoint index 1 as broken");
    });
});
