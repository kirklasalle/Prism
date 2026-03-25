import { testActivityBus } from "./activity-bus.test.js";
import { testAdapterSafetyRegression } from "./adapter-safety.test.js";
import { testDashboardService } from "./dashboard-service.test.js";
import { testCharacterAccountability } from "./character-accountability.test.js";
import { testD2SystemTools } from "./d2-system-tools.test.js";
import { testD2GovernancePaths } from "./d2-governance-paths.test.js";
import { testDomainWorkflowTemplates } from "./domain-workflow-templates.test.js";
import { testEnvironmentProfiles } from "./environment-profiles.test.js";
import { testLlmProviderManager } from "./llm-provider-manager.test.js";
import { testPolicyEngine } from "./policy-engine.test.js";
import { testOrchestratorExecutionProfile } from "./orchestrator-execution-profile.test.js";
import { testPolicyAuditExporter, testSessionTraceExplorer } from "./operator-surfaces.test.js";
import { testEpisodicMemory, testRetrievalMetricsCollector, testSemanticMemoryIndex } from "./memory.test.js";
import { testReplayHarness } from "./replay.test.js";
import { testReleaseValidationGates } from "./release-validation.test.js";
import { testRetrievalDashboardStore } from "./retrieval-dashboard-store.test.js";
import { testSelfReviewScheduler } from "./self-review-scheduler.test.js";
import { testSqliteMigrations } from "./sqlite-migrations.test.js";
import { testToolContracts } from "./tool-contracts.test.js";
import { testToolContractSnapshots } from "./tool-contract-snapshot.test.js";
import { testWorkflowOrchestrator } from "./workflow.test.js";
import { testBrowserProfileManager } from "./browser-profile-manager.test.js";

async function runTests(): Promise<void> {
    const tests = [
        { name: "PolicyEngine", fn: testPolicyEngine },
        { name: "OrchestratorExecutionProfile", fn: testOrchestratorExecutionProfile },
        { name: "D2GovernancePaths", fn: testD2GovernancePaths },
        { name: "ActivityBus", fn: testActivityBus },
        { name: "AdapterSafetyRegression", fn: testAdapterSafetyRegression },
        { name: "DashboardService", fn: testDashboardService },
        { name: "CharacterAccountability", fn: testCharacterAccountability },
        { name: "D2SystemTools", fn: testD2SystemTools },
        { name: "LlmProviderManager", fn: testLlmProviderManager },
        { name: "SessionTraceExplorer", fn: testSessionTraceExplorer },
        { name: "PolicyAuditExporter", fn: testPolicyAuditExporter },
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
        { name: "BrowserProfileManager", fn: testBrowserProfileManager },
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
