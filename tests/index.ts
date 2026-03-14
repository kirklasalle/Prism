import { testActivityBus } from "./activity-bus.test.js";
import { testAdapterSafetyRegression } from "./adapter-safety.test.js";
import { testDashboardService } from "./dashboard-service.test.js";
import { testDomainWorkflowTemplates } from "./domain-workflow-templates.test.js";
import { testEnvironmentProfiles } from "./environment-profiles.test.js";
import { testLlmProviderManager } from "./llm-provider-manager.test.js";
import { testPolicyEngine } from "./policy-engine.test.js";
import { testEpisodicMemory, testRetrievalMetricsCollector, testSemanticMemoryIndex } from "./memory.test.js";
import { testReplayHarness } from "./replay.test.js";
import { testReleaseValidationGates } from "./release-validation.test.js";
import { testRetrievalDashboardStore } from "./retrieval-dashboard-store.test.js";
import { testSelfReviewScheduler } from "./self-review-scheduler.test.js";
import { testSqliteMigrations } from "./sqlite-migrations.test.js";
import { testToolContracts } from "./tool-contracts.test.js";
import { testToolContractSnapshots } from "./tool-contract-snapshot.test.js";
import { testWorkflowOrchestrator } from "./workflow.test.js";

async function runTests(): Promise<void> {
    const tests = [
        { name: "PolicyEngine", fn: testPolicyEngine },
        { name: "ActivityBus", fn: testActivityBus },
        { name: "AdapterSafetyRegression", fn: testAdapterSafetyRegression },
        { name: "DashboardService", fn: testDashboardService },
        { name: "LlmProviderManager", fn: testLlmProviderManager },
        { name: "EnvironmentProfiles", fn: testEnvironmentProfiles },
        { name: "ReplayHarness", fn: testReplayHarness },
        { name: "ReleaseValidationGates", fn: testReleaseValidationGates },
        { name: "EpisodicMemory", fn: testEpisodicMemory },
        { name: "SemanticMemoryIndex", fn: testSemanticMemoryIndex },
        { name: "RetrievalMetricsCollector", fn: testRetrievalMetricsCollector },
        { name: "RetrievalDashboardStore", fn: testRetrievalDashboardStore },
        { name: "SqliteMigrations", fn: testSqliteMigrations },
        { name: "SelfReviewScheduler", fn: testSelfReviewScheduler },
        { name: "ToolContracts", fn: testToolContracts },
        { name: "ToolContractSnapshots", fn: testToolContractSnapshots },
        { name: "DomainWorkflowTemplates", fn: testDomainWorkflowTemplates },
        { name: "WorkflowOrchestrator", fn: testWorkflowOrchestrator },
    ];

    let passed = 0;
    let failed = 0;

    console.log("Running PRISM unit tests...\n");

    for (const test of tests) {
        try {
            await test.fn();
            passed++;
        } catch (error: unknown) {
            failed++;
            console.error(`✗ ${test.name} failed:`, error);
        }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`${"=".repeat(60)}`);

    if (failed > 0) {
        process.exitCode = 1;
    }
}

runTests().catch((error) => {
    console.error("Test runner failed:", error);
    process.exitCode = 1;
});
