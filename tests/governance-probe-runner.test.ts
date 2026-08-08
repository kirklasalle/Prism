import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { EvidenceManifest } from "../src/core/governance/evidence-manifest.js";
import { runProbeCli } from "../src/core/governance/probe-runner.js";

const temporaryDirectories: string[] = [];
let originalCommit: string | undefined;
let originalBuildId: string | undefined;

beforeEach(() => {
    originalCommit = process.env.PRISM_COMMIT;
    originalBuildId = process.env.PRISM_BUILD_ID;
    process.env.PRISM_COMMIT = "commit-runner";
    process.env.PRISM_BUILD_ID = "build-runner";
});

afterEach(() => {
    if (originalCommit === undefined) delete process.env.PRISM_COMMIT;
    else process.env.PRISM_COMMIT = originalCommit;
    if (originalBuildId === undefined) delete process.env.PRISM_BUILD_ID;
    else process.env.PRISM_BUILD_ID = originalBuildId;
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("Governance probe CLI", () => {
    it("writes a canonical manifest for selected probes", async () => {
        const directory = mkdtempSync(join(tmpdir(), "prism-probe-runner-"));
        temporaryDirectories.push(directory);
        const outputPath = join(directory, "evidence.json");
        const exitCode = await runProbeCli({
            requested: [{ probeId: "security.certificate-envelope", probeVersion: 1 }],
            outputPath,
            inputs: {},
            allowNotEvaluated: false,
        });

        assert.equal(exitCode, 0);
        assert.equal(existsSync(outputPath), true);
        const manifest = JSON.parse(readFileSync(outputPath, "utf-8")) as EvidenceManifest;
        assert.equal(manifest.commit, "commit-runner");
        assert.equal(manifest.buildId, "build-runner");
        assert.equal(manifest.records[0]?.result, "passed");
    });

    it("rejects unregistered probe selection without writing an artifact", async () => {
        const directory = mkdtempSync(join(tmpdir(), "prism-probe-runner-missing-"));
        temporaryDirectories.push(directory);
        const outputPath = join(directory, "evidence.json");
        const exitCode = await runProbeCli({
            requested: [{ probeId: "security.missing", probeVersion: 1 }],
            outputPath,
            inputs: {},
            allowNotEvaluated: false,
        });

        assert.equal(exitCode, 1);
        assert.equal(existsSync(outputPath), false);
    });
});
