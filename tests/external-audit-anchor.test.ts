import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import { ActivityBus } from "../src/core/activity/bus.js";
import { SqliteActivityStore } from "../src/core/activity/sqlite-store.js";
import {
    FileExternalAuditAnchorStore,
    publishPersistedAuditAnchor,
    verifyLatestPersistedAuditAnchor,
} from "../src/core/activity/external-audit-anchor.js";

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("External persisted audit anchors", () => {
    it("detects suffix deletion against an independently stored signed checkpoint", () => {
        const directory = mkdtempSync(join(tmpdir(), "prism-external-anchor-"));
        directories.push(directory);
        const databasePath = join(directory, "activity.db");
        const store = new SqliteActivityStore(databasePath);
        const bus = new ActivityBus();
        bus.subscribe(store);
        for (const operation of ["one", "two", "three"]) {
            bus.emit({ sessionId: "anchor-test", layer: "governance", operation, status: "succeeded", details: {} });
        }
        const anchors = new FileExternalAuditAnchorStore(join(directory, "external", "anchors.jsonl"));
        publishPersistedAuditAnchor(store, anchors);
        assert.equal(verifyLatestPersistedAuditAnchor(store, anchors).valid, true);

        const database = new DatabaseSync(databasePath);
        database.exec("UPDATE audit_chain_guard SET retention_active = 1 WHERE id = 1");
        database.exec("DELETE FROM activity_events WHERE sequence_number = 3");
        database.exec("UPDATE audit_chain_guard SET retention_active = 0 WHERE id = 1");
        database.close();

        const result = verifyLatestPersistedAuditAnchor(store, anchors);
        assert.equal(result.valid, false);
        assert.match(result.reason, /range|Sequence|missing/i);
        store.close();
    });
});