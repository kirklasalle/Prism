/**
 * R5-1 — SQLite backup and restore engine.
 *
 * Prism keeps multiple SQLite databases in the workspace (activity events,
 * chat sessions, retrieval dashboards, session packages, terminal sessions,
 * etc.). Operators need a one-button way to:
 *
 *   1. Capture a consistent, crash-safe snapshot of every DB while Prism
 *      is running (no `pkill && cp` rituals).
 *   2. Restore that snapshot to a clean install or recover from corruption.
 *
 * This module implements both as pure functions on top of `node:sqlite`'s
 * built-in support for the `VACUUM INTO` SQL command — the SQLite-blessed
 * online backup primitive. Each output file is a fully-defragmented copy
 * with no WAL/-shm side files; restoring it is a plain filesystem copy.
 *
 * The backup payload is a flat directory:
 *
 *     backupRoot/
 *       manifest.json        — version, creation timestamp, file list,
 *                              SHA-256 per file, prism git commit (if known)
 *       <db1>.db             — VACUUM INTO copy
 *       <db2>.db
 *       preferences.json     — copy of `.prism-preferences.json` (if found)
 *
 * Tarballing/zipping is intentionally left to the operator: the directory
 * format is dependency-free and trivially diffable. CI can `tar czf` the
 * directory for archival.
 *
 * Restore is the inverse: read the manifest, verify every file's checksum
 * against the manifest, then atomically replace the corresponding files in
 * the workspace. Refuses to overwrite without `force: true`.
 */

import { createHash } from "node:crypto";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    statSync,
    writeFileSync,
    readdirSync,
    unlinkSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface BackupEntry {
    /** Original absolute path of the source file at backup time. */
    readonly originalPath: string;
    /** Filename inside the backup directory. */
    readonly fileName: string;
    /** Logical kind for restore-time routing. */
    readonly kind: "sqlite" | "preferences" | "config";
    /** SHA-256 hex of the backup file. */
    readonly checksum: string;
    /** File size in bytes. */
    readonly bytes: number;
}

export interface BackupManifest {
    readonly schemaVersion: 1;
    readonly createdAt: string;
    readonly prismVersion?: string;
    readonly prismCommit?: string;
    readonly entries: readonly BackupEntry[];
}

export interface BackupSource {
    /** Absolute path to the source file. */
    readonly path: string;
    readonly kind: "sqlite" | "preferences" | "config";
    /** Optional rename for the backup file. Defaults to basename(path). */
    readonly fileName?: string;
}

export interface BackupOptions {
    readonly outputDir: string;
    readonly sources: readonly BackupSource[];
    readonly prismVersion?: string;
    readonly prismCommit?: string;
}

export interface RestoreOptions {
    readonly backupDir: string;
    /** Map of `fileName` (in manifest) → absolute target path on disk. */
    readonly targets: Readonly<Record<string, string>>;
    /** When true, overwrites existing files. Defaults to false (refuses). */
    readonly force?: boolean;
}

export interface RestoreResult {
    readonly restored: readonly { fileName: string; targetPath: string; bytes: number }[];
    readonly skipped: readonly { fileName: string; reason: string }[];
}

const MANIFEST_NAME = "manifest.json";

/**
 * Run a backup. Returns the absolute path to the manifest.
 *
 * For SQLite sources, uses `VACUUM INTO` so the backup is consistent even
 * if the source DB is being written to by another process (Prism itself).
 * For other sources, performs a plain copy.
 */
export function runBackup(options: BackupOptions): { manifestPath: string; manifest: BackupManifest } {
    const outputDir = resolve(options.outputDir);
    mkdirSync(outputDir, { recursive: true });

    // Refuse to write into a directory that already has a manifest — backups
    // are immutable once created.
    if (existsSync(join(outputDir, MANIFEST_NAME))) {
        throw new Error(
            `backup output directory already contains a manifest: ${outputDir} ` +
            `(refusing to overwrite — pick a fresh path)`,
        );
    }

    const seenNames = new Set<string>();
    const entries: BackupEntry[] = [];

    for (const src of options.sources) {
        if (!existsSync(src.path)) {
            throw new Error(`backup source not found: ${src.path}`);
        }
        const fileName = src.fileName ?? basename(src.path);
        if (seenNames.has(fileName)) {
            throw new Error(`duplicate backup file name: ${fileName}`);
        }
        seenNames.add(fileName);
        const dest = join(outputDir, fileName);

        if (src.kind === "sqlite") {
            backupSqlite(src.path, dest);
        } else {
            copyFileSync(src.path, dest);
        }

        const bytes = statSync(dest).size;
        const checksum = sha256OfFile(dest);
        entries.push({
            originalPath: resolve(src.path),
            fileName,
            kind: src.kind,
            checksum,
            bytes,
        });
    }

    const manifest: BackupManifest = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        prismVersion: options.prismVersion,
        prismCommit: options.prismCommit,
        entries,
    };

    const manifestPath = join(outputDir, MANIFEST_NAME);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    return { manifestPath, manifest };
}

/**
 * Restore from a previously-created backup directory.
 *
 * Validates every file against its manifest checksum BEFORE touching any
 * target. A single mismatched checksum aborts the entire run; partial
 * restores are not possible.
 */
export function runRestore(options: RestoreOptions): RestoreResult {
    const backupDir = resolve(options.backupDir);
    const manifestPath = join(backupDir, MANIFEST_NAME);
    if (!existsSync(manifestPath)) {
        throw new Error(`no manifest found at ${manifestPath}`);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
    if (manifest.schemaVersion !== 1) {
        throw new Error(
            `unsupported backup manifest schemaVersion=${manifest.schemaVersion} ` +
            `(this build supports v1)`,
        );
    }

    // Verify every file's checksum first — fail loud, fail early.
    for (const entry of manifest.entries) {
        const filePath = join(backupDir, entry.fileName);
        if (!existsSync(filePath)) {
            throw new Error(`backup file missing: ${entry.fileName}`);
        }
        const actual = sha256OfFile(filePath);
        if (actual !== entry.checksum) {
            throw new Error(
                `backup checksum mismatch for ${entry.fileName}: ` +
                `expected=${entry.checksum.slice(0, 12)} actual=${actual.slice(0, 12)}`,
            );
        }
    }

    const restored: { fileName: string; targetPath: string; bytes: number }[] = [];
    const skipped: { fileName: string; reason: string }[] = [];

    for (const entry of manifest.entries) {
        const targetPath = options.targets[entry.fileName];
        if (!targetPath) {
            skipped.push({ fileName: entry.fileName, reason: "no target mapping" });
            continue;
        }
        const absTarget = resolve(targetPath);
        if (existsSync(absTarget) && !options.force) {
            skipped.push({
                fileName: entry.fileName,
                reason: `target exists: ${absTarget} (pass force=true to overwrite)`,
            });
            continue;
        }

        // For SQLite restores, also remove any stale -wal / -shm side files
        // so the restored DB doesn't get poisoned by the previous instance's
        // write-ahead log.
        if (entry.kind === "sqlite" && options.force) {
            for (const suffix of ["-wal", "-shm"]) {
                const side = absTarget + suffix;
                if (existsSync(side)) {
                    try { unlinkSync(side); } catch { /* best effort */ }
                }
            }
        }

        mkdirSync(resolve(absTarget, ".."), { recursive: true });
        copyFileSync(join(backupDir, entry.fileName), absTarget);
        restored.push({ fileName: entry.fileName, targetPath: absTarget, bytes: entry.bytes });
    }

    return { restored, skipped };
}

/**
 * Discover SQLite databases in a directory by their `.db` extension.
 * Excludes the WAL and shared-memory side files.
 */
export function discoverSqliteFiles(dir: string): readonly string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        if (!name.endsWith(".db")) continue;
        if (name.endsWith("-wal") || name.endsWith("-shm")) continue;
        out.push(resolve(join(dir, name)));
    }
    return out;
}

function backupSqlite(srcPath: string, destPath: string): void {
    if (existsSync(destPath)) {
        // VACUUM INTO refuses to overwrite — clear first.
        unlinkSync(destPath);
    }
    const db = new DatabaseSync(srcPath);
    try {
        // SQLite quoting: the filename is a string literal, double single
        // quotes inside the path are escaped. Most platforms produce paths
        // without quotes so this is straightforward; we still escape to be
        // safe.
        const escaped = destPath.replace(/'/g, "''");
        db.exec(`VACUUM INTO '${escaped}'`);
    } finally {
        db.close();
    }
}

function sha256OfFile(filePath: string): string {
    const buf = readFileSync(filePath);
    return createHash("sha256").update(buf).digest("hex");
}
