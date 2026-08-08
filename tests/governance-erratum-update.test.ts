import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { join } from "node:path";

describe("Governance erratum update status", () => {
    it("recognizes the signed corrected PAD without requiring the temporary candidate", () => {
        const scriptPath = join(process.cwd(), "scripts", "governance-erratum-update.cjs");
        const result = spawnSync(process.execPath, [scriptPath, "check"], {
            cwd: process.cwd(),
            encoding: "utf8",
        });

        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /phase=applied_pending_release_commit/);
        assert.match(result.stdout, /signatureValid=true/);
        assert.match(result.stdout, /candidate=unavailable/);
        assert.match(result.stdout, /ready=true/);
    });
});