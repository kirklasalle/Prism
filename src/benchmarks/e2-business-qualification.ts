import { mkdir, writeFile } from "node:fs/promises";
import { resolveEnvironmentProfile } from "../core/config/environment-profiles.js";
import {
    describeExecutionProfileResolution,
    resolveExecutionProfileFromEnv,
} from "../core/config/execution-mode-config.js";
import { PolicyEngine } from "../core/policy/engine.js";
import { BUSINESS_PROFILE } from "../core/policy/execution-profiles.js";

interface QualificationCheck {
    name: string;
    passed: boolean;
    details: string;
}

interface E2QualificationArtifact {
    generatedAt: string;
    environmentProfile: string;
    requestedExecutionProfile: string | null;
    resolvedProfileSegment: string;
    resolvedProfileDescription: string;
    checks: QualificationCheck[];
    passed: boolean;
}

const OUTPUT_PATH = process.env.PRISM_E2_OUTPUT_PATH ?? "prism-output/e2-business-qualification.json";

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
        name: "Resolved segment is business",
        passed: resolvedProfile.segment === "business",
        details: `segment=${resolvedProfile.segment}`,
    });

    checks.push({
        name: "Resolved profile matches BUSINESS rollback policy",
        passed: resolvedProfile.rollbackPlanRequired === BUSINESS_PROFILE.rollbackPlanRequired,
        details: `rollbackPlanRequired=${resolvedProfile.rollbackPlanRequired}`,
    });

    checks.push({
        name: "Resolved profile matches BUSINESS audit policy",
        passed: resolvedProfile.auditAllOperations === BUSINESS_PROFILE.auditAllOperations,
        details: `auditAllOperations=${resolvedProfile.auditAllOperations}`,
    });

    const lowRiskRead = engine.evaluate({
        operation: "read_status",
        risk: "low",
        mutatesState: false,
        executionProfile: resolvedProfile,
    });
    checks.push({
        name: "Low-risk read remains autonomous allow",
        passed: lowRiskRead.tier === "tier1_autonomous" && lowRiskRead.decision === "allow",
        details: `tier=${lowRiskRead.tier} decision=${lowRiskRead.decision}`,
    });

    const lowRiskMutation = engine.evaluate({
        operation: "touch_note",
        risk: "low",
        mutatesState: true,
        executionProfile: resolvedProfile,
    });
    checks.push({
        name: "Low-risk mutation is denied in business tier1",
        passed: lowRiskMutation.tier === "tier1_autonomous" && lowRiskMutation.decision === "deny",
        details: `tier=${lowRiskMutation.tier} decision=${lowRiskMutation.decision}`,
    });

    const mediumNoRollback = engine.evaluate({
        operation: "update_note",
        risk: "medium",
        mutatesState: true,
        rollbackPlan: undefined,
        executionProfile: resolvedProfile,
    });
    checks.push({
        name: "Medium-risk mutation without rollback is denied",
        passed: mediumNoRollback.tier === "tier2_conditional" && mediumNoRollback.decision === "deny",
        details: `tier=${mediumNoRollback.tier} decision=${mediumNoRollback.decision}`,
    });

    const mediumWithRollback = engine.evaluate({
        operation: "update_note",
        risk: "medium",
        mutatesState: true,
        rollbackPlan: "restore previous note state",
        executionProfile: resolvedProfile,
    });
    checks.push({
        name: "Medium-risk mutation with rollback is allowed",
        passed: mediumWithRollback.tier === "tier2_conditional" && mediumWithRollback.decision === "allow",
        details: `tier=${mediumWithRollback.tier} decision=${mediumWithRollback.decision}`,
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

    const artifact: E2QualificationArtifact = {
        generatedAt: new Date().toISOString(),
        environmentProfile: envProfile,
        requestedExecutionProfile,
        resolvedProfileSegment: resolvedProfile.segment,
        resolvedProfileDescription: resolvedDescription,
        checks,
        passed: checks.every((check) => check.passed),
    };

    await writeArtifact(artifact);

    console.log("\nE2 business qualification\n");
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

async function writeArtifact(artifact: E2QualificationArtifact): Promise<void> {
    const normalizedPath = OUTPUT_PATH.replaceAll("\\", "/");
    const slashIndex = normalizedPath.lastIndexOf("/");
    const outputDir = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : ".";

    await mkdir(outputDir, { recursive: true });
    await writeFile(normalizedPath, JSON.stringify(artifact, null, 2), "utf-8");
}

main().catch((error: unknown) => {
    console.error("E2 qualification failed:", error);
    process.exitCode = 1;
});
