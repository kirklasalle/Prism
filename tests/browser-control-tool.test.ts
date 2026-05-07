import assert from "node:assert";
import { BrowserControlTool } from "../src/adapters/system/browser-control-tool.js";
import type { ToolRequest } from "../src/core/tools/types.js";

function makeRequest(args: Record<string, unknown>): ToolRequest {
  return { operation: "browser_control", args, risk: "low", mutatesState: false };
}

/* ── Contract ─────────────────────────────────────────────────────────── */

export async function testBrowserControlToolContract(): Promise<void> {
  const tool = new BrowserControlTool();
  assert.strictEqual(tool.name, "browser_control");
  assert.ok(tool.contract, "Should have a contract");
  assert.strictEqual(tool.contract.version, "2.0.0");
  assert.ok(tool.contract.args.action, "Should have action arg");
  assert.ok(tool.contract.args.action.required, "action should be required");
  assert.ok(Array.isArray(tool.contract.args.action.enum), "action should have enum");

  // Verify enum lists every governance action
  const enumActions = tool.contract.args.action.enum!;
  const governanceActions = Object.keys(tool.governance.actions);
  for (const ga of governanceActions) {
    assert.ok(enumActions.includes(ga), `Contract enum missing governance action: ${ga}`);
  }
  console.log("  ✓ BrowserControlTool contract is valid and enum covers all governance actions");
}

/* ── Governance ───────────────────────────────────────────────────────── */

export async function testBrowserControlToolGovernance(): Promise<void> {
  const tool = new BrowserControlTool();
  assert.ok(tool.governance, "Should have governance schema");
  const actions = tool.governance.actions;

  // Low risk, non-mutating, no rollback
  const lowReadOnly = [
    "screenshot", "get_console_logs", "get_network_log", "get_dom_snapshot",
    "list_sessions", "diagnostics", "scroll", "wait_for_selector",
    "get_page_info", "get_text_content", "get_links", "get_accessibility_tree",
    "screenshot_full_page", "save_pdf", "get_cookies", "list_profiles", "get_profile",
  ];
  for (const name of lowReadOnly) {
    assert.strictEqual(actions[name].minimumRisk, "low", `${name} should be low risk`);
    assert.strictEqual(actions[name].rollbackRequired, false, `${name} should not require rollback`);
  }

  // Low risk but mutating
  assert.strictEqual(actions.close_session.minimumRisk, "low");
  assert.strictEqual(actions.close_session.mutating, true);

  // Medium risk actions
  const mediumActions = [
    "launch_session", "navigate", "click", "type",
    "go_back", "go_forward", "reload", "hover",
    "select_option", "set_cookie", "clear_cookies",
    "create_profile", "delete_profile",
  ];
  for (const name of mediumActions) {
    assert.strictEqual(actions[name].minimumRisk, "medium", `${name} should be medium risk`);
    assert.strictEqual(actions[name].rollbackRequired, false, `${name} should not require rollback`);
  }

  // High risk actions
  assert.strictEqual(actions.evaluate.minimumRisk, "high");
  assert.strictEqual(actions.evaluate.rollbackRequired, true);
  assert.strictEqual(actions.evaluate.mutating, true);

  console.log("  ✓ BrowserControlTool governance tiers are correct for all actions");
}

/* ── Core actions ─────────────────────────────────────────────────────── */

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

/* ── Original input-guard tests ───────────────────────────────────────── */

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

/* ── Input-guard tests for new actions ────────────────────────────────── */

async function testSessionIdRequired(actionName: string): Promise<void> {
  const tool = new BrowserControlTool();
  const result = await tool.execute(makeRequest({ action: actionName }));
  assert.strictEqual(result.ok, false, `${actionName} without sessionId should fail`);
  assert.ok(
    String(result.output.error).includes("sessionId") || String(result.output.error).includes("not found"),
    `${actionName} error should mention sessionId`
  );
}

export async function testBrowserControlToolNavigationHelpers(): Promise<void> {
  for (const action of ["go_back", "go_forward", "reload"]) {
    await testSessionIdRequired(action);
  }
  console.log("  ✓ go_back/go_forward/reload require sessionId");
}

export async function testBrowserControlToolHoverRequiresSelector(): Promise<void> {
  const tool = new BrowserControlTool();
  // No sessionId
  await testSessionIdRequired("hover");
  // Has sessionId but no selector
  const result = await tool.execute(makeRequest({ action: "hover", sessionId: "test-123" }));
  assert.strictEqual(result.ok, false);
  assert.ok(String(result.output.error).includes("selector"));
  console.log("  ✓ Hover requires sessionId and selector");
}

export async function testBrowserControlToolSelectOptionRequiresSelector(): Promise<void> {
  const tool = new BrowserControlTool();
  await testSessionIdRequired("select_option");
  const result = await tool.execute(makeRequest({ action: "select_option", sessionId: "test-123" }));
  assert.strictEqual(result.ok, false);
  assert.ok(String(result.output.error).includes("selector"));
  console.log("  ✓ select_option requires sessionId and selector");
}

export async function testBrowserControlToolScrollRequiresSession(): Promise<void> {
  await testSessionIdRequired("scroll");
  console.log("  ✓ scroll requires sessionId");
}

export async function testBrowserControlToolWaitForSelectorRequires(): Promise<void> {
  const tool = new BrowserControlTool();
  await testSessionIdRequired("wait_for_selector");
  const result = await tool.execute(makeRequest({ action: "wait_for_selector", sessionId: "test-123" }));
  assert.strictEqual(result.ok, false);
  assert.ok(String(result.output.error).includes("selector"));
  console.log("  ✓ wait_for_selector requires sessionId and selector");
}

export async function testBrowserControlToolPageInfoActions(): Promise<void> {
  for (const action of ["get_page_info", "get_text_content", "get_links", "get_accessibility_tree"]) {
    await testSessionIdRequired(action);
  }
  console.log("  ✓ Page info actions require sessionId");
}

export async function testBrowserControlToolScreenshotFullPage(): Promise<void> {
  await testSessionIdRequired("screenshot_full_page");
  console.log("  ✓ screenshot_full_page requires sessionId");
}

export async function testBrowserControlToolSavePdf(): Promise<void> {
  await testSessionIdRequired("save_pdf");
  console.log("  ✓ save_pdf requires sessionId");
}

export async function testBrowserControlToolScreenshotRequiresSession(): Promise<void> {
  await testSessionIdRequired("screenshot");
  console.log("  ✓ screenshot requires sessionId");
}

export async function testBrowserControlToolTypeRequiresSelector(): Promise<void> {
  const tool = new BrowserControlTool();
  await testSessionIdRequired("type");
  const result = await tool.execute(makeRequest({ action: "type", sessionId: "test-123" }));
  assert.strictEqual(result.ok, false);
  assert.ok(String(result.output.error).includes("selector"));
  console.log("  ✓ type requires sessionId and selector");
}

export async function testBrowserControlToolCloseSessionRequiresId(): Promise<void> {
  const tool = new BrowserControlTool();
  const result = await tool.execute(makeRequest({ action: "close_session" }));
  assert.strictEqual(result.ok, false);
  assert.ok(String(result.output.error).includes("sessionId"));
  console.log("  ✓ close_session requires sessionId");
}

export async function testBrowserControlToolConsoleLogsRequiresSession(): Promise<void> {
  await testSessionIdRequired("get_console_logs");
  console.log("  ✓ get_console_logs requires sessionId");
}

export async function testBrowserControlToolNetworkLogRequiresSession(): Promise<void> {
  await testSessionIdRequired("get_network_log");
  console.log("  ✓ get_network_log requires sessionId");
}

export async function testBrowserControlToolDomSnapshotRequiresSession(): Promise<void> {
  await testSessionIdRequired("get_dom_snapshot");
  console.log("  ✓ get_dom_snapshot requires sessionId");
}

/* ── Cookie management input guards ──────────────────────────────────── */

export async function testBrowserControlToolCookieActions(): Promise<void> {
  const tool = new BrowserControlTool();
  // get_cookies requires sessionId
  await testSessionIdRequired("get_cookies");
  // set_cookie requires sessionId
  await testSessionIdRequired("set_cookie");
  // set_cookie with sessionId but no cookie
  const setCookieResult = await tool.execute(makeRequest({ action: "set_cookie", sessionId: "test-123" }));
  assert.strictEqual(setCookieResult.ok, false);
  assert.ok(String(setCookieResult.output.error).includes("cookie"));
  // set_cookie with invalid JSON
  const badJsonResult = await tool.execute(makeRequest({ action: "set_cookie", sessionId: "test-123", cookie: "not-json" }));
  assert.strictEqual(badJsonResult.ok, false);
  assert.ok(String(badJsonResult.output.error).includes("JSON"));
  // clear_cookies requires sessionId
  await testSessionIdRequired("clear_cookies");
  console.log("  ✓ Cookie actions validate inputs correctly");
}

/* ── Profile management input guards ─────────────────────────────────── */

export async function testBrowserControlToolProfileActions(): Promise<void> {
  const tool = new BrowserControlTool();
  // list_profiles should work (no sessionId needed)
  const listResult = await tool.execute(makeRequest({ action: "list_profiles" }));
  assert.strictEqual(listResult.ok, true);
  assert.ok((listResult.output as any).count === 0 || (listResult.output as any).count >= 0);

  // create_profile requires email
  const createNoEmail = await tool.execute(makeRequest({ action: "create_profile" }));
  assert.strictEqual(createNoEmail.ok, false);
  assert.ok(String(createNoEmail.output.error).includes("email"));

  // create_profile with email works
  const createResult = await tool.execute(makeRequest({ action: "create_profile", email: "test@example.com" }));
  assert.strictEqual(createResult.ok, true);
  const profileId = (createResult.output as any).profileId;
  assert.ok(profileId, "Should return profileId");

  // get_profile requires profileId
  const getNoId = await tool.execute(makeRequest({ action: "get_profile" }));
  assert.strictEqual(getNoId.ok, false);
  assert.ok(String(getNoId.output.error).includes("profileId"));

  // get_profile with valid id
  const getResult = await tool.execute(makeRequest({ action: "get_profile", profileId }));
  assert.strictEqual(getResult.ok, true);

  // get_profile with nonexistent id
  const getNotFound = await tool.execute(makeRequest({ action: "get_profile", profileId: "nonexistent" }));
  assert.strictEqual(getNotFound.ok, false);
  assert.ok(String(getNotFound.output.error).includes("not found"));

  // delete_profile requires profileId
  const deleteNoId = await tool.execute(makeRequest({ action: "delete_profile" }));
  assert.strictEqual(deleteNoId.ok, false);
  assert.ok(String(deleteNoId.output.error).includes("profileId"));

  // delete_profile with valid id
  const deleteResult = await tool.execute(makeRequest({ action: "delete_profile", profileId }));
  assert.strictEqual(deleteResult.ok, true);
  assert.strictEqual((deleteResult.output as any).deleted, true);

  console.log("  ✓ Profile management actions validate inputs correctly");
}

export async function testBrowserControlToolProfileManagerAccess(): Promise<void> {
  const tool = new BrowserControlTool();
  const profMgr = tool.getProfileManager();
  assert.ok(profMgr, "Should expose profile manager");
  assert.ok(Array.isArray(profMgr.listProfiles()));
  console.log("  ✓ getProfileManager() returns profile manager");
}

/* ── Aggregate runner ─────────────────────────────────────────────────── */

export async function testBrowserControlTool(): Promise<void> {
  console.log("BrowserControlTool");
  // Contract & governance
  await testBrowserControlToolContract();
  await testBrowserControlToolGovernance();
  // Core actions
  await testBrowserControlToolUnknownAction();
  await testBrowserControlToolDiagnostics();
  await testBrowserControlToolListSessionsEmpty();
  // Original input guards
  await testBrowserControlToolNavigateRequiresSession();
  await testBrowserControlToolNavigateRequiresUrl();
  await testBrowserControlToolClickRequiresSelector();
  await testBrowserControlToolEvaluateRequiresExpression();
  await testBrowserControlToolManagerAccess();
  // New action input guards
  await testBrowserControlToolNavigationHelpers();
  await testBrowserControlToolHoverRequiresSelector();
  await testBrowserControlToolSelectOptionRequiresSelector();
  await testBrowserControlToolScrollRequiresSession();
  await testBrowserControlToolWaitForSelectorRequires();
  await testBrowserControlToolPageInfoActions();
  await testBrowserControlToolScreenshotFullPage();
  await testBrowserControlToolSavePdf();
  await testBrowserControlToolScreenshotRequiresSession();
  await testBrowserControlToolTypeRequiresSelector();
  await testBrowserControlToolCloseSessionRequiresId();
  await testBrowserControlToolConsoleLogsRequiresSession();
  await testBrowserControlToolNetworkLogRequiresSession();
  await testBrowserControlToolDomSnapshotRequiresSession();
  // Cookie input guards
  await testBrowserControlToolCookieActions();
  // Profile management
  await testBrowserControlToolProfileActions();
  await testBrowserControlToolProfileManagerAccess();
}
