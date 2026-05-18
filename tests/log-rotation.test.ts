/**
 * R5-3 — Log rotation unit test.
 *
 * Drives `rotateActiveLog`, `pruneOldArchives`, and `resolveRetentionDays`
 * with an injected clock and a temp directory. No real timers, no real
 * env mutation.
 */

import assert from "node:assert";
import {
    existsSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    DEFAULT_LOG_RETENTION_DAYS,
    dateStamp,
    pruneOldArchives,
    resolveRetentionDays,
    rotateActiveLog,
    rotateAndPrune,
} from "../src/core/observability/log-rotator.js";

function touchFile(path: string, content: string, mtime: Date): void {
    writeFileSync(path, content, "utf8");
    const seconds = mtime.getTime() / 1000;
    utimesSync(path, seconds, seconds);
}

export async function testLogRotation(): Promise<void> {
    // ── dateStamp ────────────────────────────────────────────────────
    assert.strictEqual(dateStamp(new Date(Date.UTC(2026, 0, 5))), "20260105");
    assert.strictEqual(dateStamp(new Date(Date.UTC(2026, 11, 31, 23, 59))), "20261231");

    // ── resolveRetentionDays ─────────────────────────────────────────
    assert.strictEqual(resolveRetentionDays({}), DEFAULT_LOG_RETENTION_DAYS);
    assert.strictEqual(resolveRetentionDays({ PRISM_LOG_RETENTION_DAYS: "7" }), 7);
    assert.strictEqual(resolveRetentionDays({ PRISM_LOG_RETENTION_DAYS: "0" }), DEFAULT_LOG_RETENTION_DAYS);
    assert.strictEqual(resolveRetentionDays({ PRISM_LOG_RETENTION_DAYS: "abc" }), DEFAULT_LOG_RETENTION_DAYS);
    assert.strictEqual(resolveRetentionDays({ PRISM_LOG_RETENTION_DAYS: "9999" }), 365);

    // ── rotateActiveLog ──────────────────────────────────────────────
    {
        const dir = mkdtempSync(join(tmpdir(), "prism-rot-"));
        const active = join(dir, "prism.log");
        const yesterday = new Date(Date.UTC(2026, 4, 7, 12, 0));   // 2026-05-07
        const today = new Date(Date.UTC(2026, 4, 8, 9, 0));        // 2026-05-08
        touchFile(active, "yesterday line\n", yesterday);

        const r1 = rotateActiveLog({ logDir: dir, activeFile: "prism.log", now: today });
        assert.strictEqual(r1.skipped, false, "first rotation: not skipped");
        assert.ok(r1.archived?.endsWith("prism-20260507.log"), "archive name uses mtime stamp");
        assert.ok(existsSync(r1.archived!), "archive file exists on disk");
        assert.ok(!existsSync(active), "active file moved away");

        // Idempotent — running again with the same `now` and a fresh active
        // file (same mtime as yesterday) must not clobber the archive.
        touchFile(active, "second batch\n", yesterday);
        const r2 = rotateActiveLog({ logDir: dir, activeFile: "prism.log", now: today });
        assert.strictEqual(r2.skipped, true, "duplicate archive: skipped");
        assert.strictEqual(readFileSync(r1.archived!, "utf8"), "yesterday line\n", "archive contents preserved");

        // Same-day mtime → no rotation.
        const today2 = new Date(today.getTime());
        touchFile(active, "today line\n", today);
        const r3 = rotateActiveLog({ logDir: dir, activeFile: "prism.log", now: today2 });
        assert.strictEqual(r3.archived, null, "same-day mtime: no archive");
        assert.strictEqual(r3.skipped, false);
        assert.ok(existsSync(active), "active file untouched on same-day rotate");
    }

    // ── pruneOldArchives ─────────────────────────────────────────────
    {
        const dir = mkdtempSync(join(tmpdir(), "prism-prune-"));
        // Create dated archives spanning 1..40 days back.
        const today = new Date(Date.UTC(2026, 4, 8, 0, 0));
        const stamps = [1, 2, 5, 14, 29, 30, 31, 40];
        for (const back of stamps) {
            const d = new Date(today.getTime() - back * 86_400_000);
            const name = `prism-${dateStamp(d)}.log`;
            writeFileSync(join(dir, name), `archive ${back}d\n`, "utf8");
        }
        // Foreign file that must be ignored.
        writeFileSync(join(dir, "unrelated.txt"), "x", "utf8");
        // Active file — must never be deleted even if its name parses.
        writeFileSync(join(dir, "prism.log"), "active", "utf8");

        const result = pruneOldArchives({ logDir: dir, activeFile: "prism.log", retentionDays: 30, now: today });

        // Strictly older than 30 days → 31, 40 deleted. 30-day boundary retained.
        const expectDeleted = [40, 31].map((back) => {
            const d = new Date(today.getTime() - back * 86_400_000);
            return `prism-${dateStamp(d)}.log`;
        });
        const deletedNames = result.deleted.map((p) => p.split(/[\\/]/).pop()!).sort();
        assert.deepStrictEqual(deletedNames, expectDeleted.sort(), "exactly the >30d archives are deleted");

        const remaining = readdirSync(dir).sort();
        for (const expected of expectDeleted) {
            assert.ok(!remaining.includes(expected), `pruned ${expected}`);
        }
        assert.ok(remaining.includes("prism.log"), "active file not pruned");
        assert.ok(remaining.includes("unrelated.txt"), "foreign file not pruned");
        // 30-day-back boundary retained.
        const boundary = new Date(today.getTime() - 30 * 86_400_000);
        assert.ok(remaining.includes(`prism-${dateStamp(boundary)}.log`), "30-day boundary retained");
    }

    // ── rotateAndPrune integration ───────────────────────────────────
    {
        const dir = mkdtempSync(join(tmpdir(), "prism-rotprune-"));
        const today = new Date(Date.UTC(2026, 4, 8, 6, 0));
        const yesterday = new Date(today.getTime() - 86_400_000);
        const ancient = new Date(today.getTime() - 60 * 86_400_000);

        const active = join(dir, "prism.log");
        touchFile(active, "fresh\n", yesterday);
        const ancientName = join(dir, `prism-${dateStamp(ancient)}.log`);
        writeFileSync(ancientName, "old\n", "utf8");

        const r = rotateAndPrune({ logDir: dir, activeFile: "prism.log", retentionDays: 30, now: today });
        assert.ok(r.rotate.archived?.endsWith(`prism-${dateStamp(yesterday)}.log`));
        assert.ok(r.prune.deleted.includes(ancientName));
    }
}
