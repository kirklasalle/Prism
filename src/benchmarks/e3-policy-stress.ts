import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { PolicyEngine } from "../core/policy/engine.js";
import {
    BUSINESS_PROFILE,
    INDIVIDUAL_PROFILE,
    type ExecutionProfile,
} from "../core/policy/execution-profiles.js";
import type { PolicyContext } from "../core/policy/types.js";

type Decision = "allow" | "deny" | "require_approval";
type Tier = "tier1_autonomous" | "tier2_conditional" | "tier3_approval";

interface E3Mismatch {
    profile: "individual" | "business";
    context: PolicyContext;
    expected: { tier: Tier; decision: Decision };
    actual: { tier: Tier; decision: Decision };
}

interface E3Artifact {
    generatedAt: string;
    iterations: number;
    p95ThresholdMs: number;
    sampleCount: number;
    matrixChecks: number;
    matrixMismatches: number;
    stress: {
        avgMs: number;
        p50Ms: number;
        p95Ms: number;
        p99Ms: number;
        maxMs: number;
    };
    decisionDistribution: Record<string, number>;
    gateResults: Array<{
        name: string;
        passed: boolean;
        details: string;
    }>;
    mismatches: E3Mismatch[];
    passed: boolean;
}

const OUTPUT_PATH = process.env.PRISM_E3_OUTPUT_PATH ?? "prism-output/e3-policy-stress.json";
const ITERATIONS = readIntEnv("PRISM_E3_ITERATIONS", 200_000);
const P95_THRESHOLD_MS = readNumberEnv("PRISM_E3_POLICY_P95_MS", 5);

function readIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNumberEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function expectedResult(context: PolicyContext, profile: ExecutionProfile): { tier: Tier; decision: Decision } {
    if (context.risk === "high") {
        if (!profile.tier3ApprovalRequired) {
            return { tier: "tier3_approval", decision: "allow" };
        }
        if (context.isWhitelisted && profile.tier3WhitelistBypass) {
            return { tier: "tier3_approval", decision: "allow" };
        }
        return { tier: "tier3_approval", decision: "require_approval" };
    }

    if (context.risk === "medium") {
        if (profile.rollbackPlanRequired && context.mutatesState && !context.rollbackPlan) {
            return { tier: "tier2_conditional", decision: "deny" };
        }
        if (!profile.tier2ConditionalAllowed) {
            return { tier: "tier2_conditional", decision: "deny" };
        }
        return { tier: "tier2_conditional", decision: "allow" };
    }

    if (context.mutatesState && profile.segment === "business") {
        return { tier: "tier1_autonomous", decision: "deny" };
    }
    if (!profile.tier1AutonomousAllowed) {
        return { tier: "tier1_autonomous", decision: "deny" };
    }
    return { tier: "tier1_autonomous", decision: "allow" };
}

function buildMatrixContexts(): PolicyContext[] {
    const risks: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];
    const mutates = [false, true];
    const rollbackPlans: Array<string | undefined> = [undefined, "rollback-step"];
    const whitelisted = [false, true];

    const contexts: PolicyContext[] = [];
    for (const risk of risks) {
        for (const doesMutate of mutates) {
            for (const rollbackPlan of rollbackPlans) {
                for (const isWhitelisted of whitelisted) {
                    contexts.push({
                        operation: `${risk}_${doesMutate ? "mutating" : "read"}`,
                        risk,
                        mutatesState: doesMutate,
                        rollbackPlan,
                        isWhitelisted,
                    });
                }
            }
        }
    }
    return contexts;
}

function percentile(sortedSamples: number[], ratio: number): number {
    if (sortedSamples.length === 0) {
        return 0;
    }
    const index = Math.min(sortedSamples.length - 1, Math.floor(sortedSamples.length * ratio));
    return sortedSamples[index] ?? 0;
}

async function writeArtifact(artifact: E3Artifact): Promise<void> {
    const normalizedPath = OUTPUT_PATH.replaceAll("\\", "/");
    const slashIndex = normalizedPath.lastIndexOf("/");
    const outputDir = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : ".";

    await mkdir(outputDir, { recursive: true });
    await writeFile(normalizedPath, JSON.stringify(artifact, null, 2), "utf-8");
}

async function main(): Promise<void> {
    const engine = new PolicyEngine();
    const contexts = buildMatrixContexts();
    const profiles = [INDIVIDUAL_PROFILE, BUSINESS_PROFILE] as const;

    const mismatches: E3Mismatch[] = [];
    for (const profile of profiles) {
        for (const context of contexts) {
            const expected = expectedResult(context, profile);
            const actual = engine.evaluate({ ...context, executionProfile: profile });

            if (expected.tier !== actual.tier || expected.decision !== actual.decision) {
                mismatches.push({
                    profile: profile.segment,
                    context,
                    expected,
                    actual: { tier: actual.tier, decision: actual.decision },
                });
            }
        }
    }

    const samples: number[] = [];
    const decisionDistribution: Record<string, number> = {
        allow: 0,
        deny: 0,
        require_approval: 0,
    };

    for (let i = 0; i < ITERATIONS; i += 1) {
        const context = contexts[i % contexts.length]!;
        const profile = i % 2 === 0 ? INDIVIDUAL_PROFILE : BUSINESS_PROFILE;

        const started = performance.now();
        const result = engine.evaluate({ ...context, executionProfile: profile });
        const elapsed = performance.now() - started;

        samples.push(elapsed);
        decisionDistribution[result.decision] = (decisionDistribution[result.decision] ?? 0) + 1;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const sum = samples.reduce((acc, value) => acc + value, 0);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const p99 = percentile(sorted, 0.99);
    const max = sorted[sorted.length - 1] ?? 0;
    const avg = samples.length > 0 ? sum / samples.length : 0;

    const gates = [
        {
            name: "Policy matrix correctness",
            passed: mismatches.length === 0,
            details: `mismatches=${mismatches.length} matrixChecks=${contexts.length * profiles.length}`,
        },
        {
            name: "Policy stress latency p95",
            passed: p95 <= P95_THRESHOLD_MS,
            details: `measured=${p95.toFixed(6)}ms threshold<=${P95_THRESHOLD_MS.toFixed(6)}ms`,
        },
    ];

    const artifact: E3Artifact = {
        generatedAt: new Date().toISOString(),
        iterations: ITERATIONS,
        p95ThresholdMs: P95_THRESHOLD_MS,
        sampleCount: samples.length,
        matrixChecks: contexts.length * profiles.length,
        matrixMismatches: mismatches.length,
        stress: {
            avgMs: avg,
            p50Ms: p50,
            p95Ms: p95,
            p99Ms: p99,
            maxMs: max,
        },
        decisionDistribution,
        gateResults: gates,
        mismatches: mismatches.slice(0, 25),
        passed: gates.every((gate) => gate.passed),
    };

    await writeArtifact(artifact);

    console.log("\nE3 policy stress qualification\n");
    console.log(`- Iterations: ${artifact.iterations}`);
    console.log(`- Matrix checks: ${artifact.matrixChecks}`);
    console.log(`- Matrix mismatches: ${artifact.matrixMismatches}`);
    console.log(`- Stress avg=${artifact.stress.avgMs.toFixed(6)}ms p50=${artifact.stress.p50Ms.toFixed(6)}ms p95=${artifact.stress.p95Ms.toFixed(6)}ms p99=${artifact.stress.p99Ms.toFixed(6)}ms max=${artifact.stress.maxMs.toFixed(6)}ms`);
    console.log(`- Decisions: allow=${artifact.decisionDistribution.allow} deny=${artifact.decisionDistribution.deny} require_approval=${artifact.decisionDistribution.require_approval}`);
    for (const gate of artifact.gateResults) {
        console.log(`- [${gate.passed ? "PASS" : "FAIL"}] ${gate.name}: ${gate.details}`);
    }
    console.log(`- Artifact: ${OUTPUT_PATH.replaceAll("\\", "/")}`);

    if (!artifact.passed) {
        process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    console.error("E3 qualification failed:", error);
    process.exitCode = 1;
});
