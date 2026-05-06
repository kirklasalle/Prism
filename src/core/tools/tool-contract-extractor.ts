/**
 * Tool Contract Extractor
 * 
 * Extracts tool contracts from three sources (manifest, decorators, dynamic),
 * compares against baseline for breaking changes, assigns risk tier via
 * keyword scoring, and routes high-risk changes through approval gates.
 * 
 * Supports deterministic replay validation for Stage 2 testing.
 * 
 * See: TOOL_CONTRACT_EXTRACTION_SPEC.md for full specification
 * 
 * @module core/tools/tool-contract-extractor
 */

import sqlite3 from "sqlite3";
import { v4 as uuidv4 } from "uuid";
import { PolicyEngine } from "../policy/engine.js";
import { ActivityBus } from "../activity/bus.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { ToolRegistry } from "./registry.js";
import type { Tool } from "./types.js";

/**
 * Tool contract definition
 */
export interface ToolContract {
    tool_id: string;
    tool_name: string;
    version: string;
    parameters: Record<string, any>;
    return_type: string;
    description: string;
    extraction_method: "manifest" | "decorator" | "dynamic";
    risk_tier: "tier1" | "tier2" | "tier3";
    extracted_at: string;
}

/**
 * Contract comparison result
 */
export interface ContractComparison {
    tool_id: string;
    baseline_version: string;
    current_version: string;
    breaking_changes: string[];
    safe_additions: string[];
    deprecations: string[];
    risk_assessment: string;
    requires_approval: boolean;
}

/**
 * Extraction request
 */
export interface ExtractionRequest {
    request_id: string;
    tool_ids?: string[];
    sources: ("manifest" | "decorator" | "dynamic")[];
    baseline_comparison: boolean;
    risk_assessment: boolean;
    approval_routing: boolean;
    created_at: string;
}

/**
 * Extraction result
 */
export interface ExtractionResult {
    request_id: string;
    extracted_contracts: ToolContract[];
    comparisons: ContractComparison[];
    risk_summary: Record<string, number>;
    approval_required: boolean;
    status: "success" | "partial" | "failed";
    details: string;
}

/**
 * Risk scoring keywords
 */
const HIGH_RISK_KEYWORDS = [
    "delete", "destroy", "remove", "uninstall", "reset", "wipe",
    "revoke", "terminate", "halt", "shutdown", "kill", "abort",
    "dangerous", "unsafe", "privileged", "elevated", "root",
    "kernel", "system", "critical"
];

const BREAKING_CHANGE_KEYWORDS = [
    "removed", "deleted", "deprecated", "no_longer", "incompatible",
    "changed", "renamed", "moved", "migrated", "breaking"
];

/**
 * Tool Contract Extractor
 * 
 * Orchestrates contract extraction from multiple sources, validates against
 * baseline, scores risk, and routes through approval gates for deployment.
 */
export class ToolContractExtractor {
    private db: sqlite3.Database;
    private policyEngine: PolicyEngine;
    private activityBus: ActivityBus;
    private manifestCache: Map<string, ToolContract> = new Map();
    private baselineCache: Map<string, ToolContract> = new Map();
    private initializationPromise: Promise<void>;
    private toolRegistry: ToolRegistry | null = null;
    private manifestPaths: string[] = [];

    constructor(db: sqlite3.Database, policyEngine: PolicyEngine, activityBus: ActivityBus) {
        this.db = db;
        this.policyEngine = policyEngine;
        this.activityBus = activityBus;
        this.initializationPromise = this.initializeDatabase();
    }

    /**
     * Wire a ToolRegistry for registry-based extraction (decorator + dynamic methods).
     * When set, extractFromDecorators() scans for tools with explicit contracts,
     * and extractFromDynamic() infers contracts from governance schemas.
     */
    setToolRegistry(registry: ToolRegistry): void {
        this.toolRegistry = registry;
    }

    /**
     * Add manifest search paths. extractFromManifest() will scan these directories
     * for `tool-contract.json` files and `tool-contract-snapshot.json` manifests.
     */
    addManifestPath(dirPath: string): void {
        if (!this.manifestPaths.includes(dirPath)) {
            this.manifestPaths.push(dirPath);
        }
    }

    /**
     * Initialize SQLite schema
     * @private
     */
    private initializeDatabase(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS tool_contracts (
                        tool_id TEXT PRIMARY KEY,
                        tool_name TEXT NOT NULL,
                        version TEXT NOT NULL,
                        parameters TEXT NOT NULL,
                        return_type TEXT NOT NULL,
                        description TEXT,
                        extraction_method TEXT NOT NULL,
                        risk_tier TEXT NOT NULL,
                        extracted_at TEXT NOT NULL,
                        created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS contract_baseline (
                            baseline_id TEXT PRIMARY KEY,
                            tool_id TEXT NOT NULL,
                            version TEXT NOT NULL,
                            parameters TEXT NOT NULL,
                            return_type TEXT NOT NULL,
                            baseline_date TEXT NOT NULL,
                            created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE(tool_id, version)
                        )
                    `, (baselineErr) => {
                        if (baselineErr) {
                            reject(baselineErr);
                            return;
                        }

                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS extraction_requests (
                                request_id TEXT PRIMARY KEY,
                                tool_ids TEXT,
                                sources TEXT NOT NULL,
                                baseline_comparison BOOLEAN NOT NULL,
                                risk_assessment BOOLEAN NOT NULL,
                                approval_routing BOOLEAN NOT NULL,
                                created_at TEXT NOT NULL,
                                status TEXT NOT NULL,
                                result_summary TEXT,
                                created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                            )
                        `, (requestErr) => {
                            if (requestErr) {
                                reject(requestErr);
                                return;
                            }

                            this.db.run(`
                                CREATE TABLE IF NOT EXISTS contract_changes (
                                    change_id TEXT PRIMARY KEY,
                                    tool_id TEXT NOT NULL,
                                    baseline_version TEXT NOT NULL,
                                    current_version TEXT NOT NULL,
                                    change_type TEXT NOT NULL,
                                    breaking BOOLEAN NOT NULL,
                                    risk_score INTEGER NOT NULL,
                                    details TEXT,
                                    approval_status TEXT DEFAULT 'pending',
                                    created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                    FOREIGN KEY(tool_id) REFERENCES tool_contracts(tool_id)
                                )
                            `, (changesErr) => {
                                if (changesErr) {
                                    reject(changesErr);
                                } else {
                                    resolve();
                                }
                            });
                        });
                    });
                });
            });
        });
    }

    /**
     * Extract contracts from all specified sources
     * 
     * @param request - Extraction request with source specification
     * @returns Extraction result with contracts and analysis
     */
    async extractContracts(request: ExtractionRequest): Promise<ExtractionResult> {
        await this.initializationPromise;
        const extracted_contracts: ToolContract[] = [];
        const comparisons: ContractComparison[] = [];
        const risk_summary: Record<string, number> = { tier1: 0, tier2: 0, tier3: 0 };

        try {
            // Step 1: Extract from manifest
            if (request.sources.includes("manifest")) {
                const manifestContracts = await this.extractFromManifest(request.tool_ids);
                extracted_contracts.push(...manifestContracts);
            }

            // Step 2: Extract from decorators
            if (request.sources.includes("decorator")) {
                const decoratorContracts = await this.extractFromDecorators(request.tool_ids);
                extracted_contracts.push(...decoratorContracts);
            }

            // Step 3: Extract from dynamic inspection
            if (request.sources.includes("dynamic")) {
                const dynamicContracts = await this.extractFromDynamic(request.tool_ids);
                extracted_contracts.push(...dynamicContracts);
            }

            // Step 4: Baseline comparison
            if (request.baseline_comparison) {
                for (const contract of extracted_contracts) {
                    const comparison = await this.compareWithBaseline(contract);
                    if (comparison) {
                        comparisons.push(comparison);
                    }
                }
            }

            // Step 5: Risk assessment
            if (request.risk_assessment) {
                for (const contract of extracted_contracts) {
                    const riskTier = await this.assessRiskTier(contract);
                    contract.risk_tier = riskTier;
                    risk_summary[riskTier]++;
                }
            }

            // Step 6: Persist contracts
            for (const contract of extracted_contracts) {
                await this.persistContract(contract);
            }

            // Step 7: Approval routing
            let approval_required = false;
            if (request.approval_routing) {
                approval_required = await this.routeForApproval(request.request_id, comparisons);
            }

            // Step 8: Persist request
            await this.persistExtractionRequest(request, extracted_contracts.length, approval_required);

            // Emit activity
            this.activityBus.emit({
                sessionId: request.request_id,
                layer: "governance",
                operation: "contract_extraction",
                status: "succeeded",
                details: {
                    contract_count: extracted_contracts.length,
                    risk_summary,
                    approval_required
                },
                authorityTier: approval_required ? "tier3_approval" : "tier2_conditional",
                policyDecision: "allow"
            });

            return {
                request_id: request.request_id,
                extracted_contracts,
                comparisons,
                risk_summary,
                approval_required,
                status: "success",
                details: `Extracted ${extracted_contracts.length} contracts from ${request.sources.join(", ")}`
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Emit failure activity
            this.activityBus.emit({
                sessionId: request.request_id,
                layer: "governance",
                operation: "contract_extraction",
                status: "failed",
                details: { error: errorMsg },
                authorityTier: "tier1_autonomous",
                policyDecision: "deny"
            });

            return {
                request_id: request.request_id,
                extracted_contracts: [],
                comparisons: [],
                risk_summary,
                approval_required: false,
                status: "failed",
                details: errorMsg
            };
        }
    }

    /**
     * Extract contracts from manifest files.
     * Scans configured manifest paths for:
     *   - `tool-contract.json` files (direct contract manifests per spec §3.1 Method 1)
     *   - `tool-contract-snapshot.json` files (snapshot manifests with multiple tools)
     *   - Subdirectory manifests: `<dir>/<tool-name>/tool-contract.json`
     *
     * Falls back to simulated data when no manifest paths are configured.
     *
     * @private
     * @param tool_ids - Optional filter for specific tool IDs
     * @returns Contracts extracted from manifest files
     */
    private async extractFromManifest(tool_ids?: string[]): Promise<ToolContract[]> {
        const contracts: ToolContract[] = [];

        // Scan configured manifest paths for real files
        for (const dirPath of this.manifestPaths) {
            if (!existsSync(dirPath)) continue;

            // Check for direct tool-contract.json in directory
            const directManifest = join(dirPath, "tool-contract.json");
            if (existsSync(directManifest)) {
                const parsed = this.parseManifestFile(directManifest);
                if (parsed) contracts.push(parsed);
            }

            // Check for snapshot manifest
            const snapshotManifest = join(dirPath, "tool-contract-snapshot.json");
            if (existsSync(snapshotManifest)) {
                const snapContracts = this.parseSnapshotManifest(snapshotManifest);
                contracts.push(...snapContracts);
            }

            // Scan subdirectories for per-tool manifests
            try {
                const entries = readdirSync(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subManifest = join(dirPath, entry.name, "tool-contract.json");
                        if (existsSync(subManifest)) {
                            const parsed = this.parseManifestFile(subManifest);
                            if (parsed) contracts.push(parsed);
                        }
                    }
                }
            } catch {
                // Directory listing failed — skip
            }
        }

        if (contracts.length === 0 && this.manifestPaths.length === 0) {
            throw new Error("No manifest paths configured for extraction.");
        }

        if (tool_ids && tool_ids.length > 0) {
            return contracts.filter(c => tool_ids.includes(c.tool_id));
        }

        return contracts;
    }

    /**
     * Parse a single tool-contract.json manifest file per spec §3.1 Method 1.
     * Expected format: { "_meta": {...}, "tool_contract": { ... } } or direct ToolContract shape.
     *
     * @private
     */
    private parseManifestFile(filePath: string): ToolContract | null {
        try {
            const raw = readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(raw);

            // Support spec format: { _meta, tool_contract: { ... } }
            const src = parsed.tool_contract || parsed;

            return {
                tool_id: src.tool_id || src.tool_name || uuidv4(),
                tool_name: src.tool_name || src.name || basename(filePath, ".json"),
                version: src.version || "0.0.0",
                parameters: src.input_schema?.properties || src.parameters || src.args || {},
                return_type: src.output_schema?.type || src.return_type || "unknown",
                description: src.description || "",
                extraction_method: "manifest",
                risk_tier: src.risk_tier || "tier2",
                extracted_at: new Date().toISOString()
            };
        } catch {
            return null;
        }
    }

    /**
     * Parse a tool-contract-snapshot.json file (generated by contract-snapshot.ts).
     *
     * @private
     */
    private parseSnapshotManifest(filePath: string): ToolContract[] {
        try {
            const raw = readFileSync(filePath, "utf-8");
            const snapshot = JSON.parse(raw);
            const tools: ToolContract[] = [];

            for (const entry of snapshot.tools || []) {
                tools.push({
                    tool_id: entry.name || uuidv4(),
                    tool_name: entry.name,
                    version: entry.version || "0.0.0",
                    parameters: this.convertArgSchemaToParams(entry.args || {}),
                    return_type: "unknown",
                    description: `Tool: ${entry.name}`,
                    extraction_method: "manifest",
                    risk_tier: "tier1",
                    extracted_at: new Date().toISOString()
                });
            }

            return tools;
        } catch {
            return [];
        }
    }

    /**
     * Convert ToolArgSchema map (from contracts.ts) to simple parameter map.
     * @private
     */
    private convertArgSchemaToParams(args: Record<string, any>): Record<string, any> {
        const params: Record<string, any> = {};
        for (const [name, schema] of Object.entries(args)) {
            params[name] = schema?.type || "unknown";
        }
        return params;
    }

    /**
     * Extract contracts from tools with explicit contract declarations.
     * Scans the ToolRegistry for tools that have a `contract` property
     * (analogous to decorator-based metadata per spec §3.1 Method 2).
     *
     * Falls back to simulated data when no registry is configured.
     *
     * @private
     * @param tool_ids - Optional filter for specific tool IDs
     * @returns Contracts extracted from tool declarations
     */
    private async extractFromDecorators(tool_ids?: string[]): Promise<ToolContract[]> {
        if (this.toolRegistry) {
            const contracts: ToolContract[] = [];
            for (const tool of this.toolRegistry.list()) {
                if (tool.contract) {
                    contracts.push(this.toolToContract(tool, "decorator"));
                }
            }
            if (tool_ids && tool_ids.length > 0) {
                return contracts.filter(c => tool_ids.includes(c.tool_id));
            }
            return contracts;
        }

        throw new Error("ToolRegistry is required for decorator extraction, but none was configured.");
    }

    /**
     * Extract contracts via runtime inspection of the ToolRegistry.
     * For tools without explicit contracts, infers contracts from governance
     * schemas and tool metadata (per spec §3.1 Method 3).
     *
     * Falls back to simulated data when no registry is configured.
     *
     * @private
     * @param tool_ids - Optional filter for specific tool IDs
     * @returns Contracts extracted dynamically
     */
    private async extractFromDynamic(tool_ids?: string[]): Promise<ToolContract[]> {
        if (this.toolRegistry) {
            const contracts: ToolContract[] = [];
            for (const tool of this.toolRegistry.list()) {
                // Only infer for tools WITHOUT explicit contracts (those are handled by decorator method)
                if (!tool.contract && tool.governance) {
                    contracts.push(this.inferContractFromGovernance(tool));
                }
            }
            if (tool_ids && tool_ids.length > 0) {
                return contracts.filter(c => tool_ids.includes(c.tool_id));
            }
            return contracts;
        }

        throw new Error("ToolRegistry is required for dynamic extraction, but none was configured.");
    }

    /**
     * Convert a registered Tool (with explicit contract) into the extractor ToolContract format.
     * @private
     */
    private toolToContract(tool: Tool, method: "manifest" | "decorator" | "dynamic"): ToolContract {
        const contract = tool.contract!;
        const hasMutatingActions = tool.governance
            ? Object.values(tool.governance.actions).some(a => a.mutating)
            : false;

        return {
            tool_id: tool.name,
            tool_name: tool.name,
            version: contract.version,
            parameters: this.convertArgSchemaToParams(contract.args),
            return_type: "ToolResult",
            description: `Registered tool: ${tool.name}`,
            extraction_method: method,
            risk_tier: hasMutatingActions ? "tier2" : "tier1",
            extracted_at: new Date().toISOString()
        };
    }

    /**
     * Infer a contract from a tool's governance schema when no explicit contract exists.
     * Uses governance action rules to determine parameters and risk (spec §3.1 Method 3).
     * @private
     */
    private inferContractFromGovernance(tool: Tool): ToolContract {
        const governance = tool.governance!;
        const actions = Object.keys(governance.actions);
        const hasMutating = Object.values(governance.actions).some(a => a.mutating);
        const hasHighRisk = Object.values(governance.actions).some(a => a.minimumRisk === "high");

        // Infer parameters from action names
        const parameters: Record<string, any> = {
            action: "string",
        };
        for (const actionName of actions) {
            parameters[`${actionName}_args`] = "object";
        }

        const riskTier = hasHighRisk ? "tier3" : hasMutating ? "tier2" : "tier1";

        return {
            tool_id: tool.name,
            tool_name: tool.name,
            version: "0.0.0",
            parameters,
            return_type: "ToolResult",
            description: `Inferred from governance: ${actions.join(", ")}`,
            extraction_method: "dynamic",
            risk_tier: riskTier,
            extracted_at: new Date().toISOString()
        };
    }

    /**
     * Compare extracted contract against baseline version
     * 
     * @private
     * @param current - Current contract to compare
     * @returns Comparison result with change analysis
     */
    private async compareWithBaseline(current: ToolContract): Promise<ContractComparison | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT tool_id, version, parameters, return_type FROM contract_baseline WHERE tool_id = ? ORDER BY created_timestamp DESC LIMIT 1`,
                [current.tool_id],
                (err: any, row: any) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Check in-memory cache first (useful for unit tests and recent lookups)
                    const cachedBaseline = this.baselineCache.get(current.tool_id);
                    if (cachedBaseline && !row) {
                        row = {
                            version: cachedBaseline.version,
                            parameters: JSON.stringify(cachedBaseline.parameters),
                            return_type: cachedBaseline.return_type
                        };
                    }

                    if (!row) {
                        // No baseline exists, not a breaking change
                        resolve({
                            tool_id: current.tool_id,
                            baseline_version: "none",
                            current_version: current.version,
                            breaking_changes: [],
                            safe_additions: Object.keys(current.parameters),
                            deprecations: [],
                            risk_assessment: "new_tool",
                            requires_approval: false
                        });
                        return;
                    }

                    let parsedParameters: Record<string, any> = {};
                    try {
                        parsedParameters = JSON.parse(row.parameters);
                    } catch {
                        parsedParameters = {};
                    }

                    const baseline = {
                        version: row.version,
                        parameters: parsedParameters,
                        return_type: row.return_type
                    };

                    const breaking_changes: string[] = [];
                    const safe_additions: string[] = [];
                    const deprecations: string[] = [];

                    // Check parameter changes
                    for (const [paramName, paramType] of Object.entries(baseline.parameters)) {
                        if (!current.parameters[paramName]) {
                            breaking_changes.push(`removed_parameter: ${paramName}`);
                        } else if (current.parameters[paramName] !== paramType) {
                            breaking_changes.push(`changed_type: ${paramName} (was ${paramType})`);
                        }
                    }

                    // Check new parameters
                    for (const paramName of Object.keys(current.parameters)) {
                        if (!baseline.parameters[paramName]) {
                            safe_additions.push(paramName);
                        }
                    }

                    // Check return type change
                    if (baseline.return_type !== current.return_type) {
                        breaking_changes.push(`return_type_changed: ${baseline.return_type} → ${current.return_type}`);
                    }

                    const requires_approval = breaking_changes.length > 0;
                    const risk_assessment = breaking_changes.length > 0 ? "breaking_changes" : "safe_update";

                    resolve({
                        tool_id: current.tool_id,
                        baseline_version: baseline.version,
                        current_version: current.version,
                        breaking_changes,
                        safe_additions,
                        deprecations,
                        risk_assessment,
                        requires_approval
                    });
                }
            );
        });
    }

    /**
     * Assess risk tier based on contract content
     * 
     * @private
     * @param contract - Contract to assess
     * @returns Risk tier assignment
     */
    private async assessRiskTier(contract: ToolContract): Promise<"tier1" | "tier2" | "tier3"> {
        let riskScore = 0;

        // Score based on keywords in description
        const description = contract.description.toLowerCase();
        for (const keyword of HIGH_RISK_KEYWORDS) {
            if (description.includes(keyword)) {
                riskScore += 3;
            }
        }

        for (const keyword of BREAKING_CHANGE_KEYWORDS) {
            if (description.includes(keyword)) {
                riskScore += 2;
            }
        }

        // Score based on parameter count (complex APIs carry more risk)
        const paramCount = Object.keys(contract.parameters).length;
        if (paramCount > 8) {
            riskScore += 2;
        } else if (paramCount > 5) {
            riskScore += 1;
        }

        // Score based on parameter types indicating side effects
        const paramValues = Object.values(contract.parameters).map(v => String(v).toLowerCase());
        const sideEffectParamKeywords = ["file", "path", "url", "host", "command", "shell", "exec", "network", "socket"];
        for (const val of paramValues) {
            for (const kw of sideEffectParamKeywords) {
                if (val.includes(kw)) {
                    riskScore += 1;
                    break;
                }
            }
        }

        // Score based on parameter names indicating mutation
        const mutationParamNames = ["target", "destination", "overwrite", "force", "recursive", "cascade"];
        for (const name of Object.keys(contract.parameters)) {
            if (mutationParamNames.includes(name.toLowerCase())) {
                riskScore += 1;
            }
        }

        // Score based on tool name patterns
        const toolName = contract.tool_name.toLowerCase();
        const mutatingToolPatterns = ["write", "exec", "shell", "delete", "send", "deploy", "push"];
        for (const pattern of mutatingToolPatterns) {
            if (toolName.includes(pattern)) {
                riskScore += 2;
            }
        }

        // If registry-sourced, check governance schema for elevated risk
        if (this.toolRegistry && this.toolRegistry.has(contract.tool_name)) {
            const tool = this.toolRegistry.get(contract.tool_name);
            if (tool.governance) {
                for (const rule of Object.values(tool.governance.actions)) {
                    if (rule.mutating) riskScore += 2;
                    if (rule.minimumRisk === "high") riskScore += 3;
                    if (rule.rollbackRequired) riskScore += 1;
                }
            }
        }

        // Determine tier (per spec: score >= 8 → tier3, >= 3 → tier2, else tier1)
        if (riskScore >= 8) {
            return "tier3";
        } else if (riskScore >= 3) {
            return "tier2";
        } else {
            return "tier1";
        }
    }

    /**
     * Route contracts requiring approval through policy gates
     * 
     * @private
     * @param request_id - Extraction request ID
     * @param comparisons - Contract comparisons
     * @returns Whether approval is required
     */
    private async routeForApproval(
        request_id: string,
        comparisons: ContractComparison[]
    ): Promise<boolean> {
        const approvalsNeeded = comparisons.filter(c => c.requires_approval);

        if (approvalsNeeded.length === 0) {
            return false;
        }

        // Log approval requirements
        for (const comp of approvalsNeeded) {
            await new Promise<void>((resolve, reject) => {
                this.db.run(
                    `INSERT INTO contract_changes
                     (change_id, tool_id, baseline_version, current_version, change_type, breaking, risk_score, details, approval_status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        uuidv4(),
                        comp.tool_id,
                        comp.baseline_version,
                        comp.current_version,
                        "signature_change",
                        comp.breaking_changes.length > 0 ? 1 : 0,
                        comp.breaking_changes.length * 2,
                        JSON.stringify(comp.breaking_changes),
                        "pending"
                    ],
                    (err: any) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }

        return true;
    }

    /**
     * Stage contract for deployment after approval
     * 
     * @param request_id - Extraction request ID
     * @param approval - Whether approved
     * @returns Deployment status
     */
    async stageForDeployment(
        request_id: string,
        approval: boolean
    ): Promise<{ request_id: string; staged: boolean; details: string }> {
        await this.initializationPromise;
        if (!approval) {
            return {
                request_id,
                staged: false,
                details: "Deployment blocked due to missing approval"
            };
        }

        // Mark all pending changes as approved
        await new Promise<void>((resolve, reject) => {
            this.db.run(
                `UPDATE contract_changes SET approval_status = 'approved' WHERE approval_status = 'pending'`,
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Emit activity
        this.activityBus.emit({
            sessionId: request_id,
            layer: "governance",
            operation: "contract_staging",
            status: "succeeded",
            details: { request_id },
            authorityTier: "tier3_approval",
            policyDecision: "allow"
        });

        return {
            request_id,
            staged: true,
            details: "Contracts staged for deployment"
        };
    }

    /**
     * Get current extraction request status
     * 
     * @param request_id - Request ID
     * @returns Request status and results
     */
    async getExtractionStatus(request_id: string): Promise<ExtractionRequest | null> {
        await this.initializationPromise;
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT request_id, tool_ids, sources, baseline_comparison, risk_assessment, approval_routing, created_at, status
                 FROM extraction_requests
                 WHERE request_id = ?`,
                [request_id],
                (err: any, row: any) => {
                    if (err) {
                        reject(err);
                    } else if (!row) {
                        resolve(null);
                    } else {
                        resolve({
                            request_id: row.request_id,
                            tool_ids: row.tool_ids ? row.tool_ids.split(",") : undefined,
                            sources: row.sources.split(","),
                            baseline_comparison: Boolean(row.baseline_comparison),
                            risk_assessment: Boolean(row.risk_assessment),
                            approval_routing: Boolean(row.approval_routing),
                            created_at: row.created_at
                        });
                    }
                }
            );
        });
    }

    /**
     * Persist extracted contract
     * 
     * @private
     * @param contract - Contract to persist
     */
    private async persistContract(contract: ToolContract): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO tool_contracts
                 (tool_id, tool_name, version, parameters, return_type, description, extraction_method, risk_tier, extracted_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    contract.tool_id,
                    contract.tool_name,
                    contract.version,
                    JSON.stringify(contract.parameters),
                    contract.return_type,
                    contract.description,
                    contract.extraction_method,
                    contract.risk_tier,
                    contract.extracted_at
                ],
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    /**
     * Update the approval status of a single tool's pending contract change.
     *
     * This is the per-tool counterpart to {@link resolveApproval} (which acts on
     * the entire request). It is the bidirectional callback target wired from
     * {@link ApprovalQueue} resolutions in `dashboard-service.ts` so that
     * approve/deny/timeout decisions made by an operator flow back into the
     * `contract_changes` table.
     *
     * @param tool_id - Tool identifier whose pending change should be updated
     * @param decision - "approved" | "denied" | "timeout"
     * @param decisionContext - Optional metadata (decidedBy, decidedAt, source)
     * @returns Whether a row was updated
     */
    async consumeApprovalDecision(
        tool_id: string,
        decision: "approved" | "denied" | "timeout",
        decisionContext?: { decidedBy?: string; decidedAt?: string; decisionSource?: string }
    ): Promise<{ tool_id: string; decision: typeof decision; updated: boolean }> {
        await this.initializationPromise;

        const updated = await new Promise<number>((resolve, reject) => {
            this.db.run(
                `UPDATE contract_changes
                 SET approval_status = ?
                 WHERE tool_id = ? AND approval_status = 'pending'`,
                [decision, tool_id],
                function (this: { changes: number }, err: any) {
                    if (err) reject(err);
                    else resolve(this.changes ?? 0);
                }
            );
        });

        // If no pending row existed (e.g. tier-3 enqueued without a baseline-diff
        // comparison), insert a synthetic record so polling clients can read the
        // resolved decision via getContractChangeStatus().
        if (updated === 0) {
            await new Promise<void>((resolve, reject) => {
                this.db.run(
                    `INSERT INTO contract_changes
                     (change_id, tool_id, baseline_version, current_version, change_type, breaking, risk_score, details, approval_status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        uuidv4(),
                        tool_id,
                        "",
                        "",
                        "approval_only",
                        0,
                        0,
                        JSON.stringify({ source: decisionContext?.decisionSource ?? "approval_queue" }),
                        decision,
                    ],
                    (err: any) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }

        this.activityBus.emit({
            sessionId: tool_id,
            layer: "governance",
            operation: "tool.stage.approval_resolved",
            status: decision === "approved" ? "succeeded" : "failed",
            details: {
                tool_id,
                decision,
                decidedBy: decisionContext?.decidedBy,
                decidedAt: decisionContext?.decidedAt ?? new Date().toISOString(),
                decisionSource: decisionContext?.decisionSource ?? "approval_queue",
                rows_updated: updated,
            },
            authorityTier: "tier3_approval",
            policyDecision: decision === "approved" ? "allow" : "deny",
        });

        return { tool_id, decision, updated: true };
    }

    /**
     * Read the latest approval status for a tool's contract change.
     * Used by polling clients (e.g. `GET /api/tools/stage/status?tool_id=...`).
     *
     * @param tool_id - Tool identifier
     * @returns Status row, or null if no contract change exists for the tool
     */
    async getContractChangeStatus(
        tool_id: string
    ): Promise<{ tool_id: string; approval_status: string; change_id: string; created_timestamp: string } | null> {
        await this.initializationPromise;
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT change_id, tool_id, approval_status, created_timestamp
                 FROM contract_changes
                 WHERE tool_id = ?
                 ORDER BY created_timestamp DESC
                 LIMIT 1`,
                [tool_id],
                (err: any, row: any) => {
                    if (err) reject(err);
                    else if (!row) resolve(null);
                    else resolve({
                        tool_id: row.tool_id,
                        approval_status: row.approval_status,
                        change_id: row.change_id,
                        created_timestamp: row.created_timestamp,
                    });
                }
            );
        });
    }

    /**
     * Resolve approval and register staged tools into the ToolRegistry.
     * Called when an approval decision is received (approve/reject).
     *
     * @param request_id - Extraction request ID
     * @param approved - Whether the contracts are approved
     * @returns Resolution result with registered tool names
     */
    async resolveApproval(
        request_id: string,
        approved: boolean
    ): Promise<{ request_id: string; resolved: boolean; registered: string[]; details: string }> {
        await this.initializationPromise;

        // Stage or reject
        const staging = await this.stageForDeployment(request_id, approved);
        if (!staging.staged) {
            this.activityBus.emit({
                sessionId: request_id,
                layer: "governance",
                operation: "contract_approval_rejected",
                status: "succeeded",
                details: { request_id, reason: "Approval denied" },
                authorityTier: "tier3_approval",
                policyDecision: "deny"
            });
            return { request_id, resolved: true, registered: [], details: "Approval denied — contracts not registered" };
        }

        // Retrieve approved contracts and register into ToolRegistry
        const registered: string[] = [];
        const rows = await new Promise<any[]>((resolve, reject) => {
            this.db.all(
                `SELECT tool_id, tool_name, version, parameters, return_type, description
                 FROM tool_contracts
                 WHERE tool_id IN (
                     SELECT tool_id FROM contract_changes WHERE approval_status = 'approved'
                 )`,
                (err: any, rows: any[]) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        if (this.toolRegistry) {
            for (const row of rows) {
                if (!this.toolRegistry.has(row.tool_name)) {
                    const params = typeof row.parameters === "string" ? JSON.parse(row.parameters) : row.parameters;
                    this.toolRegistry.register({
                        name: row.tool_name,
                        contract: {
                            version: row.version,
                            args: params
                        },
                        execute: async () => ({ ok: true, output: { message: `Staged tool ${row.tool_name} — awaiting runtime binding` } })
                    });
                    registered.push(row.tool_name);
                }
            }
        }

        this.activityBus.emit({
            sessionId: request_id,
            layer: "governance",
            operation: "contract_approval_resolved",
            status: "succeeded",
            details: { request_id, registered_count: registered.length, registered },
            authorityTier: "tier3_approval",
            policyDecision: "allow"
        });

        return {
            request_id,
            resolved: true,
            registered,
            details: `Approved and registered ${registered.length} tool(s): ${registered.join(", ") || "none (already registered)"}`
        };
    }

    /**
     * Persist extraction request to database
     * 
     * @private
     * @param request - Request to persist
     * @param contract_count - Number of contracts extracted
     * @param approval_required - Whether approval is needed
     */
    private async persistExtractionRequest(
        request: ExtractionRequest,
        contract_count: number,
        approval_required: boolean
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO extraction_requests
                 (request_id, tool_ids, sources, baseline_comparison, risk_assessment, approval_routing, created_at, status, result_summary)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    request.request_id,
                    request.tool_ids?.join(",") || null,
                    request.sources.join(","),
                    request.baseline_comparison ? 1 : 0,
                    request.risk_assessment ? 1 : 0,
                    request.approval_routing ? 1 : 0,
                    request.created_at,
                    "completed",
                    JSON.stringify({
                        contract_count,
                        approval_required
                    })
                ],
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
}
