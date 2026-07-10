/**
 * Amendment Ledger — Append-Only, Hash-Chained Governance Log
 *
 * Implements a tamper-evident, append-only ledger for all governance
 * amendment events. Each entry includes the SHA-256 hash of the
 * previous entry, creating a chain that makes retroactive tampering
 * detectable.
 *
 * The ledger serves Law 9 (Auditable Reasoning) by maintaining a
 * transparent, verifiable record of every governance action.
 *
 * Storage: JSON file at workspace/governance/amendment-ledger.json
 * The ledger is instance-local — each Prism instance maintains its
 * own copy, reflecting the dual-binary decisions made on that instance.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AmendmentLedgerEntry } from "./amendment-types.js";

/* ── Constants ──────────────────────────────────────────────────────── */

const LEDGER_FILENAME = "amendment-ledger.json";
const GENESIS_PREVIOUS_HASH = "";

/* ── Ledger Class ───────────────────────────────────────────────────── */

export class AmendmentLedger {
    private readonly ledgerPath: string;
    private readonly instanceId: string;
    private entries: AmendmentLedgerEntry[] = [];

    /**
     * @param governanceDir - Absolute path to the governance directory
     *                        (e.g., workspace/governance/)
     * @param instanceId - Unique identifier for this Prism instance
     */
    constructor(governanceDir: string, instanceId: string) {
        this.ledgerPath = join(governanceDir, LEDGER_FILENAME);
        this.instanceId = instanceId;
        this.load();
    }

    /* ── Public API ─────────────────────────────────────────────────── */

    /**
     * Append a new entry to the ledger. The entry is hash-chained
     * to the previous entry automatically.
     */
    append(
        eventType: AmendmentLedgerEntry["eventType"],
        proposalId: string | null,
        payload: Record<string, unknown>,
        padHash: string,
    ): AmendmentLedgerEntry {
        const previousEntry = this.entries.length > 0 ? this.entries[this.entries.length - 1]! : null;

        const index = this.entries.length;
        const previousHash = previousEntry?.entryHash ?? GENESIS_PREVIOUS_HASH;
        const timestamp = new Date().toISOString();

        // Compute the entry hash from all content fields
        const contentForHash = JSON.stringify({
            index,
            previousHash,
            timestamp,
            eventType,
            proposalId,
            payload,
            padHash,
            instanceId: this.instanceId,
        });
        const entryHash = createHash("sha256").update(contentForHash, "utf8").digest("hex");

        const entry: AmendmentLedgerEntry = {
            index,
            previousHash,
            entryHash,
            timestamp,
            eventType,
            proposalId,
            payload,
            padHashAtEntry: padHash,
            instanceId: this.instanceId,
        };

        this.entries.push(entry);
        this.persist();

        return entry;
    }

    /**
     * Record the genesis event — the creation of this ledger.
     * Called once when the ledger is first initialized.
     */
    recordGenesis(padHash: string): AmendmentLedgerEntry {
        if (this.entries.length > 0) {
            throw new Error("Cannot record genesis on a non-empty ledger");
        }
        return this.append(
            "genesis",
            null,
            {
                event: "Governance Amendment Ledger initialized",
                instanceId: this.instanceId,
                charterVersion: "1.0",
                lawsImmutable: true,
                dualBinaryRequired: true,
            },
            padHash,
        );
    }

    /**
     * Record a periodic integrity check of the ledger itself.
     */
    recordIntegrityCheck(padHash: string): AmendmentLedgerEntry {
        const verification = this.verifyChain();
        return this.append(
            "integrity_check",
            null,
            {
                chainValid: verification.valid,
                entriesVerified: verification.entriesVerified,
                brokenAtIndex: verification.brokenAtIndex,
            },
            padHash,
        );
    }

    /**
     * Record a PAD hash snapshot for provenance tracking.
     */
    recordPadHashSnapshot(padHash: string, context: string): AmendmentLedgerEntry {
        return this.append(
            "pad_hash_recorded",
            null,
            {
                padHash,
                context,
                snapshotAt: new Date().toISOString(),
            },
            padHash,
        );
    }

    /**
     * Verify the integrity of the entire hash chain.
     * Returns true only if every entry's hash correctly chains
     * to the previous entry.
     */
    verifyChain(): { valid: boolean; entriesVerified: number; brokenAtIndex: number | null } {
        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i]!;

            // Verify previous hash linkage
            if (i === 0) {
                if (entry.previousHash !== GENESIS_PREVIOUS_HASH) {
                    return { valid: false, entriesVerified: i, brokenAtIndex: i };
                }
            } else {
                const prev = this.entries[i - 1]!;
                if (entry.previousHash !== prev.entryHash) {
                    return { valid: false, entriesVerified: i, brokenAtIndex: i };
                }
            }

            // Verify entry hash integrity
            const recomputedHash = this.computeEntryHash(entry);
            if (entry.entryHash !== recomputedHash) {
                return { valid: false, entriesVerified: i, brokenAtIndex: i };
            }
        }

        return { valid: true, entriesVerified: this.entries.length, brokenAtIndex: null };
    }

    /**
     * Get all ledger entries (read-only copy).
     */
    getEntries(): readonly AmendmentLedgerEntry[] {
        return [...this.entries];
    }

    /**
     * Get the most recent entry.
     */
    getLatestEntry(): AmendmentLedgerEntry | null {
        return this.entries.length > 0 ? this.entries[this.entries.length - 1]! : null;
    }

    /**
     * Get all entries related to a specific proposal.
     */
    getEntriesForProposal(proposalId: string): AmendmentLedgerEntry[] {
        return this.entries.filter((e) => e.proposalId === proposalId);
    }

    /**
     * Get the total number of entries.
     */
    get length(): number {
        return this.entries.length;
    }

    /**
     * Get the ledger file path.
     */
    get path(): string {
        return this.ledgerPath;
    }

    /* ── Internal ───────────────────────────────────────────────────── */

    /**
     * Recompute the hash of an entry from its content fields.
     * Used for chain verification.
     */
    private computeEntryHash(entry: AmendmentLedgerEntry): string {
        const contentForHash = JSON.stringify({
            index: entry.index,
            previousHash: entry.previousHash,
            timestamp: entry.timestamp,
            eventType: entry.eventType,
            proposalId: entry.proposalId,
            payload: entry.payload,
            padHash: entry.padHashAtEntry,
            instanceId: entry.instanceId,
        });
        return createHash("sha256").update(contentForHash, "utf8").digest("hex");
    }

    /**
     * Load the ledger from disk. If the file doesn't exist,
     * initialize an empty ledger.
     */
    private load(): void {
        if (!existsSync(this.ledgerPath)) {
            this.entries = [];
            return;
        }

        try {
            const raw = readFileSync(this.ledgerPath, "utf8");
            const parsed = JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                console.warn("[PRISM][governance] Ledger file is not an array, starting fresh");
                this.entries = [];
                return;
            }

            this.entries = parsed as AmendmentLedgerEntry[];
        } catch (err) {
            console.warn(
                "[PRISM][governance] Failed to parse amendment ledger, starting fresh:",
                err instanceof Error ? err.message : String(err),
            );
            this.entries = [];
        }
    }

    /**
     * Persist the ledger to disk. The entire ledger is written
     * atomically (write to temp + rename would be safer in
     * production — acceptable for v1).
     */
    private persist(): void {
        const dir = dirname(this.ledgerPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(this.ledgerPath, JSON.stringify(this.entries, null, 2) + "\n", "utf8");
    }
}

/**
 * Create a new AmendmentLedger with a unique instance ID.
 * If the ledger file doesn't exist, creates it with a genesis entry.
 */
export function createAmendmentLedger(governanceDir: string, padHash: string, instanceId?: string): AmendmentLedger {
    const id = instanceId ?? randomUUID();
    const ledger = new AmendmentLedger(governanceDir, id);

    if (ledger.length === 0) {
        ledger.recordGenesis(padHash);
        console.log(`[PRISM][governance] Amendment ledger initialized (instance=${id.slice(0, 8)}…)`);
    }

    return ledger;
}
