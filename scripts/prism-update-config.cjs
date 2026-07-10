#!/usr/bin/env node
/**
 * scripts/prism-update-config.cjs
 *
 * Config Migrator for Prism Update System.
 * Appends missing keys from `.env.example` to `.env` and merges defaults
 * into `.prism-preferences.json` without modifying existing operator configs.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const envPath = path.join(repoRoot, ".env");
const envExamplePath = path.join(repoRoot, ".env.example");
const prefsPath = path.join(repoRoot, ".prism-preferences.json");

function log(msg) {
    console.log(`[PRISM][update-config] ${msg}`);
}

function warn(msg) {
    console.warn(`[PRISM][update-config] ⚠ ${msg}`);
}

function parseEnv(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, "utf8");
    const result = {};
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index > 0) {
            const key = trimmed.slice(0, index).trim();
            const val = trimmed.slice(index + 1).trim();
            result[key] = val;
        }
    }
    return result;
}

function migrateEnv(version) {
    log("Starting .env migration...");
    if (!fs.existsSync(envExamplePath)) {
        warn(".env.example not found. Skipping .env migration.");
        return [];
    }

    const currentEnv = parseEnv(envPath);
    const exampleEnv = parseEnv(envExamplePath);
    const addedKeys = [];

    let appendContent = "";
    const exampleLines = fs.readFileSync(envExamplePath, "utf8").split(/\r?\n/);
    const currentKeys = new Set(Object.keys(currentEnv));

    // Scan .env.example line-by-line to preserve comments structure for any new keys we add
    let pendingComments = [];
    for (const line of exampleLines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || !trimmed) {
            pendingComments.push(line);
            continue;
        }

        const index = trimmed.indexOf("=");
        if (index > 0) {
            const key = trimmed.slice(0, index).trim();
            if (!currentKeys.has(key)) {
                // Key is missing in current .env
                if (appendContent === "") {
                    appendContent += `\n# ──────────────────────────────────────────────────────────────────────────────\n`;
                    appendContent += `# Added by Prism Update v${version} on ${new Date().toISOString()}\n`;
                    appendContent += `# ──────────────────────────────────────────────────────────────────────────────\n`;
                }

                if (pendingComments.length > 0) {
                    appendContent += pendingComments.join("\n") + "\n";
                }
                appendContent += `${line}\n`;
                addedKeys.push(key);
                log(`Added missing configuration key: ${key}`);
            }
            pendingComments = []; // Clear comments once key is processed
        }
    }

    if (appendContent !== "") {
        fs.appendFileSync(envPath, appendContent, "utf8");
        log(`.env migration completed. Added ${addedKeys.length} new keys.`);
    } else {
        log(".env is already up to date. No keys added.");
    }

    return addedKeys;
}

function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
            if (!target[key] || typeof target[key] !== "object") {
                target[key] = {};
            }
            deepMerge(target[key], source[key]);
        } else {
            if (target[key] === undefined) {
                target[key] = source[key];
            }
        }
    }
}

function migratePreferences() {
    log("Starting .prism-preferences.json migration...");
    const defaults = {
        autoUpdate: false,
        guardianConfig: {
            modelAlias: "guardian",
            modelPath: "",
            authorityTier: "tier2_conditional",
            healthCheckIntervalMs: 30000,
            autoStart: true,
            contextSize: 4096,
            flashAttn: true,
        },
        powerMode: "adaptive",
        uiMode: "advanced",
    };

    let currentPrefs = {};
    if (fs.existsSync(prefsPath)) {
        try {
            currentPrefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
        } catch (e) {
            warn(`Failed to parse existing preferences: ${e.message}. Initializing clean preferences.`);
        }
    }

    deepMerge(currentPrefs, defaults);
    currentPrefs.lastModified = new Date().toISOString();

    fs.writeFileSync(prefsPath, JSON.stringify(currentPrefs, null, 2) + "\n", "utf8");
    log(".prism-preferences.json migration completed successfully.");
}

function main() {
    let version = "unknown";
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        version = pkg.version || "unknown";
    } catch (_) {}

    const envAddedKeys = migrateEnv(version);
    migratePreferences();

    // If run directly, print result json for orchestrator to consume
    if (require.main === module) {
        console.log(JSON.stringify({ success: true, envAddedKeys }));
    }
}

main();
