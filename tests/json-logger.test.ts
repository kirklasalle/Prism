/**
 * R5-4 — Structured logger facade unit test.
 *
 * Drives the env-mode switch, level filter, and record formatting via a
 * captured sink. No real stdout writes.
 */

import assert from "node:assert";

import {
    formatRecord,
    Logger,
    resolveLoggerConfig,
} from "../src/core/observability/logger.js";

export async function testJsonLogger(): Promise<void> {
    // ── resolveLoggerConfig env switch ───────────────────────────────
    {
        const text = resolveLoggerConfig({});
        assert.strictEqual(text.format, "text", "default format is text");
        assert.strictEqual(text.minLevel, "info", "default level is info");

        const json = resolveLoggerConfig({ PRISM_LOG_FORMAT: "json", PRISM_LOG_LEVEL: "debug" });
        assert.strictEqual(json.format, "json");
        assert.strictEqual(json.minLevel, "debug");

        const bogus = resolveLoggerConfig({ PRISM_LOG_FORMAT: "yaml", PRISM_LOG_LEVEL: "loud" });
        assert.strictEqual(bogus.format, "text", "unknown format → text");
        assert.strictEqual(bogus.minLevel, "info", "unknown level → info");
    }

    // ── formatRecord JSON ────────────────────────────────────────────
    {
        const out = formatRecord(
            { ts: "2026-05-08T12:00:00.000Z", level: "info", msg: "hello", op: "boot", count: 3 },
            "json",
        );
        const parsed = JSON.parse(out);
        assert.strictEqual(parsed.ts, "2026-05-08T12:00:00.000Z");
        assert.strictEqual(parsed.level, "info");
        assert.strictEqual(parsed.msg, "hello");
        assert.strictEqual(parsed.op, "boot");
        assert.strictEqual(parsed.count, 3);
        // Stable key order: ts, level, msg, op, then the rest.
        assert.deepStrictEqual(Object.keys(parsed), ["ts", "level", "msg", "op", "count"]);
    }

    // ── formatRecord TEXT ────────────────────────────────────────────
    {
        const out = formatRecord(
            { ts: "2026-05-08T12:00:00.000Z", level: "warn", msg: "limit hit", op: "rate-limit", ip: "1.2.3.4" },
            "text",
        );
        assert.ok(out.startsWith("[2026-05-08T12:00:00.000Z] WARN  limit hit"), "text prefix + padded level + msg");
        assert.ok(out.includes("op=rate-limit"), "text has op kv");
        assert.ok(out.includes("ip=1.2.3.4"), "text has ip kv");

        // Quoted value when it contains whitespace or `=`.
        const quoted = formatRecord(
            { ts: "t", level: "error", msg: "boom", path: "C:/Program Files/x" },
            "text",
        );
        assert.ok(quoted.includes('path="C:/Program Files/x"'), "whitespace value is JSON-quoted");
    }

    // ── Logger sink + level filter ───────────────────────────────────
    {
        const lines: string[] = [];
        const log = new Logger({ format: "json", minLevel: "info", sink: (l) => lines.push(l) });
        log.debug("ignored");          // below minLevel
        log.info("served", { status: 200 });
        log.warn("slow", { ms: 1234 });
        log.error("oops", { op: "boot" });

        assert.strictEqual(lines.length, 3, "debug below minLevel is dropped");
        const a = JSON.parse(lines[0]!);
        assert.strictEqual(a.msg, "served");
        assert.strictEqual(a.status, 200);
        assert.strictEqual(a.level, "info");
        const c = JSON.parse(lines[2]!);
        assert.strictEqual(c.op, "boot");
        assert.strictEqual(c.level, "error");
    }

    // ── Logger format=text path ──────────────────────────────────────
    {
        const lines: string[] = [];
        const log = new Logger({ format: "text", minLevel: "debug", sink: (l) => lines.push(l) });
        log.debug("dbg", { k: "v" });
        assert.strictEqual(lines.length, 1);
        assert.ok(/\[.+\] DEBUG dbg k=v$/.test(lines[0]!), "text record matches expected pattern");
    }
}
