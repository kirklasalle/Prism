/**
 * Optional-dependency probe — structural tests.
 *
 * The probe is the runtime answer to "are these optional native modules
 * actually loadable on this machine?" — surfaced via `/api/health`. These
 * tests do not assert availability (CI runners may or may not have node-pty
 * installed); they assert the contract:
 *
 *   - Every spec in the probe table is reported.
 *   - Each result has a status of `available | missing | error`.
 *   - Caching: a second call without `refresh` returns the same instance.
 *   - `summarizeOptionalDeps` totals match the per-module statuses.
 */

import assert from "node:assert/strict";
import { describe, it } from "mocha";

import {
    probeOptionalDeps,
    summarizeOptionalDeps,
    getCachedOptionalDeps,
    type OptionalDepResult,
} from "../src/core/system/optional-deps.js";

const EXPECTED_MODULES = ["node-pty", "dockerode", "googleapis", "@azure/msal-node"];

describe("optional-deps probe", () => {
    it("reports every expected optional module", async () => {
        const results = await probeOptionalDeps({ refresh: true });
        const seen = results.map((r) => r.module).sort();
        assert.deepStrictEqual(seen, [...EXPECTED_MODULES].sort());
    });

    it("each result has a valid status", async () => {
        const results = await probeOptionalDeps();
        for (const r of results) {
            assert.ok(
                ["available", "missing", "error"].includes(r.status),
                `unexpected status "${r.status}" for ${r.module}`,
            );
            if (r.status === "available") {
                assert.strictEqual(r.error, null, `available module should not have error: ${r.module}`);
            } else {
                assert.ok(typeof r.error === "string" && r.error.length > 0,
                    `${r.status} module must include error message: ${r.module}`);
            }
        }
    });

    it("caches results across calls without refresh", async () => {
        const first = await probeOptionalDeps();
        const second = await probeOptionalDeps();
        assert.strictEqual(first, second, "cached call should return the same array reference");
        const cached = getCachedOptionalDeps();
        assert.ok(cached !== null && cached.length === EXPECTED_MODULES.length);
    });

    it("summary totals match per-module statuses", async () => {
        const results: OptionalDepResult[] = await probeOptionalDeps();
        const summary = summarizeOptionalDeps(results);
        assert.strictEqual(
            summary.available + summary.missing + summary.error,
            results.length,
            "summary totals must equal result count",
        );
    });
});
