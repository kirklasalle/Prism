import { testActivityBus } from "./activity-bus.test.js";
import { testPolicyEngine } from "./policy-engine.test.js";
import { testEpisodicMemory, testSemanticMemoryIndex } from "./memory.test.js";
async function runTests() {
    const tests = [
        { name: "PolicyEngine", fn: testPolicyEngine },
        { name: "ActivityBus", fn: testActivityBus },
        { name: "EpisodicMemory", fn: testEpisodicMemory },
        { name: "SemanticMemoryIndex", fn: testSemanticMemoryIndex },
    ];
    let passed = 0;
    let failed = 0;
    console.log("Running PRISM unit tests...\n");
    for (const test of tests) {
        try {
            await test.fn();
            passed++;
        }
        catch (error) {
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
//# sourceMappingURL=index.js.map