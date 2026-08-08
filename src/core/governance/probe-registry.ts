import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteActivityStore } from "../activity/sqlite-store.js";
import { ChatSessionStore } from "../operator/chat-session-store.js";
import {
    generateMarkdownCertificateV1,
    parseCertificateEnvelopeV1,
    serializeCanonicalCertificate,
    validateCertificateEnvelopeV1,
    type InitializationCertificateEnvelopeV1,
} from "../security/certificate-envelope.js";
import {
    evidenceValueDigest,
    type EvidenceManifest,
    type EvidenceRecord,
    type EvidenceResult,
} from "./evidence-manifest.js";
import { checkGovernanceArtifacts } from "./governance-artifact-manifest.js";
import { IamStore } from "../iam/store.js";
import { SessionManager } from "../iam/sso/session.js";
import {
    FileExternalAuditAnchorStore,
    verifyLatestPersistedAuditAnchor,
} from "../activity/external-audit-anchor.js";
import { ApprovalQueue } from "../approval/approval-queue.js";
import { normalizeRequestByGovernance, validateRequestAgainstGovernance } from "../tools/governance-normalizer.js";
import { createAdversarialCapabilityLedger } from "./adversarial-capability-ledger.js";
import {
    findReleaseKey,
    loadReleaseSigningKeyRegistry,
    verifyArtifactSignature,
} from "../security/artifact-signature.js";

export interface EvidenceProbeContext {
    readonly commit: string;
    readonly buildId: string;
    readonly evaluatedAt?: string;
    readonly inputs: Readonly<Record<string, unknown>>;
}

export interface EvidenceProbeExecution {
    readonly result: EvidenceResult;
    readonly output: unknown;
    readonly failureReason?: string;
    readonly artifactPath?: string;
}

export interface EvidenceProbeDefinition {
    readonly probeId: string;
    readonly version: number;
    readonly description: string;
    readonly requiredInputs: readonly string[];
    readonly execute: (context: EvidenceProbeContext) => Promise<EvidenceProbeExecution>;
}

interface DeploymentAttestation {
    format: "prism-deployment-control-attestation";
    version: 1;
    probeId: string;
    probeVersion: number;
    commit: string;
    buildId: string;
    evaluatedAt: string;
    result: "passed" | "failed";
    observations: Record<string, unknown>;
    keyId: string;
    signatureBase64: string;
}

async function executeDeploymentAttestationProbe(
    context: EvidenceProbeContext,
    probeId: string,
    probeVersion: number,
): Promise<EvidenceProbeExecution> {
    const directory = context.inputs.deploymentEvidenceDirectory;
    const registryPath = context.inputs.releaseKeyRegistryPath;
    if (typeof directory !== "string" || typeof registryPath !== "string") {
        return {
            result: "not_evaluated",
            output: { reason: "deploymentEvidenceDirectory and releaseKeyRegistryPath are required" },
        };
    }
    const artifactPath = join(directory, `${probeId}@${probeVersion}.json`);
    if (!existsSync(artifactPath) || !existsSync(registryPath)) {
        return { result: "not_evaluated", output: { artifactPath, reason: "signed deployment evidence is absent" } };
    }
    try {
        const attestation = JSON.parse(new TextDecoder().decode(await import("node:fs/promises").then((fs) => fs.readFile(artifactPath)))) as DeploymentAttestation;
        const { signatureBase64, ...payload } = attestation;
        const identityMatches =
            attestation.format === "prism-deployment-control-attestation" &&
            attestation.version === 1 &&
            attestation.probeId === probeId &&
            attestation.probeVersion === probeVersion &&
            attestation.commit === context.commit &&
            attestation.buildId === context.buildId;
        const registry = loadReleaseSigningKeyRegistry(registryPath);
        const key = findReleaseKey(registry, attestation.keyId);
        const signatureValid = Boolean(
            key &&
            verifyArtifactSignature(
                Buffer.from(JSON.stringify(payload)),
                Buffer.from(signatureBase64, "base64"),
                key.publicKeyBase64,
            ),
        );
        const passed = identityMatches && signatureValid && attestation.result === "passed";
        return {
            result: passed ? "passed" : "failed",
            output: { identityMatches, signatureValid, attestedResult: attestation.result },
            failureReason: passed ? undefined : "Deployment attestation identity, signature, or result is invalid",
            artifactPath,
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { result: "failed", output: { reason }, failureReason: reason, artifactPath };
    }
}

function deploymentProbe(probeId: string, description: string): EvidenceProbeDefinition {
    return {
        probeId,
        version: 1,
        description,
        requiredInputs: ["deploymentEvidenceDirectory", "releaseKeyRegistryPath"],
        execute: (context) => executeDeploymentAttestationProbe(context, probeId, 1),
    };
}

async function executeCertificateEnvelopeProbe(): Promise<EvidenceProbeExecution> {
    const envelope: InitializationCertificateEnvelopeV1 = {
        format: "prism-initialization-certificate",
        version: "1.0",
        issuerKeyId: "probe-release-key",
        sequence: 1,
        createdAt: "2026-08-08T00:00:00.000Z",
        identity: {
            operatorEmail: "probe.operator@prismrefraction.com",
            operatorName: "Probe Operator",
            cacEmail: "probe.cac@prismrefraction.com",
            cacName: "Probe CAC",
            locationName: "isolated-probe",
        },
        provenance: {
            padDigest: "a".repeat(64),
            covenantVersion: "1.0",
            covenantDigest: "b".repeat(64),
            workspaceRoot: "isolated-probe-workspace",
        },
    };
    const validationErrors = validateCertificateEnvelopeV1(envelope);
    const canonicalPayload = serializeCanonicalCertificate(envelope);
    const markdown = generateMarkdownCertificateV1(envelope, "c2ln", "cHVi");
    const parsed = parseCertificateEnvelopeV1(markdown);
    const tampered = { ...envelope, version: "2.0" };
    const tamperedErrors = validateCertificateEnvelopeV1(tampered);
    const passed =
        validationErrors.length === 0 &&
        parsed?.canonicalPayload === canonicalPayload &&
        tamperedErrors.includes("Unsupported certificate version");
    const output = {
        validEnvelopeAccepted: validationErrors.length === 0,
        canonicalRoundTrip: parsed?.canonicalPayload === canonicalPayload,
        unsupportedVersionRejected: tamperedErrors.includes("Unsupported certificate version"),
        validationErrors,
    };
    return {
        result: passed ? "passed" : "failed",
        output,
        failureReason: passed ? undefined : "Certificate envelope schema or canonical round-trip invariant failed",
    };
}

async function executeCovenantCanonicalityProbe(): Promise<EvidenceProbeExecution> {
    const errors = await checkGovernanceArtifacts();
    return {
        result: errors.length === 0 ? "passed" : "failed",
        output: { errors },
        failureReason: errors.length === 0 ? undefined : errors.join("; "),
    };
}

async function executeFailClosedLoginProbe(): Promise<EvidenceProbeExecution> {
    const store = new IamStore(":memory:");
    try {
        const user = store.createUser({ tenantId: "probe", email: "operator@probe.invalid" });
        const sessions = new SessionManager(store, { secret: "probe-session-secret".repeat(2), secure: false });
        const pending = sessions.issue(user.id, "probe", 60, "authenticated");
        const authenticated = sessions.verify(pending.cookie) !== null;
        const privilegedBeforeEnrollment = sessions.verifyOperational(pending.cookie) !== null;
        const mismatchAccepted = store.activateSessionWithEnrollment(
            pending.session.id,
            "probe-enrollment-token",
            "wrong-token",
            "probe-certificate",
        );
        const activated = store.activateSessionWithEnrollment(
            pending.session.id,
            "probe-enrollment-token",
            "probe-enrollment-token",
            "probe-certificate",
        );
        const privilegedAfterEnrollment = sessions.verifyOperational(pending.cookie) !== null;
        const replay = sessions.issue(user.id, "probe", 60, "authenticated");
        const replayAccepted = store.activateSessionWithEnrollment(
            replay.session.id,
            "probe-enrollment-token",
            "probe-enrollment-token",
            "probe-certificate",
        );
        const passed =
            authenticated &&
            !privilegedBeforeEnrollment &&
            !mismatchAccepted &&
            activated &&
            privilegedAfterEnrollment &&
            !replayAccepted;
        return {
            result: passed ? "passed" : "failed",
            output: {
                authenticated,
                privilegedBeforeEnrollment,
                mismatchAccepted,
                activated,
                privilegedAfterEnrollment,
                replayAccepted,
            },
            failureReason: passed ? undefined : "Fail-closed enrollment or one-time token invariant failed",
        };
    } finally {
        store.close();
    }
}

async function executeAdversarialProbe(context: EvidenceProbeContext): Promise<EvidenceProbeExecution> {
    const entries = [];
    const request = { operation: "probe-tool", args: { action: "undeclared" }, risk: "low" as const, mutatesState: false };
    const schema = { actions: { inspect: { minimumRisk: "low" as const, mutating: false, rollbackRequired: false } } };
    const normalized = normalizeRequestByGovernance(request, schema).normalized;
    const quarantineError = validateRequestAgainstGovernance(normalized, schema);
    entries.push({
        threatPosition: "caller-controlled tool request",
        attackAttempted: "submit undeclared action as low-risk and non-mutating",
        expectedResult: "request quarantined before policy or approval",
        actualResult: quarantineError ?? "request accepted",
        blocked: Boolean(quarantineError),
    });

    const queue = new ApprovalQueue();
    const approvalContext = { args: { target: "original" }, risk: "high" };
    const approvalPromise = queue.request("probe-session", "probe.operation", approvalContext, 5_000);
    approvalContext.args.target = "substituted";
    const pending = queue.list()[0]!;
    queue.approve(pending.id);
    const approved = await approvalPromise;
    const replayAccepted = queue.approve(pending.id);
    const snapshotPreserved = (pending.context.args as { target: string }).target === "original";
    entries.push({
        threatPosition: "approval decision endpoint",
        attackAttempted: "mutate approved parameters and replay the settled request id",
        expectedResult: "original parameters remain bound and replay is rejected",
        actualResult: `approved=${approved}; snapshotPreserved=${snapshotPreserved}; replayAccepted=${replayAccepted}`,
        blocked: approved && snapshotPreserved && !replayAccepted,
    });

    const store = new IamStore(":memory:");
    try {
        const user = store.createUser({ tenantId: "probe", email: "adversary@probe.invalid" });
        const first = store.createSession(user.id, "probe", 60, "authenticated");
        const second = store.createSession(user.id, "probe", 60, "authenticated");
        const firstAccepted = store.activateSessionWithEnrollment(first.id, "one-time", "one-time", "certificate");
        const replayEnrollmentAccepted = store.activateSessionWithEnrollment(second.id, "one-time", "one-time", "certificate");
        entries.push({
            threatPosition: "authenticated but unbound session",
            attackAttempted: "replay a consumed certificate enrollment token",
            expectedResult: "only the first session becomes operational",
            actualResult: `firstAccepted=${firstAccepted}; replayAccepted=${replayEnrollmentAccepted}`,
            blocked: firstAccepted && !replayEnrollmentAccepted,
        });
    } finally {
        store.close();
    }

    const ledger = createAdversarialCapabilityLedger(
        context.commit,
        context.buildId,
        context.evaluatedAt ?? new Date().toISOString(),
        entries,
    );
    const outputDirectory = context.inputs.evidenceOutputDirectory;
    let artifactPath: string | undefined;
    if (typeof outputDirectory === "string" && outputDirectory.trim()) {
        mkdirSync(outputDirectory, { recursive: true });
        artifactPath = join(outputDirectory, "adversarial-capability-ledger.json");
        writeFileSync(artifactPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    }
    const passed = entries.every((entry) => entry.blocked);
    return {
        result: passed ? "passed" : "failed",
        output: ledger,
        artifactPath,
        failureReason: passed ? undefined : "One or more adversarial attacks survived",
    };
}

async function executeCertificateImmutabilityProbe(): Promise<EvidenceProbeExecution> {
    const directory = mkdtempSync(join(tmpdir(), "prism-certificate-immutability-probe-"));
    const databasePath = join(directory, "chat.db");
    let store: ChatSessionStore | undefined;
    let database: DatabaseSync | undefined;
    try {
        store = new ChatSessionStore(databasePath);
        const session = store.createSession({
            title: "PRISM Initialization Certificate — Evidence Probe",
            operatorEmail: "probe.operator@prismrefraction.com",
        });
        store.appendMessage(session.sessionId, "assistant", "Probe certificate", { type: "certificate" });
        const message = store.getMessages(session.sessionId)[0];
        database = new DatabaseSync(databasePath);
        const attempts = [
            () => database!.prepare("UPDATE chat_messages SET content = ? WHERE message_id = ?").run("changed", message!.messageId),
            () => database!.prepare("DELETE FROM chat_messages WHERE message_id = ?").run(message!.messageId),
            () => database!.prepare("UPDATE chat_sessions SET title = ? WHERE session_id = ?").run("changed", session.sessionId),
            () => database!.prepare("DELETE FROM chat_sessions WHERE session_id = ?").run(session.sessionId),
        ];
        const blocked = attempts.map((attempt) => {
            try {
                attempt();
                return false;
            } catch {
                return true;
            }
        });
        const passed = blocked.every(Boolean);
        return {
            result: passed ? "passed" : "failed",
            output: {
                messageUpdateBlocked: blocked[0],
                messageDeleteBlocked: blocked[1],
                sessionUpdateBlocked: blocked[2],
                sessionDeleteBlocked: blocked[3],
            },
            failureReason: passed ? undefined : "One or more certificate mutation paths were not blocked",
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { result: "failed", output: { reason }, failureReason: `Certificate immutability probe failed: ${reason}` };
    } finally {
        database?.close();
        store?.close();
        rmSync(directory, { recursive: true, force: true });
    }
}

async function executeProductionMigrationParityProbe(context: EvidenceProbeContext): Promise<EvidenceProbeExecution> {
    const databasePath = context.inputs.chatDatabasePath;
    if (typeof databasePath !== "string" || databasePath.trim() === "") {
        return { result: "not_evaluated", output: { reason: "chatDatabasePath input was not supplied" } };
    }
    if (!existsSync(databasePath)) {
        return { result: "not_evaluated", output: { databasePath, reason: "chat database does not exist" } };
    }

    let database: DatabaseSync | undefined;
    try {
        database = new DatabaseSync(databasePath, { readOnly: true });
        const requiredObjects = [
            "prevent_cert_message_update",
            "prevent_cert_message_delete",
            "prevent_cert_session_update",
            "prevent_cert_session_delete",
            "idx_unique_active_operator_cert",
        ];
        const rows = database
            .prepare(`SELECT name, type, sql FROM sqlite_master WHERE name IN (${requiredObjects.map(() => "?").join(",")})`)
            .all(...requiredObjects) as Array<{ name: string; type: string; sql: string }>;
        const present = new Set(rows.map((row) => row.name));
        const missing = requiredObjects.filter((name) => !present.has(name));
        const uniqueIndex = rows.find((row) => row.name === "idx_unique_active_operator_cert");
        const indexSql = uniqueIndex?.sql.toLowerCase() ?? "";
        const cardinalityPredicatePresent =
            uniqueIndex?.type === "index" &&
            indexSql.includes("operator_email") &&
            indexSql.includes("is_quarantined = 0") &&
            indexSql.includes("archived:%");
        const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
        const passed = missing.length === 0 && cardinalityPredicatePresent && integrity.integrity_check === "ok";
        const output = {
            databasePath,
            requiredObjects,
            missing,
            cardinalityPredicatePresent,
            integrityCheck: integrity.integrity_check,
        };
        return {
            result: passed ? "passed" : "failed",
            output,
            failureReason: passed ? undefined : `Production migration parity failed; missing: ${missing.join(", ") || "none"}`,
            artifactPath: databasePath,
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            result: "failed",
            output: { databasePath, reason },
            failureReason: `Production migration parity probe failed: ${reason}`,
            artifactPath: databasePath,
        };
    } finally {
        database?.close();
    }
}

async function executeAuditChainProbe(context: EvidenceProbeContext): Promise<EvidenceProbeExecution> {
    const databasePath = context.inputs.auditDatabasePath;
    if (typeof databasePath !== "string" || databasePath.trim() === "") {
        return {
            result: "not_evaluated",
            output: { reason: "auditDatabasePath input was not supplied" },
        };
    }
    if (!existsSync(databasePath)) {
        return {
            result: "not_evaluated",
            output: { databasePath, reason: "audit database does not exist" },
        };
    }

    let store: SqliteActivityStore | undefined;
    try {
        store = new SqliteActivityStore(databasePath);
        const verification = store.verifyPersistedChain();
        return {
            result:
                verification.status === "valid"
                    ? "passed"
                    : verification.status === "invalid"
                        ? "failed"
                        : "not_evaluated",
            output: verification,
            failureReason: verification.status === "invalid" ? verification.reason : undefined,
            artifactPath: databasePath,
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            result: "failed",
            output: { databasePath, reason },
            failureReason: `Audit-chain probe failed: ${reason}`,
            artifactPath: databasePath,
        };
    } finally {
        store?.close();
    }
}

async function executeExternalAuditAnchorProbe(context: EvidenceProbeContext): Promise<EvidenceProbeExecution> {
    const databasePath = context.inputs.auditDatabasePath;
    const anchorPath = context.inputs.auditAnchorPath;
    if (typeof databasePath !== "string" || typeof anchorPath !== "string") {
        return { result: "not_evaluated", output: { reason: "auditDatabasePath and auditAnchorPath are required" } };
    }
    if (!existsSync(databasePath) || !existsSync(anchorPath)) {
        return { result: "not_evaluated", output: { databasePath, anchorPath, reason: "database or anchor is absent" } };
    }
    const store = new SqliteActivityStore(databasePath);
    try {
        const verification = verifyLatestPersistedAuditAnchor(store, new FileExternalAuditAnchorStore(anchorPath));
        return {
            result: verification.valid ? "passed" : "failed",
            output: verification,
            failureReason: verification.valid ? undefined : verification.reason,
            artifactPath: anchorPath,
        };
    } finally {
        store.close();
    }
}

export const EVIDENCE_PROBES: readonly EvidenceProbeDefinition[] = [
    deploymentProbe("security.key-custody", "Verify signed host key-custody and ACL inspection evidence"),
    deploymentProbe("security.issuer-trust", "Verify signed live issuer trust-registry inspection evidence"),
    deploymentProbe("security.legacy-remediation", "Verify signed live legacy key and certificate remediation evidence"),
    deploymentProbe("security.identity-cardinality", "Verify signed live certificate and CAC cardinality evidence"),
    deploymentProbe("security.execution-authority-coverage", "Verify signed privileged-path authority coverage evidence"),
    deploymentProbe("security.action-provenance", "Verify signed live action provenance completeness evidence"),
    deploymentProbe("security.guardian-binding", "Verify signed exact Guardian authority-binding evidence"),
    deploymentProbe("security.test-isolation", "Verify signed suite-wide live-state and network isolation evidence"),
    {
        probeId: "security.adversarial",
        version: 1,
        description: "Execute bypass attacks and publish a digest-bound adversarial capability ledger",
        requiredInputs: [],
        execute: executeAdversarialProbe,
    },
    {
        probeId: "security.fail-closed-login",
        version: 1,
        description: "Verify authenticated-only sessions remain non-operational until one-time enrollment succeeds",
        requiredInputs: [],
        execute: executeFailClosedLoginProbe,
    },
    {
        probeId: "security.covenant-canonicality",
        version: 1,
        description: "Verify the governance artifact manifest and generated canonical Covenant publication",
        requiredInputs: [],
        execute: executeCovenantCanonicalityProbe,
    },
    {
        probeId: "security.certificate-envelope",
        version: 1,
        description: "Validate certificate v1 schema, canonical serialization, and unsupported-version rejection",
        requiredInputs: [],
        execute: executeCertificateEnvelopeProbe,
    },
    {
        probeId: "security.certificate-immutability",
        version: 1,
        description: "Exercise certificate message and session mutation guards in an isolated production-schema store",
        requiredInputs: [],
        execute: executeCertificateImmutabilityProbe,
    },
    {
        probeId: "security.production-migration-parity",
        version: 1,
        description: "Inspect a migrated chat database for certificate guards, cardinality index, and SQLite integrity",
        requiredInputs: ["chatDatabasePath"],
        execute: executeProductionMigrationParityProbe,
    },
    {
        probeId: "security.audit-chain",
        version: 2,
        description: "Verify the durable SQLite audit chain from persisted rows and prune state",
        requiredInputs: ["auditDatabasePath"],
        execute: executeAuditChainProbe,
    },
    {
        probeId: "security.audit-external-anchor",
        version: 1,
        description: "Verify the live durable chain against an independently stored signed persisted-range checkpoint",
        requiredInputs: ["auditDatabasePath", "auditAnchorPath"],
        execute: executeExternalAuditAnchorProbe,
    },
];

export function findEvidenceProbe(probeId: string, version: number): EvidenceProbeDefinition | null {
    return EVIDENCE_PROBES.find((probe) => probe.probeId === probeId && probe.version === version) ?? null;
}

export function validateProbeRegistry(probes: readonly EvidenceProbeDefinition[] = EVIDENCE_PROBES): string[] {
    const errors: string[] = [];
    const identities = new Set<string>();
    for (const probe of probes) {
        const identity = `${probe.probeId}@${probe.version}`;
        if (identities.has(identity)) errors.push(`Duplicate evidence probe: ${identity}`);
        identities.add(identity);
        if (probe.probeId.trim() === "") errors.push("Evidence probe has an empty probeId");
        if (!Number.isInteger(probe.version) || probe.version < 1) errors.push(`${identity} has an invalid version`);
    }
    return errors;
}

export async function runEvidenceProbes(
    requestedProbes: readonly { probeId: string; probeVersion: number }[],
    context: EvidenceProbeContext,
): Promise<EvidenceManifest> {
    const registryErrors = validateProbeRegistry();
    if (registryErrors.length > 0) throw new Error(`Invalid evidence probe registry: ${registryErrors.join("; ")}`);
    const evaluatedAt = context.evaluatedAt ?? new Date().toISOString();
    const records: EvidenceRecord[] = [];

    for (const requested of requestedProbes) {
        const probe = findEvidenceProbe(requested.probeId, requested.probeVersion);
        if (!probe) continue;
        const execution = await probe.execute({ ...context, evaluatedAt });
        const input = Object.fromEntries(probe.requiredInputs.map((key) => [key, context.inputs[key]]));
        records.push({
            evidenceId: `${probe.probeId}:${probe.version}:${context.buildId}:${evaluatedAt}`,
            probeId: probe.probeId,
            probeVersion: probe.version,
            result: execution.result,
            commit: context.commit,
            buildId: context.buildId,
            evaluatedAt,
            inputDigest: evidenceValueDigest(input),
            outputDigest: evidenceValueDigest(execution.output),
            artifactPath: execution.artifactPath,
            failureReason: execution.failureReason,
        });
    }

    return {
        format: "prism-governance-evidence",
        version: 1,
        commit: context.commit,
        buildId: context.buildId,
        generatedAt: evaluatedAt,
        records,
    };
}
