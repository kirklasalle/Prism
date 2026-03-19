import { mkdir, writeFile } from "node:fs/promises";
import { resolveEnvironmentProfile } from "../core/config/environment-profiles.js";
import {
    describeExecutionProfileResolution,
    resolveExecutionProfileFromEnv,
} from "../core/config/execution-mode-config.js";
import { PolicyEngine } from "../core/policy/engine.js";
import { INDIVIDUAL_PROFILE } from "../core/policy/execution-profiles.js";

interface QualificationCheck {
    name: string;
    passed: boolean;
    details: string;
}

interface E1QualificationArtifact {
    generatedAt: string;
    environmentProfile: string;
    requestedExecutionProfile: string | null;
    resolvedProfileSegment: string;
    resolvedProfileDescription: string;
    checks: QualificationCheck[];
    passed: boolean;
}

const OUTPUT_PATH = process.env.PRISM_E1_OUTPUT_PATH ?? "prism-output/e1-individual-qualification.json";

async function main(): Promise<void> {
    const envProfile = resolveEnvironmentProfile(
        process.env.PRISM_ENV_PROFILE ?? (process.env.CI ? "staging" : "dev"),
    );
    const requestedExecutionProfile = process.env.PRISM_EXECUTION_PROFILE ?? null;
    const resolvedProfile = resolveExecutionProfileFromEnv(envProfile);
    const resolvedDescription = describeExecutionProfileResolution(resolvedProfile, envProfile);

    const engine = new PolicyEngine();
    const checks: QualificationCheck[] = [];

    checks.push({
        name: "Resolved segment is individual",
        passed: resolvedProfile.segment === "individual",
        details: `segment=${resolvedProfile.segment}`,
    });

    checks.push({
        name: "Resolved profile matches INDIVIDUAL rollback policy",
        passed: resolvedProfile.rollbackPlanRequired === INDIVIDUAL_PROFILE.rollbackPlanRequired,
        details: `rollbackPlanRequired=${resolvedProfile.rollbackPlanRequired}`,
    });

    checks.push({
        name: "Resolved profile matches INDIVIDUAL audit policy",
        passed: resolvedProfile.auditAllOperations === INDIVIDUAL_PROFILE.auditAllOperations,
        details: `auditAllOperations=${resolvedProfile.auditAllOperations}`,
    });

    const lowRisk = engine.evaluate({
        operation: "read_status",
        risk: "low",
        mutatesState: false,
        executionProfile: resolvedProfile,
    });
    checks.push({
        name: "Low-risk read is autonomous allow",
        passed: lowRisk.tier === "tier1_autonomous" && lowRisk.decision === "allow",
        details: `tier=${lowRisk.tier} decision=${lowRisk.decision}`,
    });

    const mediumRiskNoRollback = engine.evaluate({
        operation: "update_note",
        risk: "medium",
        mutatesState: true,
        rollbackPlan: undefined,
        executionProfile: resolvedProfile,
    });
    checks.push({
        name: "Medium-risk mutation without rollback is allowed in individual",
        passed:
            mediumRiskNoRollback.tier === "tier2_conditional" &&
            mediumRiskNoRollback.decision === "allow" &&
            mediumRiskNoRollback.reasons.some((reason) => reason.includes("Warning")),
        details: `tier=${mediumRiskNoRollback.tier} decision=${mediumRiskNoRollback.decision}`,
    });

    const highRisk = engine.evaluate({
        operation: "delete_account",
        risk: "high",
        mutatesState: true,
        executionProfile: resolvedProfile,
    });
    checks.push({
        name: "High-risk operation requires approval",
        passed: highRisk.tier === "tier3_approval" && highRisk.decision === "require_approval",
        details: `tier=${highRisk.tier} decision=${highRisk.decision}`,
    });

    const artifact: E1QualificationArtifact = {
        generatedAt: new Date().toISOString(),
        environmentProfile: envProfile,
        requestedExecutionProfile,
        resolvedProfileSegment: resolvedProfile.segment,
        resolvedProfileDescription: resolvedDescription,
        checks,
        passed: checks.every((check) => check.passed),
    };

    await writeArtifact(artifact);

    console.log("\nE1 individual qualification\n");
    console.log(`- Environment profile: ${artifact.environmentProfile}`);
    console.log(`- Requested execution profile: ${artifact.requestedExecutionProfile ?? "(none)"}`);
    console.log(`- Resolved: ${artifact.resolvedProfileDescription}`);
    for (const check of artifact.checks) {
        const status = check.passed ? "PASS" : "FAIL";
        console.log(`- [${status}] ${check.name}: ${check.details}`);
    }
    console.log(`- Artifact: ${OUTPUT_PATH.replaceAll("\\", "/")}`);

    if (!artifact.passed) {
        process.exitCode = 1;
    }
}

async function writeArtifact(artifact: E1QualificationArtifact): Promise<void> {
    const normalizedPath = OUTPUT_PATH.replaceAll("\\", "/");
    const slashIndex = normalizedPath.lastIndexOf("/");
    const outputDir = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : ".";

    await mkdir(outputDir, { recursive: true });
    await writeFile(normalizedPath, JSON.stringify(artifact, null, 2), "utf-8");
}

main().catch((error: unknown) => {
    console.error("E1 qualification failed:", error);
    process.exitCode = 1;
});
