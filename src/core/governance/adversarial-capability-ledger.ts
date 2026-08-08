import { createHash } from "node:crypto";

export interface AdversarialCapabilityEntry {
    readonly threatPosition: string;
    readonly attackAttempted: string;
    readonly expectedResult: string;
    readonly actualResult: string;
    readonly blocked: boolean;
}

export interface AdversarialCapabilityLedger {
    readonly format: "prism-adversarial-capability-ledger";
    readonly version: 1;
    readonly commit: string;
    readonly buildId: string;
    readonly evaluatedAt: string;
    readonly entries: readonly AdversarialCapabilityEntry[];
    readonly ledgerDigest: string;
}

export function createAdversarialCapabilityLedger(
    commit: string,
    buildId: string,
    evaluatedAt: string,
    entries: readonly AdversarialCapabilityEntry[],
): AdversarialCapabilityLedger {
    if (entries.length === 0) throw new Error("Adversarial capability ledger requires at least one attack");
    const payload = { format: "prism-adversarial-capability-ledger" as const, version: 1 as const, commit, buildId, evaluatedAt, entries };
    return { ...payload, ledgerDigest: createHash("sha256").update(canonicalJson(payload)).digest("hex") };
}

export function validateAdversarialCapabilityLedger(ledger: AdversarialCapabilityLedger): string[] {
    const errors: string[] = [];
    const { ledgerDigest: _digest, ...payload } = ledger;
    const expected = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    if (ledger.ledgerDigest !== expected) errors.push("Adversarial capability ledger digest mismatch");
    if (ledger.entries.length === 0) errors.push("Adversarial capability ledger has no entries");
    for (const entry of ledger.entries) {
        if (!entry.threatPosition || !entry.attackAttempted || !entry.expectedResult || !entry.actualResult) {
            errors.push("Adversarial capability entry is incomplete");
        }
    }
    return errors;
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}