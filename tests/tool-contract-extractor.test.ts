/**
 * Tool Contract Extractor Tests
 * 
 * Test coverage for contract extraction, comparison, risk tier assignment,
 * and policy gating for tool staging
 * 
 * @test tests/tool-contract-extractor.test.ts
 */

import * as assert from "assert";
import { describe, it, before, after } from "mocha";
import sqlite3 from "sqlite3";
import {
    ToolContractExtractor,
    ToolContract,
    ExtractionRequest
} from "../src/core/tools/tool-contract-extractor.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ActivityBus } from "../src/core/activity/bus.js";

describe("Tool Contract Extractor", () => {
    let extractor: ToolContractExtractor;
    let db: sqlite3.Database;
    let policyEngine: PolicyEngine;
    let activityBus: ActivityBus;

    before(async () => {
        db = new sqlite3.Database(":memory:");
        policyEngine = new PolicyEngine();
        activityBus = new ActivityBus();
        extractor = new ToolContractExtractor(db, policyEngine, activityBus);
    });

    after(async () => {
        await new Promise<void>((resolve, reject) => {
            db.close((err) => (err ? reject(err) : resolve()));
        });
    });

    describe("extractContracts", () => {
        it("extracts contracts from all requested sources", async () => {
            const request: ExtractionRequest = {
                request_id: "req-all-sources",
                sources: ["manifest", "decorator", "dynamic"],
                baseline_comparison: true,
                risk_assessment: true,
                approval_routing: true,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            assert.strictEqual(result.status, "success");
            assert.strictEqual(result.extracted_contracts.length, 3);
            assert.strictEqual(result.comparisons.length, 3);
            assert.strictEqual(result.approval_required, false);
            assert.strictEqual(result.risk_summary.tier1 + result.risk_summary.tier2 + result.risk_summary.tier3, 3);
        });

        it("supports source-specific extraction", async () => {
            const request: ExtractionRequest = {
                request_id: "req-manifest-only",
                sources: ["manifest"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            assert.strictEqual(result.status, "success");
            assert.strictEqual(result.extracted_contracts.length, 1);
            assert.strictEqual(result.extracted_contracts[0].extraction_method, "manifest");
        });

        it("returns no contracts when tool_ids filter misses all", async () => {
            const request: ExtractionRequest = {
                request_id: "req-filter-miss",
                tool_ids: ["non-existent-tool-id"],
                sources: ["manifest", "decorator", "dynamic"],
                baseline_comparison: false,
                risk_assessment: false,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            const result = await extractor.extractContracts(request);
            assert.strictEqual(result.status, "success");
            assert.strictEqual(result.extracted_contracts.length, 0);
        });

        it("persists extraction request and exposes it via status lookup", async () => {
            const request: ExtractionRequest = {
                request_id: "req-status-check",
                sources: ["dynamic"],
                baseline_comparison: true,
                risk_assessment: true,
                approval_routing: false,
                created_at: new Date().toISOString()
            };

            await extractor.extractContracts(request);
            const status = await extractor.getExtractionStatus(request.request_id);

            assert.ok(status);
            assert.strictEqual(status?.request_id, request.request_id);
            assert.deepStrictEqual(status?.sources, ["dynamic"]);
            assert.strictEqual(status?.baseline_comparison, true);
            assert.strictEqual(status?.risk_assessment, true);
        });
    });

    describe("Risk and Baseline Analysis", () => {
        it("assigns tier1 for low-risk contract descriptions", async () => {
            const contract: ToolContract = {
                tool_id: "risk-tier1",
                tool_name: "status-tool",
                version: "1.0.0",
                parameters: { id: "string" },
                return_type: "object",
                description: "Read status metrics",
                extraction_method: "manifest",
                risk_tier: "tier1",
                extracted_at: new Date().toISOString()
            };

            const tier = await (extractor as any).assessRiskTier(contract);
            assert.strictEqual(tier, "tier1");
        });

        it("assigns tier3 when high-risk keywords are present", async () => {
            const contract: ToolContract = {
                tool_id: "risk-tier3",
                tool_name: "destroy-tool",
                version: "1.0.0",
                parameters: { target: "string" },
                return_type: "object",
                description: "Delete destroy shutdown critical system data",
                extraction_method: "dynamic",
                risk_tier: "tier1",
                extracted_at: new Date().toISOString()
            };

            const tier = await (extractor as any).assessRiskTier(contract);
            assert.strictEqual(tier, "tier3");
        });

        it("returns new_tool comparison when no baseline exists", async () => {
            const contract: ToolContract = {
                tool_id: "no-baseline",
                tool_name: "new-tool",
                version: "1.0.0",
                parameters: { query: "string", limit: "number" },
                return_type: "object",
                description: "Safe query tool",
                extraction_method: "manifest",
                risk_tier: "tier1",
                extracted_at: new Date().toISOString()
            };

            const comparison = await (extractor as any).compareWithBaseline(contract);
            assert.ok(comparison);
            assert.strictEqual(comparison.risk_assessment, "new_tool");
            assert.strictEqual(comparison.requires_approval, false);
            assert.ok(comparison.safe_additions.includes("query"));
        });

        it("flags breaking change when baseline parameter is removed", async () => {
            const current: ToolContract = {
                tool_id: "has-baseline",
                tool_name: "update-tool",
                version: "1.1.0",
                parameters: { query: "string" },
                return_type: "object",
                description: "Updated tool",
                extraction_method: "manifest",
                risk_tier: "tier2",
                extracted_at: new Date().toISOString()
            };

            (extractor as any).baselineCache.set("has-baseline", {
                ...current,
                version: "1.0.0",
                parameters: { query: "string", limit: "number" }
            });

            const comparison = await (extractor as any).compareWithBaseline(current);
            assert.ok(comparison?.breaking_changes.some((change: string) => change.includes("removed_parameter: limit")));
            assert.strictEqual(comparison?.requires_approval, true);
        });
    });

    describe("Deployment Staging", () => {
        it("blocks staging when approval is false", async () => {
            const result = await extractor.stageForDeployment("req-no-approval", false);
            assert.strictEqual(result.staged, false);
            assert.ok(result.details.includes("blocked"));
        });

        it("approves pending changes and emits activity when approval is true", async () => {
            await new Promise<void>((resolve, reject) => {
                db.run(
                    `INSERT INTO contract_changes
                     (change_id, tool_id, baseline_version, current_version, change_type, breaking, risk_score, details, approval_status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        "change-1",
                        "tool-1",
                        "1.0.0",
                        "1.1.0",
                        "signature_change",
                        1,
                        2,
                        "[]",
                        "pending"
                    ],
                    (err) => (err ? reject(err) : resolve())
                );
            });

            const result = await extractor.stageForDeployment("req-approved", true);
            assert.strictEqual(result.staged, true);

            const approvedCount = await new Promise<number>((resolve, reject) => {
                db.get(
                    `SELECT COUNT(*) AS count FROM contract_changes WHERE approval_status = 'approved'`,
                    (err, row: { count: number }) => (err ? reject(err) : resolve(row.count))
                );
            });

            assert.ok(approvedCount >= 1);

            const events = activityBus.listEvents();
            const hasStagingEvent = events.some(
                (event) => event.operation === "contract_staging" && event.status === "succeeded"
            );
            assert.strictEqual(hasStagingEvent, true);
        });
    });
});

export function testToolContractExtractor(): void {
    // This function allows the test to be run from the main test suite
}
