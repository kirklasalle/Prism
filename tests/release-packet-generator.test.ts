/**
 * Release Packet Generator — smoke test
 *
 * Verifies that `scripts/generate-release-packet.cjs` produces all five
 * expected report files in the requested output directory and that each
 * report contains the documented header and inventory banner.
 *
 * Read-only: writes only into a `tmp/` subdirectory and cleans up.
 */
import { describe, it, before, after } from "mocha";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Release Packet Generator (scripts/generate-release-packet.cjs)", function () {
    this.timeout(30_000);
    let outDir: string;

    before(() => {
        outDir = mkdtempSync(join(tmpdir(), "prism-release-packet-"));
        const scriptPath = join(process.cwd(), "scripts", "generate-release-packet.cjs");
        execFileSync(process.execPath, [scriptPath, "--out", outDir, "--build-id", "smoketest"], {
            cwd: process.cwd(),
            stdio: "pipe",
        });
    });

    after(() => {
        try { rmSync(outDir, { recursive: true, force: true }); } catch { /* noop */ }
    });

    const expected = [
        "governance-path-report.md",
        "terminal-container-lifecycle-report.md",
        "plugin-compat-trust-report.md",
        "claim-alignment-checklist.md",
        "release-packet-manifest.md",
    ];

    for (const name of expected) {
        it(`emits ${name}`, () => {
            const p = join(outDir, name);
            assert.ok(existsSync(p), `${name} should exist at ${p}`);
            const body = readFileSync(p, "utf8");
            assert.ok(body.length > 0, `${name} should not be empty`);
        });
    }

    it("each report carries the candidate ID and STATUS banner (except manifest)", () => {
        for (const name of expected) {
            const body = readFileSync(join(outDir, name), "utf8");
            assert.ok(body.includes("smoketest"), `${name} should reference build id`);
            if (name !== "release-packet-manifest.md") {
                assert.ok(body.includes("STATUS: INVENTORY"), `${name} should include status banner`);
            }
        }
    });

    it("governance-path-report.md covers allow/deny/timeout/revoke sections", () => {
        const body = readFileSync(join(outDir, "governance-path-report.md"), "utf8");
        for (const heading of ["### Allow", "### Deny", "### Timeout", "### Revoke"]) {
            assert.ok(body.includes(heading), `governance-path-report.md missing heading ${heading}`);
        }
    });

    it("plugin-compat-trust-report.md references signature & trust-tier coverage", () => {
        const body = readFileSync(join(outDir, "plugin-compat-trust-report.md"), "utf8");
        assert.ok(body.includes("Ed25519"), "should mention Ed25519 signature verification");
        assert.ok(body.includes("trust-tier"), "should mention trust-tier enforcement");
    });

    it("release-packet-manifest.md lists all generated files", () => {
        const body = readFileSync(join(outDir, "release-packet-manifest.md"), "utf8");
        for (const name of expected) {
            assert.ok(body.includes(name), `manifest should reference ${name}`);
        }
    });
});
