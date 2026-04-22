/**
 * Workspace Integrity Fingerprint (WIF)
 *
 * Computes a deterministic SHA-256 hash tree over every file in a workspace
 * directory. Two workspaces with identical file contents, paths, and sizes
 * always produce the same fingerprint — regardless of filesystem metadata
 * (timestamps, permissions, ordering).
 *
 * Use cases:
 *   - Pre/post-import integrity verification
 *   - Tamper detection between sessions
 *   - Workspace snapshot comparison (diffFingerprints)
 *   - CI gating: workspace must match known-good fingerprint
 *
 * The hash tree is computed bottom-up: each file's hash includes its
 * workspace-relative path and content. The root hash is the SHA-256 of
 * the sorted concatenation of all file hashes.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, posix } from "node:path";

/* ── Types ───────────────────────────────────────────────────────────── */

export interface FileFingerprint {
    /** Workspace-relative path (posix separators) */
    path: string;
    /** SHA-256 hex digest of path + content */
    hash: string;
    /** File size in bytes */
    size: number;
}

export interface WorkspaceFingerprint {
    /** Root SHA-256 of the sorted hash tree */
    hash: string;
    /** Number of files included */
    fileCount: number;
    /** Total size of all files in bytes */
    totalSize: number;
    /** Individual file hashes sorted by path */
    tree: FileFingerprint[];
    /** ISO 8601 timestamp of computation */
    computedAt: string;
}

export interface FingerprintDiff {
    /** Files added (present in `after` but not `before`) */
    added: string[];
    /** Files removed (present in `before` but not `after`) */
    removed: string[];
    /** Files with changed content */
    modified: string[];
    /** True if fingerprints are identical */
    identical: boolean;
}

/* ── Core ────────────────────────────────────────────────────────────── */

/**
 * Recursively collect all files under `dir`, returning workspace-relative
 * paths with posix separators.
 */
function walkDir(dir: string, root: string, ignore: Set<string>): string[] {
    const results: string[] = [];
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return results;
    }
    for (const entry of entries) {
        if (ignore.has(entry)) continue;
        const full = join(dir, entry);
        let stat;
        try {
            stat = statSync(full);
        } catch {
            continue;
        }
        if (stat.isDirectory()) {
            results.push(...walkDir(full, root, ignore));
        } else if (stat.isFile()) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Compute a SHA-256 fingerprint for a single file.
 * Hash input: `<relative-posix-path>\0<file-bytes>`
 */
function hashFile(fullPath: string, root: string): FileFingerprint {
    const relPath = relative(root, fullPath).split("\\").join("/");
    const content = readFileSync(fullPath);
    const hash = createHash("sha256")
        .update(relPath)
        .update("\0")
        .update(content)
        .digest("hex");
    return { path: relPath, hash, size: content.length };
}

/**
 * Compute the Workspace Integrity Fingerprint for a directory.
 *
 * @param root - Absolute path to the workspace root
 * @param ignore - Set of directory/file names to skip (default: common noise)
 */
export function computeWorkspaceFingerprint(
    root: string,
    ignore = new Set([".git", "node_modules", ".venv", "__pycache__", ".DS_Store", "Thumbs.db"]),
): WorkspaceFingerprint {
    const files = walkDir(root, root, ignore);
    const tree: FileFingerprint[] = files
        .map((f) => hashFile(f, root))
        .sort((a, b) => a.path.localeCompare(b.path));

    const rootHashInput = tree.map((f) => f.hash).join("");
    const hash = createHash("sha256").update(rootHashInput).digest("hex");

    return {
        hash,
        fileCount: tree.length,
        totalSize: tree.reduce((sum, f) => sum + f.size, 0),
        tree,
        computedAt: new Date().toISOString(),
    };
}

/**
 * Diff two fingerprints to detect added, removed, and modified files.
 */
export function diffFingerprints(
    before: WorkspaceFingerprint,
    after: WorkspaceFingerprint,
): FingerprintDiff {
    const beforeMap = new Map(before.tree.map((f) => [f.path, f.hash]));
    const afterMap = new Map(after.tree.map((f) => [f.path, f.hash]));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    for (const [path, hash] of afterMap) {
        if (!beforeMap.has(path)) {
            added.push(path);
        } else if (beforeMap.get(path) !== hash) {
            modified.push(path);
        }
    }
    for (const path of beforeMap.keys()) {
        if (!afterMap.has(path)) {
            removed.push(path);
        }
    }

    return {
        added: added.sort(),
        removed: removed.sort(),
        modified: modified.sort(),
        identical: added.length === 0 && removed.length === 0 && modified.length === 0,
    };
}
