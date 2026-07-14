#!/usr/bin/env node
"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function verifyDirectiveSignature(repoRoot, padContent, currentHash) {
    const signaturePath = path.join(repoRoot, "config", "permanent-active-directives.signature.json");
    const keysPath = path.join(repoRoot, "config", "governance-signing-keys.json");
    if (!fs.existsSync(signaturePath)) {
        return { valid: false, error: `Missing signature file: ${signaturePath}` };
    }
    if (!fs.existsSync(keysPath)) {
        return { valid: false, error: `Missing governance key registry: ${keysPath}` };
    }

    const signatureFile = JSON.parse(fs.readFileSync(signaturePath, "utf8"));
    const keySet = JSON.parse(fs.readFileSync(keysPath, "utf8"));
    const keys = Array.isArray(keySet.keys) ? keySet.keys : [];
    const key = keys.find((candidate) => candidate.keyId === signatureFile.keyId && candidate.algorithm === "ed25519");
    if (!key) {
        return { valid: false, error: `No active governance key for keyId=${signatureFile.keyId}` };
    }
    if (signatureFile.sha256 !== currentHash) {
        return { valid: false, error: "Signed hash does not match current directive hash." };
    }

    try {
        const publicKey = require("node:crypto").createPublicKey({
            key: Buffer.from(key.publicKeyBase64, "base64"),
            format: "der",
            type: "spki",
        });
        const ok = require("node:crypto").verify(
            null,
            Buffer.from(padContent, "utf8"),
            publicKey,
            Buffer.from(signatureFile.signatureBase64, "base64"),
        );
        if (!ok) {
            return { valid: false, error: "Signature cryptographic verification failed." };
        }
        return {
            valid: true,
            keyId: signatureFile.keyId,
            signaturePath,
            keysPath,
            signedAt: signatureFile.signedAt,
            expectedHash: signatureFile.sha256,
        };
    } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
}

function readText(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

function parseGeneratedHash(generatedSource) {
    const hashMatch = generatedSource.match(/DIRECTIVE_SHA256_GENERATED\s*=\s*"([a-f0-9]{64})"/i);
    const generatedAtMatch = generatedSource.match(/DIRECTIVE_HASH_GENERATED_AT\s*=\s*"([^"]+)"/i);
    return {
        hash: hashMatch ? hashMatch[1] : null,
        generatedAt: generatedAtMatch ? generatedAtMatch[1] : null,
    };
}

function sha256(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

function main() {
    const repoRoot = process.cwd();
    const outputDir = path.join(repoRoot, "prism-output", "security");
    const summaryPath = path.join(outputDir, "directive-integrity-gate-summary.json");

    const padPath = path.join(repoRoot, "Permanent_Active_Directives.txt");
    const generatedPath = path.join(repoRoot, "src", "core", "security", "directive-hash.generated.ts");

    const summary = {
        generatedAt: new Date().toISOString(),
        passed: false,
        checks: {
            padExists: fs.existsSync(padPath),
            generatedHashExists: fs.existsSync(generatedPath),
            hashMatches: false,
            signatureVerified: false,
        },
        details: {
            padPath,
            generatedPath,
            expectedHash: null,
            currentHash: null,
            directiveHashGeneratedAt: null,
            signaturePath: null,
            keysPath: null,
            keyId: null,
            signedAt: null,
            error: null,
        },
    };

    try {
        if (!summary.checks.padExists) {
            throw new Error(`Directive file missing: ${padPath}`);
        }
        if (!summary.checks.generatedHashExists) {
            throw new Error(`Generated directive hash file missing: ${generatedPath}`);
        }

        const padContent = readText(padPath);
        const generatedSource = readText(generatedPath);
        const parsed = parseGeneratedHash(generatedSource);
        if (!parsed.hash) {
            throw new Error("Could not parse DIRECTIVE_SHA256_GENERATED from directive-hash.generated.ts");
        }

        const currentHash = sha256(padContent);
        summary.details.currentHash = currentHash;
        summary.details.expectedHash = parsed.hash;
        summary.details.directiveHashGeneratedAt = parsed.generatedAt;
        summary.checks.hashMatches = currentHash === parsed.hash;
        const signatureCheck = verifyDirectiveSignature(repoRoot, padContent, currentHash);
        summary.checks.signatureVerified = signatureCheck.valid === true;
        summary.details.signaturePath = signatureCheck.signaturePath ?? null;
        summary.details.keysPath = signatureCheck.keysPath ?? null;
        summary.details.keyId = signatureCheck.keyId ?? null;
        summary.details.signedAt = signatureCheck.signedAt ?? null;

        if (!signatureCheck.valid) {
            throw new Error(signatureCheck.error || "Directive signature verification failed.");
        }

        summary.passed = summary.checks.hashMatches && summary.checks.signatureVerified;
    } catch (err) {
        summary.details.error = err instanceof Error ? err.message : String(err);
        summary.passed = false;
    }

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

    console.log(`[directive-integrity-gate] Summary written to ${summaryPath}`);
    if (!summary.passed) {
        if (summary.details.error) {
            console.error(`[directive-integrity-gate] FAILED: ${summary.details.error}`);
        } else {
            console.error("[directive-integrity-gate] FAILED: PAD hash does not match generated constant.");
            console.error(
                `[directive-integrity-gate] expected=${summary.details.expectedHash}, current=${summary.details.currentHash}`,
            );
        }
        process.exit(1);
    }

    console.log("[directive-integrity-gate] PASSED: PAD hash and signature verification succeeded.");
}

main();
