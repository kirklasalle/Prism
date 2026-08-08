import fs from "fs";
import path from "path";
import { workspacePath } from "../core/config/workspace-resolver.js";

interface GateCheck {
    id: string;
    description: string;
    required: boolean;
    passed: boolean;
    details?: string;
}

interface CiGateSummary {
    generatedAt: string;
    passed: boolean;
    checks: GateCheck[];
}

function readJson<T>(filePath: string): T {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
}

function exists(filePath: string): boolean {
    return fs.existsSync(filePath);
}

function run(): void {
    const outputDir = path.resolve("prism-output");
    const checks: GateCheck[] = [];

    const perfPath = path.join(outputDir, "perf-qualification.json");
    const contractsPath = path.join(outputDir, "tool-contract-snapshot.json");
    const stage2Path = path.join(outputDir, "e-stage2-qualification-summary.json");
    const releaseValidationPath = path.join(outputDir, "release-validation.json");
    const cuBgValidationPath = path.join(outputDir, "computer-use-business-gate-validation.json");
    const sbomCveSummaryPath = path.join(outputDir, "security", "sbom-cve-gate-summary.json");
    const directiveIntegritySummaryPath = path.join(outputDir, "security", "directive-integrity-gate-summary.json");
    const secretsScanSummaryPath = path.join(outputDir, "secrets-scan-summary.json");
    const governanceEvidencePath = path.join(outputDir, "security", "governance-evidence-manifest.json");

    checks.push({
        id: "artifact-perf",
        description: "Performance qualification artifact exists",
        required: true,
        passed: exists(perfPath),
        details: perfPath,
    });

    checks.push({
        id: "artifact-contracts",
        description: "Tool contract snapshot artifact exists",
        required: true,
        passed: exists(contractsPath),
        details: contractsPath,
    });

    checks.push({
        id: "artifact-stage2",
        description: "Stage 2 qualification summary artifact exists",
        required: true,
        passed: exists(stage2Path),
        details: stage2Path,
    });

    checks.push({
        id: "artifact-release-validation",
        description: "Release validation artifact exists",
        required: true,
        passed: exists(releaseValidationPath),
        details: releaseValidationPath,
    });

    checks.push({
        id: "artifact-cu-bg-validation",
        description: "Computer-use Business gate validation artifact exists",
        required: true,
        passed: exists(cuBgValidationPath),
        details: cuBgValidationPath,
    });

    checks.push({
        id: "artifact-sbom-cve-gate",
        description: "SBOM/CVE gate summary artifact exists",
        required: true,
        passed: exists(sbomCveSummaryPath),
        details: sbomCveSummaryPath,
    });

    checks.push({
        id: "artifact-directive-integrity-gate",
        description: "Directive integrity gate summary artifact exists",
        required: true,
        passed: exists(directiveIntegritySummaryPath),
        details: directiveIntegritySummaryPath,
    });

    checks.push({
        id: "artifact-secrets-scan",
        description: "Secrets scan summary artifact exists",
        required: true,
        passed: exists(secretsScanSummaryPath),
        details: secretsScanSummaryPath,
    });

    checks.push({
        id: "artifact-governance-evidence",
        description: "Governance evidence manifest exists",
        required: true,
        passed: exists(governanceEvidencePath),
        details: governanceEvidencePath,
    });

    if (exists(perfPath)) {
        const perf = readJson<{ passed?: boolean }>(perfPath);
        checks.push({
            id: "gate-perf",
            description: "Performance qualification passed",
            required: true,
            passed: perf.passed === true,
        });
    }

    if (exists(stage2Path)) {
        const stage2 = readJson<{ passed?: boolean }>(stage2Path);
        checks.push({
            id: "gate-stage2",
            description: "Stage 2 E1-E4 aggregate qualification passed",
            required: true,
            passed: stage2.passed === true,
        });
    }

    if (exists(releaseValidationPath)) {
        const releaseValidation = readJson<{ passed?: boolean }>(releaseValidationPath);
        checks.push({
            id: "gate-release-validation",
            description: "Release validation passed",
            required: true,
            passed: releaseValidation.passed === true,
        });
    }

    if (exists(cuBgValidationPath)) {
        const cuBgValidation = readJson<{ passed?: boolean }>(cuBgValidationPath);
        checks.push({
            id: "gate-cu-bg-validation",
            description: "Computer-use Business gate validation passed",
            required: true,
            passed: cuBgValidation.passed === true,
        });
    }

    if (exists(sbomCveSummaryPath)) {
        const sbomCveSummary = readJson<{
            passed?: boolean;
            threshold?: { failOn?: string };
            audit?: { summary?: { high?: number; critical?: number } };
        }>(sbomCveSummaryPath);
        checks.push({
            id: "gate-sbom-cve",
            description: "SBOM generation and CVE threshold gate passed",
            required: true,
            passed: sbomCveSummary.passed === true,
            details: `failOn=${sbomCveSummary.threshold?.failOn ?? "high"}, high=${sbomCveSummary.audit?.summary?.high ?? 0}, critical=${sbomCveSummary.audit?.summary?.critical ?? 0}`,
        });
    }

    if (exists(directiveIntegritySummaryPath)) {
        const directiveIntegritySummary = readJson<{
            passed?: boolean;
            checks?: { hashMatches?: boolean; signatureVerified?: boolean };
            details?: { currentHash?: string; expectedHash?: string; keyId?: string | null };
        }>(directiveIntegritySummaryPath);
        checks.push({
            id: "gate-directive-integrity",
            description: "Directive integrity gate passed",
            required: true,
            passed: directiveIntegritySummary.passed === true,
            details: `hashMatches=${directiveIntegritySummary.checks?.hashMatches === true}, signatureVerified=${directiveIntegritySummary.checks?.signatureVerified === true}, keyId=${directiveIntegritySummary.details?.keyId ?? "unknown"}, current=${directiveIntegritySummary.details?.currentHash ?? "unknown"}, expected=${directiveIntegritySummary.details?.expectedHash ?? "unknown"}`,
        });
    }

    if (exists(secretsScanSummaryPath)) {
        const secretsScanSummary = readJson<{ clean?: boolean; findingsCount?: number }>(secretsScanSummaryPath);
        checks.push({
            id: "gate-secrets-scan",
            description: "Workspace secrets scan passed",
            required: true,
            passed: secretsScanSummary.clean === true,
            details: `clean=${secretsScanSummary.clean === true}, findings=${secretsScanSummary.findingsCount ?? 0}`,
        });
    }

    if (exists(governanceEvidencePath)) {
        const governanceEvidence = readJson<{
            records?: Array<{ probeId?: string; probeVersion?: number; result?: string }>;
        }>(governanceEvidencePath);
        const records = governanceEvidence.records ?? [];
        const failed = records.filter((record) => record.result === "failed");
        const notEvaluated = records.filter((record) => record.result === "not_evaluated");
        checks.push({
            id: "gate-governance-probes",
            description: "Registered governance probes completed without a failed result",
            required: true,
            passed: records.length > 0 && failed.length === 0,
            details: `records=${records.length}, failed=${failed.length}, notEvaluated=${notEvaluated.length}`,
        });
    }

    const requiredChecks = checks.filter((check) => check.required);
    const passed = requiredChecks.every((check) => check.passed);

    const summary: CiGateSummary = {
        generatedAt: new Date().toISOString(),
        passed,
        checks,
    };

    const summaryPath = path.join(outputDir, "ci-gate-summary.json");
    const content = JSON.stringify(summary, null, 2);
    fs.writeFileSync(summaryPath, content, "utf8");

    try {
        const workspaceTarget = workspacePath("artifacts", "ci-gates", "ci-gate-summary.json");
        const wsDir = path.dirname(workspaceTarget);
        if (!fs.existsSync(wsDir)) {
            fs.mkdirSync(wsDir, { recursive: true });
        }
        fs.writeFileSync(workspaceTarget, content, "utf8");
        console.log(`- Mirrored CI Gate artifact to workspace: ${workspaceTarget}`);
    } catch (err) {
        console.warn(`- Failed to mirror CI Gate artifact to workspace: ${(err as Error).message}`);
    }

    if (!passed) {
        const failed = requiredChecks.filter((check) => !check.passed);
        console.error("CI gate check failed.");
        for (const check of failed) {
            console.error(`- ${check.id}: ${check.description}`);
        }
        process.exit(1);
    }

    console.log("CI gate check passed.");
    console.log(`Summary written to ${summaryPath}`);
}

run();
