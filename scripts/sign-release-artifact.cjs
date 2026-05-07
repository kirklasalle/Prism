#!/usr/bin/env node
/*
 * Phase F-F — sign-release-artifact.cjs
 *
 * Signs a binary release artifact (or plugin pack) with a release-tier
 * Ed25519 private key. Emits sidecar files <artifact>.sig and
 * <artifact>.sig.json next to the input.
 *
 * Usage:
 *   node scripts/sign-release-artifact.cjs --artifact dist/prism-0.7.0.tar.gz \
 *        --private-key keys/release-2026.pem --keyId prism-release-2026
 *
 * The private key file must be PKCS#8 PEM (the format generate-plugin-key.cjs
 * emits). Generation:
 *   node scripts/generate-plugin-key.cjs --tier release --keyId prism-release-2026 \
 *        --out keys/release-2026.pem
 */

"use strict";

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createHash, createPrivateKey, sign } = require("node:crypto");

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    return process.argv[i + 1];
}

function fail(msg) { console.error(`[sign-release-artifact] ${msg}`); process.exit(2); }

const artifactPath = arg("artifact");
const privateKeyPath = arg("private-key");
const keyId = arg("keyId");
if (!artifactPath || !privateKeyPath || !keyId) {
    fail("usage: --artifact <path> --private-key <pem> --keyId <id>");
}

const artifactAbs = resolve(process.cwd(), artifactPath);
const keyAbs = resolve(process.cwd(), privateKeyPath);
const bytes = readFileSync(artifactAbs);
const pem = readFileSync(keyAbs, "utf-8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const key = createPrivateKey(pem);
const signature = sign(null, bytes, key);
const manifest = {
    keyId,
    algorithm: "ed25519",
    signedAt: new Date().toISOString(),
    sha256,
    artifact: artifactPath.split(/[\\/]/).pop(),
    formatVersion: 1,
};
const { writeFileSync } = require("node:fs");
writeFileSync(`${artifactAbs}.sig`, signature.toString("base64") + "\n", "utf-8");
writeFileSync(`${artifactAbs}.sig.json`, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
console.log(`[sign-release-artifact] signed ${artifactPath} with ${keyId} (sha256=${sha256.slice(0, 16)}...)`);
