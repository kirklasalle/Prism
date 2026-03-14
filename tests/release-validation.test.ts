import assert from "node:assert";
import { evaluateReleaseGates } from "../src/benchmarks/release-validation.js";

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
        },
        stagingValidated: false,
        rollbackRehearsed: false,
        runbooksCurrent: false,
        strictMode: true,
    });

    assert.strictEqual(strictFail.passed, false);
    assert.ok(strictFail.gates.filter((gate) => gate.requiredFor === "production").every((gate) => gate.status === "failed"));

    const candidateFail = evaluateReleaseGates({
        commandResults: [
            { command: "node dist/tests/index.js", ok: false },
            { command: "node dist/src/benchmarks/tool-contract-snapshot.js", ok: true },
            { command: "node dist/src/benchmarks/performance-qualification.js", ok: true },
        ],
        artifactsPresent: {
            perfQualification: true,
            contractSnapshot: true,
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

    console.log("✓ Release validation gates tests passed");
}
