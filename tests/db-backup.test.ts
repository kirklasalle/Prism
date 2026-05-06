/**
 * R5-1 — Backup / restore engine tests.
 *
 * These tests run a real round-trip:
 *
 *   1. Create two SQLite DBs and a preferences file with known content.
 *   2. Run `runBackup` — confirm manifest + file contents on disk.
 *   3. Wipe the originals.
 *   4. Run `runRestore` with `force: true` — confirm content matches.
 *   5. Tamper with a backup file → expect checksum-mismatch error and
 *      no file is written.
 */

import { strict as assert } from "node:assert";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, beforeEach, afterEach } from "mocha";
import {
    runBackup,
    runRestore,
    discoverSqliteFiles,
} from "../src/core/db/backup.js";

describe("R5 backup / restore", () => {
    let tmp: string;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), "prism-backup-"));
    });

    afterEach(() => {
        if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
    });

    function makeDb(path: string, table: string, rows: ReadonlyArray<{ id: string; v: string }>): void {
        const db = new DatabaseSync(path);
        try {
            db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, v TEXT);`);
            const stmt = db.prepare(`INSERT INTO ${table} (id, v) VALUES (:id, :v);`);
            for (const r of rows) stmt.run({ id: r.id, v: r.v });
        } finally {
            db.close();
        }
    }

    function readAll(path: string, table: string): Array<{ id: string; v: string }> {
        const db = new DatabaseSync(path);
        try {
            const rows = db.prepare(`SELECT id, v FROM ${table} ORDER BY id ASC`).all() as Array<{ id: string; v: string }>;
            // node:sqlite returns null-prototype rows — normalize for deepStrictEqual.
            return rows.map((r) => ({ id: r.id, v: r.v }));
        } finally {
            db.close();
        }
    }

    it("captures every source into the manifest with stable checksums", () => {
        const dbA = join(tmp, "activity.db");
        const dbB = join(tmp, "chat.db");
        const prefs = join(tmp, ".prism-preferences.json");
        makeDb(dbA, "events", [{ id: "e1", v: "hello" }, { id: "e2", v: "world" }]);
        makeDb(dbB, "sessions", [{ id: "s1", v: "session-1" }]);
        writeFileSync(prefs, JSON.stringify({ workspaceRoot: "/tmp/wsx" }), "utf8");

        const out = join(tmp, "out");
        const result = runBackup({
            outputDir: out,
            sources: [
                { path: dbA, kind: "sqlite" },
                { path: dbB, kind: "sqlite" },
                { path: prefs, kind: "preferences" },
            ],
            prismVersion: "0.4.2",
        });

        assert.strictEqual(result.manifest.entries.length, 3);
        assert.strictEqual(result.manifest.schemaVersion, 1);
        assert.strictEqual(result.manifest.prismVersion, "0.4.2");

        const names = result.manifest.entries.map((e) => e.fileName).sort();
        assert.deepStrictEqual(names, [".prism-preferences.json", "activity.db", "chat.db"]);

        for (const e of result.manifest.entries) {
            assert.ok(existsSync(join(out, e.fileName)), `${e.fileName} should exist`);
            assert.ok(/^[a-f0-9]{64}$/.test(e.checksum), "checksum must be 64-char hex");
            assert.ok(e.bytes > 0);
        }
    });

    it("refuses to overwrite an existing backup directory", () => {
        const dbA = join(tmp, "a.db");
        makeDb(dbA, "t", [{ id: "1", v: "x" }]);
        const out = join(tmp, "out");
        runBackup({ outputDir: out, sources: [{ path: dbA, kind: "sqlite" }] });
        assert.throws(
            () => runBackup({ outputDir: out, sources: [{ path: dbA, kind: "sqlite" }] }),
            /already contains a manifest/,
        );
    });

    it("round-trips a SQLite database byte-perfectly via VACUUM INTO", () => {
        const src = join(tmp, "src.db");
        makeDb(src, "items", [
            { id: "a", v: "alpha" },
            { id: "b", v: "beta" },
            { id: "c", v: "gamma" },
        ]);

        const out = join(tmp, "backup");
        runBackup({ outputDir: out, sources: [{ path: src, kind: "sqlite" }] });

        // Wipe the original.
        rmSync(src);
        assert.ok(!existsSync(src));

        const restoreTarget = join(tmp, "restored.db");
        const result = runRestore({
            backupDir: out,
            targets: { "src.db": restoreTarget },
        });

        assert.strictEqual(result.restored.length, 1);
        assert.strictEqual(result.skipped.length, 0);
        assert.deepStrictEqual(readAll(restoreTarget, "items"), [
            { id: "a", v: "alpha" },
            { id: "b", v: "beta" },
            { id: "c", v: "gamma" },
        ]);
    });

    it("refuses to overwrite an existing target without force", () => {
        const src = join(tmp, "src.db");
        makeDb(src, "t", [{ id: "1", v: "old" }]);
        const out = join(tmp, "backup");
        runBackup({ outputDir: out, sources: [{ path: src, kind: "sqlite" }] });

        // Mutate src and try to restore on top of it.
        makeDb(src + ".other", "t", [{ id: "1", v: "newer" }]);

        const target = join(tmp, "target.db");
        // Pre-create target file to trigger the "exists" guard.
        writeFileSync(target, "stub");

        const result = runRestore({
            backupDir: out,
            targets: { "src.db": target },
        });
        assert.strictEqual(result.restored.length, 0);
        assert.strictEqual(result.skipped.length, 1);
        assert.match(result.skipped[0]!.reason, /target exists/);
        // Target wasn't overwritten.
        assert.strictEqual(readFileSync(target, "utf8"), "stub");
    });

    it("force: true overwrites existing targets", () => {
        const src = join(tmp, "src.db");
        makeDb(src, "t", [{ id: "1", v: "fresh" }]);
        const out = join(tmp, "backup");
        runBackup({ outputDir: out, sources: [{ path: src, kind: "sqlite" }] });

        const target = join(tmp, "target.db");
        writeFileSync(target, "stub");

        const result = runRestore({
            backupDir: out,
            targets: { "src.db": target },
            force: true,
        });
        assert.strictEqual(result.restored.length, 1);
        assert.deepStrictEqual(readAll(target, "t"), [{ id: "1", v: "fresh" }]);
    });

    it("aborts the entire restore on a checksum mismatch", () => {
        const src = join(tmp, "src.db");
        makeDb(src, "t", [{ id: "1", v: "x" }]);
        const out = join(tmp, "backup");
        runBackup({ outputDir: out, sources: [{ path: src, kind: "sqlite" }] });

        // Tamper with the backup copy.
        writeFileSync(join(out, "src.db"), "TAMPERED");

        const target = join(tmp, "target.db");
        assert.throws(
            () => runRestore({
                backupDir: out,
                targets: { "src.db": target },
                force: true,
            }),
            /checksum mismatch/,
        );
        // Target must not have been written despite force=true.
        assert.ok(!existsSync(target), "target must not be created on checksum failure");
    });

    it("rejects a missing manifest", () => {
        const out = join(tmp, "empty");
        assert.throws(
            () => runRestore({ backupDir: out, targets: {} }),
            /no manifest found/,
        );
    });

    it("rejects an unsupported manifest schemaVersion", () => {
        const out = join(tmp, "out");
        // Build a real backup, then mutate the manifest to a future version.
        const src = join(tmp, "src.db");
        makeDb(src, "t", [{ id: "1", v: "x" }]);
        runBackup({ outputDir: out, sources: [{ path: src, kind: "sqlite" }] });

        const manifestPath = join(out, "manifest.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        manifest.schemaVersion = 99;
        writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

        assert.throws(
            () => runRestore({ backupDir: out, targets: {} }),
            /unsupported backup manifest schemaVersion=99/,
        );
    });

    it("skips entries that have no target mapping", () => {
        const src = join(tmp, "src.db");
        makeDb(src, "t", [{ id: "1", v: "x" }]);
        const out = join(tmp, "backup");
        runBackup({ outputDir: out, sources: [{ path: src, kind: "sqlite" }] });

        const result = runRestore({ backupDir: out, targets: {} });
        assert.strictEqual(result.restored.length, 0);
        assert.strictEqual(result.skipped.length, 1);
        assert.strictEqual(result.skipped[0]!.fileName, "src.db");
        assert.match(result.skipped[0]!.reason, /no target mapping/);
    });

    it("rejects duplicate fileNames across sources", () => {
        const a = join(tmp, "a.db");
        const b = join(tmp, "sub", "a.db");
        makeDb(a, "t", [{ id: "1", v: "x" }]);
        mkdirSync(join(tmp, "sub"));
        makeDb(b, "t", [{ id: "1", v: "y" }]);
        const out = join(tmp, "out");
        assert.throws(
            () => runBackup({
                outputDir: out,
                sources: [
                    { path: a, kind: "sqlite" },
                    { path: b, kind: "sqlite" }, // collides on basename "a.db"
                ],
            }),
            /duplicate backup file name/,
        );
    });

    it("discoverSqliteFiles finds *.db and ignores wal/shm", () => {
        const dir = join(tmp, "scan");
        mkdirSync(dir);
        writeFileSync(join(dir, "a.db"), "");
        writeFileSync(join(dir, "b.db"), "");
        writeFileSync(join(dir, "a.db-wal"), "");
        writeFileSync(join(dir, "a.db-shm"), "");
        writeFileSync(join(dir, "notes.txt"), "");
        const found = discoverSqliteFiles(dir).map((p) => p.split(/[\\/]/).pop()!).sort();
        assert.deepStrictEqual(found, ["a.db", "b.db"]);
    });

    it("discoverSqliteFiles returns empty array for missing dir", () => {
        assert.deepStrictEqual(
            discoverSqliteFiles(join(tmp, "does-not-exist")),
            [],
        );
    });

    it("rejects a non-existent source", () => {
        const out = join(tmp, "out");
        assert.throws(
            () => runBackup({
                outputDir: out,
                sources: [{ path: join(tmp, "missing.db"), kind: "sqlite" }],
            }),
            /backup source not found/,
        );
    });
});
