import * as assert from "assert";
import { createSign, generateKeyPairSync } from "crypto";
import { describe, it } from "mocha";
import { BusinessTrustValidator } from "../src/core/plugins/business-trust-validator.js";
import type { PluginPackManifest } from "../src/core/plugins/plugin-pack-validator.js";

function createBaseManifest(): PluginPackManifest {
    return {
        manifest_version: "1.0",
        pack_name: "trusted-pack",
        pack_version: "1.0.0",
        description: "Business-qualified plugin pack",
        author: {
            name: "Trusted Engineering",
            email: "eng@prism.dev",
        },
        license: "MIT",
        repository: {
            type: "git",
            url: "https://github.com/prism/trusted-pack",
        },
        adapters: [
            {
                adapter_id: "trusted-adapter",
                adapter_type: "application",
                entry_file: "dist/src/index.js",
                capabilities: ["execute_command"],
                tier_routing: {
                    default_tier: 2,
                },
                trust_level: "verified",
            },
        ],
        compatibility: {
            prism_min_version: "0.1.0",
            profiles: ["both"],
        },
        security: {
            review_status: "security-reviewed",
            signature_algorithm: "rsa-2048",
            signature: "",
            known_issues: [],
        },
        metadata: {
            released: "2026-03-10T00:00:00.000Z",
        },
    };
}

describe("Business Trust Validator", () => {
    it("allows trusted and correctly signed manifest for business profile", () => {
        const validator = new BusinessTrustValidator();
        const manifest = createBaseManifest();
        const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

        const signer = createSign("RSA-SHA256");
        signer.update(validator.buildSignablePayload(manifest));
        signer.end();
        manifest.security!.signature = signer.sign(keyPair.privateKey).toString("base64");

        const result = validator.validate(manifest, {
            executionProfile: "business",
            publicKeyPem: keyPair.publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
        });

        assert.strictEqual(result.allowed, true);
        assert.strictEqual(result.decision, "allow");
        assert.strictEqual(result.reasonCodes.length, 0);
        assert.strictEqual(result.evidence.signatureVerified, true);
    });

    it("denies business profile when trust level is below minimum", () => {
        const validator = new BusinessTrustValidator();
        const manifest = createBaseManifest();
        manifest.adapters[0].trust_level = "community";

        const result = validator.validate(manifest, {
            executionProfile: "business",
        });

        assert.strictEqual(result.allowed, false);
        assert.ok(result.reasonCodes.includes("TRUST_LEVEL_BELOW_MIN"));
    });

    it("denies business profile when signature is missing", () => {
        const validator = new BusinessTrustValidator();
        const manifest = createBaseManifest();
        delete manifest.security!.signature;

        const result = validator.validate(manifest, {
            executionProfile: "business",
        });

        assert.strictEqual(result.allowed, false);
        assert.ok(result.reasonCodes.includes("SIGNATURE_REQUIRED"));
    });

    it("denies business profile when repository host is not allow-listed", () => {
        const validator = new BusinessTrustValidator();
        const manifest = createBaseManifest();
        manifest.repository!.url = "https://example.com/unknown/repo";

        const result = validator.validate(manifest, {
            executionProfile: "business",
        });

        assert.strictEqual(result.allowed, false);
        assert.ok(result.reasonCodes.includes("REPOSITORY_HOST_NOT_ALLOWED"));
    });

    it("denies business profile when future release date is provided", () => {
        const validator = new BusinessTrustValidator();
        const manifest = createBaseManifest();
        manifest.metadata!.released = "2099-01-01T00:00:00.000Z";

        const result = validator.validate(manifest, {
            executionProfile: "business",
            nowIso: "2026-03-18T00:00:00.000Z",
        });

        assert.strictEqual(result.allowed, false);
        assert.ok(result.reasonCodes.includes("RELEASE_DATE_IN_FUTURE"));
    });

    it("denies business profile for unmitigated critical issues", () => {
        const validator = new BusinessTrustValidator();
        const manifest = createBaseManifest();
        manifest.security!.known_issues = [
            {
                id: "CVE-TEST-001",
                severity: "critical",
                description: "Critical issue",
                mitigated: false,
            },
        ];

        const result = validator.validate(manifest, {
            executionProfile: "business",
        });

        assert.strictEqual(result.allowed, false);
        assert.ok(result.reasonCodes.includes("UNMITIGATED_CRITICAL_ISSUES"));
    });

    it("allows individual profile in advisory mode with warnings", () => {
        const validator = new BusinessTrustValidator();
        const manifest = createBaseManifest();
        manifest.adapters[0].trust_level = "untrusted";
        manifest.security = undefined;

        const result = validator.validate(manifest, {
            executionProfile: "individual",
        });

        assert.strictEqual(result.allowed, true);
        assert.strictEqual(result.decision, "allow");
        assert.ok(result.warnings.length > 0);
    });

    it("fails verification when signature does not match payload", () => {
        const validator = new BusinessTrustValidator();
        const manifest = createBaseManifest();
        const signerPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const verifierPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

        const signer = createSign("RSA-SHA256");
        signer.update(validator.buildSignablePayload(manifest));
        signer.end();
        manifest.security!.signature = signer.sign(signerPair.privateKey).toString("base64");

        const result = validator.validate(manifest, {
            executionProfile: "business",
            publicKeyPem: verifierPair.publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
        });

        assert.strictEqual(result.allowed, false);
        assert.ok(result.reasonCodes.includes("SIGNATURE_VERIFICATION_FAILED"));
    });
});
