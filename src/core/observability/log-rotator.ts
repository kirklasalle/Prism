/**
 * R5-3 — Log rotation utility.
 *
 * Pure-Node rotator for PRISM log files. Operates on a single log directory
 * (default: workspace logs dir) and:
 *
 *   1. **Rotates** an active log file (e.g. `prism.log`) to a dated archive
 *      (`prism-YYYYMMDD.log`) when the calendar day boundary is crossed.
 *   2. **Prunes** dated archives older than the retention window
 *      (default 30 days; override via `PRISM_LOG_RETENTION_DAYS`).
 *
 * No external dependency. Designed to be invoked once at process start
 * and then on a daily timer (the wiring is the caller's responsibility —
 * this module exposes pure functions so unit tests can drive them with
 * an injected clock).
 */

import {
    existsSync,
    mkdirSync,
    readdirSync,
    renameSync,
    statSync,
    unlinkSync,
} from "node:fs";
import { join, parse } from "node:path";

/** Default retention window when `PRISM_LOG_RETENTION_DAYS` is unset/invalid. */
export const DEFAULT_LOG_RETENTION_DAYS = 30;

/** Filename pattern for dated archives: `<base>-YYYYMMDD<ext>`. */
const ARCHIVE_RE = /^(?<base>.+)-(?<date>\d{8})(?<ext>\.[A-Za-z0-9]+)$/;

export interface RotateOptions {
    /** Directory containing the active log + dated archives. */
    logDir: string;
    /** Active log filename, e.g. `"prism.log"`. */
    activeFile: string;
    /** "Today" — supplied so tests can drive a fake clock. */
    now: Date;
}

export interface RotateResult {
    /** Path of the archive produced this call (or `null` if no rotation). */
    archived: string | null;
    /** `true` if the archive name already existed before rotation (no-op). */
    skipped: boolean;
}

/** Format a `Date` as `YYYYMMDD` in UTC. */
export function dateStamp(d: Date): string {
    const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = d.getUTCDate().toString().padStart(2, "0");
    return `${yyyy}${mm}${dd}`;
}

/**
 * Rotate `<logDir>/<activeFile>` to `<logDir>/<base>-<YYYYMMDD><ext>` if and
 * only if the active file's mtime is on a strictly earlier UTC day than
 * `now`. Idempotent: if the archive name already exists, returns
 * `{archived: <path>, skipped: true}` without touching the active file.
 */
export function rotateActiveLog(opts: RotateOptions): RotateResult {
    const { logDir, activeFile, now } = opts;
    const activePath = join(logDir, activeFile);
    if (!existsSync(activePath)) {
        return { archived: null, skipped: false };
    }
    const mtime = statSync(activePath).mtime;
    const mtimeStamp = dateStamp(mtime);
    const todayStamp = dateStamp(now);
    if (mtimeStamp >= todayStamp) {
        // active file is from today (or future) — nothing to rotate.
        return { archived: null, skipped: false };
    }
    const parsed = parse(activeFile);
    const archiveName = `${parsed.name}-${mtimeStamp}${parsed.ext}`;
    const archivePath = join(logDir, archiveName);
    if (existsSync(archivePath)) {
        return { archived: archivePath, skipped: true };
    }
    renameSync(activePath, archivePath);
    return { archived: archivePath, skipped: false };
}

export interface PruneOptions {
    /** Directory to scan for dated archives. */
    logDir: string;
    /** Active log basename (e.g. `"prism.log"`) — never pruned. */
    activeFile: string;
    /** Retention window in days. */
    retentionDays: number;
    /** "Today" — supplied so tests can drive a fake clock. */
    now: Date;
}

export interface PruneResult {
    /** Archive paths that were deleted. */
    deleted: string[];
}

/**
 * Delete dated archives in `logDir` whose embedded `YYYYMMDD` is strictly
 * older than `now - retentionDays`. Active file is left untouched. Files
 * that don't match the archive pattern are ignored.
 */
export function pruneOldArchives(opts: PruneOptions): PruneResult {
    const { logDir, activeFile, retentionDays, now } = opts;
    if (!existsSync(logDir)) return { deleted: [] };
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    const cutoffStamp = dateStamp(cutoff);

    const deleted: string[] = [];
    const activeBase = parse(activeFile).name;
    for (const entry of readdirSync(logDir)) {
        if (entry === activeFile) continue;
        const m = ARCHIVE_RE.exec(entry);
        if (!m || !m.groups) continue;
        if (m.groups.base !== activeBase) continue;
        if (m.groups.date < cutoffStamp) {
            const full = join(logDir, entry);
            try {
                unlinkSync(full);
                deleted.push(full);
            } catch {
                // best-effort — pruning failures should never crash the host.
            }
        }
    }
    return { deleted };
}

/** Resolve `PRISM_LOG_RETENTION_DAYS` with sane fallback + clamping (1..365). */
export function resolveRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.PRISM_LOG_RETENTION_DAYS;
    const n = raw == null ? NaN : Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_LOG_RETENTION_DAYS;
    if (n > 365) return 365;
    return n;
}

/** Combined rotate + prune helper. */
export function rotateAndPrune(opts: {
    logDir: string;
    activeFile: string;
    retentionDays?: number;
    now?: Date;
}): { rotate: RotateResult; prune: PruneResult } {
    const now = opts.now ?? new Date();
    const retentionDays = opts.retentionDays ?? resolveRetentionDays();
    if (!existsSync(opts.logDir)) {
        mkdirSync(opts.logDir, { recursive: true });
    }
    const rotate = rotateActiveLog({ logDir: opts.logDir, activeFile: opts.activeFile, now });
    const prune = pruneOldArchives({ logDir: opts.logDir, activeFile: opts.activeFile, retentionDays, now });
    return { rotate, prune };
}
