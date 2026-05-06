import { testActivityBus } from "./activity-bus.test.js";
import { testAdapterSafetyRegression } from "./adapter-safety.test.js";
import { testAdapterSafetyRegressionExpanded } from "./adapter-safety-expanded.test.js";
import { testNetworkAdapterSafety } from "./network-adapter-safety.test.js";
import { testApprovalContentionMixedOutcomes } from "./approval-contention-mixed-outcomes.test.js";
import { testDashboardService } from "./dashboard-service.test.js";
import { testCharacterAccountability, testCharacterAccountabilityPhaseE3 } from "./character-accountability.test.js";
import { testD2SystemTools } from "./d2-system-tools.test.js";
import { testD2GovernancePaths } from "./d2-governance-paths.test.js";
import { testPolicyPathMutatingOps } from "./policy-path-mutating-ops.test.js";
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
import {
    testUtilityRegistry,
    testRiskOverrideStore,
    testIncidentTrendStore,
    testRetrievalAlertTuning,
} from "./operator-surfaces-phase-e3.test.js";
import { testPerfTrendReport } from "./perf-trend-report.test.js";
import { testCccCompiler } from "./ccc-compiler.test.js";
import { testDlmaArbiter } from "./dlma-arbiter.test.js";
import { testShwsSynthesizer } from "./shws-synthesizer.test.js";
import { testSRNModelFanout } from "./sr-n-model-fanout.test.js";
import { testSrMemoryAndRecommender } from "./sr-memory-recommender.test.js";
import { testSrTool } from "./sr-tool.test.js";
import { testTenantContext } from "./tenant-context.test.js";
import { testSyncScaffold } from "./sync-scaffold.test.js";
import { testPluginMarketplace } from "./plugin-marketplace.test.js";
import { testPwaAssets } from "./pwa-assets.test.js";
import { testPersistenceInterfaces } from "./persistence-interfaces.test.js";
import { testPostgresAdapter } from "./postgres-adapter.test.js";
import { testMultiTenantWorkspace } from "./multi-tenant-workspace.test.js";
import { testSoakHarness } from "./soak-harness.test.js";
import { testStressHarness } from "./stress-harness.test.js";
import { testArtifactSignature } from "./artifact-signature.test.js";
import { testOwaspScan } from "./owasp-scan.test.js";
import { testPlatformParityAudit } from "./platform-parity-audit.test.js";
import { testMarketplaceCuration } from "./marketplace-curation.test.js";
import { testSrShowcaseDemo } from "./sr-showcase.test.js";
import { testPluginScaffold } from "./plugin-scaffold.test.js";
import { testPtacOrchestrator } from "./ptac-orchestrator.test.js";
import { testOpenAiCompatShim } from "./openai-compat-shim.test.js";
import { testOpenAiCompatRoutes } from "./openai-compat-routes.test.js";
import { testIamStore } from "./iam-store.test.js";
import { testIamRbac } from "./iam-rbac.test.js";
import {
    testIamSsoSession,
    testIamSsoOidc,
    testIamSsoSaml,
    testIamRoutesEndToEnd,
} from "./iam-sso.test.js";
import { testScimRoutes, testIamAdminRoutes } from "./iam-scim-admin.test.js";
import { testHelmLint } from "./helm-lint.test.js";
import { testSoc2Exporter } from "./soc2-exporter.test.js";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setWorkspaceRootForTest } from "../src/core/config/workspace-resolver.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const EXTENDED_TIMEOUT_MS = 60_000;
const EXTENDED_TESTS = new Set([
    "BrowserSessionManager",
    "BrowserControlTool",
    "BrowserProfileManager",
    "ContainerSandboxAdapter",
    "TerminalSessionAdapter",
    "OAuthAdapters",
    "DashboardService",
]);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`TIMEOUT after ${ms}ms -- "${label}" did not complete. Check for hanging async ops.`));
        }, ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); }
        );
    });
}

async function runTests(): Promise<void> {
    // Filter known-benign Windows ConPTY teardown noise from node-pty's
    // `conpty_console_list.cc` — when a PTY child process has already exited,
    // the native cleanup helper calls `AttachConsole(pid)` which throws
    // "AttachConsole failed". This surfaces as an uncaughtException during
    // process teardown but is not a test failure; swallow it so the runner
    // can exit with a non-zero status only when an actual test fails.
    process.on("uncaughtException", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("AttachConsole failed")) {
            return; // benign node-pty Windows cleanup race
        }
        // Re-raise anything else by exiting with the original Node behaviour.
        console.error("Uncaught exception during test run:", err);
        process.exit(1);
    });

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
        { name: "PolicyPathMutatingOps", fn: testPolicyPathMutatingOps },
        { name: "ActivityBus", fn: testActivityBus },
        { name: "AdapterSafetyRegression", fn: testAdapterSafetyRegression },
        { name: "AdapterSafetyRegressionExpanded", fn: testAdapterSafetyRegressionExpanded },
        { name: "NetworkAdapterSafety", fn: testNetworkAdapterSafety },
        { name: "ApprovalContentionMixedOutcomes", fn: testApprovalContentionMixedOutcomes },
        { name: "DashboardService", fn: testDashboardService },
        { name: "CharacterAccountability", fn: testCharacterAccountability },
        { name: "CharacterAccountabilityPhaseE3", fn: testCharacterAccountabilityPhaseE3 },
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
        { name: "UtilityRegistry", fn: testUtilityRegistry },
        { name: "RiskOverrideStore", fn: testRiskOverrideStore },
        { name: "IncidentTrendStore", fn: testIncidentTrendStore },
        { name: "RetrievalAlertTuning", fn: testRetrievalAlertTuning },
        { name: "PerfTrendReport", fn: testPerfTrendReport },
        { name: "CccCompiler", fn: testCccCompiler },
        { name: "DlmaArbiter", fn: testDlmaArbiter },
        { name: "ShwsSynthesizer", fn: testShwsSynthesizer },
        { name: "SRNModelFanout", fn: testSRNModelFanout },
        { name: "SrMemoryAndRecommender", fn: testSrMemoryAndRecommender },
        { name: "SrTool", fn: testSrTool },
        { name: "TenantContext", fn: testTenantContext },
        { name: "SyncScaffold", fn: testSyncScaffold },
        { name: "PwaAssets", fn: testPwaAssets },
        { name: "PluginMarketplace", fn: testPluginMarketplace },
        { name: "PersistenceInterfaces", fn: testPersistenceInterfaces },
        { name: "PostgresAdapter", fn: testPostgresAdapter },
        { name: "MultiTenantWorkspace", fn: testMultiTenantWorkspace },
        { name: "SoakHarness", fn: testSoakHarness },
        { name: "StressHarness", fn: testStressHarness },
        { name: "ArtifactSignature", fn: testArtifactSignature },
        { name: "OwaspScan", fn: testOwaspScan },
        { name: "PlatformParityAudit", fn: testPlatformParityAudit },
        { name: "MarketplaceCuration", fn: testMarketplaceCuration },
        { name: "SrShowcaseDemo", fn: testSrShowcaseDemo },
        { name: "PluginScaffold", fn: testPluginScaffold },
        { name: "PtacOrchestrator", fn: testPtacOrchestrator },
        { name: "OpenAiCompatShim", fn: testOpenAiCompatShim },
        { name: "OpenAiCompatRoutes", fn: testOpenAiCompatRoutes },
        { name: "IamStore", fn: testIamStore },
        { name: "IamRbac", fn: testIamRbac },
        { name: "IamSsoSession", fn: testIamSsoSession },
        { name: "IamSsoOidc", fn: testIamSsoOidc },
        { name: "IamSsoSaml", fn: testIamSsoSaml },
        { name: "IamRoutesE2E", fn: testIamRoutesEndToEnd },
        { name: "ScimRoutes", fn: testScimRoutes },
        { name: "IamAdminRoutes", fn: testIamAdminRoutes },
        { name: "HelmLint", fn: testHelmLint },
        { name: "Soc2Exporter", fn: testSoc2Exporter },
    ];

    let passed = 0;
    let failed = 0;

    console.log("Running PRISM unit tests...\n");

    try {
        for (const test of tests) {
            const timeoutMs = EXTENDED_TESTS.has(test.name) ? EXTENDED_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
            process.stdout.write(`  -> ${test.name.padEnd(36)} `);
            const t0 = Date.now();
            try {
                await withTimeout(test.fn(), timeoutMs, test.name);
                const elapsed = Date.now() - t0;
                process.stdout.write(`OK   ${elapsed}ms\n`);
                passed++;
            } catch (error: unknown) {
                const elapsed = Date.now() - t0;
                process.stdout.write(`FAIL ${elapsed}ms\n`);
                failed++;
                console.error(`   ✗ ${test.name}:`, error instanceof Error ? error.message : error);
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
