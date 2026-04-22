import { testContainerSandboxAdapter } from "./container-sandbox-adapter.test.js";
import { testTerminalSessionAdapter } from "./terminal-session-adapter.test.js";

async function run() {
    console.log("Testing Sandbox:");
    await testContainerSandboxAdapter();
    console.log("\nTesting Terminal:");
    await testTerminalSessionAdapter();
}
run().catch(console.error);
