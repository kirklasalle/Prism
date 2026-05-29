#!/usr/bin/env node
"use strict";
const { readFileSync } = require("node:fs");
const path = require("node:path");

function isBase64(s) {
    try {
        const buf = Buffer.from(s, 'base64');
        return buf.length > 0 && buf.toString('base64') === s.replace(/\r|\n/g, '');
    } catch (e) {
        return false;
    }
}

const cfgPath = path.resolve(__dirname, '..', 'config', 'plugin-signing-keys.json');
const raw = readFileSync(cfgPath, 'utf8');
const cfg = JSON.parse(raw);

if (!Array.isArray(cfg.keys) || cfg.keys.length === 0) {
    console.error('[validate-plugin-keys] No keys found in', cfgPath);
    process.exit(2);
}

for (const k of cfg.keys) {
    if (k.algorithm !== 'ed25519') {
        console.error('[validate-plugin-keys] Unsupported algorithm for key', k.keyId, k.algorithm);
        process.exit(3);
    }
    if (!k.publicKeyBase64 || !isBase64(k.publicKeyBase64)) {
        console.error('[validate-plugin-keys] Invalid publicKeyBase64 for key', k.keyId);
        process.exit(4);
    }
}

console.log('[validate-plugin-keys] OK — all keys appear well-formed');
process.exit(0);
