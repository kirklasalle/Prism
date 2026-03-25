import assert from "node:assert";
import { BrowserControlTool } from "../src/adapters/system/browser-control-tool.js";
import type { ToolRequest } from "../src/core/tools/types.js";

function makeRequest(args: Record<string, unknown>): ToolRequest {
  return { operation: "browser_control", args, risk: "low", mutatesState: false };
}

export async function testBrowserControlToolContract(): Promise<void> {
  const tool = new BrowserControlTool();
  assert.strictEqual(tool.name, "browser_control");
  assert.ok(tool.contract, "Should have a contract");
  assert.strictEqual(tool.contract.version, "1.0.0");
  assert.ok(tool.contract.args.action, "Should have action arg");
  assert.ok(tool.contract.args.action.required, "action should be required");
  assert.ok(Array.isArray(tool.contract.args.action.enum), "action should have enum");
  console.log("  ✓ BrowserControlTool contract is valid");
}

export async function testBrowserControlToolGovernance(): Promise<void> {
  const tool = new BrowserControlTool();
  assert.ok(tool.governance, "Should have governance schema");
  const actions = tool.governance.actions;

  // Low risk actions
  assert.strictEqual(actions.screenshot.minimumRisk, "low");
  assert.strictEqual(actions.get_console_logs.minimumRisk, "low");
  assert.strictEqual(actions.get_network_log.minimumRisk, "low");
  assert.strictEqual(actions.get_dom_snapshot.minimumRisk, "low");
  assert.strictEqual(actions.diagnostics.minimumRisk, "low");

  // Medium risk actions
  assert.strictEqual(actions.launch_session.minimumRisk, "medium");
  assert.strictEqual(actions.navigate.minimumRisk, "medium");
  assert.strictEqual(actions.click.minimumRisk, "medium");
  assert.strictEqual(actions.type.minimumRisk, "medium");

  // High risk actions
  assert.strictEqual(actions.evaluate.minimumRisk, "high");
  assert.strictEqual(actions.evaluate.rollbackRequired, true);

  console.log("  ✓ BrowserControlTool governance tiers are correct");
}

export async function testBrowserControlToolUnknownAction(): Promise<void> {
  const tool = new BrowserControlTool();
  const result = await tool.execute(makeRequest({ action: "nonexistent" }));
  assert.strictEqual(result.ok, false);
  assert.ok(String(result.output.error).includes("Unknown"));
  console.log("  ✓ Unknown action returns error");
}

export async function testBrowserControlToolDiagnostics(): Promise<void> {
  const tool = new BrowserControlTool();
  const result = await tool.execute(makeRequest({ action: "diagnostics" }));
  assert.strictEqual(result.ok, true);
  assert.ok("playwrightAvailable" in result.output, "Should report playwright availability");
  console.log("  ✓ Diagnostics action works");
}

export async function testBrowserControlToolListSessionsEmpty(): Promise<void> {
  const tool = new BrowserControlTool();
  const result = await tool.execute(makeRequest({ action: "list_sessions" }));
  assert.strictEqual(result.ok, true);
  const sessions = (result.output as any).sessions;
  assert.ok(Array.isArray(sessions), "Should return array");
  assert.strictEqual(sessions.length, 0, "Should start empty");
  console.log("  ✓ List sessions returns empty array when no sessions");
}

export async function testBrowserControlToolNavigateRequiresSession(): Promise<void> {
  const tool = new BrowserControlTool();
  const result = await tool.execute(makeRequest({ action: "navigate", url: "https://example.com" }));
  assert.strictEqual(result.ok, false);
  assert.ok(String(result.output.error).includes("sessionId"));
  console.log("  ✓ Navigate without sessionId returns error");
}

export async function testBrowserControlToolNavigateRequiresUrl(): Promise<void> {
  const tool = new BrowserControlTool();
  const result = await tool.execute(makeRequest({ action: "navigate", sessionId: "test-123" }));
  assert.strictEqual(result.ok, false);
  assert.ok(String(result.output.error).includes("url") || String(result.output.error).includes("not found"));
  console.log("  ✓ Navigate without url returns error");
}

export async function testBrowserControlToolClickRequiresSelector(): Promise<void> {
  const tool = new BrowserControlTool();
  const result = await tool.execute(makeRequest({ action: "click", sessionId: "test-123" }));
  assert.strictEqual(result.ok, false);
  assert.ok(String(result.output.error).includes("selector"));
  console.log("  ✓ Click without selector returns error");
}

export async function testBrowserControlToolEvaluateRequiresExpression(): Promise<void> {
  const tool = new BrowserControlTool();
  const result = await tool.execute(makeRequest({ action: "evaluate", sessionId: "test-123" }));
  assert.strictEqual(result.ok, false);
  assert.ok(String(result.output.error).includes("expression"));
  console.log("  ✓ Evaluate without expression returns error");
}

export async function testBrowserControlToolManagerAccess(): Promise<void> {
  const tool = new BrowserControlTool();
  const manager = tool.getManager();
  assert.ok(manager, "Should expose session manager");
  const sessions = manager.listSessions();
  assert.ok(Array.isArray(sessions));
  console.log("  ✓ getManager() returns session manager");
}
