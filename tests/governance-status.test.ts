import assert from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
    checkGovernanceStatus,
    renderGovernanceStatus,
    validateGovernanceStatusClaims,
    writeGovernanceStatus,
} from "../src/core/governance/governance-status.js";
import { GOVERNANCE_CONTROLS } from "../src/core/governance/control-registry.js";
import { EVIDENCE_PROBES } from "../src/core/governance/probe-registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Generated governance status", () => {
    it("renders every registered control and does not claim unsupported enforcement", () => {
        const document = renderGovernanceStatus();

        assert.match(document, /IC-01-KEY-CUSTODY/);
        assert.match(document, /IC-15-ADVERSARIAL/);
        assert.match(document, /\| Enforced \| 0 \|/);
        assert.match(document, /Source presence alone is not executable evidence/);
    });

    it("rejects an enforced claim when its required executable probe is removed", () => {
        const promoted = GOVERNANCE_CONTROLS.map((control) =>
            control.gateNumber === 1 ? { ...control, implementationStatus: "enforced" as const } : control,
        );
        const probesWithoutKeyCustody = EVIDENCE_PROBES.filter(
            (probe) => probe.probeId !== "security.key-custody",
        );

        assert.ok(
            validateGovernanceStatusClaims(promoted, probesWithoutKeyCustody).some((error) =>
                error.includes("claims enforcement without executable probe security.key-custody@1"),
            ),
        );
    });

    it("detects hand-edited generated documentation", async () => {
        const directory = await mkdtemp(join(tmpdir(), "prism-governance-status-"));
        temporaryDirectories.push(directory);
        const path = join(directory, "GOVERNANCE_CONTROL_STATUS.md");

        await writeGovernanceStatus(path);
        assert.equal(await checkGovernanceStatus(path), true);

        const generated = await readFile(path, "utf-8");
        await writeFile(path, generated.replace("| Enforced | 0 |", "| Enforced | 15 |"), "utf-8");
        assert.equal(await checkGovernanceStatus(path), false);
    });
});
