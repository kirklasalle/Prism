import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAD_LAWS } from "../security/directive-manifest.js";
import {
    GOVERNANCE_CONTROLS,
    type GovernanceControlDefinition,
    validateControlRegistry,
} from "./control-registry.js";
import {
    EVIDENCE_PROBES,
    type EvidenceProbeDefinition,
    findEvidenceProbe,
    validateProbeRegistry,
} from "./probe-registry.js";

export const GOVERNANCE_STATUS_PATH = resolve(process.cwd(), "docs", "GOVERNANCE_CONTROL_STATUS.md");

function escapeCell(value: string): string {
    return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function validateGovernanceStatusClaims(
    controls: readonly GovernanceControlDefinition[] = GOVERNANCE_CONTROLS,
    probes: readonly EvidenceProbeDefinition[] = EVIDENCE_PROBES,
): string[] {
    const errors = [...validateControlRegistry(controls), ...validateProbeRegistry(probes)];
    for (const control of controls.filter((item) => item.implementationStatus === "enforced")) {
        for (const requirement of control.evidenceRequirements) {
            const available = probes.some(
                (probe) => probe.probeId === requirement.probeId && probe.version === requirement.probeVersion,
            );
            if (!available) {
                errors.push(
                    `${control.controlId} claims enforcement without executable probe ${requirement.probeId}@${requirement.probeVersion}`,
                );
            }
        }
    }
    return errors;
}

export function renderGovernanceStatus(): string {
    const registryErrors = validateGovernanceStatusClaims();
    if (registryErrors.length > 0) {
        throw new Error(`Invalid governance control registry: ${registryErrors.join("; ")}`);
    }

    const statusCounts = GOVERNANCE_CONTROLS.reduce(
        (counts, control) => {
            counts[control.implementationStatus] += 1;
            return counts;
        },
        { enforced: 0, partial: 0, not_enforced: 0 },
    );
    const controlRows = GOVERNANCE_CONTROLS.map((control) => {
        const probes = control.evidenceRequirements
            .map((requirement) => `${requirement.probeId}@${requirement.probeVersion}`)
            .join("<br>");
        const availability = control.evidenceRequirements
            .map((requirement) => (findEvidenceProbe(requirement.probeId, requirement.probeVersion) ? "available" : "missing"))
            .join("<br>");
        return `| ${control.gateNumber} | ${control.controlId} | ${escapeCell(control.title)} | ${control.implementationStatus} | ${control.requiredFor} | ${control.padLawIds.join(", ")} | ${escapeCell(probes)} | ${availability} | ${escapeCell(control.owners.join("<br>"))} | ${escapeCell(control.limitation)} |`;
    }).join("\n");
    const lawRows = PAD_LAWS.map((law) => {
        const controls = GOVERNANCE_CONTROLS.filter((control) => control.padLawIds.includes(law.id));
        const status = controls.some((control) => control.implementationStatus === "enforced")
            ? "enforced"
            : controls.some((control) => control.implementationStatus === "partial")
                ? "partial"
                : "not_enforced";
        return `| ${law.id} | ${law.code} | ${escapeCell(law.title)} | ${status} | ${controls.map((control) => control.controlId).join(", ") || "none"} |`;
    }).join("\n");

    return `# PRISM Governance Control Status

> This file is generated from \`src/core/governance/control-registry.ts\`.
> Do not promote enforcement claims by editing this document. Run \`npm run governance:status:generate\`.

## Summary

| Status | Controls |
| --- | ---: |
| Enforced | ${statusCounts.enforced} |
| Partial | ${statusCounts.partial} |
| Not enforced | ${statusCounts.not_enforced} |

A control remains partial or not enforced until its registered probe emits current evidence for the release commit and build. Source presence alone is not executable evidence.

## Control Registry

| Gate | Control ID | Requirement | Implementation | Release tier | PAD laws | Required probes | Executable | Owners | Known limitation |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${controlRows}

## PAD Coverage

| Law | Code | Title | Mechanical coverage | Controls |
| ---: | --- | --- | --- | --- |
${lawRows}

## Evidence Semantics

The checked-in document reports static implementation claims only. Runtime release status is computed from a canonical evidence manifest. Missing, stale, failed, wrong-commit, or wrong-build evidence is not evaluated and blocks certification.
`;
}

export async function writeGovernanceStatus(path = GOVERNANCE_STATUS_PATH): Promise<void> {
    await writeFile(path, renderGovernanceStatus(), "utf-8");
}

export async function checkGovernanceStatus(path = GOVERNANCE_STATUS_PATH): Promise<boolean> {
    if (!existsSync(path)) return false;
    return (await readFile(path, "utf-8")) === renderGovernanceStatus();
}

async function main(): Promise<void> {
    const checkOnly = process.argv.includes("--check");
    if (checkOnly) {
        if (!(await checkGovernanceStatus())) {
            console.error(`Governance status drift detected: ${GOVERNANCE_STATUS_PATH}`);
            process.exitCode = 1;
            return;
        }
        console.log(`Governance status is current: ${GOVERNANCE_STATUS_PATH}`);
        return;
    }
    await writeGovernanceStatus();
    console.log(`Generated governance status: ${GOVERNANCE_STATUS_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    void main();
}
