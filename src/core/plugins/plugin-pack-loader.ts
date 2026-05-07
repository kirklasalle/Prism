/**
 * Plugin Pack Loader — Validates plugin packs at load time before registration.
 *
 * Wires the PluginPackValidator (manifest schema) and BusinessTrustValidator
 * (trust policy) into the adapter load pipeline, emitting activity events
 * for auditability.
 *
 * Task F — Phase D2 Manifest — Due 2026-04-28
 */

import { PluginPackValidator, type PluginPackManifest, type ValidationResult } from "./plugin-pack-validator.js";
import { BusinessTrustValidator, type TrustValidationResult, type TrustValidationContext } from "./business-trust-validator.js";
import type { ActivityBus } from "../activity/bus.js";

export interface PluginLoadResult {
    /** Whether the plugin was accepted and registered. */
    accepted: boolean;
    /** Manifest validation result. */
    manifestValidation: ValidationResult;
    /** Trust validation result (business profile only). */
    trustValidation: TrustValidationResult | null;
    /** Human-readable summary. */
    summary: string;
}

export interface PluginLoadOptions {
    /** Execution profile segment — determines trust policy enforcement level. */
    executionProfile: "individual" | "business";
    /** Optional public key PEM for signature verification. */
    publicKeyPem?: string;
}

/**
 * Validate and load a plugin pack manifest, enforcing both manifest schema
 * validation and business trust policy. Emits activity events on the bus.
 *
 * @param manifest   Parsed plugin pack manifest
 * @param packPath   Filesystem path to the plugin pack root
 * @param bus        ActivityBus for event emission
 * @param options    Load options (profile, public key)
 * @returns          PluginLoadResult indicating acceptance or rejection
 */
export function loadPluginPack(
    manifest: PluginPackManifest,
    packPath: string,
    bus: ActivityBus,
    options: PluginLoadOptions,
): PluginLoadResult {
    // ── Step 1: Manifest Schema Validation ─────────────────
    const validator = new PluginPackValidator(manifest, packPath);
    const manifestResult = validator.validate();

    if (!manifestResult.valid) {
        bus.emit({
            sessionId: "system",
            layer: "governance",
            operation: "prism.plugin.validation_failed",
            status: "failed",
            authorityTier: "tier2_conditional",
            policyDecision: "deny",
            details: {
                packName: manifest.pack_name ?? "unknown",
                packVersion: manifest.pack_version ?? "unknown",
                reasonCodes: ["PLUGIN_VALIDATION_FAILED"],
                errorCount: manifestResult.errors.length,
                errors: manifestResult.errors.map(e => ({ field: e.field, message: e.message, severity: e.severity })),
                warningCount: manifestResult.warnings.length,
            },
        });

        return {
            accepted: false,
            manifestValidation: manifestResult,
            trustValidation: null,
            summary: `Plugin '${manifest.pack_name ?? "unknown"}' rejected: ${manifestResult.errors.length} manifest validation error(s).`,
        };
    }

    // ── Step 2: Business Trust Policy Validation ──────────
    let trustResult: TrustValidationResult | null = null;

    if (options.executionProfile === "business") {
        const trustValidator = new BusinessTrustValidator();
        const trustContext: TrustValidationContext = {
            executionProfile: "business",
            publicKeyPem: options.publicKeyPem,
        };

        trustResult = trustValidator.validate(manifest, trustContext);

        if (!trustResult.allowed) {
            bus.emit({
                sessionId: "system",
                layer: "governance",
                operation: "prism.plugin.trust_validation_failed",
                status: "failed",
                authorityTier: "tier3_approval",
                policyDecision: "deny",
                details: {
                    packName: manifest.pack_name,
                    packVersion: manifest.pack_version,
                    reasonCodes: ["PLUGIN_REJECTED", ...trustResult.reasonCodes],
                    reasons: trustResult.reasons,
                    evidence: trustResult.evidence,
                },
            });

            return {
                accepted: false,
                manifestValidation: manifestResult,
                trustValidation: trustResult,
                summary: `Plugin '${manifest.pack_name}' rejected by business trust policy: ${trustResult.reasons.join("; ")}`,
            };
        }
    }

    // ── Step 3: Accepted — emit success event ─────────────
    bus.emit({
        sessionId: "system",
        layer: "governance",
        operation: "prism.plugin.validation_passed",
        status: "succeeded",
        authorityTier: options.executionProfile === "business" ? "tier2_conditional" : "tier1_autonomous",
        policyDecision: "allow",
        details: {
            packName: manifest.pack_name,
            packVersion: manifest.pack_version,
            reasonCodes: ["PLUGIN_VALIDATION_PASSED", ...(trustResult ? ["TRUST_BUSINESS_ALLOWED"] : ["TRUST_INDIVIDUAL_ADVISORY"])],
            adapterCount: manifest.adapters?.length ?? 0,
            profile: options.executionProfile,
            warningCount: manifestResult.warnings.length,
        },
    });

    return {
        accepted: true,
        manifestValidation: manifestResult,
        trustValidation: trustResult,
        summary: `Plugin '${manifest.pack_name}@${manifest.pack_version}' accepted (${manifest.adapters?.length ?? 0} adapter(s), ${options.executionProfile} profile).`,
    };
}
