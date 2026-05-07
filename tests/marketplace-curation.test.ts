/**
 * tests/marketplace-curation.test.ts (Phase G)
 *
 * Validates the marketplace review ledger + curated filter.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { _setWorkspaceRootForTest } from "../src/core/config/workspace-resolver.js";
import { listEntries, listEntriesWithCuration } from "../src/core/plugins/plugin-marketplace.js";
import { recordDecision, latestDecisionFor, isApproved, readLedger } from "../src/core/plugins/marketplace-review-ledger.js";

export async function testMarketplaceCuration(): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), "prism-curation-"));
    const prevRoot = process.env.PRISM_WORKSPACE_ROOT;
    try {
        _setWorkspaceRootForTest(root);
        mkdirSync(join(root, "marketplace"), { recursive: true });

        // Seed a catalog with three entries.
        const catalog = {
            version: "1.0.0",
            entries: [
                { id: "alpha", name: "Alpha", version: "1.0.0", source: "file://x.zip", trust: "signed", tags: ["test"], tier: 0 },
                { id: "beta", name: "Beta", version: "0.5.0", source: "file://y.zip", trust: "signed", tags: ["test"], tier: 0 },
                { id: "gamma", name: "Gamma", version: "0.1.0", source: "file://z.zip", trust: "unsigned", tags: ["test"], tier: 0 },
            ],
        };
        writeFileSync(join(root, "marketplace", "catalog.json"), JSON.stringify(catalog), "utf-8");

        // Initially no curation decisions — curated filter returns empty.
        assert.strictEqual(listEntries({ curated: true }).length, 0, "initial curated set is empty");
        assert.strictEqual(listEntries({ curated: false }).length, 3, "initial uncurated set is full catalog");
        assert.strictEqual(listEntries().length, 3, "no filter returns all");

        // Record approval for alpha and beta.
        recordDecision({ entryId: "alpha", version: "1.0.0", status: "approved", reviewer: "alice", reviewedAt: "2026-05-05T00:00:00Z" });
        recordDecision({ entryId: "beta", version: "0.5.0", status: "approved", reviewer: "alice", reviewedAt: "2026-05-05T00:00:01Z" });

        // Curated filter now returns alpha + beta.
        const curated = listEntries({ curated: true });
        assert.strictEqual(curated.length, 2, "two approved entries");
        assert.deepStrictEqual(new Set(curated.map(e => e.id)), new Set(["alpha", "beta"]));

        // Reject decisions require notes.
        assert.throws(() => recordDecision({ entryId: "gamma", version: "0.1.0", status: "rejected", reviewer: "alice", reviewedAt: "" }), /notes required/);

        // A new decision overrides the old one (latest wins).
        recordDecision({ entryId: "alpha", version: "1.0.0", status: "deprecated", reviewer: "bob", reviewedAt: "2026-05-06T00:00:00Z", notes: "Superseded by v2." });
        const latest = latestDecisionFor("alpha", "1.0.0");
        assert.ok(latest);
        assert.strictEqual(latest.status, "deprecated", "latest decision is deprecated");
        assert.strictEqual(isApproved("alpha", "1.0.0"), false, "alpha no longer approved");

        // Curated set now contains only beta.
        const curated2 = listEntries({ curated: true });
        assert.strictEqual(curated2.length, 1, "only beta still approved");
        assert.strictEqual(curated2[0]!.id, "beta");

        // listEntriesWithCuration decorates entries with the latest decision.
        const decorated = listEntriesWithCuration();
        assert.strictEqual(decorated.length, 3, "decorator returns full catalog when no filter");
        const alphaDecorated = decorated.find(e => e.id === "alpha");
        assert.ok(alphaDecorated);
        assert.strictEqual(alphaDecorated.curationDecision?.status, "deprecated");

        // Ledger is append-only — three decisions persisted.
        const ledger = readLedger();
        assert.strictEqual(ledger.decisions.length, 3, "ledger has all three decisions");
    } finally {
        if (prevRoot) process.env.PRISM_WORKSPACE_ROOT = prevRoot;
        try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
    }
}
