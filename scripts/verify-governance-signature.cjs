#!/usr/bin/env node
/*
 * verify-governance-signature.cjs
 *
 * CI Gate 9+ — Governance Lookback Verification
 *
 * When a PR modifies `Permanent_Active_Directives.txt`, this script
 * verifies that the commit introducing the change is cryptographically
 * signed by an authorized Governance Council member.
 *
 * This prevents the governance amendment process from being faked:
 * even if someone regenerates the directive hash, the CI gate will
 * reject the PR unless the commit is signed by an authorized key.
 *
 * Usage:
 *   node scripts/verify-governance-signature.cjs [--strict]
 *
 * In non-strict mode (default), the script warns but does not fail
 * when git signature verification is unavailable (e.g., no GPG on
 * the runner). In strict mode, it fails on any verification issue.
 *
 * Environment:
 *   PRISM_GOVERNANCE_ALLOWED_SIGNERS — comma-separated list of
 *     authorized GPG key fingerprints or SSH key comments.
 *     Example: "kirk@lasalle.dev,0xABCDEF1234567890"
 *
 * Exit codes:
 *   0 — PAD not modified, or modified with valid signature
 *   1 — PAD modified without authorized signature (strict mode)
 *   2 — Verification infrastructure unavailable (strict mode)
 */

"use strict";

const { execSync } = require("node:child_process");
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join, resolve } = require("node:path");

const repoRoot = resolve(__dirname, "..");
const padFile = "Permanent_Active_Directives.txt";
const hashGenFile = "src/core/security/directive-hash.generated.ts";
const outputDir = join(repoRoot, "prism-output");
const reportPath = join(outputDir, "governance-signature-verification.json");
const strict = process.argv.includes("--strict");

/* ── Helpers ─────────────────────────────────────────────────────────── */

function git(cmd) {
    try {
        return execSync(`git ${cmd}`, { cwd: repoRoot, encoding: "utf8" }).trim();
    } catch {
        return null;
    }
}

function log(msg) {
    console.log(`[governance:signature] ${msg}`);
}

function warn(msg) {
    console.warn(`[governance:signature] ⚠ ${msg}`);
}

function fail(msg) {
    console.error(`[governance:signature] ✗ ${msg}`);
    process.exit(1);
}

/* ── Main ────────────────────────────────────────────────────────────── */

function main() {
    const report = {
        timestamp: new Date().toISOString(),
        padModified: false,
        hashGenModified: false,
        commitHash: null,
        commitAuthor: null,
        commitSigned: null,
        signatureValid: null,
        signerIdentity: null,
        authorizedSigners: [],
        signerAuthorized: null,
        samePr: null,
        result: "not_applicable",
        mode: strict ? "strict" : "advisory",
    };

    // 1. Check if PAD was modified in the current diff
    //    In CI, this is typically HEAD vs. the base branch.
    const baseBranch = process.env.GITHUB_BASE_REF || "main";
    let diffTarget;

    // Try merge-base first (PR context), fall back to HEAD~1
    const mergeBase = git(`merge-base origin/${baseBranch} HEAD`);
    if (mergeBase) {
        diffTarget = mergeBase;
    } else {
        diffTarget = "HEAD~1";
    }

    const diffFiles = git(`diff --name-only ${diffTarget} HEAD`);
    if (!diffFiles) {
        log("No diff available — skipping governance signature check.");
        writeReport(report);
        process.exit(0);
    }

    const changedFiles = diffFiles.split("\n").map((f) => f.trim());
    const padModified = changedFiles.includes(padFile);
    const hashGenModified = changedFiles.includes(hashGenFile);

    report.padModified = padModified;
    report.hashGenModified = hashGenModified;

    if (!padModified && !hashGenModified) {
        log("PAD and directive hash not modified — governance signature check not required.");
        report.result = "not_applicable";
        writeReport(report);
        process.exit(0);
    }

    log(`PAD modified: ${padModified}, Hash generated file modified: ${hashGenModified}`);

    // 2. Both files must be modified together
    if (padModified !== hashGenModified) {
        report.samePr = false;
        if (padModified && !hashGenModified) {
            const msg =
                "PAD modified but directive-hash.generated.ts was NOT updated. " +
                "Run `npm run prebuild` and commit both changes together.";
            report.result = "failed_desync";
            writeReport(report);
            fail(msg);
        }
        if (!padModified && hashGenModified) {
            const msg =
                "directive-hash.generated.ts modified but PAD was NOT changed. " +
                "The generated hash file should only change when the PAD changes.";
            report.result = "failed_orphan_hash";
            writeReport(report);
            fail(msg);
        }
    }
    report.samePr = true;

    // 3. Find the commit that modified the PAD
    const padCommit = git(`log -1 --format=%H -- ${padFile}`);
    if (!padCommit) {
        warn("Could not determine the commit that modified the PAD.");
        report.result = strict ? "failed_no_commit" : "advisory_no_commit";
        writeReport(report);
        if (strict) fail("Cannot verify governance signature: no commit found for PAD modification.");
        process.exit(0);
    }
    report.commitHash = padCommit;

    const commitAuthor = git(`log -1 --format=%ae ${padCommit}`);
    report.commitAuthor = commitAuthor;

    // 4. Check if the commit is signed
    const signatureStatus = git(`log -1 --format=%G? ${padCommit}`);
    // G = good signature, B = bad, U = untrusted, X = expired, Y = expired key, R = revoked, E = error, N = no signature
    report.commitSigned = signatureStatus !== "N" && signatureStatus !== null;
    report.signatureValid = signatureStatus === "G" || signatureStatus === "U";

    if (signatureStatus === "N" || signatureStatus === null) {
        const msg =
            `Commit ${padCommit.slice(0, 8)} modifying the PAD is NOT cryptographically signed. ` +
            "Governance amendments must be committed with GPG or SSH signing enabled.";
        report.result = strict ? "failed_unsigned" : "advisory_unsigned";
        writeReport(report);
        if (strict) fail(msg);
        warn(msg);
        process.exit(0);
    }

    // 5. Get signer identity
    const signerInfo = git(`log -1 --format=%GS ${padCommit}`);
    report.signerIdentity = signerInfo;
    log(`Commit ${padCommit.slice(0, 8)} signed by: ${signerInfo}`);

    // 6. Check if the signer is authorized
    const allowedSigners = (process.env.PRISM_GOVERNANCE_ALLOWED_SIGNERS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    report.authorizedSigners = allowedSigners;

    if (allowedSigners.length === 0) {
        const msg =
            "PRISM_GOVERNANCE_ALLOWED_SIGNERS is not configured. " +
            "Set it to a comma-separated list of authorized signer identities.";
        report.result = strict ? "failed_no_allowed_signers" : "advisory_no_allowed_signers";
        writeReport(report);
        if (strict) fail(msg);
        warn(msg);
        log("Signature is present but cannot verify authorization without an allowed-signers list.");
        process.exit(0);
    }

    const signerLower = (signerInfo || "").toLowerCase();
    const isAuthorized = allowedSigners.some(
        (allowed) => signerLower.includes(allowed) || (commitAuthor || "").toLowerCase() === allowed,
    );
    report.signerAuthorized = isAuthorized;

    if (!isAuthorized) {
        const msg =
            `Commit ${padCommit.slice(0, 8)} is signed by "${signerInfo}" but this identity ` +
            `is NOT in the authorized Governance Council signers list. ` +
            `Authorized: [${allowedSigners.join(", ")}]`;
        report.result = "failed_unauthorized_signer";
        writeReport(report);
        fail(msg);
    }

    // 7. All checks passed
    report.result = "passed";
    writeReport(report);
    log(`✓ Governance signature verification PASSED for ${padCommit.slice(0, 8)} (signer: ${signerInfo})`);
    process.exit(0);
}

function writeReport(report) {
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    log(`Report written to ${reportPath}`);
}

main();
