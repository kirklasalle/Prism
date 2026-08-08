import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SqliteActivityStore } from "./sqlite-store.js";
import {
    createAuditCheckpoint,
    verifyAuditCheckpoint,
    type SignedAuditCheckpoint,
} from "./hash-chained-audit.js";

export interface ExternalAuditAnchor {
    readonly format: "prism-external-audit-anchor";
    readonly version: 1;
    readonly checkpoint: SignedAuditCheckpoint;
    readonly databaseIdentity: string;
    readonly firstPredecessorHash: string;
    readonly lastEventHash: string;
    readonly rootedAfterPrune: boolean;
    readonly unchainedRows: number;
    readonly issuerKeyId: string;
    readonly previousAnchorDigest: string | null;
    readonly anchorDigest: string;
}

export interface ExternalAuditAnchorStore {
    publish(anchor: ExternalAuditAnchor): void;
    latest(): ExternalAuditAnchor | null;
}

export class FileExternalAuditAnchorStore implements ExternalAuditAnchorStore {
    constructor(private readonly path: string) { }

    publish(anchor: ExternalAuditAnchor): void {
        mkdirSync(dirname(this.path), { recursive: true });
        appendFileSync(this.path, `${JSON.stringify(anchor)}\n`, "utf8");
    }

    latest(): ExternalAuditAnchor | null {
        if (!existsSync(this.path)) return null;
        const lines = readFileSync(this.path, "utf8").trim().split("\n").filter(Boolean);
        return lines.length > 0 ? (JSON.parse(lines[lines.length - 1]!) as ExternalAuditAnchor) : null;
    }
}

export function publishPersistedAuditAnchor(
    activityStore: SqliteActivityStore,
    anchorStore: ExternalAuditAnchorStore,
): ExternalAuditAnchor {
    const verification = activityStore.verifyPersistedChain();
    if (verification.status !== "valid") {
        throw new Error(`Cannot anchor an unverified persisted chain: ${verification.reason}`);
    }
    const previous = anchorStore.latest();
    if (previous && !verifyAuditCheckpoint(previous.checkpoint)) {
        throw new Error("Existing external anchor has an invalid signature");
    }
    const sequenceStart = previous ? previous.checkpoint.sequenceEnd + 1 : verification.firstSequence!;
    const events = activityStore.readPersistedChainRange(sequenceStart);
    if (events.length === 0) throw new Error("No new persisted events are available to anchor");
    const checkpoint = createAuditCheckpoint(events);
    const previousAnchorDigest = previous?.anchorDigest ?? null;
    const identity = {
        databaseIdentity: createHash("sha256")
            .update(`${events[0]!.sequenceNumber}:${events[0]!.previousHash}`)
            .digest("hex"),
        firstPredecessorHash: events[0]!.previousHash,
        lastEventHash: events[events.length - 1]!.hash!,
        rootedAfterPrune: verification.rootedAfterPrune,
        unchainedRows: verification.unchainedRows,
        issuerKeyId: createHash("sha256").update(checkpoint.publicKeyBase64).digest("hex"),
    };
    const anchorWithoutDigest = {
        format: "prism-external-audit-anchor" as const,
        version: 1 as const,
        checkpoint,
        ...identity,
        previousAnchorDigest,
    };
    const anchor: ExternalAuditAnchor = { ...anchorWithoutDigest, anchorDigest: digestAnchor(anchorWithoutDigest) };
    anchorStore.publish(anchor);
    return anchor;
}

export function verifyLatestPersistedAuditAnchor(
    activityStore: SqliteActivityStore,
    anchorStore: ExternalAuditAnchorStore,
): { valid: boolean; reason: string } {
    const anchor = anchorStore.latest();
    if (!anchor) return { valid: false, reason: "No external audit anchor is available" };
    if (!verifyAuditCheckpoint(anchor.checkpoint)) return { valid: false, reason: "Checkpoint signature is invalid" };
    const { anchorDigest, ...anchorWithoutDigest } = anchor;
    if (anchorDigest !== digestAnchor(anchorWithoutDigest)) {
        return { valid: false, reason: "External anchor digest is invalid" };
    }
    const persisted = activityStore.verifyPersistedChain();
    if (persisted.status !== "valid") return { valid: false, reason: persisted.reason };
    const events = activityStore.readPersistedChainRange(
        anchor.checkpoint.sequenceStart,
        anchor.checkpoint.sequenceEnd,
    );
    if (events.length !== anchor.checkpoint.eventCount) {
        return { valid: false, reason: "Anchored persisted range is missing events" };
    }
    if (
        events[0]!.previousHash !== anchor.firstPredecessorHash ||
        events[events.length - 1]!.hash !== anchor.lastEventHash
    ) {
        return { valid: false, reason: "Persisted range boundary does not match the external anchor" };
    }
    const rootHash = createHash("sha256").update(events.map((event) => event.hash).join(":")).digest("hex");
    if (rootHash !== anchor.checkpoint.rootHash) {
        return { valid: false, reason: "Persisted range does not match the external checkpoint root" };
    }
    return { valid: true, reason: `External anchor verifies sequences ${anchor.checkpoint.sequenceStart}-${anchor.checkpoint.sequenceEnd}` };
}

function digestAnchor(anchor: Omit<ExternalAuditAnchor, "anchorDigest">): string {
    return createHash("sha256").update(JSON.stringify(anchor)).digest("hex");
}