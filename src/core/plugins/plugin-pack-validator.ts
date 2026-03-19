import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

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

    constructor(manifest: PluginPackManifest, packPath: string) {
        this.manifest = manifest;
        this.packPath = packPath;
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
        if (!sec) return;

        if (sec.signature && !sec.signature_algorithm) {
            this.warnings.push({
                field: 'security.signature',
                message: 'Signature present but signature_algorithm not specified',
                suggestion: 'Add signature_algorithm (e.g., rsa-4096, ecdsa-384)',
            });
        }

        if (sec.review_status === 'unreviewed') {
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
    packPath?: string
): Promise<ValidationResult> {
    try {
        const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
        const manifest: PluginPackManifest = JSON.parse(manifestContent);

        const resolvedPackPath = packPath || path.dirname(manifestPath);
        const validator = new PluginPackValidator(manifest, resolvedPackPath);

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
