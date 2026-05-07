#!/usr/bin/env node
/**
 * R5 — Prism restore CLI.
 *
 * Restores a backup directory produced by `prism-backup.cjs` into the
 * current working directory.
 *
 * Usage:
 *   node scripts/prism-restore.cjs --from <backupDir> [--target-dir <dir>] [--force]
 *
 * Behaviour:
 *   - Validates every file's SHA-256 against the manifest BEFORE writing
 *     anything. A single mismatch aborts the run.
 *   - Refuses to overwrite an existing target unless --force is passed.
 *   - Each manifest entry is restored to <targetDir>/<entry.fileName>.
 *     The original absolute path stored in the manifest is informational
 *     only — operators routinely move workspaces between machines.
 */

"use strict";

const path = require("path");

async function main() {
    let runRestore;
    try {
        ({ runRestore } = require("../dist/src/core/db/backup.js"));
    } catch (e) {
        console.error("[prism-restore] dist/src/core/db/backup.js not found.");
        console.error("[prism-restore] Run `npm run build` first.");
        process.exit(2);
    }

    const args = process.argv.slice(2);
    let backupDir = null;
    let targetDir = process.cwd();
    let force = false;
    let showHelp = false;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--from" || a === "-f") {
            backupDir = args[++i];
        } else if (a === "--target-dir" || a === "-t") {
            targetDir = args[++i];
        } else if (a === "--force") {
            force = true;
        } else if (a === "--help" || a === "-h") {
            showHelp = true;
        } else {
            console.error(`[prism-restore] unknown argument: ${a}`);
            process.exit(2);
        }
    }

    if (showHelp || !backupDir) {
        console.log("Usage: node scripts/prism-restore.cjs --from <backupDir> [--target-dir <dir>] [--force]");
        console.log("");
        console.log("Restores a backup directory produced by prism-backup.cjs.");
        console.log("Default target directory is cwd. Pass --force to overwrite existing files.");
        process.exit(showHelp ? 0 : 2);
    }

    const fs = require("fs");
    const manifestPath = path.join(backupDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        console.error(`[prism-restore] no manifest found at ${manifestPath}`);
        process.exit(2);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const targets = {};
    for (const entry of manifest.entries) {
        targets[entry.fileName] = path.join(targetDir, entry.fileName);
    }

    console.log(`[prism-restore] from:   ${path.resolve(backupDir)}`);
    console.log(`[prism-restore] target: ${path.resolve(targetDir)}`);
    console.log(`[prism-restore] force:  ${force}`);

    const result = runRestore({ backupDir, targets, force });

    console.log(`[prism-restore] restored ${result.restored.length}, skipped ${result.skipped.length}`);
    for (const r of result.restored) {
        console.log(`  + ${r.fileName} → ${r.targetPath} (${r.bytes} bytes)`);
    }
    for (const s of result.skipped) {
        console.log(`  - ${s.fileName}: ${s.reason}`);
    }
    if (result.skipped.length > 0 && !force) {
        console.log("[prism-restore] note: some entries were skipped. Re-run with --force to overwrite.");
    }
}

main().catch((err) => {
    console.error(`[prism-restore] FAILED: ${err && err.message ? err.message : err}`);
    process.exit(1);
});
