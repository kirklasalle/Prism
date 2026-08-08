#!/usr/bin/env node
/* global __dirname, Buffer, console, process */
"use strict";

const { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} = require("node:fs");
const { basename, dirname, join, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const activePath = join(root, "Permanent_Active_Directives.txt");
const defaultCandidatePath = join(root, "Permanent_Active_Directives-corrected.txt");
const erratumPath = join(root, "config", "governance-errata", "E-2026-001.json");
const signaturePath = join(root, "config", "permanent-active-directives.signature.json");
const keysPath = join(root, "config", "governance-signing-keys.json");
const generatedHashPath = join(root, "src", "core", "security", "directive-hash.generated.ts");
const artifactManifestPath = join(root, "config", "governance-artifact-manifest.json");
const rotationPath = join(root, "config", "governance-key-rotations", "R-2026-001.json");
const backupRoot = join(root, "state", "governance-erratum-backups");
const expectedErratumId = "E-2026-001";
const successorKeyId = "prism-governance-pad-2026-08-r1";

function arg(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

function keyIsActive(entry) {
    return !entry.revokedAt && (!entry.expiresAt || Date.parse(entry.expiresAt) > Date.now());
}

function verifyActiveSignature(activeBytes, activeHash) {
    try {
        const signature = readJson(signaturePath);
        const registry = readJson(keysPath);
        const key = registry.keys?.find(
            (entry) => entry.keyId === signature.keyId && entry.algorithm === "ed25519" && keyIsActive(entry),
        );
        if (!key) return { valid: false, keyId: signature.keyId, error: "Registered active key not found." };
        if (signature.sha256 !== activeHash) {
            return { valid: false, keyId: signature.keyId, error: "Detached signature hash does not match active PAD." };
        }
        const publicKey = createPublicKey({
            key: Buffer.from(key.publicKeyBase64, "base64"),
            format: "der",
            type: "spki",
        });
        const valid = verify(null, activeBytes, publicKey, Buffer.from(signature.signatureBase64, "base64"));
        return { valid, keyId: signature.keyId, error: valid ? null : "Detached signature verification failed." };
    } catch (error) {
        return { valid: false, keyId: null, error: error instanceof Error ? error.message : String(error) };
    }
}

function inspect(candidatePath) {
    const errors = [];
    for (const path of [activePath, candidatePath, erratumPath, signaturePath, keysPath, generatedHashPath]) {
        if (!existsSync(path)) errors.push(`Required file is missing: ${path}`);
    }
    if (errors.length > 0) return { ready: false, errors };

    const activeBytes = readFileSync(activePath);
    const candidateBytes = readFileSync(candidatePath);
    const activeText = activeBytes.toString("utf8");
    const candidateText = candidateBytes.toString("utf8");
    const activeHash = sha256(activeBytes);
    const candidateHash = sha256(candidateBytes);
    const record = readJson(erratumPath);
    const proposal = record.proposal ?? {};
    const signature = verifyActiveSignature(activeBytes, activeHash);
    const generatedSource = readFileSync(generatedHashPath, "utf8");
    const generatedMatch = generatedSource.match(/DIRECTIVE_SHA256_GENERATED\s*=\s*"([a-f0-9]{64})"/i);
    const generatedHash = generatedMatch?.[1] ?? null;

    if (record.format !== "prism-governance-erratum" || proposal.erratumId !== expectedErratumId) {
        errors.push(`Erratum record must be ${expectedErratumId}.`);
    }
    if (record.status !== "approved_pending_signature") {
        errors.push("Erratum must remain approved_pending_signature before application.");
    }
    if (activeHash !== proposal.previousPadHash) {
        errors.push(`Active PAD hash ${activeHash} does not match erratum previousPadHash ${proposal.previousPadHash}.`);
    }
    if (candidateHash !== proposal.correctedPadHash) {
        errors.push(`Candidate hash ${candidateHash} does not match erratum correctedPadHash ${proposal.correctedPadHash}.`);
    }
    if (!signature.valid) errors.push(`Active PAD signature is invalid: ${signature.error}`);
    if (generatedHash !== activeHash) {
        errors.push(`Generated PAD hash ${generatedHash ?? "unavailable"} does not match active PAD ${activeHash}.`);
    }
    if (!activeText.includes(proposal.previousText) || activeText.includes(proposal.correctedText)) {
        errors.push("Active PAD does not contain exactly the registered previous Law 4 text.");
    }
    if (!candidateText.includes(proposal.correctedText) || candidateText.includes(proposal.previousText)) {
        errors.push("Candidate PAD does not contain exactly the registered corrected Law 4 text.");
    }
    if (sha256(Buffer.from(proposal.previousText, "utf8")) !== proposal.previousTextHash) {
        errors.push("Erratum previous Law text hash is invalid.");
    }
    if (sha256(Buffer.from(proposal.correctedText, "utf8")) !== proposal.correctedTextHash) {
        errors.push("Erratum corrected Law text hash is invalid.");
    }

    return {
        ready: errors.length === 0,
        erratumId: proposal.erratumId,
        activeHash,
        candidateHash,
        expectedPreviousHash: proposal.previousPadHash,
        expectedCorrectedHash: proposal.correctedPadHash,
        generatedHash,
        signatureValid: signature.valid,
        governanceKeyId: signature.keyId,
        candidatePath,
        errors,
    };
}

function inspectCurrentState(candidatePath) {
    const requiredPaths = [activePath, erratumPath, signaturePath, keysPath, generatedHashPath];
    const missing = requiredPaths.filter((path) => !existsSync(path));
    if (missing.length > 0) {
        return { ready: false, phase: "unavailable", errors: missing.map((path) => `Required file is missing: ${path}`) };
    }

    const activeBytes = readFileSync(activePath);
    const activeHash = sha256(activeBytes);
    const record = readJson(erratumPath);
    const proposal = record.proposal ?? {};
    if (activeHash !== proposal.correctedPadHash) return inspect(candidatePath);

    const errors = [];
    const activeText = activeBytes.toString("utf8");
    const signature = verifyActiveSignature(activeBytes, activeHash);
    const generatedSource = readFileSync(generatedHashPath, "utf8");
    const generatedMatch = generatedSource.match(/DIRECTIVE_SHA256_GENERATED\s*=\s*"([a-f0-9]{64})"/i);
    const generatedHash = generatedMatch?.[1] ?? null;
    const candidateHash = existsSync(candidatePath) ? sha256(readFileSync(candidatePath)) : null;

    if (record.format !== "prism-governance-erratum" || proposal.erratumId !== expectedErratumId) {
        errors.push(`Erratum record must be ${expectedErratumId}.`);
    }
    if (!signature.valid) errors.push(`Active corrected PAD signature is invalid: ${signature.error}`);
    if (signature.keyId !== record.expectedGovernanceKeyId) {
        errors.push(
            `Active corrected PAD key ${signature.keyId ?? "unavailable"} does not match expected key ${record.expectedGovernanceKeyId}.`,
        );
    }
    if (generatedHash !== activeHash) {
        errors.push(`Generated PAD hash ${generatedHash ?? "unavailable"} does not match active PAD ${activeHash}.`);
    }
    if (!activeText.includes(proposal.correctedText) || activeText.includes(proposal.previousText)) {
        errors.push("Active PAD does not contain exactly the registered corrected Law 4 text.");
    }
    if (sha256(Buffer.from(proposal.correctedText, "utf8")) !== proposal.correctedTextHash) {
        errors.push("Erratum corrected Law text hash is invalid.");
    }
    if (candidateHash && candidateHash !== proposal.correctedPadHash) {
        errors.push(`Optional candidate hash ${candidateHash} does not match correctedPadHash ${proposal.correctedPadHash}.`);
    }

    return {
        ready: errors.length === 0,
        phase: record.status === "effective" ? "effective" : "applied_pending_release_commit",
        erratumId: proposal.erratumId,
        activeHash,
        candidateHash,
        expectedPreviousHash: proposal.previousPadHash,
        expectedCorrectedHash: proposal.correctedPadHash,
        generatedHash,
        signatureValid: signature.valid,
        governanceKeyId: signature.keyId,
        candidatePath: existsSync(candidatePath) ? candidatePath : null,
        errors,
    };
}

function printStatus(status) {
    console.log(`[governance:erratum] ${status.erratumId ?? expectedErratumId}`);
    console.log(`[governance:erratum] phase=${status.phase ?? "preflight"}`);
    console.log(`[governance:erratum] active=${status.activeHash ?? "unavailable"}`);
    console.log(`[governance:erratum] candidate=${status.candidateHash ?? "unavailable"}`);
    console.log(`[governance:erratum] signatureValid=${status.signatureValid === true}`);
    console.log(`[governance:erratum] ready=${status.ready}`);
    for (const error of status.errors) console.error(`[governance:erratum] BLOCKED: ${error}`);
}

function command(name, args = []) {
    execFileSync(name, args, { cwd: root, stdio: "inherit", windowsHide: true });
}

function npmCommand(args) {
    if (process.env.npm_execpath) {
        command(process.execPath, [process.env.npm_execpath, ...args]);
        return;
    }
    command(process.platform === "win32" ? "npm.cmd" : "npm", args);
}

function verifyAuthorizedReleaseCommit(commit) {
    if (!/^[a-f0-9]{40}$/i.test(commit ?? "")) throw new Error("--commit must be a full 40-character Git commit hash.");
    const allowedSigners = (process.env.PRISM_GOVERNANCE_ALLOWED_SIGNERS ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    if (allowedSigners.length === 0) throw new Error("PRISM_GOVERNANCE_ALLOWED_SIGNERS is not configured.");

    const output = execFileSync("git", ["show", "-s", "--format=%H%n%G?%n%GS%n%ae", commit], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
    }).trimEnd();
    const [resolvedCommit, signatureStatus, signerIdentity, authorEmail] = output.split(/\r?\n/);
    if (resolvedCommit.toLowerCase() !== commit.toLowerCase()) throw new Error("Git did not resolve the requested release commit.");
    if (signatureStatus !== "G" && signatureStatus !== "U") {
        throw new Error(`Release commit signature status is '${signatureStatus || "unknown"}'.`);
    }
    const signerLower = signerIdentity.toLowerCase();
    const authorLower = authorEmail.toLowerCase();
    if (!allowedSigners.some((allowed) => signerLower.includes(allowed) || authorLower === allowed)) {
        throw new Error(`Release commit signer '${signerIdentity}' is not authorized.`);
    }

    const changedPaths = new Set(execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", commit], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
    }).split(/\r?\n/).filter(Boolean));
    for (const requiredPath of [
        "Permanent_Active_Directives.txt",
        "config/permanent-active-directives.signature.json",
        "config/governance-errata/E-2026-001.json",
        "config/governance-key-rotations/R-2026-001.json",
    ]) {
        if (!changedPaths.has(requiredPath)) throw new Error(`Release commit does not contain ${requiredPath}.`);
    }
    return { commit: resolvedCommit, signerIdentity, signatureStatus };
}

function effectuate(releaseCommit) {
    const status = inspectCurrentState(defaultCandidatePath);
    if (!status.ready) throw new Error(`Applied erratum is not ready: ${status.errors.join("; ")}`);
    const record = readJson(erratumPath);
    const rotation = readJson(rotationPath);
    if (record.status === "effective" && record.releaseCommit === releaseCommit) {
        console.log(`[governance:erratum] ${expectedErratumId} is already effective at ${releaseCommit}.`);
        return;
    }
    if (record.status !== "approved_pending_signature") throw new Error("Erratum is not pending effectuation.");
    if (rotation.status !== "effective_pending_release_commit") throw new Error("Key rotation is not pending release commit.");
    command(process.execPath, [join(root, "scripts", "verify-governance-key-rotation.cjs")]);
    const commitEvidence = verifyAuthorizedReleaseCommit(releaseCommit);
    const signatureBytes = readFileSync(signaturePath);
    const signature = readJson(signaturePath);
    const effectiveAt = new Date().toISOString();

    record.status = "effective";
    record.signatureEvidence = {
        governanceKeyId: signature.keyId,
        detachedSignatureDigest: sha256(signatureBytes),
        detachedSignatureVerified: true,
        releaseCommitSigner: commitEvidence.signerIdentity,
        releaseCommitSignatureStatus: commitEvidence.signatureStatus,
        verifiedAt: effectiveAt,
    };
    record.releaseCommit = commitEvidence.commit;
    record.effectiveAt = effectiveAt;
    rotation.status = "effective";
    rotation.releaseCommit = commitEvidence.commit;
    rotation.releaseCommitSigner = commitEvidence.signerIdentity;
    rotation.releaseCommitVerifiedAt = effectiveAt;

    writeFileSync(erratumPath, `${JSON.stringify(record, null, 4)}\n`, "utf8");
    writeFileSync(rotationPath, `${JSON.stringify(rotation, null, 4)}\n`, "utf8");
    npmCommand(["run", "governance:artifacts:generate"]);
    console.log(`[governance:erratum] ${expectedErratumId} and R-2026-001 are effective at ${commitEvidence.commit}.`);
}

function replaceActiveFile(sourcePath, transactionSuffix) {
    const displacedActive = `${activePath}.${transactionSuffix}-${process.pid}.rollback`;
    renameSync(activePath, displacedActive);
    try {
        renameSync(sourcePath, activePath);
        rmSync(displacedActive, { force: true });
    } catch (error) {
        if (existsSync(displacedActive)) renameSync(displacedActive, activePath);
        throw error;
    }
}

function matchSignedCheckout(bytes, expectedHash) {
    const text = bytes.toString("utf8");
    const variants = [
        { bytes, lineEndings: "repository" },
        { bytes: Buffer.from(text.replace(/\r\n/g, "\n"), "utf8"), lineEndings: "LF" },
        { bytes: Buffer.from(text.replace(/\r?\n/g, "\r\n"), "utf8"), lineEndings: "CRLF" },
    ];
    for (const variant of variants) {
        if (sha256(variant.bytes) !== expectedHash) continue;
        const signature = verifyActiveSignature(variant.bytes, expectedHash);
        if (signature.valid) return variant;
    }
    return null;
}

function findSignedBase() {
    const proposal = readJson(erratumPath).proposal;
    const commits = execFileSync("git", ["rev-list", "--all", "--", basename(activePath)], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
    })
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
    for (const commit of commits) {
        try {
            const bytes = execFileSync("git", ["show", `${commit}:${basename(activePath)}`], {
                cwd: root,
                encoding: "buffer",
                windowsHide: true,
                maxBuffer: 2 * 1024 * 1024,
            });
            const match = matchSignedCheckout(bytes, proposal.previousPadHash);
            if (match) return { commit, ...match };
        } catch {
            // The path may not exist in every historical commit.
        }
    }
    return null;
}

function restoreSignedBase(commit) {
    const proposal = readJson(erratumPath).proposal;
    let resolvedCommit = commit;
    let bytes;
    if (resolvedCommit) {
        const repositoryBytes = execFileSync("git", ["show", `${resolvedCommit}:${basename(activePath)}`], {
            cwd: root,
            encoding: "buffer",
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
        });
        const match = matchSignedCheckout(repositoryBytes, proposal.previousPadHash);
        if (!match) throw new Error(`Commit ${resolvedCommit} does not contain the signed previous PAD artifact.`);
        bytes = match.bytes;
    } else {
        const found = findSignedBase();
        if (!found) throw new Error(`No Git version matches signed previousPadHash ${proposal.previousPadHash}.`);
        resolvedCommit = found.commit;
        bytes = found.bytes;
    }
    if (sha256(bytes) !== proposal.previousPadHash) {
        throw new Error(`Commit ${resolvedCommit} does not contain the signed previous PAD artifact.`);
    }
    const signature = verifyActiveSignature(bytes, proposal.previousPadHash);
    if (!signature.valid) throw new Error(`Historical PAD signature verification failed: ${signature.error}`);

    const backup = backupFiles([activePath, generatedHashPath]);
    const tempActive = `${activePath}.restore-${process.pid}.tmp`;
    try {
        writeFileSync(tempActive, bytes);
        replaceActiveFile(tempActive, "restore");
        command(process.execPath, [join(root, "scripts", "compute-directive-hash.cjs")]);
        console.log(`[governance:erratum] Restored exact signed base from commit ${resolvedCommit}.`);
        console.log(`[governance:erratum] Previous local files backed up at ${backup.backupDir}`);
    } catch (error) {
        rmSync(tempActive, { force: true });
        restoreBackup(backup);
        throw new Error(`Signed-base restoration failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function verifyPrivateKey(privateKeyPath, expectedKeyId) {
    const privateKey = createPrivateKey(readFileSync(privateKeyPath));
    const publicKeyBase64 = createPublicKey(privateKey)
        .export({ type: "spki", format: "der" })
        .toString("base64");
    const registry = readJson(keysPath);
    const registered = registry.keys?.find((entry) => entry.keyId === expectedKeyId && entry.algorithm === "ed25519");
    if (!registered || registered.publicKeyBase64 !== publicKeyBase64) {
        throw new Error(`Private key does not match registered governance key ${expectedKeyId}.`);
    }
}

function backupFiles(paths) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = join(backupRoot, `${expectedErratumId}-${stamp}`);
    mkdirSync(backupDir, { recursive: true });
    const manifest = [];
    for (const path of paths) {
        const existed = existsSync(path);
        const backupPath = join(backupDir, basename(path));
        if (existed) copyFileSync(path, backupPath);
        manifest.push({ path, backupPath, existed });
    }
    writeFileSync(join(backupDir, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { backupDir, manifest };
}

function restoreBackup(backup) {
    for (const entry of backup.manifest) {
        if (entry.existed) {
            mkdirSync(dirname(entry.path), { recursive: true });
            copyFileSync(entry.backupPath, entry.path);
        } else {
            rmSync(entry.path, { force: true });
        }
    }
}

function apply(candidatePath, privateKeyPath) {
    const before = inspect(candidatePath);
    printStatus(before);
    if (!before.ready) throw new Error("Erratum preflight failed; active PAD was not modified.");
    if (!privateKeyPath || !existsSync(privateKeyPath)) throw new Error("--private-key must name the original private PEM.");
    verifyPrivateKey(privateKeyPath, before.governanceKeyId);

    const governedFiles = [activePath, signaturePath, keysPath, generatedHashPath, artifactManifestPath];
    const backup = backupFiles(governedFiles);
    const tempActive = `${activePath}.erratum-${process.pid}.tmp`;
    try {
        copyFileSync(candidatePath, tempActive);
        replaceActiveFile(tempActive, "erratum");
        command(process.execPath, [join(root, "scripts", "compute-directive-hash.cjs")]);
        command(process.execPath, [
            join(root, "scripts", "sign-directive-file.cjs"),
            "--private-key",
            privateKeyPath,
            "--keyId",
            before.governanceKeyId,
        ]);
        npmCommand(["run", "governance:artifacts:generate"]);
        command(process.execPath, [join(root, "scripts", "directive-integrity-gate.cjs")]);

        const appliedHash = sha256(readFileSync(activePath));
        if (appliedHash !== before.expectedCorrectedHash) throw new Error("Applied PAD hash changed unexpectedly.");
        console.log(`[governance:erratum] Applied ${expectedErratumId}; backup=${backup.backupDir}`);
        console.log("[governance:erratum] NEXT: create an authorized signed Git commit containing the coordinated artifacts.");
    } catch (error) {
        rmSync(tempActive, { force: true });
        restoreBackup(backup);
        throw new Error(`Erratum application failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function emergencyRotateAndApply(candidatePath, privateKeyPath) {
    const before = inspect(candidatePath);
    printStatus(before);
    if (!before.ready) throw new Error("Erratum preflight failed; active PAD was not modified.");
    if (!process.argv.includes("--confirm-founder-authorization")) {
        throw new Error("Emergency rotation requires --confirm-founder-authorization.");
    }
    if (!privateKeyPath) throw new Error("--private-key must name a new external PEM path.");
    if (existsSync(privateKeyPath)) throw new Error("Refusing to overwrite an existing private key.");

    const governedFiles = [
        activePath,
        signaturePath,
        keysPath,
        generatedHashPath,
        artifactManifestPath,
        erratumPath,
        rotationPath,
    ];
    const backup = backupFiles(governedFiles);
    const tempActive = `${activePath}.erratum-${process.pid}.tmp`;
    let privateKeyCreated = false;
    try {
        const generated = generateKeyPairSync("ed25519");
        const privatePem = generated.privateKey.export({ type: "pkcs8", format: "pem" });
        const publicKeyDer = generated.publicKey.export({ type: "spki", format: "der" });
        const publicKeyBase64 = publicKeyDer.toString("base64");
        const now = new Date().toISOString();
        mkdirSync(dirname(privateKeyPath), { recursive: true });
        writeFileSync(privateKeyPath, privatePem, { mode: 0o600, flag: "wx" });
        privateKeyCreated = true;

        const registry = readJson(keysPath);
        const previousKey = registry.keys.find((entry) => entry.keyId === before.governanceKeyId);
        if (!previousKey) throw new Error(`Previous governance key ${before.governanceKeyId} is not registered.`);
        if (registry.keys.some((entry) => entry.keyId === successorKeyId)) {
            throw new Error(`Successor governance key ${successorKeyId} is already registered.`);
        }
        previousKey.revokedAt = now;
        previousKey.revocationReason = "Private key unavailable; Founder-authorized emergency rotation R-2026-001.";
        registry.keys.push({
            keyId: successorKeyId,
            algorithm: "ed25519",
            label: "PRISM Governance PAD Signing Key (Emergency Rotation R-2026-001)",
            publicKeyBase64,
            addedAt: now,
            expiresAt: null,
            rotationId: "R-2026-001",
        });
        writeFileSync(keysPath, `${JSON.stringify(registry, null, 4)}\n`, "utf8");

        const rotationPayload = {
            rotationId: "R-2026-001",
            previousKeyId: before.governanceKeyId,
            successorKeyId,
            previousPublicKeySha256: sha256(Buffer.from(previousKey.publicKeyBase64, "base64")),
            successorPublicKeySha256: sha256(publicKeyDer),
            reason: "Original PAD private signing key is unavailable after exhaustive local, history, backup, and GitHub recovery checks.",
            authorizedBy: "governance-founder:kirk-lasalle",
            authorizedAt: now,
            authorizationBasis: "Founder emergency authorization on 2026-08-08 for E-2026-001 and a durable lost-key contingency.",
            scope: ["E-2026-001", "future PAD detached signatures"],
            priorKeySignatureAvailable: false,
            continuityPadHash: before.activeHash,
            correctedPadHash: before.expectedCorrectedHash,
        };
        const canonicalPayload = JSON.stringify(rotationPayload);
        const successorSelfSignatureBase64 = sign(
            null,
            Buffer.from(canonicalPayload, "utf8"),
            generated.privateKey,
        ).toString("base64");
        if (!verify(null, Buffer.from(canonicalPayload, "utf8"), generated.publicKey, Buffer.from(successorSelfSignatureBase64, "base64"))) {
            throw new Error("Successor key failed rotation-record self-verification.");
        }
        const rotation = {
            format: "prism-governance-key-rotation",
            formatVersion: 1,
            status: "authorized_pending_application",
            payload: rotationPayload,
            successorPublicKeyBase64: publicKeyBase64,
            successorSelfSignatureBase64,
        };
        mkdirSync(dirname(rotationPath), { recursive: true });
        writeFileSync(rotationPath, `${JSON.stringify(rotation, null, 4)}\n`, "utf8");

        const erratum = readJson(erratumPath);
        erratum.expectedGovernanceKeyId = successorKeyId;
        erratum.keyRotationId = rotationPayload.rotationId;
        writeFileSync(erratumPath, `${JSON.stringify(erratum, null, 4)}\n`, "utf8");

        copyFileSync(candidatePath, tempActive);
        replaceActiveFile(tempActive, "erratum-rotation");
        command(process.execPath, [join(root, "scripts", "compute-directive-hash.cjs")]);
        command(process.execPath, [
            join(root, "scripts", "sign-directive-file.cjs"),
            "--private-key",
            privateKeyPath,
            "--keyId",
            successorKeyId,
        ]);
        rotation.status = "effective_pending_release_commit";
        rotation.effectiveAt = new Date().toISOString();
        writeFileSync(rotationPath, `${JSON.stringify(rotation, null, 4)}\n`, "utf8");

        npmCommand(["run", "governance:artifacts:generate"]);
        command(process.execPath, [join(root, "scripts", "directive-integrity-gate.cjs")]);
        command(process.execPath, [join(root, "scripts", "verify-governance-key-rotation.cjs")]);
        if (sha256(readFileSync(activePath)) !== before.expectedCorrectedHash) {
            throw new Error("Applied PAD hash changed unexpectedly.");
        }
        console.log(`[governance:erratum] Emergency rotation R-2026-001 applied with key ${successorKeyId}.`);
        console.log(`[governance:erratum] Private key created outside repository: ${privateKeyPath}`);
        console.log(`[governance:erratum] Backup: ${backup.backupDir}`);
        console.log("[governance:erratum] NEXT: create and verify an authorized signed Git release commit.");
    } catch (error) {
        rmSync(tempActive, { force: true });
        restoreBackup(backup);
        if (privateKeyCreated) rmSync(privateKeyPath, { force: true });
        throw new Error(`Emergency rotation failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function main() {
    const action = process.argv[2] ?? "status";
    const candidatePath = resolve(root, arg("candidate") ?? defaultCandidatePath);
    if (action === "status") {
        printStatus(inspectCurrentState(candidatePath));
        return;
    }
    if (action === "check") {
        const status = inspectCurrentState(candidatePath);
        printStatus(status);
        if (!status.ready) process.exitCode = 1;
        return;
    }
    if (action === "locate-base") {
        const found = findSignedBase();
        if (!found) throw new Error("No Git history entry matches the signed previous PAD digest.");
        console.log(
            `[governance:erratum] Signed base found at commit ${found.commit} using ${found.lineEndings} line endings.`,
        );
        return;
    }
    if (action === "restore-base") {
        restoreSignedBase(arg("commit"));
        return;
    }
    if (action === "apply") {
        apply(candidatePath, arg("private-key") ? resolve(root, arg("private-key")) : undefined);
        return;
    }
    if (action === "rotate-apply") {
        emergencyRotateAndApply(candidatePath, arg("private-key") ? resolve(root, arg("private-key")) : undefined);
        return;
    }
    if (action === "effectuate") {
        effectuate(arg("commit"));
        return;
    }
    throw new Error(
        "Usage: governance-erratum-update.cjs <status|check|locate-base|restore-base|apply|rotate-apply|effectuate> " +
        "[--candidate path] [--commit hash] [--private-key path] [--confirm-founder-authorization]",
    );
}

try {
    main();
} catch (error) {
    console.error(`[governance:erratum] FATAL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}