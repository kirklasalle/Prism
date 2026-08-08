#!/usr/bin/env node
/* global __dirname, Buffer, console, process */
"use strict";

const { createHash, createPublicKey, verify } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const rotation = JSON.parse(
    readFileSync(join(root, "config", "governance-key-rotations", "R-2026-001.json"), "utf8"),
);
const registry = JSON.parse(readFileSync(join(root, "config", "governance-signing-keys.json"), "utf8"));
const errors = [];

if (rotation.format !== "prism-governance-key-rotation" || rotation.formatVersion !== 1) {
    errors.push("Rotation record format is invalid.");
}
if (rotation.status !== "effective_pending_release_commit" && rotation.status !== "effective") {
    errors.push("Rotation record is not in an applied state.");
}
const previous = registry.keys.find((key) => key.keyId === rotation.payload.previousKeyId);
const successor = registry.keys.find((key) => key.keyId === rotation.payload.successorKeyId);
if (!previous?.revokedAt) errors.push("Previous governance key is not revoked for new signatures.");
if (!successor || successor.rotationId !== rotation.payload.rotationId) {
    errors.push("Successor governance key is not bound to the rotation record.");
}
if (successor?.publicKeyBase64 !== rotation.successorPublicKeyBase64) {
    errors.push("Successor public key differs between registry and rotation record.");
}
const publicDer = Buffer.from(rotation.successorPublicKeyBase64, "base64");
const publicDigest = createHash("sha256").update(publicDer).digest("hex");
if (publicDigest !== rotation.payload.successorPublicKeySha256) {
    errors.push("Successor public-key digest is invalid.");
}
try {
    const publicKey = createPublicKey({ key: publicDer, format: "der", type: "spki" });
    const valid = verify(
        null,
        Buffer.from(JSON.stringify(rotation.payload), "utf8"),
        publicKey,
        Buffer.from(rotation.successorSelfSignatureBase64, "base64"),
    );
    if (!valid) errors.push("Successor self-signature over the rotation payload is invalid.");
} catch (error) {
    errors.push(`Rotation signature verification failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (errors.length > 0) {
    errors.forEach((error) => console.error(`[governance:key-rotation] FAILED: ${error}`));
    process.exitCode = 1;
} else {
    console.log(`[governance:key-rotation] VERIFIED: ${rotation.payload.rotationId}`);
}