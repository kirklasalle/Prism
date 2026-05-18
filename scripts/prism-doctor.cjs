#!/usr/bin/env node
/*
 * prism-doctor.cjs — operator readiness probe (additive, v0.21).
 *
 * Single, focused operator-facing CLI that runs production-readiness
 * checks before a Prism deployment goes live. It is intentionally
 * dependency-free (only Node built-ins + an optional HTTP probe) so
 * an operator can run it directly out of the unpacked tarball.
 *
 * Usage:
 *   node scripts/prism-doctor.cjs            # full local checks
 *   node scripts/prism-doctor.cjs --json     # machine-readable output
 *   node scripts/prism-doctor.cjs --probe-http http://localhost:7777
 *
 * Exit codes:
 *   0  all checks passed
 *   1  one or more checks failed
 *   2  bad invocation
 *
 * Frontend Protection Guarantee: read-only — never modifies workspace
 * data, never starts services, never alters config files.
 */

"use strict";

const { createHash } = require("node:crypto");
const { readFileSync, statSync, existsSync, accessSync, constants, readdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
const http = require("node:http");
const https = require("node:https");

const repoRoot = resolve(__dirname, "..");
const args = process.argv.slice(2);
const outputJson = args.includes("--json");
const probeIdx = args.indexOf("--probe-http");
const probeUrl = probeIdx >= 0 ? args[probeIdx + 1] : null;

/** Each check pushes onto `results`; final exit code = any { ok:false }. */
const results = [];
function record(name, ok, detail, advisory) {
    results.push({ name, ok: !!ok, detail: String(detail || ""), advisory: advisory || null });
}

// ── Check 1: PAD integrity ─────────────────────────────────────────
function checkPad() {
    const padPath = join(repoRoot, "Permanent_Active_Directives.txt");
    if (!existsSync(padPath)) {
        record("PAD file present", false, `Missing: ${padPath}`,
            "The Permanent_Active_Directives.txt file is required at the repo root.");
        return;
    }
    const content = readFileSync(padPath, "utf8");
    const onDisk = createHash("sha256").update(content, "utf8").digest("hex");

    const generatedPath = join(repoRoot, "src", "core", "security", "directive-hash.generated.ts");
    if (!existsSync(generatedPath)) {
        record("PAD hash generated", false, `Missing: ${generatedPath}`,
            "Run `npm run prebuild:hash-pad` to regenerate the embedded hash.");
        return;
    }
    const gen = readFileSync(generatedPath, "utf8");
    const m = /DIRECTIVE_SHA256_GENERATED\s*=\s*"([0-9a-f]{64})"/i.exec(gen);
    if (!m) {
        record("PAD hash format", false, "Could not parse DIRECTIVE_SHA256_GENERATED",
            "Re-run `npm run prebuild:hash-pad`.");
        return;
    }
    const embedded = m[1];
    if (embedded !== onDisk) {
        record("PAD hash matches PAD file", false,
            `On-disk=${onDisk.slice(0, 16)}… embedded=${embedded.slice(0, 16)}…`,
            "PAD content drifted from embedded hash. Run `npm run prebuild:hash-pad` and commit.");
        return;
    }
    record("PAD hash matches PAD file", true, `sha256=${onDisk.slice(0, 16)}…`);
}

// ── Check 2: production secrets ───────────────────────────────────
function checkSecrets() {
    const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production";
    const jwt = process.env.PRISM_JWT_SECRET || "";
    const authDisabled = (process.env.PRISM_AUTH_DISABLED || "").toLowerCase() === "true";
    if (!isProd) {
        record("Production secrets", true, "NODE_ENV != production — secret length not enforced",
            "Set NODE_ENV=production and provide PRISM_JWT_SECRET (>=32 chars) before deploying.");
        return;
    }
    if (jwt.length < 32) {
        record("Production secrets", false, `PRISM_JWT_SECRET length=${jwt.length}`,
            "PRISM_JWT_SECRET must be at least 32 chars in production. Generate via `openssl rand -hex 32`.");
        return;
    }
    if (authDisabled) {
        record("Production secrets", false, "PRISM_AUTH_DISABLED=true in production",
            "Auth must be enabled in production. Unset PRISM_AUTH_DISABLED.");
        return;
    }
    record("Production secrets", true, `JWT length=${jwt.length}, auth enforced`);
}

// ── Check 3: plugin signing keys not placeholder ──────────────────
function checkPluginSigningKeys() {
    const path = join(repoRoot, "config", "plugin-signing-keys.json");
    if (!existsSync(path)) {
        record("Plugin signing keys file", false, `Missing: ${path}`,
            "Create config/plugin-signing-keys.json (or run `npm run keys:generate-plugin`).");
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
        record("Plugin signing keys file", false, `Invalid JSON: ${e.message}`,
            "Fix syntax errors in config/plugin-signing-keys.json.");
        return;
    }
    const json = JSON.stringify(parsed);
    const placeholders = ["PLACEHOLDER", "REPLACE_ME", "CHANGE_ME", "TEST_KEY", "EXAMPLE"];
    const hit = placeholders.find((p) => json.toUpperCase().includes(p));
    if (hit) {
        record("Plugin signing keys not placeholder", false, `Detected placeholder marker: ${hit}`,
            "Replace placeholder values with real keys before allowing signed-plugin enforcement.");
        return;
    }
    record("Plugin signing keys not placeholder", true, "No placeholder markers detected");
}

// ── Check 4: workspace dirs writable ──────────────────────────────
function checkWorkspaceWritable() {
    const candidates = [
        process.env.PRISM_WORKSPACE_DIR,
        join(repoRoot, "prism-output"),
        join(repoRoot, "tmp"),
    ].filter(Boolean);
    for (const dir of candidates) {
        if (!existsSync(dir)) continue;
        try {
            accessSync(dir, constants.W_OK);
            record(`Workspace writable: ${dir}`, true, "OK");
        } catch (e) {
            record(`Workspace writable: ${dir}`, false, e.message,
                `Grant write permission to ${dir} or set PRISM_WORKSPACE_DIR to a writable path.`);
        }
    }
    if (results.filter((r) => r.name.startsWith("Workspace writable")).length === 0) {
        record("Workspace writable", true, "No workspace dir present yet — will be created on first run");
    }
}

// ── Check 5: SQLite DB integrity (best-effort, file-level) ─────────
function checkSqliteFiles() {
    const checked = [];
    for (const dir of [repoRoot, join(repoRoot, "prism-output")]) {
        if (!existsSync(dir)) continue;
        let entries;
        try { entries = readdirSync(dir); } catch { continue; }
        for (const name of entries) {
            if (!/\.(db|sqlite|sqlite3)$/i.test(name)) continue;
            const full = join(dir, name);
            try {
                const st = statSync(full);
                if (!st.isFile()) continue;
                // SQLite files start with the magic header "SQLite format 3\0".
                const fd = require("node:fs").openSync(full, "r");
                const buf = Buffer.alloc(16);
                require("node:fs").readSync(fd, buf, 0, 16, 0);
                require("node:fs").closeSync(fd);
                const ok = buf.toString("utf8", 0, 15) === "SQLite format 3";
                if (ok) {
                    checked.push(name);
                    record(`SQLite header ok: ${name}`, true, `${st.size} bytes`);
                } else {
                    record(`SQLite header ok: ${name}`, false, "Header magic mismatch",
                        `${full} is not a valid SQLite database — restore from backup.`);
                }
            } catch (e) {
                record(`SQLite header ok: ${name}`, false, e.message,
                    `Could not read ${full}.`);
            }
        }
    }
    if (checked.length === 0) {
        record("SQLite files present", true, "None found — fresh install or test profile");
    }
}

// ── Check 6: optional HTTP probe of /api/health ───────────────────
function probeHttp(url) {
    return new Promise((resolveP) => {
        const lib = url.startsWith("https:") ? https : http;
        const req = lib.get(url + (url.endsWith("/") ? "" : "/") + "api/health", { timeout: 4000 }, (res) => {
            let body = "";
            res.on("data", (chunk) => body += chunk);
            res.on("end", () => {
                if (res.statusCode === 200 || res.statusCode === 503) {
                    let parsed;
                    try { parsed = JSON.parse(body); } catch { parsed = { status: "unparseable" }; }
                    record(`HTTP probe ${url}`, res.statusCode === 200,
                        `status=${parsed.status} version=${parsed.version} code=${res.statusCode}`,
                        res.statusCode === 503 ? "Server reports degraded — investigate /api/health output." : null);
                } else {
                    record(`HTTP probe ${url}`, false, `Unexpected status ${res.statusCode}`,
                        "Check that the dashboard is running and reachable.");
                }
                resolveP();
            });
        });
        req.on("error", (e) => {
            record(`HTTP probe ${url}`, false, e.message,
                "Dashboard not reachable. Start with `npm start` or `start_web.bat`.");
            resolveP();
        });
        req.on("timeout", () => {
            req.destroy(new Error("timeout"));
        });
    });
}

// ── Runner ─────────────────────────────────────────────────────────
async function main() {
    checkPad();
    checkSecrets();
    checkPluginSigningKeys();
    checkWorkspaceWritable();
    checkSqliteFiles();
    if (probeUrl) await probeHttp(probeUrl);

    const failed = results.filter((r) => !r.ok);
    if (outputJson) {
        process.stdout.write(JSON.stringify({
            ok: failed.length === 0,
            checkCount: results.length,
            failedCount: failed.length,
            results,
        }, null, 2) + "\n");
    } else {
        const W = 60;
        const pad = (s) => s.length > W ? s.slice(0, W - 1) + "…" : s.padEnd(W, " ");
        process.stdout.write("\nPRISM Doctor — operator readiness probe\n");
        process.stdout.write("=".repeat(70) + "\n");
        for (const r of results) {
            const mark = r.ok ? "✓" : "✗";
            process.stdout.write(`  ${mark}  ${pad(r.name)}  ${r.detail}\n`);
            if (!r.ok && r.advisory) {
                process.stdout.write(`       advisory: ${r.advisory}\n`);
            }
        }
        process.stdout.write("=".repeat(70) + "\n");
        process.stdout.write(`Checks: ${results.length}   Passed: ${results.length - failed.length}   Failed: ${failed.length}\n`);
        if (failed.length > 0) {
            process.stdout.write("\nDoctor reports issues. Address advisories above before deploying.\n");
        } else {
            process.stdout.write("\nAll checks passed. Operator readiness probe is green.\n");
        }
    }
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
    process.stderr.write(`prism-doctor fatal: ${e && e.stack ? e.stack : e}\n`);
    process.exit(2);
});
