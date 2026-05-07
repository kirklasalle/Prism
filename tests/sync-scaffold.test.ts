/**
 * Tests for Phase F: Sync scaffold (filesystem adapter + engine).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoopSyncAdapter } from "../src/core/sync/noop-sync-adapter.js";
import { FilesystemSyncAdapter } from "../src/core/sync/filesystem-sync-adapter.js";
import { SyncEngine, createSyncAdapterFromEnv } from "../src/core/sync/sync-engine.js";
import type { SyncEvent } from "../src/core/sync/sync-adapter.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

function makeEvent(id: string, layer: SyncEvent["layer"] = "audit"): SyncEvent {
    return {
        id,
        layer,
        tenantId: "default",
        ts: new Date().toISOString(),
        payload: { hello: id },
    };
}

export async function testSyncScaffold(): Promise<void> {
    // ── Noop adapter ──
    const noop = new NoopSyncAdapter();
    await noop.init();
    const r = await noop.push({ events: [makeEvent("e1")], source: "test" });
    assert(r.accepted === 1, "noop accepts events");
    assert((await noop.pull()) === null, "noop never returns events");
    const s = await noop.status();
    assert(s.adapter === "noop" && !s.enabled, "noop status reports disabled");

    // ── Filesystem adapter: A pushes, B pulls ──
    const root = mkdtempSync(join(tmpdir(), "prism-sync-"));
    try {
        const a = new FilesystemSyncAdapter({ root, instanceId: "instA" });
        const b = new FilesystemSyncAdapter({ root, instanceId: "instB" });
        await a.init();
        await b.init();

        const push1 = await a.push({ events: [makeEvent("e1"), makeEvent("e2"), makeEvent("e3")], source: "instA" });
        assert(push1.accepted === 3, "all events accepted by A");

        const pull1 = await b.pull();
        assert(pull1 !== null && pull1.events.length === 3, "B pulls A's 3 events");
        for (const ev of pull1!.events) {
            assert(ev._replayedFrom === "instA", "events tagged with source");
        }

        // Idempotency: second pull yields nothing.
        const pull2 = await b.pull();
        assert(pull2 === null || pull2.events.length === 0, "second pull is empty (idempotent)");

        // Cursor persistence: new B instance should still skip seen events.
        const b2 = new FilesystemSyncAdapter({ root, instanceId: "instB" });
        await b2.init();
        const pull3 = await b2.pull();
        assert(pull3 === null, "rehydrated instance skips already-seen events");

        // Layer filter: events outside allowlist rejected.
        const limited = new FilesystemSyncAdapter({ root, instanceId: "instC", layers: ["memory"] });
        await limited.init();
        const auditEvent = makeEvent("e4", "audit");
        const memoryEvent = makeEvent("e5", "memory");
        const rPush = await limited.push({ events: [auditEvent, memoryEvent], source: "instC" });
        assert(rPush.accepted === 1 && rPush.rejected === 1, "layer filter rejects audit");

        // ── SyncEngine integration ──
        const collected: SyncEvent[] = [];
        const engine = new SyncEngine({ adapter: a, onInboundEvent: (e) => collected.push(e) });
        await engine.init();
        engine.enqueue(makeEvent("e10"));
        const flush = await engine.pushNow("instA");
        assert(flush.accepted === 1, "engine flushes 1");

        // ── Factory: PRISM_SYNC_ADAPTER selects ──
        const prev = process.env.PRISM_SYNC_ADAPTER;
        delete process.env.PRISM_SYNC_ADAPTER;
        const def = createSyncAdapterFromEnv({ root, instanceId: "x" });
        assert(def.name === "noop", "default => noop");
        process.env.PRISM_SYNC_ADAPTER = "filesystem";
        const fs = createSyncAdapterFromEnv({ root, instanceId: "x" });
        assert(fs.name === "filesystem", "env=filesystem selects fs adapter");
        if (prev === undefined) delete process.env.PRISM_SYNC_ADAPTER;
        else process.env.PRISM_SYNC_ADAPTER = prev;
    } finally {
        rmSync(root, { recursive: true, force: true });
    }

    console.log("  ✓ Sync Scaffold (noop + filesystem + engine)");
}
