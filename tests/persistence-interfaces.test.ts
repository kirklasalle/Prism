/**
 * Phase F-A — Persistence Interfaces conformance test.
 *
 * Validates that the existing concrete stores satisfy the
 * `ISessionStore` and `IActivityStore` interfaces structurally, and
 * that runtime instances can be assigned to the interface types.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { SqliteActivityStore } from "../src/core/activity/sqlite-store.js";
import type { ISessionStore, IActivityStore } from "../src/core/database/store-interfaces.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testPersistenceInterfaces(): Promise<void> {
    const tmp = mkdtempSync(join(tmpdir(), "prism-persist-iface-"));
    try {
        const sessionDb = join(tmp, "sessions.db");
        const session: ISessionStore = new ChatSessionStore(sessionDb);
        assert(typeof session.createSession === "function", "ISessionStore.createSession");
        assert(typeof session.listSessions === "function", "ISessionStore.listSessions");
        assert(typeof session.getSession === "function", "ISessionStore.getSession");
        assert(typeof session.getMessages === "function", "ISessionStore.getMessages");
        assert(typeof session.appendMessage === "function", "ISessionStore.appendMessage");
        assert(typeof session.updateSessionTitle === "function", "ISessionStore.updateSessionTitle");
        assert(typeof session.deleteSession === "function", "ISessionStore.deleteSession");
        assert(typeof session.close === "function", "ISessionStore.close");
        const created = session.createSession("Phase F test") as { sessionId: string };
        assert(typeof created.sessionId === "string", "createSession returns id");
        session.close();

        const activityDb = join(tmp, "activity.db");
        const activity: IActivityStore = new SqliteActivityStore(activityDb);
        assert(typeof activity.onEvent === "function", "IActivityStore.onEvent");
        assert(typeof activity.queryEvents === "function", "IActivityStore.queryEvents");
        assert(typeof activity.close === "function", "IActivityStore.close");
        activity.close();
    } finally {
        try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
}
