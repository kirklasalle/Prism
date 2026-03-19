import { mkdir, writeFile } from "node:fs/promises";
import { ActivityBus } from "../core/activity/bus.js";
import { PolicyEngine } from "../core/policy/engine.js";
import { BUSINESS_PROFILE, INDIVIDUAL_PROFILE } from "../core/policy/execution-profiles.js";
import { Orchestrator } from "../core/runtime/orchestrator.js";
import { ToolRegistry } from "../core/tools/registry.js";
import type { ToolRequest } from "../core/tools/types.js";
import type { ActivityEvent } from "../core/activity/types.js";

interface QualificationCheck {
    name: string;
    passed: boolean;
    details: string;
}

interface ProfileSnapshot {
    label: string;
    segment: string;
    mediumMutationNoRollbackDecision: string;
    mediumMutationNoRollbackTier: string;
    lowMutationDecision: string;
    lowMutationTier: string;
    toolExecutionCount: number;
}

interface E4QualificationArtifact {
    generatedAt: string;
    sequence: string[];
    snapshots: ProfileSnapshot[];
    checks: QualificationCheck[];
    passed: boolean;
}

const OUTPUT_PATH = process.env.PRISM_E4_OUTPUT_PATH ?? "prism-output/e4-profile-switch-qualification.json";

function countToolExecutions(events: readonly ActivityEvent[], operation: string): number {
    return events.filter(
        (event) =>
            event.layer === "tool_execution" &&
            event.operation === operation &&
            event.status === "succeeded",
    ).length;
}

async function writeArtifact(artifact: E4QualificationArtifact): Promise<void> {
    const normalizedPath = OUTPUT_PATH.replaceAll("\\", "/");
    const slashIndex = normalizedPath.lastIndexOf("/");
    const outputDir = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : ".";

    await mkdir(outputDir, { recursive: true });
    await writeFile(normalizedPath, JSON.stringify(artifact, null, 2), "utf-8");
}

async function main(): Promise<void> {
    const activityBus = new ActivityBus();
    const policyEngine = new PolicyEngine();
    const toolRegistry = new ToolRegistry();

    let toolExecutionCounter = 0;
    toolRegistry.register({
        name: "profile_switch_probe",
        execute: async () => {
            toolExecutionCounter += 1;
            return {
                ok: true,
                output: { ok: true, executionCount: toolExecutionCounter },
            };
        },
    });

    const orchestrator = new Orchestrator(
        "e4-profile-switch-session",
        activityBus,
        policyEngine,
        toolRegistry,
        { executionProfile: INDIVIDUAL_PROFILE },
    );

    const mediumMutationNoRollback: ToolRequest = {
        operation: "profile_switch_probe",
        args: { mode: "medium" },
        risk: "medium",
        mutatesState: true,
        rollbackPlan: undefined,
    };

    const lowMutation: ToolRequest = {
        operation: "profile_switch_probe",
        args: { mode: "low-mutating" },
        risk: "low",
        mutatesState: true,
        rollbackPlan: undefined,
    };

    const snapshots: ProfileSnapshot[] = [];

    // Snapshot A: INDIVIDUAL
    await orchestrator.run(mediumMutationNoRollback);
    await orchestrator.run(lowMutation);
    {
        const events = activityBus.listEvents();
        const policyEvents = events.filter(
            (event) => event.layer === "governance" && event.operation === "profile_switch_probe.policy_check",
        );
        const mediumEvent = policyEvents[policyEvents.length - 2]!;
        const lowEvent = policyEvents[policyEvents.length - 1]!;
        snapshots.push({
            label: "initial_individual",
            segment: String((lowEvent.details as Record<string, unknown>).executionSegment ?? "unknown"),
            mediumMutationNoRollbackDecision: mediumEvent.policyDecision ?? "unknown",
            mediumMutationNoRollbackTier: mediumEvent.authorityTier ?? "unknown",
            lowMutationDecision: lowEvent.policyDecision ?? "unknown",
            lowMutationTier: lowEvent.authorityTier ?? "unknown",
            toolExecutionCount: countToolExecutions(events, "profile_switch_probe"),
        });
    }

    // Snapshot B: BUSINESS
    orchestrator.setExecutionProfile(BUSINESS_PROFILE);
    await orchestrator.run(mediumMutationNoRollback);
    await orchestrator.run(lowMutation);
    {
        const events = activityBus.listEvents();
        const policyEvents = events.filter(
            (event) => event.layer === "governance" && event.operation === "profile_switch_probe.policy_check",
        );
        const mediumEvent = policyEvents[policyEvents.length - 2]!;
        const lowEvent = policyEvents[policyEvents.length - 1]!;
        snapshots.push({
            label: "switched_business",
            segment: String((lowEvent.details as Record<string, unknown>).executionSegment ?? "unknown"),
            mediumMutationNoRollbackDecision: mediumEvent.policyDecision ?? "unknown",
            mediumMutationNoRollbackTier: mediumEvent.authorityTier ?? "unknown",
            lowMutationDecision: lowEvent.policyDecision ?? "unknown",
            lowMutationTier: lowEvent.authorityTier ?? "unknown",
            toolExecutionCount: countToolExecutions(events, "profile_switch_probe"),
        });
    }

    // Snapshot C: back to INDIVIDUAL
    orchestrator.setExecutionProfile(INDIVIDUAL_PROFILE);
    await orchestrator.run(mediumMutationNoRollback);
    await orchestrator.run(lowMutation);
    {
        const events = activityBus.listEvents();
        const policyEvents = events.filter(
            (event) => event.layer === "governance" && event.operation === "profile_switch_probe.policy_check",
        );
        const mediumEvent = policyEvents[policyEvents.length - 2]!;
        const lowEvent = policyEvents[policyEvents.length - 1]!;
        snapshots.push({
            label: "restored_individual",
            segment: String((lowEvent.details as Record<string, unknown>).executionSegment ?? "unknown"),
            mediumMutationNoRollbackDecision: mediumEvent.policyDecision ?? "unknown",
            mediumMutationNoRollbackTier: mediumEvent.authorityTier ?? "unknown",
            lowMutationDecision: lowEvent.policyDecision ?? "unknown",
            lowMutationTier: lowEvent.authorityTier ?? "unknown",
            toolExecutionCount: countToolExecutions(events, "profile_switch_probe"),
        });
    }

    const [a, b, c] = snapshots;
    const checks: QualificationCheck[] = [
        {
            name: "Initial segment is individual",
            passed: a?.segment === "individual",
            details: `segment=${a?.segment}`,
        },
        {
            name: "Business segment applied after switch",
            passed: b?.segment === "business",
            details: `segment=${b?.segment}`,
        },
        {
            name: "Individual segment restored after second switch",
            passed: c?.segment === "individual",
            details: `segment=${c?.segment}`,
        },
        {
            name: "Medium mutation without rollback allows in individual",
            passed:
                a?.mediumMutationNoRollbackTier === "tier2_conditional" &&
                a?.mediumMutationNoRollbackDecision === "allow" &&
                c?.mediumMutationNoRollbackDecision === "allow",
            details: `initial=${a?.mediumMutationNoRollbackDecision} restored=${c?.mediumMutationNoRollbackDecision}`,
        },
        {
            name: "Medium mutation without rollback denied in business",
            passed:
                b?.mediumMutationNoRollbackTier === "tier2_conditional" &&
                b?.mediumMutationNoRollbackDecision === "deny",
            details: `decision=${b?.mediumMutationNoRollbackDecision} tier=${b?.mediumMutationNoRollbackTier}`,
        },
        {
            name: "Low-risk mutation denied only in business",
            passed:
                a?.lowMutationDecision === "allow" &&
                b?.lowMutationDecision === "deny" &&
                c?.lowMutationDecision === "allow",
            details: `initial=${a?.lowMutationDecision} business=${b?.lowMutationDecision} restored=${c?.lowMutationDecision}`,
        },
        {
            name: "Denied business operations do not execute tool",
            passed:
                typeof a?.toolExecutionCount === "number" &&
                typeof b?.toolExecutionCount === "number" &&
                typeof c?.toolExecutionCount === "number" &&
                b.toolExecutionCount === a.toolExecutionCount &&
                c.toolExecutionCount > b.toolExecutionCount,
            details: `counts=${a?.toolExecutionCount}->${b?.toolExecutionCount}->${c?.toolExecutionCount}`,
        },
    ];

    const artifact: E4QualificationArtifact = {
        generatedAt: new Date().toISOString(),
        sequence: ["individual", "business", "individual"],
        snapshots,
        checks,
        passed: checks.every((check) => check.passed),
    };

    await writeArtifact(artifact);

    console.log("\nE4 profile-switch qualification\n");
    console.log(`- Sequence: ${artifact.sequence.join(" -> ")}`);
    for (const check of checks) {
        console.log(`- [${check.passed ? "PASS" : "FAIL"}] ${check.name}: ${check.details}`);
    }
    console.log(`- Artifact: ${OUTPUT_PATH.replaceAll("\\", "/")}`);

    if (!artifact.passed) {
        process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    console.error("E4 qualification failed:", error);
    process.exitCode = 1;
});
