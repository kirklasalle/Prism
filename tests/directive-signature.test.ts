import { describe, it, afterEach } from "mocha";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
    verifyDirectiveSignature,
    enforceDirectiveSignatureBootGate,
} from "../src/core/security/directive-signature.js";

describe("Directive Signature", function () {
    this.timeout(10_000);

    let tmpRoot = "";
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSkip = process.env.PRISM_SKIP_DIRECTIVE_SIGNATURE_BOOT_GATE;

    afterEach(() => {
        if (tmpRoot) {
            rmSync(tmpRoot, { recursive: true, force: true });
            tmpRoot = "";
        }
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = originalNodeEnv;
        }
        if (originalSkip === undefined) {
            delete process.env.PRISM_SKIP_DIRECTIVE_SIGNATURE_BOOT_GATE;
        } else {
            process.env.PRISM_SKIP_DIRECTIVE_SIGNATURE_BOOT_GATE = originalSkip;
        }
    });

    function setupSignedDirective(content = "directive body") {
        tmpRoot = mkdtempSync(join(tmpdir(), "prism-pad-sig-"));
        const configDir = join(tmpRoot, "config");
        const directivePath = join(tmpRoot, "Permanent_Active_Directives.txt");
        writeFileSync(directivePath, content, "utf8");
        mkdirSync(configDir, { recursive: true });

        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
        const signatureBase64 = sign(null, Buffer.from(content, "utf8"), privateKey).toString("base64");
        const sha256 = createHash("sha256").update(content, "utf8").digest("hex");

        writeFileSync(
            join(configDir, "governance-signing-keys.json"),
            JSON.stringify(
                {
                    version: 1,
                    keys: [
                        {
                            keyId: "test-key",
                            algorithm: "ed25519",
                            publicKeyBase64,
                            addedAt: new Date().toISOString(),
                            expiresAt: null,
                        },
                    ],
                },
                null,
                2,
            ),
            "utf8",
        );

        writeFileSync(
            join(configDir, "permanent-active-directives.signature.json"),
            JSON.stringify(
                {
                    keyId: "test-key",
                    algorithm: "ed25519",
                    signedAt: new Date().toISOString(),
                    file: "Permanent_Active_Directives.txt",
                    sha256,
                    signatureBase64,
                    formatVersion: 1,
                },
                null,
                2,
            ),
            "utf8",
        );
    }

    it("verifies a valid signed directive", () => {
        setupSignedDirective("signed directive");
        const result = verifyDirectiveSignature(tmpRoot);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.signatureVerified, true);
        assert.strictEqual(result.hashMatches, true);
    });

    it("fails when directive content is tampered", () => {
        setupSignedDirective("signed directive");
        writeFileSync(join(tmpRoot, "Permanent_Active_Directives.txt"), "tampered", "utf8");
        const result = verifyDirectiveSignature(tmpRoot);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.hashMatches, false);
    });

    it("boot gate throws on invalid signature unless bypassed", () => {
        setupSignedDirective("signed directive");
        writeFileSync(join(tmpRoot, "Permanent_Active_Directives.txt"), "tampered", "utf8");

        delete process.env.PRISM_SKIP_DIRECTIVE_SIGNATURE_BOOT_GATE;
        process.env.NODE_ENV = "test";
        assert.throws(
            () => enforceDirectiveSignatureBootGate({ workspaceRoot: tmpRoot }),
            /Directive signature check failed/,
        );

        process.env.PRISM_SKIP_DIRECTIVE_SIGNATURE_BOOT_GATE = "true";
        process.env.NODE_ENV = "development";
        const bypassed = enforceDirectiveSignatureBootGate({ workspaceRoot: tmpRoot });
        assert.strictEqual(bypassed.valid, false);
    });

    it("rejects bypass in production", () => {
        setupSignedDirective("signed directive");
        writeFileSync(join(tmpRoot, "Permanent_Active_Directives.txt"), "tampered", "utf8");
        process.env.PRISM_SKIP_DIRECTIVE_SIGNATURE_BOOT_GATE = "true";
        process.env.NODE_ENV = "production";
        assert.throws(
            () => enforceDirectiveSignatureBootGate({ workspaceRoot: tmpRoot }),
            /not permitted in production/,
        );
    });
});
