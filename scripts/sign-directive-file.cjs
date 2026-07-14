#!/usr/bin/env node
"use strict";

const { createHash, createPrivateKey, createPublicKey, sign } = require("node:crypto");
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("node:fs");
const { resolve, join, dirname } = require("node:path");

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    return process.argv[i + 1];
}

function fail(msg) {
    console.error(`[sign-directive-file] ${msg}`);
    process.exit(2);
}

const workspaceRoot = resolve(process.cwd());
const directivePath = resolve(workspaceRoot, arg("directive") || "Permanent_Active_Directives.txt");
const privateKeyPath = resolve(workspaceRoot, arg("private-key") || "tmp/governance-pad-signing.pem");
const keyId = arg("keyId") || "prism-governance-pad-2026-07";
const outPath = resolve(workspaceRoot, arg("out") || "config/permanent-active-directives.signature.json");
const keysPath = resolve(workspaceRoot, arg("keys") || "config/governance-signing-keys.json");

if (!existsSync(directivePath)) {
    fail(`Directive file not found: ${directivePath}`);
}
if (!existsSync(privateKeyPath)) {
    fail(`Private key not found: ${privateKeyPath}`);
}

const directive = readFileSync(directivePath, "utf8");
const sha256 = createHash("sha256").update(directive, "utf8").digest("hex");
const key = createPrivateKey(readFileSync(privateKeyPath, "utf8"));
const signature = sign(null, Buffer.from(directive, "utf8"), key).toString("base64");

const manifest = {
    keyId,
    algorithm: "ed25519",
    signedAt: new Date().toISOString(),
    file: "Permanent_Active_Directives.txt",
    sha256,
    signatureBase64: signature,
    formatVersion: 1,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

// Also ensure public key is present in governance key registry.
const publicKeyBase64 = createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");
let keySet = { version: 1, keys: [] };
if (existsSync(keysPath)) {
    keySet = JSON.parse(readFileSync(keysPath, "utf8"));
}
if (!Array.isArray(keySet.keys)) {
    keySet.keys = [];
}
const existing = keySet.keys.find((k) => k.keyId === keyId);
if (!existing) {
    keySet.keys.push({
        keyId,
        algorithm: "ed25519",
        label: "PRISM Governance PAD Signing Key",
        publicKeyBase64,
        addedAt: new Date().toISOString(),
        expiresAt: null,
    });
} else {
    existing.publicKeyBase64 = publicKeyBase64;
    existing.algorithm = "ed25519";
    if (!existing.addedAt) {
        existing.addedAt = new Date().toISOString();
    }
    if (typeof existing.expiresAt === "undefined") {
        existing.expiresAt = null;
    }
}
mkdirSync(dirname(keysPath), { recursive: true });
writeFileSync(keysPath, JSON.stringify(keySet, null, 2) + "\n", "utf8");

console.log(`[sign-directive-file] Signed ${directivePath}`);
console.log(`[sign-directive-file] Signature written to ${outPath}`);
console.log(`[sign-directive-file] Governance key registry updated at ${keysPath}`);
