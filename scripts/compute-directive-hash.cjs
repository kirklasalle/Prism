#!/usr/bin/env node
/*
 * compute-directive-hash.cjs
 *
 * Computes the SHA-256 of `Permanent_Active_Directives.txt` and writes it to
 * `src/core/security/directive-hash.generated.ts`. Wired into `npm run prebuild`
 * so the constant cannot drift from the on-disk PAD content without producing
 * an untracked diff that the developer must commit.
 *
 * Per Law 10 of the PAD, changes to the directive file MUST go through code
 * review (git + CI). This script does NOT bypass that — it merely automates
 * keeping the embedded hash truthful, so the runtime check
 * (verifyDirectiveIntegrity) and the CI Gate 9 check both keep working when
 * the directive content is intentionally amended via PR.
 */

"use strict";

const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("node:fs");
const { join, dirname, resolve } = require("node:path");

const repoRoot = resolve(__dirname, "..");
const padPath = join(repoRoot, "Permanent_Active_Directives.txt");
const generatedDir = join(repoRoot, "src", "core", "security");
const generatedPath = join(generatedDir, "directive-hash.generated.ts");

if (!existsSync(padPath)) {
    console.error(`[prebuild:hash-pad] FATAL: ${padPath} does not exist.`);
    process.exit(1);
}

const padContent = readFileSync(padPath, "utf8");
const hash = createHash("sha256").update(padContent, "utf8").digest("hex");
const verifiedAt = new Date().toISOString();

const banner = [
    "/* eslint-disable */",
    "/**",
    " * AUTO-GENERATED — DO NOT EDIT BY HAND.",
    " *",
    " * Produced by `scripts/compute-directive-hash.cjs` (run via `npm run prebuild`).",
    " * Mirrors the SHA-256 of `Permanent_Active_Directives.txt` so the runtime",
    " * directive-integrity check (Law 10 enforcement) cannot drift silently from",
    " * the on-disk PAD content.",
    " *",
    ` * Source file:  Permanent_Active_Directives.txt`,
    ` * Hashed bytes: ${Buffer.byteLength(padContent, "utf8")}`,
    ` * Generated at: ${verifiedAt}`,
    " */",
    "",
].join("\n");

const body = [
    `export const DIRECTIVE_SHA256_GENERATED = "${hash}";`,
    `export const DIRECTIVE_HASH_GENERATED_AT = "${verifiedAt}";`,
    `export const DIRECTIVE_HASH_SOURCE_BYTES = ${Buffer.byteLength(padContent, "utf8")};`,
    "",
].join("\n");

mkdirSync(dirname(generatedPath), { recursive: true });

let previous = "";
if (existsSync(generatedPath)) {
    previous = readFileSync(generatedPath, "utf8");
}
const next = banner + body;

if (previous !== next) {
    writeFileSync(generatedPath, next, "utf8");
    console.log(`[prebuild:hash-pad] Wrote ${generatedPath} (sha256=${hash.slice(0, 16)}…)`);
} else {
    console.log(`[prebuild:hash-pad] ${generatedPath} already current (sha256=${hash.slice(0, 16)}…)`);
}

if (process.argv.includes("--print")) {
    process.stdout.write(`${hash}\n`);
}
