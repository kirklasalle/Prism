/**
 * SR Memory Store (Phase C)
 *
 * Rolling JSON store of recent SR generations. Used by `sr-recommender.ts` to
 * propose hemisphere configurations based on historical utility/cost/success.
 *
 * Storage: `{workspace}/state/sr-memory.json`. Cap: 500 most recent records.
 * No external deps — atomic write via tmp file rename.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { workspacePath } from "../config/workspace-resolver.js";

export interface SRGenerationRecord {
    /** ISO 8601 timestamp. */
    ts: string;
    /** Caller-supplied role/scenario tag (e.g., "code-review", "research"). */
    role?: string;
    /** Snapshot of the hemispheres used (id/providerId/model/profileId/role). */
    hemispheres: Array<{
        id: string;
        providerId: string;
        model: string;
        profileId?: string;
        role: string;
    }>;
    /** Estimated total cost in USD (from estimateSRCost). */
    estimatedCostUsd: number;
    /** Wall time of fan-out + aggregation. */
    totalMs: number;
    /** Number of hemispheres that produced output (vs timed out / circuit-broken). */
    succeededHemispheres: number;
    /** Total hemispheres attempted. */
    totalHemispheres: number;
    /** User-provided utility score (0..1). Optional. Set via /sr/feedback. */
    observedUtility?: number;
    /** Free-form user note. */
    note?: string;
}

const MAX_RECORDS = 500;

let _path: string | null = null;
function storePath(): string {
    if (_path) return _path;
    _path = workspacePath("state", "sr-memory.json");
    return _path;
}

/** Override the storage path (test hook). */
export function _setSrMemoryPathForTest(p: string | null): void {
    _path = p;
}

function readAll(): SRGenerationRecord[] {
    const p = storePath();
    if (!existsSync(p)) return [];
    try {
        const raw = readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as SRGenerationRecord[];
    } catch {
        return [];
    }
}

function writeAll(records: SRGenerationRecord[]): void {
    const p = storePath();
    mkdirSync(dirname(p), { recursive: true });
    const tmp = p + ".tmp";
    writeFileSync(tmp, JSON.stringify(records, null, 2), "utf-8");
    renameSync(tmp, p);
}

/** Append a record. Trims to MAX_RECORDS keeping most recent. */
export function recordSRGeneration(record: SRGenerationRecord): void {
    const all = readAll();
    all.push(record);
    if (all.length > MAX_RECORDS) all.splice(0, all.length - MAX_RECORDS);
    writeAll(all);
}

/** Read recent records, optionally filtered by role. Newest-last. */
export function listSRRecords(opts: { role?: string; limit?: number } = {}): SRGenerationRecord[] {
    const all = readAll();
    const filtered = opts.role ? all.filter(r => r.role === opts.role) : all;
    if (opts.limit && opts.limit > 0 && filtered.length > opts.limit) {
        return filtered.slice(filtered.length - opts.limit);
    }
    return filtered;
}

/** Update a record's observed utility by approximate timestamp match (idempotent on repeat). */
export function attachUtilityFeedback(ts: string, observedUtility: number, note?: string): boolean {
    const all = readAll();
    const idx = all.findIndex(r => r.ts === ts);
    if (idx < 0) return false;
    all[idx]!.observedUtility = Math.max(0, Math.min(1, observedUtility));
    if (note !== undefined) all[idx]!.note = note;
    writeAll(all);
    return true;
}

/** Aggregate stats. */
export function srMemoryStats(): {
    total: number;
    withFeedback: number;
    avgUtility: number | null;
    avgCostUsd: number | null;
    avgTotalMs: number | null;
    roles: string[];
} {
    const all = readAll();
    const total = all.length;
    const fb = all.filter(r => typeof r.observedUtility === "number");
    const withFeedback = fb.length;
    const avgUtility = fb.length === 0 ? null : fb.reduce((s, r) => s + (r.observedUtility ?? 0), 0) / fb.length;
    const avgCostUsd = total === 0 ? null : all.reduce((s, r) => s + r.estimatedCostUsd, 0) / total;
    const avgTotalMs = total === 0 ? null : all.reduce((s, r) => s + r.totalMs, 0) / total;
    const roleSet = new Set<string>();
    for (const r of all) if (r.role) roleSet.add(r.role);
    return { total, withFeedback, avgUtility, avgCostUsd, avgTotalMs, roles: Array.from(roleSet).sort() };
}

/** Clear all records (admin/test). */
export function clearSRMemory(): void {
    writeAll([]);
}

// Re-export workspacePath join for advanced callers that want a bespoke path.
export { join as _join };
