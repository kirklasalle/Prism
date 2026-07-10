#!/usr/bin/env node
/**
 * scripts/prism-update.cjs
 *
 * Core Update Orchestrator with Supply-Chain Security Gates.
 * Handles: Pre-flight → Shutdown → Backup → Git Pull → Security Gates →
 * npm install → Config Migration → Build → Post-build Verification → Restart.
 */

"use strict";

const { execSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");

const repoRoot = path.resolve(__dirname, "..");
const backupsDir = path.join(repoRoot, "backups");
const envPath = path.join(repoRoot, ".env");
const prefsPath = path.join(repoRoot, ".prism-preferences.json");

// Process command-line args
const args = process.argv.slice(2);
const forceBranch = args.includes("--force-branch");
const fromGuardian = args.includes("--from-guardian");

// Load current configuration
let dashboardPort = 7070;
try {
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf8");
        const match = envContent.match(/^PRISM_DASHBOARD_PORT\s*=\s*(\d+)/m);
        if (match) {
            dashboardPort = parseInt(match[1], 10);
        }
    }
} catch (_) {}

function log(phase, msg, details) {
    const status = "succeeded";
    logToActivityBus(`update.${phase}`, status, details || msg);
}

function errorLog(phase, msg, details) {
    const status = "failed";
    logToActivityBus(`update.${phase}`, status, details || msg);
    console.error(`[PRISM][update][${phase}] ✗ ERROR: ${msg}`);
}

function logToActivityBus(operation, status, details) {
    const detailStr = typeof details === "string" ? details : JSON.stringify(details);
    console.log(`[PRISM][update][${operation}] ${status.toUpperCase()}: ${detailStr}`);
    try {
        const dbPath = path.join(repoRoot, "prism-activity.db");
        // Create database entry if it exists (using SQLite DatabaseSync)
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(dbPath);

        // Ensure table exists
        db.exec(`
            CREATE TABLE IF NOT EXISTS activity_events (
                id            TEXT PRIMARY KEY,
                timestamp     TEXT NOT NULL,
                session_id    TEXT NOT NULL,
                layer         TEXT NOT NULL,
                operation     TEXT NOT NULL,
                status        TEXT NOT NULL,
                details       TEXT
            )
        `);

        const insertStmt = db.prepare(`
            INSERT INTO activity_events (id, timestamp, session_id, layer, operation, status, details)
            VALUES (:id, :timestamp, :sessionId, :layer, :operation, :status, :details)
        `);

        insertStmt.run({
            id: "evt-" + crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            sessionId: "update-lifecycle",
            layer: "system",
            operation: operation,
            status: status === "failed" ? "failed" : "succeeded",
            details: JSON.stringify({ detail: detailStr, fromGuardian }),
        });
        db.close();
    } catch (e) {
        console.warn(`[PRISM][update] Direct activity logging bypassed: ${e.message}`);
    }
}

function runCmd(cmd, options = {}) {
    try {
        return execSync(cmd, { cwd: repoRoot, encoding: "utf8", stdio: options.silent ? "pipe" : "inherit" }).trim();
    } catch (e) {
        if (options.allowFail) return null;
        throw e;
    }
}

function isPortActive(port) {
    try {
        if (process.platform === "win32") {
            const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8", stdio: "pipe" });
            return out.includes("LISTENING") || out.trim().length > 0;
        } else {
            execSync(`lsof -t -i:${port} || fuser ${port}/tcp`, { stdio: "pipe" });
            return true;
        }
    } catch (_) {
        return false;
    }
}

async function shutdownServer(port) {
    if (!isPortActive(port)) {
        console.log(`[PRISM][update] Port ${port} is not active. No server shutdown needed.`);
        return true;
    }

    console.log(`[PRISM][update] Attempting graceful shutdown on port ${port}...`);
    log("shutdown", "Initiated graceful shutdown request");

    try {
        await new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: "localhost",
                    port: port,
                    path: "/api/system/shutdown",
                    method: "POST",
                    timeout: 5000,
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => (data += chunk));
                    res.on("end", () => {
                        if (res.statusCode === 200) resolve();
                        else reject(new Error(`Server returned status code ${res.statusCode}`));
                    });
                },
            );
            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("Shutdown request timed out"));
            });
            req.end();
        });

        // Wait for port to clear
        for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            if (!isPortActive(port)) {
                log("shutdown", "Server stopped gracefully");
                return true;
            }
        }
    } catch (e) {
        console.log(`[PRISM][update] Graceful shutdown failed/timed out: ${e.message}`);
    }

    // Force Kill fallback
    console.log(`[PRISM][update] Falling back to force-killing process on port ${port}...`);
    try {
        // Try stopping PM2 first
        runCmd("npx pm2 stop prism", { silent: true, allowFail: true });

        if (isPortActive(port)) {
            if (process.platform === "win32") {
                const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8", stdio: "pipe" });
                const lines = out.split("\n");
                for (const line of lines) {
                    if (line.includes("LISTENING") || line.includes("ESTABLISHED")) {
                        const parts = line.trim().split(/\s+/);
                        const pid = parts[parts.length - 1];
                        if (pid && pid !== "0" && !isNaN(pid)) {
                            execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
                        }
                    }
                }
            } else {
                runCmd(`fuser -k ${port}/tcp || kill -9 $(lsof -t -i:${port})`, { silent: true, allowFail: true });
            }
        }

        // Final check
        await new Promise((r) => setTimeout(r, 2000));
        if (!isPortActive(port)) {
            log("shutdown", "Server terminated forcefully");
            return true;
        } else {
            errorLog("shutdown", "Failed to release server port after forced termination");
            return false;
        }
    } catch (e) {
        errorLog("shutdown", `Port force kill failure: ${e.message}`);
        return false;
    }
}

function cleanOldBackups() {
    if (!fs.existsSync(backupsDir)) return;
    try {
        const folders = fs
            .readdirSync(backupsDir)
            .filter((f) => f.startsWith("pre-update-"))
            .map((f) => ({ name: f, stat: fs.statSync(path.join(backupsDir, f)) }))
            .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs); // newest first

        if (folders.length > 5) {
            const toDelete = folders.slice(5);
            for (const f of toDelete) {
                const dirPath = path.join(backupsDir, f.name);
                fs.rmSync(dirPath, { recursive: true, force: true });
                console.log(`[PRISM][update] Pruned old backup folder: ${f.name}`);
            }
        }
    } catch (e) {
        console.warn(`[PRISM][update] Warning pruning old backups: ${e.message}`);
    }
}

function createBackup(stamp) {
    const dest = path.join(backupsDir, `pre-update-${stamp}`);
    fs.mkdirSync(dest, { recursive: true });

    log("backup", `Starting critical backup to backups/pre-update-${stamp}`);

    const filesToBackup = [
        { path: envPath, name: ".env" },
        { path: prefsPath, name: ".prism-preferences.json" },
        { path: path.join(repoRoot, "config", "plugin-signing-keys.json"), name: "config/plugin-signing-keys.json" },
        { path: path.join(repoRoot, "config", "release-signing-keys.json"), name: "config/release-signing-keys.json" },
    ];

    // Auto-discover *.db in root
    const rootFiles = fs.readdirSync(repoRoot);
    for (const f of rootFiles) {
        if (f.endsWith(".db")) {
            filesToBackup.push({ path: path.join(repoRoot, f), name: f });
        }
    }

    // State folder
    const stateDir = path.join(repoRoot, "state");
    if (fs.existsSync(stateDir)) {
        filesToBackup.push({ path: stateDir, name: "state", isDir: true });
    }

    const backupManifest = {
        timestamp: new Date().toISOString(),
        prismVersion: "unknown",
        commit: runCmd("git rev-parse HEAD", { silent: true, allowFail: true }) || "unknown",
        files: [],
    };

    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        backupManifest.prismVersion = pkg.version || "unknown";
    } catch (_) {}

    for (const item of filesToBackup) {
        if (!fs.existsSync(item.path)) continue;
        const itemDest = path.join(dest, item.name);
        fs.mkdirSync(path.dirname(itemDest), { recursive: true });

        if (item.isDir) {
            fs.cpSync(item.path, itemDest, { recursive: true });
            backupManifest.files.push({ name: item.name, type: "directory" });
        } else {
            // Avoid locking errors on SQLite DB-WAL files, retry on fail
            let copied = false;
            for (let retry = 0; retry < 3; retry++) {
                try {
                    fs.copyFileSync(item.path, itemDest);
                    copied = true;
                    break;
                } catch (e) {
                    if (retry === 2) throw e;
                    console.log(`[PRISM][update] File ${item.name} locked, retrying copy...`);
                    execSync('node -e "setTimeout(() => {}, 1000)"'); // delay
                }
            }
            if (copied) {
                const content = fs.readFileSync(itemDest);
                const hash = crypto.createHash("sha256").update(content).digest("hex");
                backupManifest.files.push({ name: item.name, type: "file", sha256: hash });
            }
        }
    }

    fs.writeFileSync(path.join(dest, "backup-manifest.json"), JSON.stringify(backupManifest, null, 2) + "\n", "utf8");
    log("backup", `Backup complete. Total entries: ${backupManifest.files.length}`);
    cleanOldBackups();
    return dest;
}

function restoreFromBackup(backupPath) {
    console.log(`[PRISM][update] 🔄 ROLLBACK INITIATED: Restoring from ${backupPath}...`);
    logToActivityBus("rollback.initiated", "succeeded", { backupPath });

    const manifestPath = path.join(backupPath, "backup-manifest.json");
    if (!fs.existsSync(manifestPath)) {
        errorLog("rollback", `No backup manifest found at ${manifestPath}. Cannot rollback cleanly.`);
        return false;
    }

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

        // Revert git files
        runCmd("git checkout .", { allowFail: true });
        if (manifest.commit && manifest.commit !== "unknown") {
            runCmd(`git reset --hard ${manifest.commit}`, { allowFail: true });
        }

        // Restore backed up files
        for (const item of manifest.files) {
            const source = path.join(backupPath, item.name);
            const target = path.join(repoRoot, item.name);
            if (!fs.existsSync(source)) continue;

            fs.mkdirSync(path.dirname(target), { recursive: true });
            if (item.type === "directory") {
                fs.rmSync(target, { recursive: true, force: true });
                fs.cpSync(source, target, { recursive: true });
            } else {
                fs.copyFileSync(source, target);
                // Clear any SQLite wal/shm side files for restored DBs
                if (item.name.endsWith(".db")) {
                    for (const suffix of ["-wal", "-shm"]) {
                        const side = target + suffix;
                        if (fs.existsSync(side)) {
                            try {
                                fs.unlinkSync(side);
                            } catch (_) {}
                        }
                    }
                }
            }
        }

        logToActivityBus("rollback.completed", "succeeded", `Restored state to commit ${manifest.commit}`);
        console.log("[PRISM][update] Rollback completed successfully.");
        return true;
    } catch (e) {
        errorLog("rollback", `Failed to complete rollback: ${e.message}`);
        return false;
    }
}

async function main() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let backupPath = null;
    let originalCommit = null;

    try {
        // Phase 1: Pre-flight checks
        console.log("=== PRISM UPDATE PIPELINE STARTING ===");
        log("started", "Starting Prism update pipeline");

        // Branch check
        const currentBranch = runCmd("git rev-parse --abbrev-ref HEAD", { silent: true });
        if (currentBranch !== "main" && !forceBranch) {
            throw new Error(
                `Update aborted: Currently on branch '${currentBranch}'. Prism must be updated on branch 'main'.`,
            );
        }

        // Stability Check (Pre-update doctor)
        console.log("[PRISM][update] Running pre-update stability check...");
        log("stability_check", "Running pre-update doctor checklist");
        try {
            runCmd("node scripts/prism-doctor.cjs");
        } catch (_) {
            throw new Error("Pre-update doctor checks failed. Resolve issues before updating.");
        }

        originalCommit = runCmd("git rev-parse HEAD", { silent: true });

        // Phase 2: Shutdown server
        const portCleared = await shutdownServer(dashboardPort);
        if (!portCleared) {
            throw new Error(`Failed to shutdown running server on port ${dashboardPort}. Update aborted.`);
        }

        // Phase 3: Backup
        backupPath = createBackup(stamp);

        // Phase 4: Git pull
        console.log("[PRISM][update] Fetching updates from main branch...");
        log("git_pull", "Running git pull --ff-only origin main");
        try {
            if (forceBranch) {
                runCmd(`git pull --ff-only origin ${currentBranch}`);
            } else {
                runCmd("git pull --ff-only origin main");
            }
        } catch (e) {
            throw new Error(`Git pull failed: ${e.message}. Ensuring local commits are not diverted.`);
        }

        // Phase 4b: Security Gates
        console.log("[PRISM][update] Running supply-chain security gates...");

        // Gate 1: PAD integrity & GPG/SSH Signature check
        const padDiff = runCmd(`git diff --name-only ${originalCommit} HEAD`, { silent: true });
        if (padDiff.includes("Permanent_Active_Directives.txt")) {
            log("security.pad_changed", "Permanent_Active_Directives.txt was modified in update");
            console.log("[PRISM][update] PAD modification detected. Performing strict governance signature check...");
            try {
                runCmd("node scripts/verify-governance-signature.cjs --strict");
                log("security.pad_verified", "PAD signature successfully verified by Governance Council key");
            } catch (_) {
                throw new Error(
                    "Governance signature verification failed for modified PAD file. Update aborted due to security violation.",
                );
            }
        }

        // Gate 2: Governance files modification check
        const govFiles = ["AGENTIC_SACRED_COVENANT.md", "AGENTIC_PRIME_DIRECTIVE.md", "GOVERNANCE_COUNCIL_CHARTER.md"];
        const modifiedGov = govFiles.filter((file) => padDiff.includes(file));
        if (modifiedGov.length > 0) {
            log("security.governance_modified", `Governance files modified: ${modifiedGov.join(", ")}`);
        }

        // Gate 4: Self-modification check
        if (padDiff.includes("scripts/prism-update.cjs") || padDiff.includes("scripts/prism-update-config.cjs")) {
            log("security.update_script_modified", "Update scripts were modified. Proceeding with caution.");
            console.warn("[PRISM][update] ⚠ Warning: Update scripts themselves were modified by this pull.");
        }

        // Phase 5: Dependencies
        console.log("[PRISM][update] Installing dependencies with SOTA ignore-scripts safety...");
        log("dependencies", "Installing node modules via npm install --ignore-scripts");
        runCmd("npm install --ignore-scripts");

        // Rebuild known safe native modules
        try {
            console.log("[PRISM][update] Performing safe native rebuild of sqlite3...");
            runCmd("npm rebuild sqlite3");
        } catch (e) {
            console.warn(`[PRISM][update] Native rebuild warning: ${e.message}`);
        }

        // Gate 3: npm audit
        console.log("[PRISM][update] Performing dependency security audit...");
        try {
            runCmd("npm audit --omit=dev --audit-level=high", { silent: true });
        } catch (e) {
            log("security.dependency_vulnerability", "npm audit detected high/critical vulnerabilities");
            console.warn("[PRISM][update] ⚠ Dependency vulnerabilities found. Review packages manually.");
        }

        // Phase 6: Config Migration
        console.log("[PRISM][update] Merging local configurations...");
        log("config_migrated", "Running configuration migrator scripts/prism-update-config.cjs");
        runCmd("node scripts/prism-update-config.cjs");

        // Phase 7: Build
        console.log("[PRISM][update] Compiling codebase and copying static assets...");
        runCmd("npm run build");

        // Gate 5: Post-build PAD re-verification
        log("security.pad_verified", "Verifying post-build PAD hash integrity");
        try {
            runCmd("node scripts/prism-doctor.cjs");
        } catch (_) {
            throw new Error(
                "Post-build doctor validation failed (PAD hash verification or configuration integrity mismatch).",
            );
        }

        log(
            "completed",
            `Prism update completed successfully. System advanced to commit ${runCmd("git rev-parse HEAD", { silent: true }).slice(0, 8)}`,
        );

        // Phase 10: Restart server
        console.log("[PRISM][update] Restarting Prism gateway/server...");
        // Check if PM2 was configured and start it
        let started = false;
        try {
            const list = execSync("npx pm2 list", { encoding: "utf8", stdio: "pipe" });
            if (list.includes("prism")) {
                runCmd("npx pm2 start prism");
                started = true;
            }
        } catch (_) {}

        if (!started) {
            // Spawn normal start command detached
            console.log("[PRISM][update] Starting Prism server via background dev server...");
            const child = spawn("npm", ["run", "dev"], {
                cwd: repoRoot,
                detached: true,
                stdio: "ignore",
                env: { ...process.env, PRISM_MODE: "server" },
            });
            child.unref();
        }

        console.log("=== PRISM UPDATE PIPELINE COMPLETED SUCCESSFULLY ===");
        process.exit(0);
    } catch (e) {
        errorLog("failed", e.message);
        console.error(`\n[PRISM][update] Update Failed: ${e.message}`);

        if (backupPath) {
            const restored = restoreFromBackup(backupPath);
            if (restored) {
                console.log("[PRISM][update] State rolled back successfully. Server not restarted.");
            } else {
                console.error("[PRISM][update] ❌ CRITICAL: Rollback failed. System may be in an inconsistent state.");
            }
        }
        process.exit(1);
    }
}

main();
