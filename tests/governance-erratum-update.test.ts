import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";

describe("Governance erratum update status", () => {
    it("recognizes the signed corrected PAD without requiring the temporary candidate", () => {
        const scriptPath = join(process.cwd(), "scripts", "governance-erratum-update.cjs");
        const result = spawnSync(process.execPath, [scriptPath, "check"], {
            cwd: process.cwd(),
            encoding: "utf8",
        });

        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /phase=effective/);
        assert.match(result.stdout, /signatureValid=true/);
        assert.match(result.stdout, /candidate=unavailable/);
        assert.match(result.stdout, /ready=true/);
    });

    it("requires signed authorized release evidence for effectuation", () => {
        const script = readFileSync(join(process.cwd(), "scripts", "governance-erratum-update.cjs"), "utf8");
        assert.match(script, /action === "effectuate"/);
        assert.match(script, /PRISM_GOVERNANCE_ALLOWED_SIGNERS is not configured/);
        assert.match(script, /Release commit signature status/);
        assert.match(script, /Release commit does not contain/);
    });
});