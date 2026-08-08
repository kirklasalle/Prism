import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { workspacePath } from "../core/config/workspace-resolver.js";
import { resolveBuildIdentity } from "../core/governance/build-identity.js";
import {
    evidenceManifestDigest,
    evidenceValueDigest,
    validateEvidenceManifest,
    type EvidenceManifest,
    type EvidenceRecord,
} from "../core/governance/evidence-manifest.js";
import {
    evaluateReleaseAcceptanceGates,
    type SystemReleaseCertificate,
} from "../core/security/release-acceptance-verification.js";

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
        cuBgValidation: string;
        governanceEvidence: string;
        releaseValidation: string;
    };
    gates: ReleaseGateResult[];
    evidenceManifest: EvidenceManifest;
    evidenceManifestDigest: string;
    governanceEvidenceErrors: string[];
    governanceAcceptance: SystemReleaseCertificate;
    passed: boolean;
}

export function createReleaseValidationEvidence(
    gates: readonly ReleaseGateResult[],
    commit: string,
    buildId: string,
    evaluatedAt: string,
): EvidenceManifest {
    const records: EvidenceRecord[] = gates.map((gate) => ({
        evidenceId: `release-validation:${gate.id}:${buildId}`,
        probeId: `release-validation.${gate.id}`,
        probeVersion: 1,
        result: gate.status === "manual_required" ? "not_evaluated" : gate.status,
        commit,
        buildId,
        evaluatedAt,
        inputDigest: evidenceValueDigest({ gateId: gate.id, commit, buildId }),
        outputDigest: evidenceValueDigest(gate),
        failureReason: gate.status === "failed" ? gate.details ?? `${gate.label} failed` : undefined,
    }));
    return {
        format: "prism-governance-evidence",
        version: 1,
        commit,
        buildId,
        generatedAt: evaluatedAt,
        records,
    };
}

export function mergeCurrentEvidence(
    releaseEvidence: EvidenceManifest,
    governanceEvidence: EvidenceManifest | null,
): { manifest: EvidenceManifest; errors: string[] } {
    if (!governanceEvidence) return { manifest: releaseEvidence, errors: ["Governance evidence manifest is missing"] };
    const errors = validateEvidenceManifest(governanceEvidence, {
        commit: releaseEvidence.commit,
        buildId: releaseEvidence.buildId,
    });
    if (errors.length > 0) return { manifest: releaseEvidence, errors };

    const records = [...releaseEvidence.records];
    const evidenceIds = new Set(records.map((record) => record.evidenceId));
    for (const record of governanceEvidence.records) {
        if (evidenceIds.has(record.evidenceId)) {
            errors.push(`Duplicate evidenceId while merging manifests: ${record.evidenceId}`);
            continue;
        }
        evidenceIds.add(record.evidenceId);
        records.push(record);
    }
    return { manifest: { ...releaseEvidence, records }, errors };
}

export interface ReleaseGateEvaluationInput {
    commandResults: Array<{ command: string; ok: boolean }>;
    artifactsPresent: {
        perfQualification: boolean;
        contractSnapshot: boolean;
        cuBgValidation: boolean;
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
    const cuBgPassed = input.commandResults
        .filter((entry) => entry.command.includes("cu-bg-gate-check"))
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
            id: "candidate-cubg",
            label: "Computer-use Business gate validation passed",
            requiredFor: "candidate",
            status: cuBgPassed && input.artifactsPresent.cuBgValidation ? "passed" : "failed",
            details: "Run CU-BG validator and provide computer-use gate status artifact.",
        },
        {
            id: "production-staging",
            label: "Staging validation confirmed",
            requiredFor: "production",
            status: input.stagingValidated ? "passed" : input.strictMode ? "failed" : "manual_required",
            details: "Set PRISM_STAGING_VALIDATED=1 when staging qualification is complete.",
        },
        {
            id: "production-rollback",
            label: "Rollback rehearsal confirmed",
            requiredFor: "production",
            status: input.rollbackRehearsed ? "passed" : input.strictMode ? "failed" : "manual_required",
            details: "Set PRISM_ROLLBACK_REHEARSED=1 after rollback drill.",
        },
        {
            id: "production-runbooks",
            label: "Runbook/doc currency confirmed",
            requiredFor: "production",
            status: input.runbooksCurrent ? "passed" : input.strictMode ? "failed" : "manual_required",
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
    const outputPath =
        process.env.PRISM_RELEASE_VALIDATION_OUTPUT_PATH ??
        workspacePath("artifacts", "benchmarks", "release-validation.json");
    const perfPath =
        process.env.PRISM_PERF_OUTPUT_PATH ?? workspacePath("artifacts", "benchmarks", "perf-qualification.json");
    const contractPath =
        process.env.PRISM_CONTRACT_SNAPSHOT_OUTPUT_PATH ??
        workspacePath("artifacts", "contracts", "tool-contract-snapshot.json");
    const cuBgValidationPath =
        process.env.PRISM_CU_BG_VALIDATION_OUTPUT_PATH ??
        workspacePath("artifacts", "ci-gates", "computer-use-business-gate-validation.json");
    const governanceEvidencePath = resolve(
        process.env.PRISM_GOVERNANCE_EVIDENCE_PATH ??
        "prism-output/security/governance-evidence-manifest.json",
    );
    const latestReleaseCandidate = resolveLatestReleaseCandidateDir();
    const releasePacketManifestPath = latestReleaseCandidate
        ? `${latestReleaseCandidate}/release-packet-manifest.md`
        : undefined;
    const governancePathReportPath = latestReleaseCandidate
        ? `${latestReleaseCandidate}/governance-path-report.md`
        : undefined;
    const runbookPath = "docs/PRODUCTION_RELEASE_RUNBOOK.md";

    const commands = [
        "node dist/tests/index.js",
        "node dist/src/benchmarks/tool-contract-snapshot.js",
        "node dist/src/benchmarks/performance-qualification.js",
        `node dist/src/benchmarks/cu-bg-gate-check.js${strictMode ? " --strict" : ""}`,
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
            cuBgValidation: existsSync(cuBgValidationPath),
        },
        stagingValidated: resolveBooleanOverride(
            process.env.PRISM_STAGING_VALIDATED,
            detectStagingValidated(perfPath, contractPath, releasePacketManifestPath),
        ),
        rollbackRehearsed: resolveBooleanOverride(
            process.env.PRISM_ROLLBACK_REHEARSED,
            detectRollbackRehearsed(governancePathReportPath),
        ),
        runbooksCurrent: resolveBooleanOverride(process.env.PRISM_RUNBOOKS_CURRENT, detectRunbooksCurrent(runbookPath)),
        strictMode,
    });

    const generatedAt = new Date().toISOString();
    const { buildId, commit } = resolveBuildIdentity();
    const releaseEvidence = createReleaseValidationEvidence(evaluation.gates, commit, buildId, generatedAt);
    let governanceEvidence: EvidenceManifest | null = null;
    if (existsSync(governanceEvidencePath)) {
        try {
            governanceEvidence = JSON.parse(readFileSync(governanceEvidencePath, "utf-8")) as EvidenceManifest;
        } catch {
            governanceEvidence = null;
        }
    }
    const mergedEvidence = mergeCurrentEvidence(releaseEvidence, governanceEvidence);
    const evidenceManifest = mergedEvidence.manifest;
    const governanceAcceptance = evaluateReleaseAcceptanceGates(evidenceManifest, {
        commit,
        buildId,
        now: new Date(generatedAt),
    });
    const artifact: ReleaseValidationArtifact = {
        generatedAt,
        strictMode,
        metadata: {
            buildId,
            commit,
            environmentProfile: process.env.PRISM_ENV_PROFILE ?? "dev",
            nodeVersion: process.version,
        },
        commandResults,
        artifacts: {
            perfQualification: perfPath,
            contractSnapshot: contractPath,
            cuBgValidation: cuBgValidationPath,
            governanceEvidence: governanceEvidencePath,
            releaseValidation: outputPath,
        },
        gates: evaluation.gates,
        evidenceManifest,
        evidenceManifestDigest: evidenceManifestDigest(evidenceManifest),
        governanceEvidenceErrors: mergedEvidence.errors,
        governanceAcceptance,
        passed: evaluation.passed && (!strictMode || governanceAcceptance.certified),
    };

    await writeArtifact(outputPath, artifact);

    console.log("\nPRISM release validation");
    for (const gate of artifact.gates) {
        const marker = gate.status === "passed" ? "PASS" : gate.status === "failed" ? "FAIL" : "MANUAL";
        console.log(`- [${marker}] ${gate.label}`);
    }
    console.log(
        `- Governance acceptance: ${artifact.governanceAcceptance.passedCount}/${artifact.governanceAcceptance.totalGates} gates passed`,
    );
    console.log(`- Artifact: ${outputPath}`);

    if (!artifact.passed) {
        process.exitCode = 1;
    }
}

function resolveBooleanOverride(override: string | undefined, detected: boolean): boolean {
    if (override === "1") {
        return true;
    }
    if (override === "0") {
        return false;
    }
    return detected;
}

function resolveLatestReleaseCandidateDir(): string | null {
    const releasesRoot = workspacePath("artifacts", "releases");
    if (!existsSync(releasesRoot)) {
        return null;
    }

    const entries = readdirSync(releasesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${releasesRoot}/${entry.name}`)
        .sort((a, b) => {
            const aTime = statSync(a).mtimeMs;
            const bTime = statSync(b).mtimeMs;
            return bTime - aTime;
        });

    return entries.length > 0 ? entries[0]! : null;
}

function readJsonFlag(pathValue: string | undefined, key: string): boolean {
    if (!pathValue || !existsSync(pathValue)) {
        return false;
    }
    try {
        const raw = readFileSync(pathValue, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return parsed[key] === true;
    } catch {
        return false;
    }
}

function fileIncludesAll(pathValue: string | undefined, terms: string[]): boolean {
    if (!pathValue || !existsSync(pathValue)) {
        return false;
    }
    try {
        const text = readFileSync(pathValue, "utf-8").toLowerCase();
        return terms.every((term) => text.includes(term.toLowerCase()));
    } catch {
        return false;
    }
}

function detectStagingValidated(perfPath: string, contractPath: string, releasePacketManifestPath?: string): boolean {
    const stage2Passed = readJsonFlag(
        workspacePath("artifacts", "ci-gates", "e-stage2-qualification-summary.json"),
        "passed",
    );
    const ciGatePassed = readJsonFlag(workspacePath("artifacts", "ci-gates", "ci-gate-summary.json"), "passed");
    const packetComplete = fileIncludesAll(releasePacketManifestPath, ["packet complete", "yes"]);

    return existsSync(perfPath) && existsSync(contractPath) && stage2Passed && ciGatePassed && packetComplete;
}

function detectRollbackRehearsed(governancePathReportPath?: string): boolean {
    return fileIncludesAll(governancePathReportPath, ["timeout", "revoke", "pass"]);
}

function detectRunbooksCurrent(runbookPath: string): boolean {
    return fileIncludesAll(runbookPath, [
        "stage 3: production go/no-go",
        "pre-production checklist",
        "phase_d2_release_packet_template.md",
        "requirements_traceability_matrix.md",
    ]);
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
