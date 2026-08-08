import { verifyArtifactWithSidecar, signArtifact, type ArtifactSignatureManifest, type ReleaseSigningKeyRegistry } from "../security/artifact-signature.js";
import type { PrismPreferences } from "../config/workspace-resolver.js";
import { evidenceValueDigest } from "./evidence-manifest.js";

const GOVERNED_ENVIRONMENT_KEYS = [
    "PRISM_AUTH_DISABLED",
    "PRISM_GUARDIAN_AUTHORITY",
    "PRISM_ACTIVITY_RETENTION_ENABLED",
    "PRISM_ACTIVITY_RETENTION_DAYS",
    "PRISM_ENV_PROFILE",
    "PRISM_EXECUTION_PROFILE",
    "PRISM_ALLOW_DIRECTIVE_MISMATCH",
    "PRISM_NETWORK_EGRESS_ALLOWLIST",
] as const;

export interface GovernedConfiguration {
    readonly format: "prism-governed-configuration";
    readonly version: 1;
    readonly preferences: {
        readonly runtimeSettings: Record<string, unknown>;
        readonly executionProfileSegment: string | null;
        readonly guardianConfig: Record<string, unknown>;
        readonly activeLlmProviderId: string | null;
        readonly activeLlmModel: string | null;
        readonly disabledAddons: readonly string[];
        readonly addonSettings: Record<string, unknown>;
    };
    readonly environment: Readonly<Record<string, string | null>>;
}

export interface ConfigurationAttestation {
    readonly format: "prism-configuration-attestation";
    readonly version: 1;
    readonly issuedAt: string;
    readonly configurationDigest: string;
    readonly signatureBase64: string;
    readonly signatureManifest: ArtifactSignatureManifest;
}

function orderedRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}

export function governedConfiguration(
    preferences: PrismPreferences | null,
    environment: NodeJS.ProcessEnv = process.env,
): GovernedConfiguration {
    const environmentValues = Object.fromEntries(
        GOVERNED_ENVIRONMENT_KEYS.map((key) => [key, environment[key] ?? null]),
    );
    return {
        format: "prism-governed-configuration",
        version: 1,
        preferences: {
            runtimeSettings: orderedRecord(preferences?.runtimeSettings),
            executionProfileSegment: preferences?.executionProfileSegment ?? null,
            guardianConfig: orderedRecord(preferences?.guardianConfig),
            activeLlmProviderId: preferences?.activeLlmProviderId ?? null,
            activeLlmModel: preferences?.activeLlmModel ?? null,
            disabledAddons: [...(preferences?.disabledAddons ?? [])].sort(),
            addonSettings: orderedRecord(preferences?.addonSettings),
        },
        environment: environmentValues,
    };
}

export function configurationDigest(configuration: GovernedConfiguration): string {
    return evidenceValueDigest(configuration);
}

export function attestConfiguration(
    configuration: GovernedConfiguration,
    privateKeyPem: string,
    keyId: string,
    issuedAt = new Date().toISOString(),
): ConfigurationAttestation {
    const digest = configurationDigest(configuration);
    const payload = Buffer.from(JSON.stringify({ format: "prism-configuration-attestation", version: 1, issuedAt, configurationDigest: digest }), "utf-8");
    const { signature, manifest } = signArtifact(payload, privateKeyPem, keyId, "PRISM_CONFIGURATION_ATTESTATION.json");
    return {
        format: "prism-configuration-attestation",
        version: 1,
        issuedAt,
        configurationDigest: digest,
        signatureBase64: signature.toString("base64"),
        signatureManifest: manifest,
    };
}

export function verifyConfigurationAttestation(
    configuration: GovernedConfiguration,
    attestation: ConfigurationAttestation,
    registry: ReleaseSigningKeyRegistry,
): { valid: boolean; reason: string } {
    if (configurationDigest(configuration) !== attestation.configurationDigest) {
        return { valid: false, reason: "Governed configuration digest mismatch" };
    }
    const payload = Buffer.from(JSON.stringify({ format: attestation.format, version: attestation.version, issuedAt: attestation.issuedAt, configurationDigest: attestation.configurationDigest }), "utf-8");
    const result = verifyArtifactWithSidecar({
        artifactBytes: payload,
        signature: Buffer.from(attestation.signatureBase64, "base64"),
        manifest: attestation.signatureManifest,
        registry,
    });
    return { valid: result.ok, reason: result.reason };
}

export function configurationDrift(
    expected: GovernedConfiguration,
    actual: GovernedConfiguration,
): string[] {
    const paths = new Set<string>();
    const visit = (left: unknown, right: unknown, path: string): void => {
        if (evidenceValueDigest(left) === evidenceValueDigest(right)) return;
        if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
            const keys = new Set([...Object.keys(left as object), ...Object.keys(right as object)]);
            for (const key of [...keys].sort()) visit((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
            return;
        }
        paths.add(path);
    };
    visit(expected, actual, "");
    return [...paths].filter(Boolean).sort();
}
