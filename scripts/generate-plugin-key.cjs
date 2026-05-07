#!/usr/bin/env node
/*
 * generate-plugin-key.cjs
 *
 * Produces a fresh Ed25519 keypair for signing PRISM plugin packs.
 *
 *   - Public key (DER/SPKI base64) → printed to stdout under `publicKeyBase64`.
 *     Operators copy this into `config/plugin-signing-keys.json`.
 *   - Private key (PEM PKCS#8) → written to the path passed as --out, or to
 *     stdout under `privateKeyPem` when --out is omitted.
 *
 * The private key MUST be stored in an operator-controlled secret manager
 * (HSM, cloud KMS, environment-encrypted vault). It is NEVER committed to
 * source control. See docs/SECURITY_KEY_MANAGEMENT.md for rotation SOP.
 *
 * Usage:
 *   node scripts/generate-plugin-key.cjs                 # print both keys
 *   node scripts/generate-plugin-key.cjs --out priv.pem  # write priv to file
 *   node scripts/generate-plugin-key.cjs --json          # JSON output
 */

"use strict";

const { generateKeyPairSync } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const argv = process.argv.slice(2);
function arg(name) {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    return argv[i + 1];
}
const wantJson = argv.includes("--json");
const outPath = arg("out");
const keyId = arg("keyId") ?? `prism-plugin-${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
const tier = arg("tier") ?? "official";
const label = arg("label") ?? "PRISM Plugin Signing Key";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

if (outPath) {
    const abs = resolve(process.cwd(), outPath);
    writeFileSync(abs, privateKeyPem, { encoding: "utf8", mode: 0o600 });
    console.error(`[generate-plugin-key] Private key written to ${abs} (mode 0600). KEEP SECRET.`);
}

const generatedAt = new Date().toISOString();
const registryEntry = {
    keyId,
    tier,
    label,
    algorithm: "ed25519",
    publicKeyBase64,
    addedAt: generatedAt,
    expiresAt: null,
};

if (wantJson) {
    process.stdout.write(
        JSON.stringify(
            { registryEntry, ...(outPath ? {} : { privateKeyPem }) },
            null,
            2,
        ) + "\n",
    );
} else {
    process.stdout.write(`# Add this entry to config/plugin-signing-keys.json under "keys":\n`);
    process.stdout.write(JSON.stringify(registryEntry, null, 4) + "\n");
    if (!outPath) {
        process.stdout.write(`\n# Private key (KEEP SECRET — store in your secret manager):\n`);
        process.stdout.write(privateKeyPem);
    }
}
