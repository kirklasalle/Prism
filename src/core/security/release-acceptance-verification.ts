/** Evidence-driven release acceptance evaluation and certificate issuance. */

import {
    GOVERNANCE_CONTROLS,
    type GovernanceControlDefinition,
    validateControlRegistry,
} from "../governance/control-registry.js";
import {
    evidenceManifestDigest,
    findCurrentEvidence,
    validateEvidenceManifest,
    type EvidenceManifest,
    type EvidenceResult,
    type EvidenceValidationContext,
} from "../governance/evidence-manifest.js";
import { signArtifact, type ArtifactSignatureManifest } from "./artifact-signature.js";

export interface AcceptanceGateResult {
    readonly gateNumber: number;
    readonly controlId: string;
    readonly title: string;
    readonly status: EvidenceResult;
    readonly passed: boolean;
    readonly evidence: string;
    readonly evidenceIds: readonly string[];
}

export interface SystemReleaseCertificate {
    readonly totalGates: number;
    readonly passedCount: number;
    readonly certified: boolean;
    readonly evaluatedAt: string;
    readonly evidenceManifestDigest: string;
    readonly gateResults: AcceptanceGateResult[];
    readonly certificateMarkdown: string;
    readonly signatureBase64: string;
}

export interface IssuedReleaseAcceptanceCertificate extends SystemReleaseCertificate {
    readonly signatureManifest: ArtifactSignatureManifest;
}

function renderAssessment(
    results: readonly AcceptanceGateResult[],
    evaluatedAt: string,
    manifestDigest: string,
): string {
    const passedCount = results.filter((result) => result.status === "passed").length;
    const certified = results.length > 0 && passedCount === results.length;
    const gateSummary = results
        .map((result) => {
            const marker = result.status === "passed" ? "PASS" : result.status === "failed" ? "FAIL" : "NOT EVALUATED";
            return `- **Gate ${result.gateNumber} [${result.controlId}]: ${marker}** — ${result.title}\n  *Evidence:* ${result.evidence}`;
        })
        .join("\n\n");

    return `# PRISM System Production Release Acceptance Certificate

> **STATUS:** ${certified ? "SYSTEM ELIGIBLE FOR CERTIFICATE ISSUANCE" : "RELEASE BLOCKED — UNMET ACCEPTANCE GATES"}
> **Evaluated At:** ${evaluatedAt}
> **Evidence Manifest SHA-256:** ${manifestDigest || "NOT SUPPLIED"}
> **Compliance Score:** ${passedCount}/${results.length} Gates Passed (${results.length === 0 ? 0 : Math.round((passedCount / results.length) * 100)}%)

## Acceptance Gate Audit Summary

${gateSummary}
`;
}

/** Evaluate controls using only current, structurally valid evidence. No I/O occurs. */
export function evaluateReleaseAcceptanceGates(
    manifest?: EvidenceManifest,
    context?: EvidenceValidationContext,
    controls: readonly GovernanceControlDefinition[] = GOVERNANCE_CONTROLS,
): SystemReleaseCertificate {
    const evaluatedAt = (context?.now ?? new Date()).toISOString();
    const manifestDigest = manifest ? evidenceManifestDigest(manifest) : "";
    const registryErrors = validateControlRegistry(controls);
    const manifestErrors = manifest && context ? validateEvidenceManifest(manifest, context) : [];
    const globalErrors = [...registryErrors, ...manifestErrors];

    const results = [...controls]
        .sort((left, right) => left.gateNumber - right.gateNumber)
        .map<AcceptanceGateResult>((control) => {
            if (!manifest || !context) {
                return {
                    gateNumber: control.gateNumber,
                    controlId: control.controlId,
                    title: control.title,
                    status: "not_evaluated",
                    passed: false,
                    evidence: "NOT EVALUATED: no current-build evidence manifest was supplied",
                    evidenceIds: [],
                };
            }
            if (globalErrors.length > 0) {
                return {
                    gateNumber: control.gateNumber,
                    controlId: control.controlId,
                    title: control.title,
                    status: "not_evaluated",
                    passed: false,
                    evidence: `NOT EVALUATED: ${globalErrors.join("; ")}`,
                    evidenceIds: [],
                };
            }

            const records = control.evidenceRequirements.map((requirement) =>
                findCurrentEvidence(
                    manifest,
                    requirement.probeId,
                    requirement.probeVersion,
                    requirement.maxAgeMs,
                    context,
                ),
            );
            const missing = control.evidenceRequirements.filter((_, index) => records[index] === null);
            if (missing.length > 0) {
                return {
                    gateNumber: control.gateNumber,
                    controlId: control.controlId,
                    title: control.title,
                    status: "not_evaluated",
                    passed: false,
                    evidence: `NOT EVALUATED: missing current evidence for ${missing.map((item) => `${item.probeId}@${item.probeVersion}`).join(", ")}`,
                    evidenceIds: records.flatMap((record) => (record ? [record.evidenceId] : [])),
                };
            }

            const currentRecords = records.filter((record) => record !== null);
            const failed = currentRecords.find((record) => record.result === "failed");
            const unevaluated = currentRecords.find((record) => record.result === "not_evaluated");
            const status: EvidenceResult = failed ? "failed" : unevaluated ? "not_evaluated" : "passed";
            const evidence = failed
                ? `FAILED: ${failed.failureReason ?? failed.evidenceId}`
                : unevaluated
                    ? `NOT EVALUATED: probe ${unevaluated.probeId}`
                    : `Passed with evidence ${currentRecords.map((record) => record.evidenceId).join(", ")}`;
            return {
                gateNumber: control.gateNumber,
                controlId: control.controlId,
                title: control.title,
                status,
                passed: status === "passed",
                evidence,
                evidenceIds: currentRecords.map((record) => record.evidenceId),
            };
        });

    const passedCount = results.filter((result) => result.passed).length;
    const certified = results.length > 0 && passedCount === results.length;
    return {
        totalGates: results.length,
        passedCount,
        certified,
        evaluatedAt,
        evidenceManifestDigest: manifestDigest,
        gateResults: results,
        certificateMarkdown: renderAssessment(results, evaluatedAt, manifestDigest),
        signatureBase64: "",
    };
}

/** Sign a passing assessment with an explicitly supplied release signing key. */
export function issueReleaseAcceptanceCertificate(
    assessment: SystemReleaseCertificate,
    privateKeyPem: string,
    keyId: string,
): IssuedReleaseAcceptanceCertificate {
    if (!assessment.certified || assessment.gateResults.some((gate) => gate.status !== "passed")) {
        throw new Error("Release acceptance certificate cannot be issued until every gate passes");
    }
    const { signature, manifest } = signArtifact(
        Buffer.from(assessment.certificateMarkdown, "utf-8"),
        privateKeyPem,
        keyId,
        "RELEASE_ACCEPTANCE_CERTIFICATE.md",
    );
    const signatureBase64 = signature.toString("base64");
    return {
        ...assessment,
        signatureBase64,
        signatureManifest: manifest,
        certificateMarkdown:
            assessment.certificateMarkdown +
            `\n## Certification Signature\n\n- **Release Key ID:** ${keyId}\n- **Signature:** ${signatureBase64}\n`,
    };
}
