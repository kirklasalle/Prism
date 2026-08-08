import assert from "node:assert";
import {
    createReleaseValidationEvidence,
    evaluateReleaseGates,
    mergeCurrentEvidence,
} from "../src/benchmarks/release-validation.js";
import type { EvidenceManifest } from "../src/core/governance/evidence-manifest.js";

export async function testReleaseValidationGates(): Promise<void> {
    const permissive = evaluateReleaseGates({
        commandResults: [
            { command: "node dist/tests/index.js", ok: true },
            { command: "node dist/src/benchmarks/tool-contract-snapshot.js", ok: true },
            { command: "node dist/src/benchmarks/performance-qualification.js", ok: true },
        ],
        artifactsPresent: {
            perfQualification: true,
            contractSnapshot: true,
            cuBgValidation: true,
        },
        stagingValidated: false,
        rollbackRehearsed: false,
        runbooksCurrent: false,
        strictMode: false,
    });

    assert.strictEqual(permissive.passed, true);
    assert.ok(permissive.gates.some((gate) => gate.status === "manual_required"));

    const strictFail = evaluateReleaseGates({
        commandResults: [
            { command: "node dist/tests/index.js", ok: true },
            { command: "node dist/src/benchmarks/tool-contract-snapshot.js", ok: true },
            { command: "node dist/src/benchmarks/performance-qualification.js", ok: true },
        ],
        artifactsPresent: {
            perfQualification: true,
            contractSnapshot: true,
            cuBgValidation: true,
        },
        stagingValidated: false,
        rollbackRehearsed: false,
        runbooksCurrent: false,
        strictMode: true,
    });

    assert.strictEqual(strictFail.passed, false);
    assert.ok(
        strictFail.gates.filter((gate) => gate.requiredFor === "production").every((gate) => gate.status === "failed"),
    );

    const candidateFail = evaluateReleaseGates({
        commandResults: [
            { command: "node dist/tests/index.js", ok: false },
            { command: "node dist/src/benchmarks/tool-contract-snapshot.js", ok: true },
            { command: "node dist/src/benchmarks/performance-qualification.js", ok: true },
        ],
        artifactsPresent: {
            perfQualification: true,
            contractSnapshot: true,
            cuBgValidation: true,
        },
        stagingValidated: true,
        rollbackRehearsed: true,
        runbooksCurrent: true,
        strictMode: true,
    });

    assert.strictEqual(candidateFail.passed, false);
    const testsGate = candidateFail.gates.find((gate) => gate.id === "candidate-tests");
    assert.ok(testsGate);
    assert.strictEqual(testsGate!.status, "failed");

    const releaseEvidence = createReleaseValidationEvidence([], "commit-abc", "build-123", "2026-08-08T00:00:00.000Z");
    const governanceEvidence: EvidenceManifest = {
        format: "prism-governance-evidence",
        version: 1,
        commit: "commit-abc",
        buildId: "build-123",
        generatedAt: "2026-08-08T00:00:00.000Z",
        records: [
            {
                evidenceId: "evidence-envelope",
                probeId: "security.certificate-envelope",
                probeVersion: 1,
                result: "passed",
                commit: "commit-abc",
                buildId: "build-123",
                evaluatedAt: "2026-08-08T00:00:00.000Z",
                inputDigest: "a".repeat(64),
                outputDigest: "b".repeat(64),
            },
        ],
    };
    const merged = mergeCurrentEvidence(releaseEvidence, governanceEvidence);
    assert.deepEqual(merged.errors, []);
    assert.equal(merged.manifest.records.length, 1);

    const stale = mergeCurrentEvidence(releaseEvidence, { ...governanceEvidence, buildId: "old-build" });
    assert.ok(stale.errors.some((error) => error.includes("does not match")));
    assert.equal(stale.manifest.records.length, 0);

    console.log("✓ Release validation gates tests passed");
}
