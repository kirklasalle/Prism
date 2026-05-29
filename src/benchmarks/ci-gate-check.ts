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
