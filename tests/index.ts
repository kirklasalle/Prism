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
import { testBrowserSessionManager } from "./browser-session-manager.test.js";
import { testBrowserControlTool } from "./browser-control-tool.test.js";
import { testGuardianAgent } from "./guardian-agent.test.js";
import { testTerminalSessionAdapter } from "./terminal-session-adapter.test.js";
import { testContainerSandboxAdapter } from "./container-sandbox-adapter.test.js";
import { testOAuthAdapters } from "./oauth-adapters.test.js";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setWorkspaceRootForTest } from "../src/core/config/workspace-resolver.js";

async function runTests(): Promise<void> {
    // Isolate workspace root so tests don't conflict with a running server's SQLite DBs.
    // Must use _setWorkspaceRootForTest to directly set the module-level _resolvedRoot cache —
    // env var alone is ignored because .prism-preferences.json takes priority in resolveWorkspaceRoot().
    const testWorkspace = mkdtempSync(join(tmpdir(), "prism-test-"));
    mkdirSync(join(testWorkspace, "state"), { recursive: true });
    mkdirSync(join(testWorkspace, "config"), { recursive: true });
    mkdirSync(join(testWorkspace, "artifacts", "packages"), { recursive: true });
    mkdirSync(join(testWorkspace, "logs"), { recursive: true });
    _setWorkspaceRootForTest(testWorkspace);
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
        { name: "BrowserSessionManager", fn: testBrowserSessionManager },
        { name: "BrowserControlTool", fn: testBrowserControlTool },
        { name: "GuardianAgent", fn: testGuardianAgent },
        { name: "TerminalSessionAdapter", fn: testTerminalSessionAdapter },
        { name: "ContainerSandboxAdapter", fn: testContainerSandboxAdapter },
        { name: "OAuthAdapters", fn: testOAuthAdapters },
    ];

    let passed = 0;
    let failed = 0;

    console.log("Running PRISM unit tests...\n");

    try {
        for (const test of tests) {
            try {
                await test.fn();
                passed++;
            } catch (error: unknown) {
                failed++;
                console.error(`✗ ${test.name} failed:`, error);
            }
        }
    } finally {
        // Clean up isolated workspace
        try { rmSync(testWorkspace, { recursive: true, force: true }); } catch { /* best effort */ }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`${"=".repeat(60)}`);

    // Force exit to avoid dangling handles from test servers keeping the process alive
    setTimeout(() => process.exit(failed > 0 ? 1 : 0), 500);
}

runTests().catch((error) => {
    console.error("Test runner failed:", error);
    process.exit(1);
});
