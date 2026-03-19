import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

interface QualificationCheck {
    name: string;
    passed: boolean;
    details: string;
}

interface QualificationArtifact {
    passed: boolean;
    checks?: QualificationCheck[];
    gateResults?: QualificationCheck[];
}

interface StageRunResult {
    stage: "E1" | "E2" | "E3" | "E4";
    scriptPath: string;
    artifactPath: string;
    durationMs: number;
    passed: boolean;
    checkCount: number;
    failedChecks: number;
}

interface Stage2QualificationArtifact {
    generatedAt: string;
    sequence: string[];
    runs: StageRunResult[];
    checks: QualificationCheck[];
    passed: boolean;
}

const OUTPUT_PATH = process.env.PRISM_STAGE2_OUTPUT_PATH ?? "prism-output/e-stage2-qualification-summary.json";

const stages: Array<{
    stage: StageRunResult["stage"];
    scriptPath: string;
    artifactPath: string;
    envOverrides?: Record<string, string>;
}> = [
        {
            stage: "E1",
            scriptPath: "dist/src/benchmarks/e1-individual-qualification.js",
            artifactPath: process.env.PRISM_E1_OUTPUT_PATH ?? "prism-output/e1-individual-qualification.json",
            envOverrides: {
                PRISM_ENV_PROFILE: "dev",
                PRISM_EXECUTION_PROFILE: "individual",
            },
        },
        {
            stage: "E2",
            scriptPath: "dist/src/benchmarks/e2-business-qualification.js",
            artifactPath: process.env.PRISM_E2_OUTPUT_PATH ?? "prism-output/e2-business-qualification.json",
            envOverrides: {
                PRISM_ENV_PROFILE: "dev",
                PRISM_EXECUTION_PROFILE: "business",
            },
        },
        {
            stage: "E3",
            scriptPath: "dist/src/benchmarks/e3-policy-stress.js",
            artifactPath: process.env.PRISM_E3_OUTPUT_PATH ?? "prism-output/e3-policy-stress.json",
        },
        {
            stage: "E4",
            scriptPath: "dist/src/benchmarks/e4-profile-switch-qualification.js",
            artifactPath: process.env.PRISM_E4_OUTPUT_PATH ?? "prism-output/e4-profile-switch-qualification.json",
        },
    ];

function normalizePath(path: string): string {
    return path.replaceAll("\\", "/");
}

function runNodeScript(scriptPath: string, envOverrides?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            ...(envOverrides ?? {}),
        };

        const child = spawn(process.execPath, [scriptPath], {
            stdio: "inherit",
            env,
        });

        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`Command failed (${scriptPath}) with exit code ${code ?? "unknown"}`));
        });
    });
}

async function readArtifact(path: string): Promise<QualificationArtifact> {
    const normalized = normalizePath(path);
    const raw = await readFile(normalized, "utf-8");
    return JSON.parse(raw) as QualificationArtifact;
}

function summarizeChecks(artifact: QualificationArtifact): { checkCount: number; failedChecks: number } {
    const checks = artifact.checks ?? artifact.gateResults ?? [];
    const failedChecks = checks.filter((check) => !check.passed).length;
    return { checkCount: checks.length, failedChecks };
}

async function writeArtifact(artifact: Stage2QualificationArtifact): Promise<void> {
    const normalizedPath = normalizePath(OUTPUT_PATH);
    const slashIndex = normalizedPath.lastIndexOf("/");
    const outputDir = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : ".";

    await mkdir(outputDir, { recursive: true });
    await writeFile(normalizedPath, JSON.stringify(artifact, null, 2), "utf-8");
}

async function main(): Promise<void> {
    const runResults: StageRunResult[] = [];

    for (const stage of stages) {
        const started = performance.now();
        await runNodeScript(stage.scriptPath, stage.envOverrides);
        const durationMs = performance.now() - started;

        const artifact = await readArtifact(stage.artifactPath);
        const checks = summarizeChecks(artifact);

        runResults.push({
            stage: stage.stage,
            scriptPath: normalizePath(stage.scriptPath),
            artifactPath: normalizePath(stage.artifactPath),
            durationMs,
            passed: Boolean(artifact.passed),
            checkCount: checks.checkCount,
            failedChecks: checks.failedChecks,
        });
    }

    const checks: QualificationCheck[] = [
        {
            name: "Sequence executed E1 -> E2 -> E3 -> E4",
            passed: runResults.map((result) => result.stage).join(",") === "E1,E2,E3,E4",
            details: runResults.map((result) => result.stage).join(" -> "),
        },
        {
            name: "All stage artifacts reported passed=true",
            passed: runResults.every((result) => result.passed),
            details: runResults.map((result) => `${result.stage}=${result.passed ? "pass" : "fail"}`).join(" "),
        },
        {
            name: "No failed checks across stage artifacts",
            passed: runResults.every((result) => result.failedChecks === 0),
            details: runResults
                .map((result) => `${result.stage}:failed=${result.failedChecks}/${result.checkCount}`)
                .join(" "),
        },
    ];

    const summary: Stage2QualificationArtifact = {
        generatedAt: new Date().toISOString(),
        sequence: ["E1", "E2", "E3", "E4"],
        runs: runResults,
        checks,
        passed: checks.every((check) => check.passed),
    };

    await writeArtifact(summary);

    console.log("\nStage 2 qualification aggregator\n");
    for (const result of runResults) {
        const duration = result.durationMs.toFixed(3);
        console.log(
            `- [${result.passed ? "PASS" : "FAIL"}] ${result.stage}: ${result.artifactPath} checks=${result.checkCount} failed=${result.failedChecks} duration=${duration}ms`,
        );
    }
    for (const check of checks) {
        console.log(`- [${check.passed ? "PASS" : "FAIL"}] ${check.name}: ${check.details}`);
    }
    console.log(`- Artifact: ${normalizePath(OUTPUT_PATH)}`);

    if (!summary.passed) {
        process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    console.error("Stage 2 qualification failed:", error);
    process.exitCode = 1;
});