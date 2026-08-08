import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    CANONICAL_COVENANT_V1,
    generateCovenantMarkdown,
    getCanonicalCovenantDigest,
} from "./canonical-covenant.js";

export interface GovernanceArtifactRecord {
    readonly artifactId: string;
    readonly version: string;
    readonly path: string;
    readonly sha256: string;
    readonly relationship: "authority-source" | "generated-publication" | "governance-reference";
}

export interface GovernanceArtifactManifest {
    readonly format: "prism-governance-artifact-manifest";
    readonly version: 1;
    readonly artifacts: readonly GovernanceArtifactRecord[];
    readonly canonicalCovenantDigest: string;
}

export const GOVERNANCE_ARTIFACT_MANIFEST_PATH = resolve(process.cwd(), "config", "governance-artifact-manifest.json");
export const GENERATED_COVENANT_PATH = resolve(process.cwd(), "docs", "PRISM_SACRED_COVENANT_GENERATED.md");

function sha256(bytes: Buffer | string): string {
    return createHash("sha256").update(bytes).digest("hex");
}

export async function buildGovernanceArtifactManifest(root = process.cwd()): Promise<GovernanceArtifactManifest> {
    const definitions = [
        ["permanent-active-directives", "2026-08-02", "Permanent_Active_Directives.txt", "authority-source"],
        ["governance-erratum-e-2026-001", "2026-08-02", "config/governance-errata/E-2026-001.json", "governance-reference"],
        ["governance-key-rotation-r-2026-001", "2026-08-08", "config/governance-key-rotations/R-2026-001.json", "governance-reference"],
        ["governance-signing-key-registry", "current", "config/governance-signing-keys.json", "governance-reference"],
        ["agentic-prime-directive", "current", "AGENTIC_PRIME_DIRECTIVE.md", "authority-source"],
        ["agentic-sacred-covenant", "current", "AGENTIC_SACRED_COVENANT.md", "governance-reference"],
        ["governance-council-charter", "current", "GOVERNANCE_COUNCIL_CHARTER.md", "governance-reference"],
    ] as const;
    const artifacts: GovernanceArtifactRecord[] = [];
    for (const [artifactId, version, relativePath, relationship] of definitions) {
        const bytes = await readFile(resolve(root, relativePath));
        artifacts.push({ artifactId, version, path: relativePath, sha256: sha256(bytes), relationship });
    }
    const generatedMarkdown = generateCovenantMarkdown();
    artifacts.push({
        artifactId: "canonical-covenant-publication",
        version: CANONICAL_COVENANT_V1.version,
        path: "docs/PRISM_SACRED_COVENANT_GENERATED.md",
        sha256: sha256(generatedMarkdown),
        relationship: "generated-publication",
    });
    return {
        format: "prism-governance-artifact-manifest",
        version: 1,
        artifacts,
        canonicalCovenantDigest: getCanonicalCovenantDigest(),
    };
}

export async function writeGovernanceArtifacts(root = process.cwd()): Promise<void> {
    const manifest = await buildGovernanceArtifactManifest(root);
    const manifestPath = resolve(root, "config", "governance-artifact-manifest.json");
    const covenantPath = resolve(root, "docs", "PRISM_SACRED_COVENANT_GENERATED.md");
    await mkdir(dirname(manifestPath), { recursive: true });
    await mkdir(dirname(covenantPath), { recursive: true });
    await writeFile(covenantPath, generateCovenantMarkdown(), "utf-8");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

export async function checkGovernanceArtifacts(root = process.cwd()): Promise<string[]> {
    const manifestPath = resolve(root, "config", "governance-artifact-manifest.json");
    const covenantPath = resolve(root, "docs", "PRISM_SACRED_COVENANT_GENERATED.md");
    const errors: string[] = [];
    if (!existsSync(manifestPath)) return ["Governance artifact manifest is missing"];
    if (!existsSync(covenantPath)) return ["Generated Covenant publication is missing"];
    const expected = await buildGovernanceArtifactManifest(root);
    const actual = JSON.parse(await readFile(manifestPath, "utf-8")) as GovernanceArtifactManifest;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push("Governance artifact manifest drift detected");
    if ((await readFile(covenantPath, "utf-8")) !== generateCovenantMarkdown()) {
        errors.push("Generated Covenant publication drift detected");
    }
    return errors;
}

async function main(): Promise<void> {
    if (process.argv.includes("--check")) {
        const errors = await checkGovernanceArtifacts();
        if (errors.length > 0) {
            errors.forEach((error) => console.error(error));
            process.exitCode = 1;
            return;
        }
        console.log(`Governance artifacts are current: ${GOVERNANCE_ARTIFACT_MANIFEST_PATH}`);
        return;
    }
    await writeGovernanceArtifacts();
    console.log(`Generated governance artifacts: ${GOVERNANCE_ARTIFACT_MANIFEST_PATH}`);
    console.log(`Generated canonical Covenant: ${GENERATED_COVENANT_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
