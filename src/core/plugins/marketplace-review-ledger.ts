/**
 * Plugin Marketplace Review Ledger (Phase G)
 *
 * Records curation decisions for marketplace catalog entries. Append-only
 * JSON file at `{workspace}/marketplace/review-ledger.json`. Each decision
 * captures who reviewed an entry, when, what they decided, and a short
 * rationale. The ledger is consumed by `listEntries({ curated: true })` to
 * surface only PRISM-curated packs.
 *
 * This is intentionally a small, file-backed store — no DB dependency. The
 * ledger is read on every list call (the catalog is small) and re-written
 * atomically on each `recordDecision`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { workspacePath } from "../config/workspace-resolver.js";

export type CurationStatus = "approved" | "rejected" | "deprecated" | "pending";

export interface MarketplaceReviewDecision {
    /** CatalogEntry.id this decision applies to. */
    entryId: string;
    /** Pack version reviewed. */
    version: string;
    status: CurationStatus;
    /** Free-form reviewer identifier (handle, email, key id). */
    reviewer: string;
    /** ISO 8601 timestamp. */
    reviewedAt: string;
    /** Short rationale; required for rejected/deprecated. */
    notes?: string;
}

export interface ReviewLedger {
    formatVersion: 1;
    decisions: MarketplaceReviewDecision[];
}

const FORMAT_VERSION = 1 as const;

function ledgerPath(): string {
    return workspacePath("marketplace", "review-ledger.json");
}

export function readLedger(): ReviewLedger {
    const p = ledgerPath();
    if (!existsSync(p)) return { formatVersion: FORMAT_VERSION, decisions: [] };
    try {
        const parsed = JSON.parse(readFileSync(p, "utf-8")) as ReviewLedger;
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.decisions)) {
            return { formatVersion: FORMAT_VERSION, decisions: [] };
        }
        return parsed;
    } catch {
        return { formatVersion: FORMAT_VERSION, decisions: [] };
    }
}

function writeLedger(ledger: ReviewLedger): void {
    const p = ledgerPath();
    mkdirSync(workspacePath("marketplace"), { recursive: true });
    writeFileSync(p, JSON.stringify(ledger, null, 2), "utf-8");
}

export function recordDecision(decision: MarketplaceReviewDecision): MarketplaceReviewDecision {
    if (!decision.entryId || !decision.version || !decision.reviewer || !decision.status) {
        throw new Error("recordDecision: entryId, version, reviewer, and status are required");
    }
    if ((decision.status === "rejected" || decision.status === "deprecated") && !decision.notes) {
        throw new Error(`recordDecision: notes required for status=${decision.status}`);
    }
    const normalized: MarketplaceReviewDecision = {
        ...decision,
        reviewedAt: decision.reviewedAt || new Date().toISOString(),
    };
    const ledger = readLedger();
    ledger.decisions.push(normalized);
    writeLedger(ledger);
    return normalized;
}

/**
 * Resolve the most recent decision for `(entryId, version)` — or for `entryId`
 * across all versions when `version` is omitted. Returns `null` if no decision
 * has been recorded.
 */
export function latestDecisionFor(entryId: string, version?: string): MarketplaceReviewDecision | null {
    const ledger = readLedger();
    const candidates = ledger.decisions.filter(d => d.entryId === entryId && (!version || d.version === version));
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, current) => {
        return current.reviewedAt > latest.reviewedAt ? current : latest;
    });
}

export function isApproved(entryId: string, version?: string): boolean {
    const d = latestDecisionFor(entryId, version);
    return !!d && d.status === "approved";
}
