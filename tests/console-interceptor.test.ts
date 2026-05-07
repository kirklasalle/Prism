/**
 * Tests for ConsoleInterceptor — verifies process.stdout/stderr capture into
 * a bounded ring buffer, listener fan-out, redaction, and clean uninstall.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ConsoleInterceptor } from "../src/core/logging/console-interceptor.js";

describe("ConsoleInterceptor", () => {
    let interceptor: ConsoleInterceptor;

    beforeEach(() => {
        interceptor = new ConsoleInterceptor();
    });

    afterEach(() => {
        interceptor.uninstall();
    });

    it("captures stdout and stderr lines", () => {
        interceptor.install();
        process.stdout.write("hello stdout line\n");
        process.stderr.write("warning stderr line\n");
        interceptor.uninstall();

        const tail = interceptor.getTail();
        assert.ok(
            tail.some((e) => e.stream === "stdout" && e.line === "hello stdout line"),
            "expected stdout line",
        );
        assert.ok(
            tail.some((e) => e.stream === "stderr" && e.line === "warning stderr line"),
            "expected stderr line",
        );
    });

    it("fans out captured lines to subscribers", () => {
        const seen: Array<{ stream: string; line: string }> = [];
        const unsubscribe = interceptor.onLine((entry) => {
            seen.push({ stream: entry.stream, line: entry.line });
        });

        interceptor.install();
        process.stdout.write("subscribed line\n");
        interceptor.uninstall();
        unsubscribe();

        assert.ok(
            seen.some((e) => e.stream === "stdout" && e.line === "subscribed line"),
            "subscriber should have received the line",
        );
    });

    it("redacts admin-token style strings before storage", () => {
        interceptor.install();
        process.stdout.write("[AUTH] Admin token: abcdef0123456789deadbeef\n");
        interceptor.uninstall();

        const tail = interceptor.getTail();
        const match = tail.find((e) => e.line.startsWith("[AUTH]"));
        assert.ok(match, "expected [AUTH] line captured");
        assert.match(match!.line, /\[REDACTED\]/);
        assert.doesNotMatch(match!.line, /abcdef0123456789deadbeef/);
    });

    it("buffers partial lines until newline arrives", () => {
        interceptor.install();
        process.stdout.write("partial-");
        process.stdout.write("complete\n");
        interceptor.uninstall();

        const tail = interceptor.getTail();
        assert.ok(
            tail.some((e) => e.line === "partial-complete"),
            "expected merged partial line",
        );
        assert.ok(
            !tail.some((e) => e.line === "partial-"),
            "partial fragment should not appear standalone",
        );
    });

    it("getTail respects the limit argument", () => {
        interceptor.install();
        for (let i = 0; i < 10; i++) {
            process.stdout.write(`line ${i}\n`);
        }
        interceptor.uninstall();

        const tail = interceptor.getTail(3);
        assert.equal(tail.length, 3);
        // Tail is oldest-first; with 10 lines and limit 3, should be lines 7..9.
        assert.equal(tail[0]!.line, "line 7");
        assert.equal(tail[2]!.line, "line 9");
    });

    it("uninstall restores original stdout/stderr write functions", () => {
        const originalStdout = process.stdout.write;
        const originalStderr = process.stderr.write;

        interceptor.install();
        assert.notEqual(process.stdout.write, originalStdout, "stdout should be wrapped");
        assert.notEqual(process.stderr.write, originalStderr, "stderr should be wrapped");

        interceptor.uninstall();
        assert.equal(process.stdout.write, originalStdout, "stdout should be restored");
        assert.equal(process.stderr.write, originalStderr, "stderr should be restored");
    });

    it("install is idempotent", () => {
        interceptor.install();
        const wrapped = process.stdout.write;
        interceptor.install();
        assert.equal(process.stdout.write, wrapped, "second install must not double-wrap");
        interceptor.uninstall();
    });

    it("clear empties the ring buffer", () => {
        interceptor.install();
        process.stdout.write("about to be cleared\n");
        interceptor.uninstall();

        assert.ok(interceptor.getTail().length > 0, "expected at least one line");
        interceptor.clear();
        assert.equal(interceptor.getTail().length, 0);
    });
});
