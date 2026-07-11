/**
 * PRISM Add-on Manifest Validator
 *
 * Validates add-on manifests against the v1 schema before loading.
 * Enforces: format version, reverse-DNS ID, semver, integration points,
 * trust tier ("certified" required), and dependency resolution.
 *
 * @module addons/addon-validator
 */

import type { AddonManifest } from "./types.js";

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
const REVERSE_DNS_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;
const OSI_LICENSES = new Set([
    "Apache-2.0",
    "MIT",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "MPL-2.0",
    "ISC",
    "LGPL-2.1-only",
    "LGPL-3.0-only",
    "GPL-2.0-only",
    "GPL-3.0-only",
]);

/**
 * Validate an add-on manifest against the v1 schema.
 */
export function validateAddonManifest(manifest: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!manifest || typeof manifest !== "object") {
        return { valid: false, errors: ["Manifest must be a non-null object"], warnings };
    }

    const m = manifest as Record<string, unknown>;

    // ── Format version ──
    if (m.addonFormatVersion !== 1) {
        errors.push(`addonFormatVersion must be 1, got: ${m.addonFormatVersion}`);
    }

    // ── ID ──
    if (typeof m.id !== "string" || !REVERSE_DNS_RE.test(m.id)) {
        errors.push(`id must be a valid reverse-DNS string (e.g., "prism.addon.robotics"), got: "${m.id}"`);
    }

    // ── Name ──
    if (typeof m.name !== "string" || m.name.trim().length === 0) {
        errors.push("name must be a non-empty string");
    }

    // ── Version ──
    if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) {
        errors.push(`version must be valid semver, got: "${m.version}"`);
    }

    // ── Author ──
    if (!m.author || typeof m.author !== "object" || typeof (m.author as any).name !== "string") {
        errors.push("author must be an object with a 'name' string property");
    }

    // ── Description ──
    if (typeof m.description !== "string" || m.description.trim().length === 0) {
        errors.push("description must be a non-empty string");
    }

    // ── License ──
    if (typeof m.license !== "string") {
        errors.push("license must be a string");
    } else if (!OSI_LICENSES.has(m.license)) {
        warnings.push(`license "${m.license}" is not in the standard OSI set; manual review required`);
    }

    // ── Min PRISM version ──
    if (typeof m.minPrismVersion !== "string" || !SEMVER_RE.test(m.minPrismVersion)) {
        errors.push(`minPrismVersion must be valid semver, got: "${m.minPrismVersion}"`);
    }

    // ── Trust ──
    if (m.trust !== "certified") {
        errors.push(`trust must be "certified" for add-ons, got: "${m.trust}"`);
    }

    // ── Integration points ──
    if (!m.integrationPoints || typeof m.integrationPoints !== "object") {
        errors.push("integrationPoints must be an object");
    } else {
        const ip = m.integrationPoints as Record<string, unknown>;
        if (typeof ip.memorySubsystem !== "boolean") errors.push("integrationPoints.memorySubsystem must be boolean");
        if (typeof ip.dashboardTab !== "boolean") errors.push("integrationPoints.dashboardTab must be boolean");
        if (ip.dashboardTab && typeof ip.dashboardTabId !== "string") {
            errors.push("integrationPoints.dashboardTabId required when dashboardTab is true");
        }
        if (typeof ip.characterExtensions !== "boolean")
            errors.push("integrationPoints.characterExtensions must be boolean");
        for (const arrKey of [
            "dashboardSubPanels",
            "guardianSkills",
            "policyExtensions",
            "skillDefinitions",
            "adapterBridges",
        ]) {
            if (!Array.isArray(ip[arrKey])) errors.push(`integrationPoints.${arrKey} must be an array`);
        }
    }

    // ── Dependencies ──
    if (!m.dependencies || typeof m.dependencies !== "object") {
        errors.push("dependencies must be an object");
    } else {
        const d = m.dependencies as Record<string, unknown>;
        for (const arrKey of ["addons", "plugins", "systemCapabilities"]) {
            if (!Array.isArray(d[arrKey])) errors.push(`dependencies.${arrKey} must be an array`);
        }
    }

    // ── Council signoff (warning if missing, not error — dev mode) ──
    if (!m.governanceCouncilSignoff) {
        warnings.push("governanceCouncilSignoff is missing; add-on will run in dev/unsigned mode");
    }

    return { valid: errors.length === 0, errors, warnings };
}

/**
 * Parse and validate a JSON string as an AddonManifest.
 * Returns the typed manifest on success, throws on failure.
 */
export function parseAddonManifest(jsonString: string): AddonManifest {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonString);
    } catch (e) {
        throw new Error(`Failed to parse add-on manifest JSON: ${(e as Error).message}`);
    }

    const result = validateAddonManifest(parsed);
    if (!result.valid) {
        throw new Error(`Invalid add-on manifest:\n  ${result.errors.join("\n  ")}`);
    }

    if (result.warnings.length > 0) {
        console.warn(`[addon-validator] Warnings for manifest:\n  ${result.warnings.join("\n  ")}`);
    }

    return parsed as AddonManifest;
}
