import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
    checkGovernanceArtifacts,
    writeGovernanceArtifacts,
} from "../src/core/governance/governance-artifact-manifest.js";

const directories: string[] = [];

function createRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "prism-governance-artifacts-"));
    directories.push(root);
    writeFileSync(join(root, "Permanent_Active_Directives.txt"), "PAD\n");
    writeFileSync(join(root, "AGENTIC_PRIME_DIRECTIVE.md"), "# Prime\n");
    writeFileSync(join(root, "AGENTIC_SACRED_COVENANT.md"), "# Covenant\n");
    writeFileSync(join(root, "GOVERNANCE_COUNCIL_CHARTER.md"), "# Council\n");
    mkdirSync(join(root, "config", "governance-errata"), { recursive: true });
    mkdirSync(join(root, "config", "governance-key-rotations"), { recursive: true });
    writeFileSync(join(root, "config", "governance-errata", "E-2026-001.json"), "{}\n");
    writeFileSync(join(root, "config", "governance-key-rotations", "R-2026-001.json"), "{}\n");
    writeFileSync(join(root, "config", "governance-signing-keys.json"), "{\"version\":1,\"keys\":[]}\n");
    return root;
}

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("Governance artifact manifest", () => {
    it("generates a stable manifest and canonical Covenant publication", async () => {
        const root = createRoot();
        await writeGovernanceArtifacts(root);

        assert.deepEqual(await checkGovernanceArtifacts(root), []);
        const publication = await readFile(join(root, "docs", "PRISM_SACRED_COVENANT_GENERATED.md"), "utf-8");
        assert.match(publication, /Article 10: Release Acceptance Certification/);
    });

    it("detects source and generated-publication drift", async () => {
        const root = createRoot();
        await writeGovernanceArtifacts(root);
        await writeFile(join(root, "AGENTIC_PRIME_DIRECTIVE.md"), "# Changed Prime\n");
        assert.ok((await checkGovernanceArtifacts(root)).includes("Governance artifact manifest drift detected"));

        await writeGovernanceArtifacts(root);
        await writeFile(join(root, "docs", "PRISM_SACRED_COVENANT_GENERATED.md"), "tampered\n");
        assert.ok((await checkGovernanceArtifacts(root)).includes("Generated Covenant publication drift detected"));
    });
});
