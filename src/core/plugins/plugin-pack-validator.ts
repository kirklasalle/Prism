import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';

// ── Ed25519 Signature Support ─────────────────────────────────────────────────

export type PluginTrustTier = 'official' | 'community' | 'unsigned';

export interface SigningKeyEntry {
    keyId: string;
    tier: PluginTrustTier;
    label: string;
    algorithm: 'ed25519';
    publicKeyBase64: string;
    addedAt: string;
    expiresAt: string | null;
}

export interface SigningKeyRegistry {
    version: string;
    keys: SigningKeyEntry[];
}

/**
 * Verify an Ed25519 signature over the canonical manifest payload.
 * The payload is JSON.stringify(manifest) with 'security.signature' removed.
 *
 * @param manifest  The full parsed PluginPackManifest
 * @param signatureBase64  Base64-encoded 64-byte Ed25519 signature
 * @param publicKeyBase64  Base64-encoded DER SPKI Ed25519 public key
 * @returns true if the signature is valid, false otherwise
 */
export function verifyEd25519Signature(
    manifest: PluginPackManifest,
    signatureBase64: string,
    publicKeyBase64: string
): boolean {
    try {
        // Build canonical payload: manifest without the signature field itself
        const payload = buildSignaturePayload(manifest);
        const pubKeyDer = Buffer.from(publicKeyBase64, 'base64');
        const publicKey = crypto.createPublicKey({ key: pubKeyDer, format: 'der', type: 'spki' });
        const signature = Buffer.from(signatureBase64, 'base64');
        return crypto.verify(null, Buffer.from(payload, 'utf-8'), publicKey, signature);
    } catch {
        return false;
    }
}

/**
 * Build the canonical UTF-8 payload that is signed.
 * Removes security.signature and security.signature_algorithm from the manifest
 * before serializing, so signatures cover content but not the sig field itself.
 */
export function buildSignaturePayload(manifest: PluginPackManifest): string {
    const copy: PluginPackManifest = JSON.parse(JSON.stringify(manifest));
    if (copy.security) {
        delete (copy.security as Record<string, unknown>).signature;
        delete (copy.security as Record<string, unknown>).signature_algorithm;
        // If only the signature fields were present, drop the empty security
        // object entirely. Otherwise the verify-side payload (which sees the
        // signature fields) and the sign-side payload (which never had a
        // security field on a fresh manifest) would differ in shape — empty
        // `"security":{}` vs absent — and the signature would never verify.
        if (Object.keys(copy.security as Record<string, unknown>).length === 0) {
            delete (copy as unknown as Record<string, unknown>).security;
        }
    }
    return JSON.stringify(copy);
}

/**
 * Load the signing key registry from the given path (defaults to
 * <project-root>/config/plugin-signing-keys.json).
 */
export function loadSigningKeyRegistry(registryPath?: string): SigningKeyRegistry {
    const resolved = registryPath ?? path.join(process.cwd(), 'config', 'plugin-signing-keys.json');
    const raw = fs.readFileSync(resolved, 'utf-8');
    return JSON.parse(raw) as SigningKeyRegistry;
}

/**
 * Determine the trust tier for a manifest.
 * Returns 'official', 'community', or 'unsigned'.
 * Throws if `strict` is true and the tier is 'unsigned'.
 */
export function resolvePluginTrustTier(
    manifest: PluginPackManifest,
    registry: SigningKeyRegistry
): { tier: PluginTrustTier; keyId: string | null } {
    const sig = manifest.security?.signature;
    if (!sig) return { tier: 'unsigned', keyId: null };

    const now = Date.now();
    for (const entry of registry.keys) {
        if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now) continue;
        if (verifyEd25519Signature(manifest, sig, entry.publicKeyBase64)) {
            return { tier: entry.tier, keyId: entry.keyId };
        }
    }
    // Has signature but no key validated it — treat as unsigned (invalid sig)
    return { tier: 'unsigned', keyId: null };
}

/**
 * Plugin Pack Manifest Validator
 * Validates adapter/plugin packages against PRISM manifest schema
 */

export interface AdapterSpec {
    adapter_id: string;
    adapter_type: string;
    entry_file: string;
    capabilities: string[];
    tier_routing: {
        tier1_keywords?: string[];
        tier2_keywords?: string[];
        tier3_keywords?: string[];
        default_tier?: number;
    };
    description?: string;
    version?: string;
    dependencies?: Array<{
        adapter_id: string;
        min_version?: string;
        max_version?: string;
    }>;
    trust_level?: 'untrusted' | 'community' | 'verified' | 'official';
}

export interface PluginPackManifest {
    manifest_version: string;
    pack_name: string;
    pack_version: string;
    description: string;
    author: {
        name: string;
        email?: string;
        url?: string;
    };
    license: string;
    repository?: {
        type: string;
        url: string;
    };
    adapters: AdapterSpec[];
    compatibility: {
        prism_min_version: string;
        prism_max_version?: string;
        profiles: string[];
        node_version?: string;
        os?: string[];
    };
    install_requirements?: {
        permissions_required?: string[];
        environment_vars?: Array<{
            name: string;
            required?: boolean;
            description?: string;
        }>;
        disk_space_mb?: number;
    };
    security?: {
        review_status?: string;
        signature?: string;
        signature_algorithm?: string;
        known_issues?: Array<{
            id: string;
            severity: string;
            description: string;
            mitigated?: boolean;
        }>;
    };
    metadata?: {
        tags?: string[];
        released?: string;
        deprecated?: boolean;
        replacement_pack?: string;
    };
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    metadata: {
        timestamp: string;
        validatorVersion: string;
        packName: string;
        packVersion: string;
    };
}

export interface ValidationError {
    field: string;
    message: string;
    severity: 'critical' | 'error';
}

export interface ValidationWarning {
    field: string;
    message: string;
    suggestion?: string;
}

export class PluginPackValidator {
    private manifest: PluginPackManifest;
    private packPath: string;
    private errors: ValidationError[] = [];
    private warnings: ValidationWarning[] = [];
    private profile: 'individual' | 'business';
    private signingKeyRegistry: SigningKeyRegistry | null;

    /**
     * @param manifest  Parsed manifest object
     * @param packPath  Filesystem path to the plugin pack root
     * @param profile   Execution profile — 'business' rejects unsigned plugins; 'individual' warns only
     * @param signingKeyRegistryPath  Optional override for the signing key registry path
     */
    constructor(
        manifest: PluginPackManifest,
        packPath: string,
        profile: 'individual' | 'business' = 'individual',
        signingKeyRegistryPath?: string
    ) {
        this.manifest = manifest;
        this.packPath = packPath;
        this.profile = profile;
        try {
            this.signingKeyRegistry = loadSigningKeyRegistry(signingKeyRegistryPath);
        } catch {
            this.signingKeyRegistry = null;
        }
    }

    /**
     * Validate the plugin pack manifest
     */
    validate(): ValidationResult {
        this.errors = [];
        this.warnings = [];

        // Schema validation
        this.validateManifestVersion();
        this.validatePackName();
        this.validatePackVersion();
        this.validateDescription();
        this.validateAuthor();
        this.validateLicense();
        this.validateAdapters();
        this.validateCompatibility();
        this.validateInstallRequirements();
        this.validateSecurity();
        this.validateFilesExist();
        this.validateNoCircularDependencies();

        const valid = this.errors.length === 0;

        return {
            valid,
            errors: this.errors,
            warnings: this.warnings,
            metadata: {
                timestamp: new Date().toISOString(),
                validatorVersion: '1.0.0',
                packName: this.manifest.pack_name,
                packVersion: this.manifest.pack_version,
            },
        };
    }

    private validateManifestVersion(): void {
        if (!this.manifest.manifest_version) {
            this.errors.push({
                field: 'manifest_version',
                message: 'manifest_version is required',
                severity: 'critical',
            });
            return;
        }

        if (!/^1\.0$/.test(this.manifest.manifest_version)) {
            this.errors.push({
                field: 'manifest_version',
                message: `Invalid manifest version: ${this.manifest.manifest_version} (must be 1.0)`,
                severity: 'error',
            });
        }
    }

    private validatePackName(): void {
        if (!this.manifest.pack_name) {
            this.errors.push({
                field: 'pack_name',
                message: 'pack_name is required',
                severity: 'critical',
            });
            return;
        }

        if (!/^[a-z0-9-]+$/.test(this.manifest.pack_name)) {
            this.errors.push({
                field: 'pack_name',
                message: 'pack_name must contain only lowercase letters, numbers, and hyphens',
                severity: 'error',
            });
        }

        if (this.manifest.pack_name.length > 128) {
            this.errors.push({
                field: 'pack_name',
                message: 'pack_name must be <= 128 characters',
                severity: 'error',
            });
        }
    }

    private validatePackVersion(): void {
        if (!this.manifest.pack_version) {
            this.errors.push({
                field: 'pack_version',
                message: 'pack_version is required',
                severity: 'critical',
            });
            return;
        }

        const semverRegex =
            /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

        if (!semverRegex.test(this.manifest.pack_version)) {
            this.errors.push({
                field: 'pack_version',
                message: `Invalid semantic version: ${this.manifest.pack_version}`,
                severity: 'error',
            });
        }
    }

    private validateDescription(): void {
        if (!this.manifest.description) {
            this.errors.push({
                field: 'description',
                message: 'description is required',
                severity: 'critical',
            });
            return;
        }

        if (this.manifest.description.length < 10) {
            this.warnings.push({
                field: 'description',
                message: 'Description is very short; consider adding more detail',
                suggestion: 'Expand description to at least 50 characters',
            });
        }
    }

    private validateAuthor(): void {
        if (!this.manifest.author) {
            this.errors.push({
                field: 'author',
                message: 'author is required',
                severity: 'critical',
            });
            return;
        }

        if (!this.manifest.author.name) {
            this.errors.push({
                field: 'author.name',
                message: 'author.name is required',
                severity: 'error',
            });
        }

        if (this.manifest.author.email && !this.isValidEmail(this.manifest.author.email)) {
            this.warnings.push({
                field: 'author.email',
                message: `Invalid email format: ${this.manifest.author.email}`,
            });
        }
    }

    private validateLicense(): void {
        const validLicenses = [
            'Apache-2.0',
            'MIT',
            'GPL-3.0',
            'BSD-2-Clause',
            'BSD-3-Clause',
            'ISC',
            'Unlicense',
            'PRISM-EE',
            'PRISM-Community',
        ];

        if (!this.manifest.license) {
            this.errors.push({
                field: 'license',
                message: 'license is required',
                severity: 'critical',
            });
            return;
        }

        if (!validLicenses.includes(this.manifest.license)) {
            this.errors.push({
                field: 'license',
                message: `Unsupported license: ${this.manifest.license}. Supported: ${validLicenses.join(', ')}`,
                severity: 'error',
            });
        }
    }

    private validateAdapters(): void {
        if (!Array.isArray(this.manifest.adapters) || this.manifest.adapters.length === 0) {
            this.errors.push({
                field: 'adapters',
                message: 'adapters array is required and must contain at least one adapter',
                severity: 'critical',
            });
            return;
        }

        const adapterIds = new Set<string>();

        this.manifest.adapters.forEach((adapter, index) => {
            const prefix = `adapters[${index}]`;

            // Check for duplicate IDs
            if (adapterIds.has(adapter.adapter_id)) {
                this.errors.push({
                    field: `${prefix}.adapter_id`,
                    message: `Duplicate adapter_id: ${adapter.adapter_id}`,
                    severity: 'error',
                });
            }
            adapterIds.add(adapter.adapter_id);

            // Validate required fields
            if (!adapter.adapter_id) {
                this.errors.push({
                    field: `${prefix}.adapter_id`,
                    message: 'adapter_id is required',
                    severity: 'error',
                });
            }

            if (!adapter.adapter_type) {
                this.errors.push({
                    field: `${prefix}.adapter_type`,
                    message: 'adapter_type is required',
                    severity: 'error',
                });
            } else {
                const validTypes = ['terminal', 'container', 'protocol', 'system', 'application', 'custom'];
                if (!validTypes.includes(adapter.adapter_type)) {
                    this.errors.push({
                        field: `${prefix}.adapter_type`,
                        message: `Invalid adapter_type: ${adapter.adapter_type}. Valid types: ${validTypes.join(', ')}`,
                        severity: 'error',
                    });
                }
            }

            if (!adapter.entry_file) {
                this.errors.push({
                    field: `${prefix}.entry_file`,
                    message: 'entry_file is required',
                    severity: 'error',
                });
            }

            if (!Array.isArray(adapter.capabilities) || adapter.capabilities.length === 0) {
                this.errors.push({
                    field: `${prefix}.capabilities`,
                    message: 'capabilities is required and must contain at least one capability',
                    severity: 'error',
                });
            }

            if (!adapter.tier_routing) {
                this.errors.push({
                    field: `${prefix}.tier_routing`,
                    message: 'tier_routing is required',
                    severity: 'error',
                });
            } else {
                const defaultTier = adapter.tier_routing.default_tier || 2;
                if (![1, 2, 3].includes(defaultTier)) {
                    this.errors.push({
                        field: `${prefix}.tier_routing.default_tier`,
                        message: `Invalid default_tier: ${defaultTier}. Must be 1, 2, or 3`,
                        severity: 'error',
                    });
                }
            }

            // Validate trust_level
            if (adapter.trust_level) {
                const validTrustLevels = ['untrusted', 'community', 'verified', 'official'];
                if (!validTrustLevels.includes(adapter.trust_level)) {
                    this.warnings.push({
                        field: `${prefix}.trust_level`,
                        message: `Unknown trust_level: ${adapter.trust_level}`,
                    });
                }
            }
        });
    }

    private validateCompatibility(): void {
        if (!this.manifest.compatibility) {
            this.errors.push({
                field: 'compatibility',
                message: 'compatibility is required',
                severity: 'critical',
            });
            return;
        }

        if (!this.manifest.compatibility.prism_min_version) {
            this.errors.push({
                field: 'compatibility.prism_min_version',
                message: 'compatibility.prism_min_version is required',
                severity: 'error',
            });
        }

        if (
            !Array.isArray(this.manifest.compatibility.profiles) ||
            this.manifest.compatibility.profiles.length === 0
        ) {
            this.errors.push({
                field: 'compatibility.profiles',
                message: 'compatibility.profiles is required and must contain at least one profile',
                severity: 'error',
            });
        } else {
            const validProfiles = ['individual', 'business', 'both'];
            this.manifest.compatibility.profiles.forEach((profile) => {
                if (!validProfiles.includes(profile)) {
                    this.errors.push({
                        field: 'compatibility.profiles',
                        message: `Invalid profile: ${profile}. Valid profiles: ${validProfiles.join(', ')}`,
                        severity: 'error',
                    });
                }
            });
        }
    }

    private validateInstallRequirements(): void {
        const req = this.manifest.install_requirements;
        if (!req) return;

        if (req.disk_space_mb !== undefined && req.disk_space_mb < 0) {
            this.warnings.push({
                field: 'install_requirements.disk_space_mb',
                message: 'Negative disk space requirement is unusual',
            });
        }
    }

    private validateSecurity(): void {
        const sec = this.manifest.security;

        // ── Trust-tier enforcement ───────────────────────────────────────────
        if (this.signingKeyRegistry) {
            const { tier, keyId } = resolvePluginTrustTier(this.manifest, this.signingKeyRegistry);

            if (tier === 'unsigned') {
                if (this.profile === 'business') {
                    this.errors.push({
                        field: 'security.signature',
                        message: 'Business profile requires all plugins to be signed. This plugin is unsigned or has an invalid signature.',
                        severity: 'critical',
                    });
                } else {
                    // Individual profile: warn but allow
                    this.warnings.push({
                        field: 'security.signature',
                        message: 'Plugin is unsigned. Unsigned plugins are permitted in Individual profile but not in Business profile.',
                        suggestion: 'Request a signature from an official or community signer.',
                    });
                }
            } else {
                // Signed — add an informational warning for community tier
                if (tier === 'community') {
                    this.warnings.push({
                        field: 'security.signature',
                        message: `Plugin is signed by a community key (${keyId}). Verify trust before deployment.`,
                    });
                }
                // 'official' tier passes silently
            }

            // If a signature field exists but algorithm is wrong, flag it
            if (sec?.signature && sec.signature_algorithm && sec.signature_algorithm !== 'ed25519') {
                this.warnings.push({
                    field: 'security.signature_algorithm',
                    message: `Signature algorithm '${sec.signature_algorithm}' is not the preferred 'ed25519'. Verification was attempted with Ed25519.`,
                    suggestion: 'Use signature_algorithm: "ed25519"',
                });
            }
        } else {
            // No registry available — fallback: warn if signature present without algorithm
            if (sec?.signature && !sec.signature_algorithm) {
                this.warnings.push({
                    field: 'security.signature',
                    message: 'Signature present but signature_algorithm not specified',
                    suggestion: 'Add signature_algorithm: "ed25519"',
                });
            }
        }

        if (sec?.review_status === 'unreviewed') {
            this.warnings.push({
                field: 'security.review_status',
                message: 'Pack has not been security reviewed',
                suggestion: 'Submit for community or security review before production use',
            });
        }
    }

    private validateFilesExist(): void {
        // Check that entry files for adapters exist
        this.manifest.adapters.forEach((adapter, index) => {
            const entryPath = path.join(this.packPath, adapter.entry_file);
            try {
                if (!fs.existsSync(entryPath)) {
                    this.errors.push({
                        field: `adapters[${index}].entry_file`,
                        message: `Entry file not found: ${adapter.entry_file} (resolved to: ${entryPath})`,
                        severity: 'error',
                    });
                }
            } catch {
                this.warnings.push({
                    field: `adapters[${index}].entry_file`,
                    message: `Could not verify existence of entry file (may be OK if packPath is relative): ${adapter.entry_file}`,
                });
            }
        });
    }

    private validateNoCircularDependencies(): void {
        // Build dependency graph and check for cycles
        const dependencyMap = new Map<string, Set<string>>();

        this.manifest.adapters.forEach((adapter) => {
            const deps = new Set<string>();
            if (adapter.dependencies) {
                adapter.dependencies.forEach((dep) => {
                    deps.add(dep.adapter_id);
                });
            }
            dependencyMap.set(adapter.adapter_id, deps);
        });

        // Simple cycle detection: DFS
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCycle = (id: string): boolean => {
            visited.add(id);
            recursionStack.add(id);

            const deps = dependencyMap.get(id) || new Set();
            for (const dep of deps) {
                if (!visited.has(dep)) {
                    if (hasCycle(dep)) return true;
                } else if (recursionStack.has(dep)) {
                    return true;
                }
            }

            recursionStack.delete(id);
            return false;
        };

        for (const adapterId of dependencyMap.keys()) {
            if (!visited.has(adapterId)) {
                if (hasCycle(adapterId)) {
                    this.errors.push({
                        field: 'adapters.dependencies',
                        message: `Circular dependency detected involving adapter: ${adapterId}`,
                        severity: 'error',
                    });
                    break;
                }
            }
        }
    }

    private isValidEmail(email: string): boolean {
        // Simple email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
}

/**
 * Load and validate a plugin pack manifest from JSON file
 */
export async function validatePluginPack(
    manifestPath: string,
    packPath?: string,
    profile: 'individual' | 'business' = 'individual',
    signingKeyRegistryPath?: string
): Promise<ValidationResult> {
    try {
        const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
        const manifest: PluginPackManifest = JSON.parse(manifestContent);

        const resolvedPackPath = packPath || path.dirname(manifestPath);
        const validator = new PluginPackValidator(manifest, resolvedPackPath, profile, signingKeyRegistryPath);

        return validator.validate();
    } catch (error) {
        return {
            valid: false,
            errors: [
                {
                    field: 'manifest',
                    message: `Failed to load manifest: ${error instanceof Error ? error.message : String(error)}`,
                    severity: 'critical',
                },
            ],
            warnings: [],
            metadata: {
                timestamp: new Date().toISOString(),
                validatorVersion: '1.0.0',
                packName: 'unknown',
                packVersion: 'unknown',
            },
        };
    }
}
