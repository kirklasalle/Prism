import assert from "node:assert";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import {
    attestConfiguration,
    configurationDigest,
    configurationDrift,
    governedConfiguration,
    verifyConfigurationAttestation,
} from "../src/core/governance/configuration-attestation.js";

describe("Governed configuration attestation", () => {
    it("excludes cosmetic and enrollment fields while canonicalizing authority settings", () => {
        const first = governedConfiguration({
            lastModified: "one",
            uiMode: "simple",
            setupToken: "secret-one",
            runtimeSettings: { beta: true, alpha: 1 },
            disabledAddons: ["zeta", "alpha"],
        }, {});
        const second = governedConfiguration({
            lastModified: "two",
            uiMode: "advanced",
            setupToken: "secret-two",
            runtimeSettings: { alpha: 1, beta: true },
            disabledAddons: ["alpha", "zeta"],
        }, {});

        assert.equal(configurationDigest(first), configurationDigest(second));
    });

    it("names changed authority fields", () => {
        const expected = governedConfiguration({ lastModified: "", executionProfileSegment: "individual" }, {});
        const actual = governedConfiguration({ lastModified: "", executionProfileSegment: "business" }, {});

        assert.deepEqual(configurationDrift(expected, actual), ["preferences.executionProfileSegment"]);
    });

    it("verifies a release-key attestation and rejects configuration drift", () => {
        const { privateKey, publicKey } = generateKeyPairSync("ed25519");
        const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
        const publicDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
        const configuration = governedConfiguration({ lastModified: "", executionProfileSegment: "individual" }, {});
        const attestation = attestConfiguration(configuration, privatePem, "release-config-test", "2026-08-08T00:00:00.000Z");
        const registry = {
            keys: [{
                keyId: "release-config-test",
                tier: "release" as const,
                algorithm: "ed25519" as const,
                publicKeyBase64: publicDer,
            }],
        };

        assert.equal(verifyConfigurationAttestation(configuration, attestation, registry).valid, true);
        const drifted = governedConfiguration({ lastModified: "", executionProfileSegment: "business" }, {});
        assert.equal(verifyConfigurationAttestation(drifted, attestation, registry).valid, false);
    });
});
