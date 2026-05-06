#!/usr/bin/env node
/*
 * Phase F-F — verify-release-artifact.cjs
 *
 * Verifies an artifact + sidecar pair against a release signing key
 * registry. Default registry path: config/release-signing-keys.json.
 *
 * Usage:
 *   node scripts/verify-release-artifact.cjs --artifact dist/prism-0.7.0.tar.gz
 *   node scripts/verify-release-artifact.cjs --artifact dist/prism-0.7.0.tar.gz \
 *        --registry config/release-signing-keys.json
 *
 * Exit codes:
 *   0 — signature valid
 *   1 — signature invalid / digest mismatch / key revoked or missing
 *   2 — invocation error (missing inputs)
 */

"use strict";

const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createHash, createPublicKey, verify } = require("node:crypto");

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    return process.argv[i + 1];
}

function fail(msg, code) { console.error(`[verify-release-artifact] ${msg}`); process.exit(code ?? 2); }

const artifactPath = arg("artifact");
const registryPath = arg("registry") || "config/release-signing-keys.json";
if (!artifactPath) fail("usage: --artifact <path> [--registry <json>]");

const artifactAbs = resolve(process.cwd(), artifactPath);
const sigPath = `${artifactAbs}.sig`;
const manifestPath = `${artifactAbs}.sig.json`;
if (!existsSync(sigPath) || !existsSync(manifestPath)) {
    fail(`missing sidecar(s): ${sigPath} / ${manifestPath}`, 2);
}

const registryAbs = resolve(process.cwd(), registryPath);
if (!existsSync(registryAbs)) fail(`registry not found: ${registryAbs}`, 2);
const registry = JSON.parse(readFileSync(registryAbs, "utf-8"));
if (!registry || !Array.isArray(registry.keys)) fail("malformed registry", 2);

const artifactBytes = readFileSync(artifactAbs);
const signature = Buffer.from(readFileSync(sigPath, "utf-8").trim(), "base64");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

const expectedDigest = createHash("sha256").update(artifactBytes).digest("hex");
if (expectedDigest !== manifest.sha256) fail(`digest mismatch (expected ${manifest.sha256}, got ${expectedDigest})`, 1);

const entry = registry.keys.find((k) => k.keyId === manifest.keyId);
if (!entry) fail(`keyId not found in registry: ${manifest.keyId}`, 1);
if (entry.revokedAt) fail(`keyId revoked: ${manifest.keyId} (${entry.revokedAt})`, 1);

const der = Buffer.from(entry.publicKeyBase64, "base64");
const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
const ok = verify(null, artifactBytes, publicKey, signature);
if (!ok) fail("signature verification failed", 1);

console.log(`[verify-release-artifact] OK — ${manifest.keyId} signed ${manifest.artifact} at ${manifest.signedAt}`);
process.exit(0);
