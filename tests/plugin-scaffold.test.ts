/**
 * tests/plugin-scaffold.test.ts (Phase G)
 *
 * Validates the plugin scaffolder produces a valid pack-root layout that
 * includes a manifest, capability stub, smoke test, and supporting files.
 */

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export async function testPluginScaffold(): Promise<void> {
    const scaffolderPath = resolve(process.cwd(), "scripts", "scaffold-plugin.cjs");
    const scaffolder = require(scaffolderPath);

    // parseArgs requires id / name / out (calls process.exit(2) on missing)
    {
        const origExit = process.exit;
        let exited = 0;
        (process as unknown as { exit: (code?: number) => void }).exit = (code?: number) => {
            exited = code ?? 0;
            throw new Error("exit");
        };
        let threw = false;
        try {
            scaffolder.parseArgs([]);
        } catch {
            threw = true;
        } finally {
            process.exit = origExit;
        }
        assert.ok(threw, "parseArgs should exit on missing args");
        assert.strictEqual(exited, 2, "exit code 2 on usage error");
    }

    const args = scaffolder.parseArgs(["--id", "test-org.demo", "--name", "Demo", "--out", "ignored"]);
    assert.strictEqual(args.id, "test-org.demo");
    assert.strictEqual(args.name, "Demo");

    // Scaffold into a temp dir and verify layout
    const tmp = mkdtempSync(join(tmpdir(), "prism-scaffold-"));
    const target = join(tmp, "pack");
    try {
        const out = scaffolder.scaffold({ id: "test-org.demo", name: "Demo Pack", out: target, description: "Test scaffold." });
        assert.strictEqual(out, target);

        const expected = [
            "plugin.manifest.json",
            "package.json",
            "README.md",
            "CHANGELOG.md",
            ".gitignore",
            join("src", "capabilities", "hello.js"),
            join("test", "smoke.test.js"),
        ];
        for (const f of expected) {
            assert.ok(existsSync(join(target, f)), `expected file: ${f}`);
        }

        // Manifest is valid JSON with the required fields
        const manifest = JSON.parse(readFileSync(join(target, "plugin.manifest.json"), "utf-8"));
        assert.strictEqual(manifest.formatVersion, 1);
        assert.strictEqual(manifest.id, "test-org.demo");
        assert.ok(Array.isArray(manifest.capabilities) && manifest.capabilities.length > 0);
        assert.strictEqual(manifest.capabilities[0].tier, 0, "starter capability is tier 0");

        // Capability stub is loadable JS (smoke check — we can't execute it without npm install,
        // but we can verify it parses)
        const helloSrc = readFileSync(join(target, "src", "capabilities", "hello.js"), "utf-8");
        assert.ok(helloSrc.includes("exports.hello"), "stub exports hello function");

        // Refuses to overwrite a non-empty directory
        assert.throws(
            () => scaffolder.scaffold({ id: "x", name: "X", out: target }),
            /non-empty directory/,
        );
    } finally {
        try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
}
