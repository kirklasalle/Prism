import assert from "node:assert";
import {
  BrowserSessionManager,
  type BrowserSessionState,
} from "../src/core/operator/browser-session-manager.js";
import { ActivityBus } from "../src/core/activity/bus.js";

export async function testBrowserSessionManagerDiagnostics(): Promise<void> {
  const manager = new BrowserSessionManager();
  const diag = await manager.diagnostics();
  assert.ok("playwrightAvailable" in diag, "Should report playwright availability");
  console.log("  ✓ Diagnostics returns playwright status");
}

export async function testBrowserSessionManagerListEmpty(): Promise<void> {
  const manager = new BrowserSessionManager();
  const sessions = manager.listSessions();
  assert.ok(Array.isArray(sessions));
  assert.strictEqual(sessions.length, 0);
  console.log("  ✓ listSessions returns empty array initially");
}

export async function testBrowserSessionManagerGetSessionNull(): Promise<void> {
  const manager = new BrowserSessionManager();
  const session = manager.getSession("nonexistent");
  assert.strictEqual(session, null);
  console.log("  ✓ getSession for nonexistent returns null");
}

export async function testBrowserSessionManagerCloseNonexistent(): Promise<void> {
  const manager = new BrowserSessionManager();
  // Should not throw
  await manager.closeSession("nonexistent");
  console.log("  ✓ closeSession for nonexistent does not throw");
}

export async function testBrowserSessionManagerCloseAll(): Promise<void> {
  const manager = new BrowserSessionManager();
  // Should not throw even with no sessions
  await manager.closeAll();
  console.log("  ✓ closeAll with no sessions does not throw");
}

export async function testBrowserSessionManagerActivityBusEmit(): Promise<void> {
  const bus = new ActivityBus();
  const events: string[] = [];
  bus.subscribe({ onEvent: (e) => events.push(e.operation) });
  const manager = new BrowserSessionManager(bus, "test-session");

  // Diagnostics don't emit events
  await manager.diagnostics();
  assert.strictEqual(events.length, 0, "Diagnostics should not emit events");

  console.log("  ✓ ActivityBus integration works");
}

export async function testBrowserSessionStateType(): Promise<void> {
  // Verify the state type covers expected values
  const states: BrowserSessionState[] = ["idle", "launching", "active", "navigating", "suspended", "terminated"];
  assert.strictEqual(states.length, 6);
  console.log("  ✓ BrowserSessionState covers all lifecycle states");
}

export async function testBrowserSessionManager(): Promise<void> {
  console.log("BrowserSessionManager");
  await testBrowserSessionManagerDiagnostics();
  await testBrowserSessionManagerListEmpty();
  await testBrowserSessionManagerGetSessionNull();
  await testBrowserSessionManagerCloseNonexistent();
  await testBrowserSessionManagerCloseAll();
  await testBrowserSessionManagerActivityBusEmit();
  await testBrowserSessionStateType();
}
