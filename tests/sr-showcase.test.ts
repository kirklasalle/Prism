/**
 * tests/sr-showcase.test.ts (Phase G)
 *
 * Validates the Spectrum Refraction showcase demo runs deterministically in
 * dry-run mode and emits an audit event with the expected shape.
 */

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";

const require = createRequire(import.meta.url);

export async function testSrShowcaseDemo(): Promise<void> {
    const showcasePath = resolve(process.cwd(), "examples", "sr-showcase", "run-demo.cjs");
    const showcase = require(showcasePath);

    // parseArgs honors flags
    const args = showcase.parseArgs(["--dry-run", "--profiles", "logic,creative"]);
    assert.strictEqual(args.dryRun, true);
    assert.strictEqual(args.profilesArg, "logic,creative");

    // synthesizeHemisphereOutput produces deterministic shape per profile
    const out = showcase.synthesizeHemisphereOutput("logic", "test prompt");
    assert.strictEqual(out.profileId, "logic");
    assert.ok(typeof out.text === "string" && out.text.length > 0, "text emitted");
    assert.ok(typeof out.latencyMs === "number");
    assert.ok(typeof out.costUsd === "number");

    // aggregateHemispheres: longest output becomes primary
    const h1 = { profileId: "a", text: "short", latencyMs: 10, promptTokens: 1, completionTokens: 1, costUsd: 0.001 };
    const h2 = { profileId: "b", text: "much longer output text here", latencyMs: 20, promptTokens: 2, completionTokens: 2, costUsd: 0.002 };
    const agg = showcase.aggregateHemispheres([h1, h2]);
    assert.strictEqual(agg.primary.profileId, "b", "longer output is primary");
    assert.strictEqual(agg.supporting.length, 1);
    assert.ok(agg.consensus.includes("[a]") && agg.consensus.includes("[b]"));

    // runShowcase end-to-end (dry-run) emits an audit event
    const result = await showcase.runShowcase({ dryRun: true });
    assert.strictEqual(result.hemispheres.length, 4, "default 4 profiles");
    assert.strictEqual(result.audit.type, "sr.generation");
    assert.strictEqual(result.audit.mode, "dry-run");
    assert.strictEqual(result.audit.hemisphereCount, 4);
    assert.strictEqual(result.audit.showHemispheres, true);
    assert.strictEqual(result.costGatePassed, true, "synthetic cost stays under $0.10");
    assert.ok(existsSync(result.auditFile), "audit file written");

    // Audit file contents round-trip
    const persisted = JSON.parse(readFileSync(result.auditFile, "utf-8"));
    assert.strictEqual(persisted.type, "sr.generation");
    assert.strictEqual(persisted.profiles.length, 4);

    // Best-effort cleanup (don't fail the test on cleanup error)
    try { rmSync(result.auditFile, { force: true }); } catch { /* */ }
}
