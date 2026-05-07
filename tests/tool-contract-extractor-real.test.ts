/**
 * Tool Contract Extractor — Real Extraction Tests
 *
 * Tests for real manifest parsing, registry-based extraction,
 * governance-inferred contracts, and enhanced risk scoring.
 *
 * @test tests/tool-contract-extractor-real.test.ts
 */

import * as assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import sqlite3 from "sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    ToolContractExtractor,
    ExtractionRequest
} from "../src/core/tools/tool-contract-extractor.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import type { Tool, ToolRequest, ToolResult } from "../src/core/tools/types.js";

const noopExecute = async (_req: ToolRequest): Promise<ToolResult> => ({
    ok: true,
    output: {}
});

describe("Tool Contract Extractor — Real Extraction", () => {
    let extractor: ToolContractExtractor;
    let db: sqlite3.Database;
    let tmpDir: string;

    before(async () => {
        db = new sqlite3.Database(":memory:");
        tmpDir = mkdtempSync(join(tmpdir(), "prism-contract-test-"));
    });

    after(async () => {
        await new Promise<void>((resolve, reject) => {
            db.close((err) => (err ? reject(err) : resolve()));
        });
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    beforeEach(() => {
        extractor = new ToolContractExtractor(
            db,
            new PolicyEngine(),
            new ActivityBus()
        );
    });

    describe("Manifest File Parsing", () => {
        it("extracts contracts from a tool-contract.json file", async () => {
            const manifestDir = join(tmpDir, "manifest-direct");
            mkdirSync(manifestDir, { recursive: true });
            writeFileSync(
                join(manifestDir, "tool-contract.json"),
                JSON.stringify({
                    tool_name: "file-search",
                    version: "2.0.0",
                    parameters: { query: "string", path: "string" },
                    return_type: "SearchResult[]",
                    description: "Search files by content"
                })
            );

            extractor.addManifestPath(manifestDir);

            const request: ExtractionRequest = {
                request_id: "req-manifest-file",
                sources: ["manifest"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            assert.strictEqual(result.status, "success");
            assert.ok(result.extracted_contracts.length >= 1);

            const fileSearch = result.extracted_contracts.find(c => c.tool_name === "file-search");
            assert.ok(fileSearch, "Should find file-search contract from manifest");
            assert.strictEqual(fileSearch!.version, "2.0.0");
            assert.strictEqual(fileSearch!.extraction_method, "manifest");
            assert.ok(fileSearch!.parameters.query);
        });

        it("extracts contracts from tool-contract-snapshot.json", async () => {
            const snapshotDir = join(tmpDir, "manifest-snapshot");
            mkdirSync(snapshotDir, { recursive: true });
            writeFileSync(
                join(snapshotDir, "tool-contract-snapshot.json"),
                JSON.stringify({
                    generatedAt: new Date().toISOString(),
                    toolCount: 2,
                    tools: [
                        {
                            name: "calendar_plan",
                            version: "1.0.0",
                            contractHash: "abc123",
                            args: {
                                title: { type: "string", required: true },
                                date: { type: "string", required: true }
                            }
                        },
                        {
                            name: "email_ops",
                            version: "1.2.0",
                            contractHash: "def456",
                            args: {
                                to: { type: "string", required: true },
                                body: { type: "string" }
                            }
                        }
                    ]
                })
            );

            extractor.addManifestPath(snapshotDir);

            const request: ExtractionRequest = {
                request_id: "req-snapshot-parse",
                sources: ["manifest"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            assert.strictEqual(result.status, "success");
            assert.strictEqual(result.extracted_contracts.length, 2);
            assert.ok(result.extracted_contracts.some(c => c.tool_name === "calendar_plan"));
            assert.ok(result.extracted_contracts.some(c => c.tool_name === "email_ops"));
        });

        it("extracts from per-tool subdirectory manifests", async () => {
            const subDir = join(tmpDir, "manifest-subdirs");
            const toolDir = join(subDir, "my-tool");
            mkdirSync(toolDir, { recursive: true });
            writeFileSync(
                join(toolDir, "tool-contract.json"),
                JSON.stringify({
                    tool_name: "my-tool",
                    version: "3.0.0",
                    parameters: { input: "string" },
                    return_type: "object",
                    description: "A subdirectory tool"
                })
            );

            extractor.addManifestPath(subDir);

            const request: ExtractionRequest = {
                request_id: "req-subdir-manifest",
                sources: ["manifest"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            assert.ok(result.extracted_contracts.some(c => c.tool_name === "my-tool"));
        });

        it("falls back to simulated data when no manifest path configured", async () => {
            const request: ExtractionRequest = {
                request_id: "req-fallback",
                sources: ["manifest"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            assert.strictEqual(result.status, "success");
            assert.strictEqual(result.extracted_contracts.length, 1);
            assert.strictEqual(result.extracted_contracts[0].tool_name, "semantic-query");
        });

        it("handles malformed manifest files gracefully", async () => {
            const badDir = join(tmpDir, "manifest-bad");
            mkdirSync(badDir, { recursive: true });
            writeFileSync(join(badDir, "tool-contract.json"), "not valid json {{{");

            extractor.addManifestPath(badDir);

            const request: ExtractionRequest = {
                request_id: "req-bad-manifest",
                sources: ["manifest"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            // Should not throw; falls back to simulated
            const result = await extractor.extractContracts(request);
            assert.strictEqual(result.status, "success");
        });
    });

    describe("Registry-Based Extraction (Decorator)", () => {
        it("extracts contracts from registered tools with explicit contracts", async () => {
            const registry = new ToolRegistry();
            registry.register({
                name: "notes_extract",
                contract: {
                    version: "1.0.0",
                    args: {
                        query: { type: "string", required: true },
                        limit: { type: "number" }
                    }
                },
                execute: noopExecute
            });
            registry.register({
                name: "memory_query",
                contract: {
                    version: "2.0.0",
                    args: {
                        topic: { type: "string", required: true }
                    }
                },
                execute: noopExecute
            });

            extractor.setToolRegistry(registry);

            const request: ExtractionRequest = {
                request_id: "req-registry-decorator",
                sources: ["decorator"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            assert.strictEqual(result.status, "success");
            assert.strictEqual(result.extracted_contracts.length, 2);
            assert.ok(result.extracted_contracts.some(c => c.tool_name === "notes_extract"));
            assert.ok(result.extracted_contracts.some(c => c.tool_name === "memory_query"));
            assert.ok(result.extracted_contracts.every(c => c.extraction_method === "decorator"));
        });

        it("returns empty when registry has no tools with contracts", async () => {
            const registry = new ToolRegistry();
            registry.register({
                name: "bare-tool",
                execute: noopExecute
            });

            extractor.setToolRegistry(registry);

            const request: ExtractionRequest = {
                request_id: "req-no-contracts",
                sources: ["decorator"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            assert.strictEqual(result.extracted_contracts.length, 0);
        });
    });

    describe("Dynamic Governance-Inferred Extraction", () => {
        it("infers contracts from tools with governance but no contract", async () => {
            const registry = new ToolRegistry();
            registry.register({
                name: "shell_exec",
                governance: {
                    actions: {
                        run: { minimumRisk: "high" as any, mutating: true, rollbackRequired: true },
                        status: { minimumRisk: "low" as any, mutating: false, rollbackRequired: false }
                    }
                },
                execute: noopExecute
            });

            extractor.setToolRegistry(registry);

            const request: ExtractionRequest = {
                request_id: "req-governance-infer",
                sources: ["dynamic"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            assert.strictEqual(result.status, "success");
            assert.strictEqual(result.extracted_contracts.length, 1);

            const contract = result.extracted_contracts[0];
            assert.strictEqual(contract.tool_name, "shell_exec");
            assert.strictEqual(contract.extraction_method, "dynamic");
            assert.ok(contract.parameters.action);
            assert.ok(contract.description.includes("governance"));
        });

        it("separates decorator vs dynamic extraction for mixed registry", async () => {
            const registry = new ToolRegistry();
            // Tool with explicit contract → decorator extraction
            registry.register({
                name: "file_read",
                contract: {
                    version: "1.0.0",
                    args: { path: { type: "string", required: true } }
                },
                execute: noopExecute
            });
            // Tool with only governance → dynamic extraction
            registry.register({
                name: "file_delete",
                governance: {
                    actions: {
                        delete: { minimumRisk: "high" as any, mutating: true, rollbackRequired: true }
                    }
                },
                execute: noopExecute
            });
            // Tool with neither → skipped by both
            registry.register({
                name: "bare-tool",
                execute: noopExecute
            });

            extractor.setToolRegistry(registry);

            const decoratorReq: ExtractionRequest = {
                request_id: "req-mixed-decorator",
                sources: ["decorator"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const dynamicReq: ExtractionRequest = {
                request_id: "req-mixed-dynamic",
                sources: ["dynamic"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const decoratorResult = await extractor.extractContracts(decoratorReq);
            const dynamicResult = await extractor.extractContracts(dynamicReq);

            assert.strictEqual(decoratorResult.extracted_contracts.length, 1);
            assert.strictEqual(decoratorResult.extracted_contracts[0].tool_name, "file_read");

            assert.strictEqual(dynamicResult.extracted_contracts.length, 1);
            assert.strictEqual(dynamicResult.extracted_contracts[0].tool_name, "file_delete");
        });
    });

    describe("Enhanced Risk Scoring", () => {
        it("scores higher for tools with mutating governance rules", async () => {
            const registry = new ToolRegistry();
            registry.register({
                name: "safe_reader",
                contract: {
                    version: "1.0.0",
                    args: { query: { type: "string" } }
                },
                execute: noopExecute
            });
            registry.register({
                name: "dangerous_writer",
                contract: {
                    version: "1.0.0",
                    args: { data: { type: "string" } }
                },
                governance: {
                    actions: {
                        write: { minimumRisk: "high" as any, mutating: true, rollbackRequired: true }
                    }
                },
                execute: noopExecute
            });

            extractor.setToolRegistry(registry);

            const request: ExtractionRequest = {
                request_id: "req-risk-governance",
                sources: ["decorator"],
                baseline_comparison: false,
                risk_assessment: true,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            const safe = result.extracted_contracts.find(c => c.tool_name === "safe_reader");
            const dangerous = result.extracted_contracts.find(c => c.tool_name === "dangerous_writer");

            assert.ok(safe);
            assert.ok(dangerous);
            // dangerous_writer should have higher risk tier due to governance
            assert.strictEqual(safe!.risk_tier, "tier1");
            assert.ok(
                dangerous!.risk_tier === "tier2" || dangerous!.risk_tier === "tier3",
                `Expected tier2 or tier3 for mutating tool, got ${dangerous!.risk_tier}`
            );
        });

        it("scores parameter names indicating mutation", async () => {
            const contract = {
                tool_id: "param-risk",
                tool_name: "deploy-tool",
                version: "1.0.0",
                parameters: { target: "string", force: "boolean", overwrite: "boolean", recursive: "boolean" },
                return_type: "object",
                description: "Deploy artifact",
                extraction_method: "dynamic" as const,
                risk_tier: "tier1" as const,
                extracted_at: new Date().toISOString()
            };

            const tier = await (extractor as any).assessRiskTier(contract);
            // "deploy" in name (+2), target/force/overwrite/recursive params (+4) = 6 → tier2
            assert.ok(
                tier === "tier2" || tier === "tier3",
                `Expected tier2+ for mutation params, got ${tier}`
            );
        });
    });
});

export function testToolContractExtractorReal(): void {
    // Allows the test to be run from the main test suite
}
