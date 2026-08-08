import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildIdentity } from "./build-identity.js";
import { evidenceManifestDigest } from "./evidence-manifest.js";
import { EVIDENCE_PROBES, findEvidenceProbe, runEvidenceProbes } from "./probe-registry.js";

export interface RunnerOptions {
    readonly requested: Array<{ probeId: string; probeVersion: number }>;
    readonly outputPath: string;
    readonly inputs: Record<string, unknown>;
    readonly allowNotEvaluated: boolean;
}

function argumentValue(name: string): string | undefined {
    const exactIndex = process.argv.indexOf(name);
    if (exactIndex >= 0) return process.argv[exactIndex + 1];
    const prefix = `${name}=`;
    return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function parseProbeIdentity(value: string): { probeId: string; probeVersion: number } {
    const separator = value.lastIndexOf("@");
    const probeId = separator < 0 ? value : value.slice(0, separator);
    const probeVersion = separator < 0 ? 1 : Number(value.slice(separator + 1));
    if (!probeId || !Number.isInteger(probeVersion) || probeVersion < 1) {
        throw new Error(`Invalid probe identity: ${value}; expected probe.id@version`);
    }
    return { probeId, probeVersion };
}

export function parseRunnerOptions(): RunnerOptions {
    const probeArguments = process.argv
        .flatMap((argument, index) => (argument === "--probe" ? [process.argv[index + 1]] : argument.startsWith("--probe=") ? [argument.slice(8)] : []))
        .filter((value): value is string => Boolean(value));
    const requested =
        probeArguments.length > 0
            ? probeArguments.map(parseProbeIdentity)
            : EVIDENCE_PROBES.map((probe) => ({ probeId: probe.probeId, probeVersion: probe.version }));
    return {
        requested,
        outputPath: resolve(
            argumentValue("--output") ??
            process.env.PRISM_GOVERNANCE_EVIDENCE_PATH ??
            "prism-output/security/governance-evidence-manifest.json",
        ),
        inputs: {
            auditDatabasePath: argumentValue("--audit-db") ?? process.env.PRISM_AUDIT_DB_PATH,
            auditAnchorPath: argumentValue("--audit-anchor") ?? process.env.PRISM_AUDIT_ANCHOR_PATH,
            chatDatabasePath: argumentValue("--chat-db") ?? process.env.PRISM_CHAT_DB_PATH,
            deploymentEvidenceDirectory:
                argumentValue("--deployment-evidence-dir") ?? process.env.PRISM_DEPLOYMENT_EVIDENCE_DIR,
            releaseKeyRegistryPath:
                argumentValue("--release-key-registry") ?? process.env.PRISM_RELEASE_KEY_REGISTRY_PATH,
        },
        allowNotEvaluated: process.argv.includes("--allow-not-evaluated"),
    };
}

export async function runProbeCli(options: RunnerOptions = parseRunnerOptions()): Promise<number> {
    const unavailable = options.requested.filter(
        (requested) => !findEvidenceProbe(requested.probeId, requested.probeVersion),
    );
    if (unavailable.length > 0) {
        console.error(
            `Unregistered evidence probe(s): ${unavailable.map((item) => `${item.probeId}@${item.probeVersion}`).join(", ")}`,
        );
        return 1;
    }

    const identity = resolveBuildIdentity();
    const inputs = { ...options.inputs, evidenceOutputDirectory: dirname(options.outputPath) };
    const manifest = await runEvidenceProbes(options.requested, {
        ...identity,
        inputs,
    });
    await mkdir(resolve(options.outputPath, ".."), { recursive: true });
    await writeFile(options.outputPath, JSON.stringify(manifest, null, 2), "utf-8");

    console.log(`PRISM governance evidence (${identity.commit}/${identity.buildId})`);
    for (const record of manifest.records) {
        console.log(`- [${record.result.toUpperCase()}] ${record.probeId}@${record.probeVersion}`);
    }
    console.log(`- Manifest SHA-256: ${evidenceManifestDigest(manifest)}`);
    console.log(`- Artifact: ${options.outputPath}`);

    if (manifest.records.some((record) => record.result === "failed")) return 1;
    if (!options.allowNotEvaluated && manifest.records.some((record) => record.result === "not_evaluated")) return 2;
    return 0;
}

const modulePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1];
if (entryPath && modulePath === entryPath) {
    void runProbeCli().then((exitCode) => {
        process.exitCode = exitCode;
    });
}
