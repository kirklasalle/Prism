import assert from "node:assert";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { GOVERNANCE_CONTROLS, validateControlRegistry } from "../src/core/governance/control-registry.js";
import {
    evidenceManifestDigest,
    type EvidenceManifest,
    type EvidenceRecord,
} from "../src/core/governance/evidence-manifest.js";
import {
    evaluateReleaseAcceptanceGates,
    issueReleaseAcceptanceCertificate,
} from "../src/core/security/release-acceptance-verification.js";

const DIGEST = "a".repeat(64);
const NOW = new Date("2026-08-01T12:00:00.000Z");

function buildManifest(overrides: Partial<EvidenceRecord> = {}): EvidenceManifest {
    const requirements = GOVERNANCE_CONTROLS.flatMap((control) => control.evidenceRequirements);
    return {
        format: "prism-governance-evidence",
        version: 1,
        commit: "commit-abc",
        buildId: "build-123",
        generatedAt: NOW.toISOString(),
        records: requirements.map((requirement, index) => ({
            evidenceId: `evidence-${index + 1}`,
            probeId: requirement.probeId,
            probeVersion: requirement.probeVersion,
            result: "passed",
            commit: "commit-abc",
            buildId: "build-123",
            evaluatedAt: NOW.toISOString(),
            inputDigest: DIGEST,
            outputDigest: DIGEST,
            ...overrides,
        })),
    };
}

describe("Release acceptance verification", () => {
    let configDir: string;
    let originalConfigDir: string | undefined;

    beforeEach(() => {
        configDir = mkdtempSync(join(tmpdir(), "prism-release-evidence-"));
        originalConfigDir = process.env.PRISM_CONFIG_DIR;
        process.env.PRISM_CONFIG_DIR = configDir;
    });

    afterEach(() => {
        if (originalConfigDir === undefined) delete process.env.PRISM_CONFIG_DIR;
        else process.env.PRISM_CONFIG_DIR = originalConfigDir;
        rmSync(configDir, { recursive: true, force: true });
    });

    it("fails closed when executable evidence is not wired", () => {
        const result = evaluateReleaseAcceptanceGates();

        assert.equal(result.certified, false);
        assert.equal(result.passedCount, 0);
        assert.equal(result.signatureBase64, "");
        assert.equal(result.gateResults.length, 15);
        assert.ok(result.gateResults.every((gate) => gate.passed === false));
        assert.ok(result.gateResults.every((gate) => gate.evidence.startsWith("NOT EVALUATED")));
        assert.match(result.certificateMarkdown, /RELEASE BLOCKED/);
        assert.doesNotMatch(result.certificateMarkdown, /Certification Signature/);
    });

    it("does not generate signing material while evaluating a blocked release", () => {
        evaluateReleaseAcceptanceGates();

        assert.equal(existsSync(join(configDir, "initialization_keys.enc")), false);
        assert.equal(existsSync(join(configDir, "initialization_key_registry.json")), false);
    });

    it("maps all 15 gates to registered evidence probes", () => {
        assert.deepEqual(validateControlRegistry(), []);
        assert.deepEqual(
            GOVERNANCE_CONTROLS.map((control) => control.gateNumber),
            Array.from({ length: 15 }, (_, index) => index + 1),
        );
        assert.ok(GOVERNANCE_CONTROLS.every((control) => control.evidenceRequirements.length > 0));
    });

    it("passes only with complete current evidence for the requested build", () => {
        const manifest = buildManifest();
        const result = evaluateReleaseAcceptanceGates(manifest, {
            commit: "commit-abc",
            buildId: "build-123",
            now: NOW,
        });

        assert.equal(result.certified, true);
        assert.equal(result.passedCount, 15);
        assert.ok(result.gateResults.every((gate) => gate.status === "passed"));
        assert.equal(result.evidenceManifestDigest, evidenceManifestDigest(manifest));
        assert.match(result.certificateMarkdown, new RegExp(result.evidenceManifestDigest));
        assert.equal(result.signatureBase64, "");
    });

    it("blocks evidence from the wrong commit or build", () => {
        const result = evaluateReleaseAcceptanceGates(buildManifest(), {
            commit: "different-commit",
            buildId: "different-build",
            now: NOW,
        });

        assert.equal(result.certified, false);
        assert.equal(result.passedCount, 0);
        assert.ok(result.gateResults.every((gate) => gate.status === "not_evaluated"));
    });

    it("blocks stale and failed evidence", () => {
        const staleResult = evaluateReleaseAcceptanceGates(
            buildManifest({ evaluatedAt: "2026-07-01T00:00:00.000Z" }),
            { commit: "commit-abc", buildId: "build-123", now: NOW },
        );
        const failedManifest = buildManifest({ result: "failed", failureReason: "probe assertion failed" });
        const failedResult = evaluateReleaseAcceptanceGates(failedManifest, {
            commit: "commit-abc",
            buildId: "build-123",
            now: NOW,
        });

        assert.equal(staleResult.certified, false);
        assert.ok(staleResult.gateResults.some((gate) => gate.status === "not_evaluated"));
        assert.equal(failedResult.certified, false);
        assert.ok(failedResult.gateResults.some((gate) => gate.status === "failed"));
    });

    it("refuses blocked assessments and signs passing ones with an explicit release key", () => {
        assert.throws(
            () => issueReleaseAcceptanceCertificate(evaluateReleaseAcceptanceGates(), "invalid", "release-test"),
            /cannot be issued/,
        );
        const assessment = evaluateReleaseAcceptanceGates(buildManifest(), {
            commit: "commit-abc",
            buildId: "build-123",
            now: NOW,
        });
        const { privateKey } = generateKeyPairSync("ed25519");
        const issued = issueReleaseAcceptanceCertificate(
            assessment,
            privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
            "release-test",
        );

        assert.notEqual(issued.signatureBase64, "");
        assert.equal(issued.signatureManifest.keyId, "release-test");
        assert.match(issued.certificateMarkdown, /Certification Signature/);
    });
});
