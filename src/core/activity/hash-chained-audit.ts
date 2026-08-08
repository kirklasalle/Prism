/**
 * Hash-Chained Audit Ledger & Signed Checkpoints — Phase 4 (IC-11)
 *
 * Implements a cryptographic blockchain-style append-only event ledger for PRISM activity logs.
 * Each event embeds `previousHash`, computing its SHA-256 digest over the composite payload:
 *   `hash = SHA-256(previousHash + ":" + canonicalPayload)`
 *
 * Periodic signed checkpoints (`SignedAuditCheckpoint`) compute the cryptographic root hash
 * over sequence windows and sign them with the system's Ed25519 issuer key, producing
 * an externally exportable, tamper-evident audit sink.
 *
 * @module core/activity/hash-chained-audit
 */

import { createHash, randomUUID } from "node:crypto";
import type { ActivityEvent } from "./types.js";
import { signCertificateContent, verifyCertificateContent } from "../security/initialization-signature.js";

/** Genesis block hash for event #0 in a chain. */
export const GENESIS_PREVIOUS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
export const CURRENT_AUDIT_HASH_VERSION = 2;

export interface HashChainedEvent extends ActivityEvent {
    /** SHA-256 digest of the immediately preceding event in sequence. */
    readonly previousHash: string;
    /** Monotonically increasing 1-indexed sequence number. */
    readonly sequenceNumber: number;
    /** Version of the canonical payload covered by `hash`. */
    readonly hashVersion: number;
}

export interface SignedAuditCheckpoint {
    readonly checkpointId: string;
    readonly sequenceStart: number;
    readonly sequenceEnd: number;
    readonly eventCount: number;
    readonly rootHash: string;
    readonly timestamp: string;
    readonly signatureBase64: string;
    readonly publicKeyBase64: string;
}

/**
 * Compute the cryptographic SHA-256 hash for a chained event:
 * `SHA-256(previousHash + ":" + JSON.stringify(payload))`
 */
function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",")}}`;
}

function legacyPayload(event: Omit<ActivityEvent, "hash">): Record<string, unknown> {
    return {
        id: event.id,
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        layer: event.layer,
        operation: event.operation,
        status: event.status,
        details: event.details,
        characterId: event.characterId,
        operatorEmail: event.operatorEmail,
        assignmentId: event.assignmentId,
    };
}

function completePayload(event: Omit<ActivityEvent, "hash">): Record<string, unknown> {
    return {
        id: event.id,
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        layer: event.layer,
        operation: event.operation,
        status: event.status,
        confidence: event.confidence ?? null,
        durationMs: event.durationMs ?? null,
        details: event.details ?? {},
        authorityTier: event.authorityTier ?? null,
        policyDecision: event.policyDecision ?? null,
        sideEffects: event.sideEffects ?? [],
        characterId: event.characterId ?? null,
        prismUserId: event.prismUserId ?? null,
        prismUserEmail: event.prismUserEmail ?? null,
        operatorId: event.operatorId ?? null,
        operatorEmail: event.operatorEmail ?? null,
        clientId: event.clientId ?? null,
        executionProfileSegment: event.executionProfileSegment ?? null,
        assignmentId: event.assignmentId ?? null,
        accountabilityChain: event.accountabilityChain ?? null,
        rollbackPlan: event.rollbackPlan ?? null,
    };
}

export function computeChainedEventHash(
    previousHash: string,
    event: Omit<ActivityEvent, "hash">,
    hashVersion: number = CURRENT_AUDIT_HASH_VERSION,
): string {
    const payload = hashVersion === 1 ? legacyPayload(event) : completePayload(event);
    const canonicalPayload = hashVersion === 1 ? JSON.stringify(payload) : canonicalJson(payload);

    const hashInput = hashVersion === 1
        ? `${previousHash}:${canonicalPayload}`
        : `${hashVersion}:${previousHash}:${canonicalPayload}`;
    return createHash("sha256").update(hashInput).digest("hex");
}

/**
 * Verify an array of chained activity events for continuous cryptographic integrity.
 * Returns { valid: true } if intact, or details of broken index if tampered.
 */
export function verifyEventChain(events: HashChainedEvent[]): {
    valid: boolean;
    brokenAtIndex: number | null;
    reason: string;
} {
    if (events.length === 0) {
        return { valid: true, brokenAtIndex: null, reason: "Chain is empty" };
    }

    let expectedPrevHash = GENESIS_PREVIOUS_HASH;

    for (let i = 0; i < events.length; i++) {
        const evt = events[i]!;

        // 1. Check sequence ordering
        if (evt.sequenceNumber !== i + 1) {
            return {
                valid: false,
                brokenAtIndex: i,
                reason: `Sequence gap detected at index ${i}: expected ${i + 1}, got ${evt.sequenceNumber}`,
            };
        }

        // 2. Check previous hash link
        if (evt.previousHash !== expectedPrevHash) {
            return {
                valid: false,
                brokenAtIndex: i,
                reason: `Previous hash mismatch at index ${i} (event ${evt.id}): expected ${expectedPrevHash.slice(0, 12)}, got ${evt.previousHash.slice(0, 12)}`,
            };
        }

        // 3. Re-evaluate self hash
        const calculatedHash = computeChainedEventHash(evt.previousHash, evt, evt.hashVersion);
        if (evt.hash !== calculatedHash) {
            return {
                valid: false,
                brokenAtIndex: i,
                reason: `Event hash mismatch at index ${i} (event ${evt.id}): recorded ${(evt.hash || "").slice(0, 12)}, computed ${calculatedHash.slice(0, 12)}`,
            };
        }

        expectedPrevHash = evt.hash;
    }

    return {
        valid: true,
        brokenAtIndex: null,
        reason: `Chain verified intact: ${events.length} events from seq 1 to ${events.length}`,
    };
}

/**
 * Create a signed audit checkpoint over a sequence range of chained events.
 */
export function createAuditCheckpoint(events: HashChainedEvent[]): SignedAuditCheckpoint {
    if (events.length === 0) {
        throw new Error("Cannot create audit checkpoint for an empty event list");
    }

    const sequenceStart = events[0]!.sequenceNumber;
    const sequenceEnd = events[events.length - 1]!.sequenceNumber;
    const checkpointId = "chk-" + randomUUID();
    const timestamp = new Date().toISOString();

    // Compute root hash over event hashes
    const hashConcat = events.map((e) => e.hash).join(":");
    const rootHash = createHash("sha256").update(hashConcat).digest("hex");

    const payloadToSign = JSON.stringify({
        checkpointId,
        sequenceStart,
        sequenceEnd,
        eventCount: events.length,
        rootHash,
        timestamp,
    });

    const { signatureBase64, publicKeyBase64 } = signCertificateContent(payloadToSign);

    return {
        checkpointId,
        sequenceStart,
        sequenceEnd,
        eventCount: events.length,
        rootHash,
        timestamp,
        signatureBase64,
        publicKeyBase64,
    };
}

/**
 * Verify the cryptographic signature of an audit checkpoint.
 */
export function verifyAuditCheckpoint(checkpoint: SignedAuditCheckpoint): boolean {
    const payload = JSON.stringify({
        checkpointId: checkpoint.checkpointId,
        sequenceStart: checkpoint.sequenceStart,
        sequenceEnd: checkpoint.sequenceEnd,
        eventCount: checkpoint.eventCount,
        rootHash: checkpoint.rootHash,
        timestamp: checkpoint.timestamp,
    });

    return verifyCertificateContent(payload, checkpoint.signatureBase64, checkpoint.publicKeyBase64);
}
