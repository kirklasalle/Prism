import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type GateStatus = "passed" | "failed" | "manual_required";

interface ReleaseGateResult {
    id: string;
    label: string;
    status: GateStatus;
    requiredFor: "candidate" | "production";
    details?: string;
}

interface ReleaseValidationArtifact {
    generatedAt: string;
    strictMode: boolean;
    metadata: {
        buildId: string;
        commit: string;
        environmentProfile: string;
        nodeVersion: string;
    };
    commandResults: Array<{
        command: string;
        ok: boolean;
        exitCode: number;
    }>;
    artifacts: {
        perfQualification: string;
        contractSnapshot: string;
        releaseValidation: string;
    };
    gates: ReleaseGateResult[];
    passed: boolean;
}

export interface ReleaseGateEvaluationInput {
    commandResults: Array<{ command: string; ok: boolean }>;
    artifactsPresent: {
        perfQualification: boolean;
        contractSnapshot: boolean;
    };
    stagingValidated: boolean;
    rollbackRehearsed: boolean;
    runbooksCurrent: boolean;
    strictMode: boolean;
}

export function evaluateReleaseGates(input: ReleaseGateEvaluationInput): {
    gates: ReleaseGateResult[];
    passed: boolean;
} {
    const testsPassed = input.commandResults
        .filter((entry) => entry.command.includes("dist/tests/index.js"))
        .every((entry) => entry.ok);
    const perfPassed = input.commandResults
        .filter((entry) => entry.command.includes("performance-qualification"))
        .every((entry) => entry.ok);
    const contractsPassed = input.commandResults
        .filter((entry) => entry.command.includes("tool-contract-snapshot"))
        .every((entry) => entry.ok);

    const gates: ReleaseGateResult[] = [
        {
            id: "candidate-tests",
            label: "Full test suite passes",
            requiredFor: "candidate",
            status: testsPassed ? "passed" : "failed",
        },
        {
            id: "candidate-contracts",
            label: "Contract snapshot generated",
            requiredFor: "candidate",
            status: contractsPassed && input.artifactsPresent.contractSnapshot ? "passed" : "failed",
        },
        {
            id: "candidate-performance",
            label: "Performance qualification generated",
            requiredFor: "candidate",
            status: perfPassed && input.artifactsPresent.perfQualification ? "passed" : "failed",
        },
        {
            id: "production-staging",
            label: "Staging validation confirmed",
            requiredFor: "production",
            status: input.stagingValidated ? "passed" : (input.strictMode ? "failed" : "manual_required"),
            details: "Set PRISM_STAGING_VALIDATED=1 when staging qualification is complete.",
        },
        {
            id: "production-rollback",
            label: "Rollback rehearsal confirmed",
            requiredFor: "production",
            status: input.rollbackRehearsed ? "passed" : (input.strictMode ? "failed" : "manual_required"),
            details: "Set PRISM_ROLLBACK_REHEARSED=1 after rollback drill.",
        },
        {
            id: "production-runbooks",
            label: "Runbook/doc currency confirmed",
            requiredFor: "production",
            status: input.runbooksCurrent ? "passed" : (input.strictMode ? "failed" : "manual_required"),
            details: "Set PRISM_RUNBOOKS_CURRENT=1 once docs are reviewed.",
        },
    ];

    const hasFailedGate = gates.some((gate) => gate.status === "failed");
    return {
        gates,
        passed: !hasFailedGate,
    };
}

async function main(): Promise<void> {
    const strictMode = process.argv.includes("--strict") || process.env.PRISM_RELEASE_STRICT === "1";
    const outputPath = process.env.PRISM_RELEASE_VALIDATION_OUTPUT_PATH ?? "prism-output/release-validation.json";
    const perfPath = process.env.PRISM_PERF_OUTPUT_PATH ?? "prism-output/perf-qualification.json";
    const contractPath = process.env.PRISM_CONTRACT_SNAPSHOT_OUTPUT_PATH ?? "prism-output/tool-contract-snapshot.json";

    const commands = [
        "node dist/tests/index.js",
        "node dist/src/benchmarks/tool-contract-snapshot.js",
        "node dist/src/benchmarks/performance-qualification.js",
    ];

    const commandResults: Array<{ command: string; ok: boolean; exitCode: number }> = [];
    for (const command of commands) {
        const result = runCommand(command);
        commandResults.push(result);
        if (!result.ok) {
            break;
        }
    }

    const evaluation = evaluateReleaseGates({
        commandResults,
        artifactsPresent: {
            perfQualification: existsSync(perfPath),
            contractSnapshot: existsSync(contractPath),
        },
        stagingValidated: process.env.PRISM_STAGING_VALIDATED === "1",
        rollbackRehearsed: process.env.PRISM_ROLLBACK_REHEARSED === "1",
        runbooksCurrent: process.env.PRISM_RUNBOOKS_CURRENT === "1",
        strictMode,
    });

    const artifact: ReleaseValidationArtifact = {
        generatedAt: new Date().toISOString(),
        strictMode,
        metadata: {
            buildId: process.env.PRISM_BUILD_ID ?? resolveBuildId(),
            commit: resolveCommitHash(),
            environmentProfile: process.env.PRISM_ENV_PROFILE ?? "dev",
            nodeVersion: process.version,
        },
        commandResults,
        artifacts: {
            perfQualification: perfPath,
            contractSnapshot: contractPath,
            releaseValidation: outputPath,
        },
        gates: evaluation.gates,
        passed: evaluation.passed,
    };

    await writeArtifact(outputPath, artifact);

    console.log("\nPRISM release validation");
    for (const gate of artifact.gates) {
        const marker = gate.status === "passed" ? "PASS" : gate.status === "failed" ? "FAIL" : "MANUAL";
        console.log(`- [${marker}] ${gate.label}`);
    }
    console.log(`- Artifact: ${outputPath}`);

    if (!artifact.passed) {
        process.exitCode = 1;
    }
}

function runCommand(command: string): { command: string; ok: boolean; exitCode: number } {
    const shell = process.platform === "win32" ? "cmd.exe" : undefined;
    const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : undefined;
    const result = spawnSync(shell ?? command, args ?? [], {
        shell: process.platform !== "win32",
        stdio: "inherit",
        cwd: process.cwd(),
    });
    const exitCode = typeof result.status === "number" ? result.status : 1;
    return { command, ok: exitCode === 0, exitCode };
}

function resolveBuildId(): string {
    const dateStamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `build-${dateStamp}`;
}

function resolveCommitHash(): string {
    const command = process.platform === "win32" ? "cmd.exe" : "git";
    const args = process.platform === "win32"
        ? ["/d", "/s", "/c", "git rev-parse --short HEAD"]
        : ["rev-parse", "--short", "HEAD"];
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0 && typeof result.stdout === "string") {
        const value = result.stdout.trim();
        if (value.length > 0) {
            return value;
        }
    }
    return "unknown";
}

async function writeArtifact(pathValue: string, payload: unknown): Promise<void> {
    const normalized = pathValue.replaceAll("\\", "/");
    const slash = normalized.lastIndexOf("/");
    const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
    await mkdir(dir, { recursive: true });
    await writeFile(normalized, JSON.stringify(payload, null, 2), "utf-8");
}

const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1];
if (entryPath && modulePath === entryPath) {
    void main();
}
