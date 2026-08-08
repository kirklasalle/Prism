import { createHash } from "node:crypto";

export type EvidenceResult = "passed" | "failed" | "not_evaluated";

export interface EvidenceRecord {
    readonly evidenceId: string;
    readonly probeId: string;
    readonly probeVersion: number;
    readonly result: EvidenceResult;
    readonly commit: string;
    readonly buildId: string;
    readonly evaluatedAt: string;
    readonly inputDigest: string;
    readonly outputDigest: string;
    readonly artifactPath?: string;
    readonly failureReason?: string;
}

export interface EvidenceManifest {
    readonly format: "prism-governance-evidence";
    readonly version: 1;
    readonly commit: string;
    readonly buildId: string;
    readonly generatedAt: string;
    readonly records: readonly EvidenceRecord[];
}

export interface EvidenceValidationContext {
    readonly commit: string;
    readonly buildId: string;
    readonly now?: Date;
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
        .filter((key) => object[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
        .join(",")}}`;
}

export function evidenceValueDigest(value: unknown): string {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function sha256EvidenceRecord(record: EvidenceRecord): string {
    return evidenceValueDigest(record);
}

export function evidenceManifestDigest(manifest: EvidenceManifest): string {
    return evidenceValueDigest(manifest);
}

export function validateEvidenceManifest(
    manifest: EvidenceManifest,
    context: EvidenceValidationContext,
): string[] {
    const errors: string[] = [];
    if (manifest.format !== "prism-governance-evidence") errors.push(`Unsupported format: ${manifest.format}`);
    if (manifest.version !== 1) errors.push(`Unsupported evidence manifest version: ${manifest.version}`);
    if (manifest.commit !== context.commit) errors.push(`Manifest commit ${manifest.commit} does not match ${context.commit}`);
    if (manifest.buildId !== context.buildId) errors.push(`Manifest build ${manifest.buildId} does not match ${context.buildId}`);

    const ids = new Set<string>();
    for (const record of manifest.records) {
        if (ids.has(record.evidenceId)) errors.push(`Duplicate evidenceId: ${record.evidenceId}`);
        ids.add(record.evidenceId);
        if (record.commit !== manifest.commit) errors.push(`${record.evidenceId} commit does not match manifest`);
        if (record.buildId !== manifest.buildId) errors.push(`${record.evidenceId} build does not match manifest`);
        if (!Number.isFinite(Date.parse(record.evaluatedAt))) errors.push(`${record.evidenceId} has invalid evaluatedAt`);
        if (!/^[a-f0-9]{64}$/i.test(record.inputDigest)) errors.push(`${record.evidenceId} has invalid inputDigest`);
        if (!/^[a-f0-9]{64}$/i.test(record.outputDigest)) errors.push(`${record.evidenceId} has invalid outputDigest`);
        if (record.result === "failed" && !record.failureReason) {
            errors.push(`${record.evidenceId} failed without a failureReason`);
        }
    }
    return errors;
}

export function findCurrentEvidence(
    manifest: EvidenceManifest,
    probeId: string,
    probeVersion: number,
    maxAgeMs: number,
    context: EvidenceValidationContext,
): EvidenceRecord | null {
    const now = (context.now ?? new Date()).getTime();
    const candidates = manifest.records
        .filter((record) => record.probeId === probeId && record.probeVersion === probeVersion)
        .filter((record) => record.commit === context.commit && record.buildId === context.buildId)
        .filter((record) => {
            const evaluatedAt = Date.parse(record.evaluatedAt);
            return Number.isFinite(evaluatedAt) && evaluatedAt <= now && now - evaluatedAt <= maxAgeMs;
        })
        .sort((left, right) => Date.parse(right.evaluatedAt) - Date.parse(left.evaluatedAt));
    return candidates[0] ?? null;
}
