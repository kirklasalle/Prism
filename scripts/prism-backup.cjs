#!/usr/bin/env node
/**
 * R5 — Prism backup CLI.
 *
 * Captures a consistent snapshot of every Prism SQLite database plus the
 * `.prism-preferences.json` file into a single output directory.
 *
 * Usage:
 *   node scripts/prism-backup.cjs [--out <dir>] [--db <path>] [--db <path>] ...
 *
 * Defaults:
 *   --out  ./backups/prism-backup-<ISO timestamp>
 *
 * If no --db is passed, the CLI auto-discovers `*.db` files in the current
 * working directory (the repo root, which is where Prism's stores write by
 * default in development).
 */

"use strict";

const path = require("path");
const fs = require("fs");

async function main() {
    // Lazy import — runBackup needs the built artifact.
    let runBackup, discoverSqliteFiles;
    try {
        ({ runBackup, discoverSqliteFiles } = require("../dist/src/core/db/backup.js"));
    } catch (e) {
        console.error("[prism-backup] dist/src/core/db/backup.js not found.");
        console.error("[prism-backup] Run `npm run build` first.");
        process.exit(2);
    }

    const args = process.argv.slice(2);
    let outDir = null;
    const dbPaths = [];
    let prefsPath = null;
    let showHelp = false;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--out" || a === "-o") {
            outDir = args[++i];
        } else if (a === "--db") {
            dbPaths.push(args[++i]);
        } else if (a === "--prefs") {
            prefsPath = args[++i];
        } else if (a === "--help" || a === "-h") {
            showHelp = true;
        } else {
            console.error(`[prism-backup] unknown argument: ${a}`);
            process.exit(2);
        }
    }

    if (showHelp) {
        console.log("Usage: node scripts/prism-backup.cjs [--out <dir>] [--db <path>] ... [--prefs <path>]");
        console.log("");
        console.log("Captures a consistent snapshot of all Prism SQLite databases plus the");
        console.log("preferences file. Defaults: auto-discovers *.db in cwd; outputs to");
        console.log("./backups/prism-backup-<ISO timestamp>.");
        process.exit(0);
    }

    const cwd = process.cwd();
    if (dbPaths.length === 0) {
        const auto = discoverSqliteFiles(cwd);
        if (auto.length === 0) {
            console.error(`[prism-backup] no *.db files found in ${cwd}; pass --db <path> explicitly.`);
            process.exit(2);
        }
        for (const p of auto) dbPaths.push(p);
    }

    if (!prefsPath) {
        const candidate = path.join(cwd, ".prism-preferences.json");
        if (fs.existsSync(candidate)) prefsPath = candidate;
    }

    if (!outDir) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        outDir = path.join(cwd, "backups", `prism-backup-${stamp}`);
    }

    const sources = dbPaths.map((p) => ({ path: p, kind: "sqlite" }));
    if (prefsPath) {
        sources.push({ path: prefsPath, kind: "preferences" });
    }

    console.log(`[prism-backup] output: ${outDir}`);
    console.log(`[prism-backup] sources:`);
    for (const s of sources) console.log(`  - [${s.kind}] ${s.path}`);

    const pkg = readPackageJson();
    const result = runBackup({
        outputDir: outDir,
        sources,
        prismVersion: pkg.version,
    });

    console.log(`[prism-backup] done — ${result.manifest.entries.length} entries.`);
    console.log(`[prism-backup] manifest: ${result.manifestPath}`);
}

function readPackageJson() {
    try {
        return require(path.join(process.cwd(), "package.json"));
    } catch {
        return {};
    }
}

main().catch((err) => {
    console.error(`[prism-backup] FAILED: ${err && err.message ? err.message : err}`);
    process.exit(1);
});
