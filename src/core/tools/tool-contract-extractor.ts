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

    constructor(db: sqlite3.Database, policyEngine: PolicyEngine, activityBus: ActivityBus) {
        this.db = db;
        this.policyEngine = policyEngine;
        this.activityBus = activityBus;
        this.initializationPromise = this.initializeDatabase();
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
     * Extract contracts from manifest file
     * 
     * @private
     * @param tool_ids - Optional filter for specific tool IDs
     * @returns Contracts extracted from manifest
     */
    private async extractFromManifest(tool_ids?: string[]): Promise<ToolContract[]> {
        // Simulated manifest extraction
        // In real scenario, would parse tool-contracts.json or similar
        const contracts: ToolContract[] = [
            {
                tool_id: uuidv4(),
                tool_name: "semantic-query",
                version: "1.0.0",
                parameters: {
                    query: "string",
                    limit: "number",
                    timeout_ms: "number"
                },
                return_type: "SearchResult[]",
                description: "Semantic search across indexed knowledge",
                extraction_method: "manifest",
                risk_tier: "tier1",
                extracted_at: new Date().toISOString()
            }
        ];

        if (tool_ids && tool_ids.length > 0) {
            return contracts.filter(c => tool_ids.includes(c.tool_id));
        }

        return contracts;
    }

    /**
     * Extract contracts from function decorators
     * 
     * @private
     * @param tool_ids - Optional filter for specific tool IDs
     * @returns Contracts extracted from decorators
     */
    private async extractFromDecorators(tool_ids?: string[]): Promise<ToolContract[]> {
        // Simulated decorator extraction
        // In real scenario, would inspect TypeScript decorators via reflection
        const contracts: ToolContract[] = [
            {
                tool_id: uuidv4(),
                tool_name: "calendar-integration",
                version: "1.1.0",
                parameters: {
                    event_title: "string",
                    start_time: "DateTime",
                    end_time: "DateTime",
                    attendees: "string[]"
                },
                return_type: "CalendarEvent",
                description: "Create calendar events with attendee management",
                extraction_method: "decorator",
                risk_tier: "tier2",
                extracted_at: new Date().toISOString()
            }
        ];

        if (tool_ids && tool_ids.length > 0) {
            return contracts.filter(c => tool_ids.includes(c.tool_id));
        }

        return contracts;
    }

    /**
     * Extract contracts via runtime inspection
     * 
     * @private
     * @param tool_ids - Optional filter for specific tool IDs
     * @returns Contracts extracted dynamically
     */
    private async extractFromDynamic(tool_ids?: string[]): Promise<ToolContract[]> {
        // Simulated dynamic extraction
        // In real scenario, would load tools at runtime and inspect signatures
        const contracts: ToolContract[] = [
            {
                tool_id: uuidv4(),
                tool_name: "mcp-client",
                version: "2.0.0",
                parameters: {
                    protocol_version: "string",
                    server_capabilities: "Record<string, any>",
                    reconnect_policy: "object"
                },
                return_type: "MCPConnection",
                description: "MCP protocol client with auto-reconnect",
                extraction_method: "dynamic",
                risk_tier: "tier2",
                extracted_at: new Date().toISOString()
            }
        ];

        if (tool_ids && tool_ids.length > 0) {
            return contracts.filter(c => tool_ids.includes(c.tool_id));
        }

        return contracts;
    }

    /**
     * Compare extracted contract against baseline version
     * 
     * @private
     * @param current - Current contract to compare
     * @returns Comparison result with change analysis
     */
    private async compareWithBaseline(current: ToolContract): Promise<ContractComparison | null> {
        // Simulated baseline lookup
        const baseline = this.baselineCache.get(current.tool_id);

        if (!baseline) {
            // No baseline exists, not a breaking change
            return {
                tool_id: current.tool_id,
                baseline_version: "none",
                current_version: current.version,
                breaking_changes: [],
                safe_additions: Object.keys(current.parameters),
                deprecations: [],
                risk_assessment: "new_tool",
                requires_approval: false
            };
        }

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

        return {
            tool_id: current.tool_id,
            baseline_version: baseline.version,
            current_version: current.version,
            breaking_changes,
            safe_additions,
            deprecations,
            risk_assessment,
            requires_approval
        };
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

        // Score based on parameter count
        const paramCount = Object.keys(contract.parameters).length;
        if (paramCount > 5) {
            riskScore += 1;
        }

        // Determine tier
        if (riskScore >= 5) {
            return "tier3";
        } else if (riskScore >= 2) {
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
