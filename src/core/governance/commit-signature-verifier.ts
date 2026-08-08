import { execFileSync } from "node:child_process";

export interface CommitSignatureVerificationResult {
    valid: boolean;
    commit: string;
    signerIdentity: string;
    signerAuthorized: boolean;
    signatureStatus: string;
    verifiedAt: string;
    error?: string;
}

export function verifyAuthorizedCommitSignature(
    commit: string,
    repositoryRoot = process.cwd(),
): CommitSignatureVerificationResult {
    const verifiedAt = new Date().toISOString();
    const base = {
        valid: false,
        commit,
        signerIdentity: "",
        signerAuthorized: false,
        signatureStatus: "",
        verifiedAt,
    };

    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(commit)) {
        return { ...base, error: "Commit must be a 40- or 64-character hexadecimal digest." };
    }

    const allowedSigners = (process.env.PRISM_GOVERNANCE_ALLOWED_SIGNERS ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    if (allowedSigners.length === 0) {
        return { ...base, error: "PRISM_GOVERNANCE_ALLOWED_SIGNERS is not configured." };
    }

    try {
        const output = execFileSync(
            "git",
            ["show", "-s", "--format=%H%n%G?%n%GS%n%ae", commit],
            { cwd: repositoryRoot, encoding: "utf8", windowsHide: true },
        ).trimEnd();
        const [resolvedCommit = "", signatureStatus = "", signerIdentity = "", authorEmail = ""] =
            output.split(/\r?\n/);
        const signerLower = signerIdentity.toLowerCase();
        const authorLower = authorEmail.toLowerCase();
        const signerAuthorized = allowedSigners.some(
            (allowed) => signerLower.includes(allowed) || authorLower === allowed,
        );
        const signatureValid = signatureStatus === "G" || signatureStatus === "U";

        return {
            valid: resolvedCommit.toLowerCase() === commit.toLowerCase() && signatureValid && signerAuthorized,
            commit: resolvedCommit || commit,
            signerIdentity,
            signerAuthorized,
            signatureStatus,
            verifiedAt,
            error: !signatureValid
                ? `Commit signature status is '${signatureStatus || "unknown"}'.`
                : !signerAuthorized
                    ? "Commit signer is not authorized."
                    : undefined,
        };
    } catch (error) {
        return {
            ...base,
            error: `Commit signature verification failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}