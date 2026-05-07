/**
 * Server unit tests for TooltipsRegistry — seed loading, link merge, lookup.
 *
 * Run: mocha dist/tests/tooltips-registry.test.js --timeout 30000
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TooltipsRegistry } from "../src/core/operator/tooltips-registry.js";

describe("TooltipsRegistry — seed loading & link merge", function () {
    this.timeout(30_000);
    let dir: string;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), "prism-tooltips-"));
        // Seed entry
        writeFileSync(
            join(dir, "seeds.json"),
            JSON.stringify([
                {
                    tipId: "character:demo",
                    summary: "Demo character",
                    dynamic: ["demo line one", "demo line two"],
                    links: [{ label: "Seed link", href: "/docs/SEED.md" }],
                },
            ]),
        );
        // Link override map (takes precedence)
        writeFileSync(
            join(dir, "links.json"),
            JSON.stringify({
                "character:demo": [{ label: "Wiki", href: "https://example.com/wiki" }],
                "character:lonely": [{ label: "Wiki Only", href: "https://example.com/lonely" }],
            }),
        );
    });

    after(() => {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it("loads seed entries and merges link overrides ahead of seed links", () => {
        const reg = new TooltipsRegistry(dir);
        const entry = reg.get("character:demo");
        assert.ok(entry, "Entry should resolve");
        assert.strictEqual(entry!.summary, "Demo character");
        assert.deepStrictEqual(entry!.dynamic, ["demo line one", "demo line two"]);
        // Override appears first; seed link follows.
        assert.strictEqual(entry!.links.length, 2);
        assert.strictEqual(entry!.links[0]!.href, "https://example.com/wiki");
        assert.strictEqual(entry!.links[1]!.href, "/docs/SEED.md");
    });

    it("returns undefined for unknown tipIds with no overrides", () => {
        const reg = new TooltipsRegistry(dir);
        assert.strictEqual(reg.get("character:does-not-exist"), undefined);
    });

    it("synthesises an entry from links.json when no seed exists for the tipId", () => {
        const reg = new TooltipsRegistry(dir);
        const entry = reg.get("character:lonely");
        assert.ok(entry, "Should synthesise an entry from link map alone");
        assert.strictEqual(entry!.summary, "");
        assert.deepStrictEqual(entry!.dynamic, []);
        assert.strictEqual(entry!.links.length, 1);
        assert.strictEqual(entry!.links[0]!.href, "https://example.com/lonely");
    });

    it("list() returns all loaded seed entries", () => {
        const reg = new TooltipsRegistry(dir);
        const entries = reg.list();
        assert.ok(entries.some((e) => e.tipId === "character:demo"));
    });

    it("returns empty when seedDir does not exist", () => {
        const reg = new TooltipsRegistry(join(dir, "nonexistent"));
        assert.strictEqual(reg.list().length, 0);
        assert.strictEqual(reg.get("anything"), undefined);
    });
});
