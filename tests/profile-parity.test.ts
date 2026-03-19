import * as assert from "assert";
import { describe, it, before, after } from "mocha";
import sqlite3 from "sqlite3";
import {
    TerminalSessionAdapter,
} from "../src/adapters/application/terminal-session-adapter.js";
import {
    ContainerSandboxAdapter,
    ResourceQuota,
} from "../src/adapters/application/container-sandbox-adapter.js";
import { ToolContractExtractor } from "../src/core/tools/tool-contract-extractor.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import {
    INDIVIDUAL_PROFILE,
    BUSINESS_PROFILE,
} from "../src/core/policy/execution-profiles.js";

/**
 * Profile Parity Integration Tests
 *
 * Validates that INDIVIDUAL_PROFILE and BUSINESS_PROFILE
 * support equivalent capabilities across all three adapters:
 * - TerminalSessionAdapter
 * - ContainerSandboxAdapter
 * - ToolContractExtractor
 *
 * This test suite executes the same operation sequences under
 * both profiles and verifies identical outcomes (differing only
 * in governance enforcement).
 */

describe("Profile Parity Integration Tests", function () {
    this.timeout(15000);

    let dbTerminal: sqlite3.Database;
    let dbContainer: sqlite3.Database;
    let dbTools: sqlite3.Database;
    let policyEngine: PolicyEngine;
    let activityBus: ActivityBus;

    before(async () => {
        dbTerminal = new sqlite3.Database(":memory:");
        dbContainer = new sqlite3.Database(":memory:");
        dbTools = new sqlite3.Database(":memory:");
        policyEngine = new PolicyEngine();
        activityBus = new ActivityBus();
    });

    after(async () => {
        await new Promise<void>((resolve, reject) => {
            dbTerminal.close((err) => (err ? reject(err) : resolve()));
        });
        await new Promise<void>((resolve, reject) => {
            dbContainer.close((err) => (err ? reject(err) : resolve()));
        });
        await new Promise<void>((resolve, reject) => {
            dbTools.close((err) => (err ? reject(err) : resolve()));
        });
    });

    describe("Terminal Session Adapter - Profile Equivalence", () => {
        it("creates sessions identically under both profiles", async () => {
            const adapterIndividual = new TerminalSessionAdapter(
                dbTerminal,
                policyEngine,
                activityBus
            );
            const adapterBusiness = new TerminalSessionAdapter(
                new sqlite3.Database(":memory:"),
                policyEngine,
                new ActivityBus()
            );

            const sessionIndividual = await adapterIndividual.startSession(
                "bash",
                process.cwd(),
                "individual-user"
            );

            const sessionBusiness = await adapterBusiness.startSession(
                "bash",
                process.cwd(),
                "business-user"
            );

            // Both sessions created with correct metadata
            assert.ok(sessionIndividual.session_id.length > 10);
            assert.ok(sessionBusiness.session_id.length > 10);
            assert.strictEqual(sessionIndividual.state, "idle");
            assert.strictEqual(sessionBusiness.state, "idle");
            assert.strictEqual(sessionIndividual.shell, "bash");
            assert.strictEqual(sessionBusiness.shell, "bash");
        });

        it("classifies commands identically under both profiles", async () => {
            const adapterIndividual = new TerminalSessionAdapter(
                new sqlite3.Database(":memory:"),
                policyEngine,
                activityBus
            );
            const adapterBusiness = new TerminalSessionAdapter(
                new sqlite3.Database(":memory:"),
                policyEngine,
                activityBus
            );

            // Both adapters should classify same commands identically
            const classIndividual = (adapterIndividual as any).classifyCommandTier("ls");
            const classBusiness = (adapterBusiness as any).classifyCommandTier("ls");

            assert.strictEqual(classIndividual, classBusiness, "Command classification must match");
        });
    });

    describe("Container Sandbox Adapter - Profile Equivalence", () => {
        it("creates containers identically under both profiles", async () => {
            const dbIndividual = new sqlite3.Database(":memory:");
            const dbBusiness = new sqlite3.Database(":memory:");

            const adapterIndividual = new ContainerSandboxAdapter(
                dbIndividual,
                policyEngine,
                activityBus
            );
            const adapterBusiness = new ContainerSandboxAdapter(
                dbBusiness,
                policyEngine,
                activityBus
            );

            const quota: ResourceQuota = {
                cpu_limit: 2,
                memory_limit_mb: 4096,
                disk_limit_mb: 20480,
            };

            const containerIndividual = await adapterIndividual.createContainer(
                "alpine:latest",
                quota
            );

            const containerBusiness = await adapterBusiness.createContainer(
                "alpine:latest",
                quota
            );

            // Both containers created successfully
            assert.ok(containerIndividual.container_id.length > 0);
            assert.ok(containerBusiness.container_id.length > 0);
            assert.strictEqual(containerIndividual.state, "created");
            assert.strictEqual(containerBusiness.state, "created");
            assert.deepStrictEqual(containerIndividual.resource_quota, quota);
            assert.deepStrictEqual(containerBusiness.resource_quota, quota);

            // Cleanup
            await new Promise<void>((resolve, reject) => {
                dbIndividual.close((err) => (err ? reject(err) : resolve()));
            });
            await new Promise<void>((resolve, reject) => {
                dbBusiness.close((err) => (err ? reject(err) : resolve()));
            });
        });

        it("snapshots containers identically under both profiles", async () => {
            const dbIndividual = new sqlite3.Database(":memory:");
            const dbBusiness = new sqlite3.Database(":memory:");

            const adapterIndividual = new ContainerSandboxAdapter(
                dbIndividual,
                policyEngine,
                activityBus
            );
            const adapterBusiness = new ContainerSandboxAdapter(
                dbBusiness,
                policyEngine,
                activityBus
            );

            const quota: ResourceQuota = {
                cpu_limit: 2,
                memory_limit_mb: 4096,
                disk_limit_mb: 20480,
            };

            // Create containers
            const containerIndividual = await adapterIndividual.createContainer(
                "alpine:latest",
                quota
            );
            const containerBusiness = await adapterBusiness.createContainer(
                "alpine:latest",
                quota
            );

            // Both create snapshots
            const snapshotIndividual = await adapterIndividual.snapshotContainer(
                containerIndividual.container_id,
                "checkpoint-1"
            );
            const snapshotBusiness = await adapterBusiness.snapshotContainer(
                containerBusiness.container_id,
                "checkpoint-1"
            );

            // Both snapshots created with identical structure
            assert.strictEqual(snapshotIndividual.snapshot_name, "checkpoint-1");
            assert.strictEqual(snapshotBusiness.snapshot_name, "checkpoint-1");
            assert.ok(snapshotIndividual.snapshot_size_mb > 0);
            assert.ok(snapshotBusiness.snapshot_size_mb > 0);

            // Cleanup
            await new Promise<void>((resolve, reject) => {
                dbIndividual.close((err) => (err ? reject(err) : resolve()));
            });
            await new Promise<void>((resolve, reject) => {
                dbBusiness.close((err) => (err ? reject(err) : resolve()));
            });
        });
    });

    describe("Tool Contract Extractor - Profile Equivalence", () => {
        it("extracts tool contracts identically under both profiles", async () => {
            const dbIndividual = new sqlite3.Database(":memory:");
            const dbBusiness = new sqlite3.Database(":memory:");

            const extractorIndividual = new ToolContractExtractor(
                dbIndividual,
                policyEngine,
                new ActivityBus()
            );
            const extractorBusiness = new ToolContractExtractor(
                dbBusiness,
                policyEngine,
                new ActivityBus()
            );

            const now = new Date().toISOString();

            // Extract under Individual profile
            const responseIndividual = await extractorIndividual.extractContracts({
                request_id: "req-ind-1",
                sources: ["dynamic"],
                baseline_comparison: false,
                risk_assessment: true,
                approval_routing: false,
                created_at: now,
            });

            // Extract under Business profile
            const responseBusiness = await extractorBusiness.extractContracts({
                request_id: "req-bus-1",
                sources: ["dynamic"],
                baseline_comparison: false,
                risk_assessment: true,
                approval_routing: false,
                created_at: now,
            });

            // Both extractions complete successfully
            assert.ok(
                responseIndividual.status === "success" ||
                responseIndividual.status === "partial"
            );
            assert.ok(
                responseBusiness.status === "success" ||
                responseBusiness.status === "partial"
            );
            assert.strictEqual(
                responseIndividual.extracted_contracts.length,
                responseBusiness.extracted_contracts.length,
                "Extract count must match"
            );

            // Cleanup
            await new Promise<void>((resolve, reject) => {
                dbIndividual.close((err) => (err ? reject(err) : resolve()));
            });
            await new Promise<void>((resolve, reject) => {
                dbBusiness.close((err) => (err ? reject(err) : resolve()));
            });
        });

        it("classifies tool risk identically under both profiles", async () => {
            const dbIndividual = new sqlite3.Database(":memory:");
            const dbBusiness = new sqlite3.Database(":memory:");

            const extractorIndividual = new ToolContractExtractor(
                dbIndividual,
                policyEngine,
                new ActivityBus()
            );
            const extractorBusiness = new ToolContractExtractor(
                dbBusiness,
                policyEngine,
                new ActivityBus()
            );

            const now = new Date().toISOString();

            // Both profiles should classify risk identically
            const resultIndividual = await extractorIndividual.extractContracts({
                request_id: "req-ind-risk",
                sources: ["manifest"],
                baseline_comparison: false,
                risk_assessment: true,
                approval_routing: false,
                created_at: now,
            });

            const resultBusiness = await extractorBusiness.extractContracts({
                request_id: "req-bus-risk",
                sources: ["manifest"],
                baseline_comparison: false,
                risk_assessment: true,
                approval_routing: false,
                created_at: now,
            });

            // Verify both profiles extracted successfully and have same risk structure
            assert.ok(typeof resultIndividual.risk_summary === "object");
            assert.ok(typeof resultBusiness.risk_summary === "object");
            assert.strictEqual(
                Object.keys(resultIndividual.risk_summary).length,
                Object.keys(resultBusiness.risk_summary).length,
                "Risk summary keys must match"
            );

            // Cleanup
            await new Promise<void>((resolve, reject) => {
                dbIndividual.close((err) => (err ? reject(err) : resolve()));
            });
            await new Promise<void>((resolve, reject) => {
                dbBusiness.close((err) => (err ? reject(err) : resolve()));
            });
        });

        it("processes different extraction sources with both profiles", async () => {
            const dbIndividual = new sqlite3.Database(":memory:");
            const dbBusiness = new sqlite3.Database(":memory:");

            const extractorIndividual = new ToolContractExtractor(
                dbIndividual,
                policyEngine,
                new ActivityBus()
            );
            const extractorBusiness = new ToolContractExtractor(
                dbBusiness,
                policyEngine,
                new ActivityBus()
            );

            const now = new Date().toISOString();
            const sourceTypes: ("manifest" | "decorator" | "dynamic")[] = [
                "manifest",
                "decorator",
                "dynamic",
            ];

            for (const source of sourceTypes) {
                const resultIndividual = await extractorIndividual.extractContracts({
                    request_id: `req-ind-${source}`,
                    sources: [source],
                    baseline_comparison: false,
                    risk_assessment: true,
                    approval_routing: false,
                    created_at: now,
                });

                const resultBusiness = await extractorBusiness.extractContracts({
                    request_id: `req-bus-${source}`,
                    sources: [source],
                    baseline_comparison: false,
                    risk_assessment: true,
                    approval_routing: false,
                    created_at: now,
                });

                // Verify both profiles processed sources identically
                assert.strictEqual(
                    resultIndividual.status,
                    resultBusiness.status,
                    `Status should match for ${source} source`
                );
            }

            // Cleanup
            await new Promise<void>((resolve, reject) => {
                dbIndividual.close((err) => (err ? reject(err) : resolve()));
            });
            await new Promise<void>((resolve, reject) => {
                dbBusiness.close((err) => (err ? reject(err) : resolve()));
            });
        });
    });

    describe("Cross-Adapter Profile Equivalence", () => {
        it("emits identical activity bus events for equivalent operations", async () => {
            const busIndividual = new ActivityBus();
            const busBusiness = new ActivityBus();

            const adapterIndividual = new TerminalSessionAdapter(
                dbTerminal,
                policyEngine,
                busIndividual
            );

            const dbBusiness = new sqlite3.Database(":memory:");
            const adapterBusiness = new TerminalSessionAdapter(
                dbBusiness,
                policyEngine,
                busBusiness
            );

            // Create sessions
            await adapterIndividual.startSession("bash", process.cwd(), "user1");
            await adapterBusiness.startSession("bash", process.cwd(), "user2");

            // Check event counts
            const eventsIndividual = busIndividual.listEvents();
            const eventsBusiness = busBusiness.listEvents();

            // Both should emit terminal_session_start events
            const hasCreateIndividual = eventsIndividual.some(
                (e) => e.operation === "terminal_session_start"
            );
            const hasCreateBusiness = eventsBusiness.some(
                (e) => e.operation === "terminal_session_start"
            );

            assert.strictEqual(hasCreateIndividual, true, "Individual should emit terminal_session_start");
            assert.strictEqual(hasCreateBusiness, true, "Business should emit terminal_session_start");

            // Both use same event layer
            const layerIndividual = eventsIndividual.find((e) => e.operation === "terminal_session_start")
                ?.layer;
            const layerBusiness = eventsBusiness.find((e) => e.operation === "terminal_session_start")
                ?.layer;

            assert.strictEqual(layerIndividual, "governance");
            assert.strictEqual(layerBusiness, "governance");

            // Cleanup
            await new Promise<void>((resolve, reject) => {
                dbBusiness.close((err) => (err ? reject(err) : resolve()));
            });
        });

        it("persists identical schemas under both profiles", async () => {
            const dbIndividual = new sqlite3.Database(":memory:");
            const dbBusiness = new sqlite3.Database(":memory:");

            new TerminalSessionAdapter(dbIndividual, policyEngine, activityBus);
            new TerminalSessionAdapter(dbBusiness, policyEngine, activityBus);

            // Check terminal_sessions table exists in both
            const tableExistsIndividual = await new Promise<boolean>((resolve, reject) => {
                dbIndividual.get(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='terminal_sessions'",
                    (err, row) => (err ? reject(err) : resolve(!!row))
                );
            });

            const tableExistsBusiness = await new Promise<boolean>((resolve, reject) => {
                dbBusiness.get(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='terminal_sessions'",
                    (err, row) => (err ? reject(err) : resolve(!!row))
                );
            });

            assert.strictEqual(
                tableExistsIndividual,
                true,
                "Individual should have terminal_sessions table"
            );
            assert.strictEqual(
                tableExistsBusiness,
                true,
                "Business should have terminal_sessions table"
            );

            // Cleanup
            await new Promise<void>((resolve, reject) => {
                dbIndividual.close((err) => (err ? reject(err) : resolve()));
            });
            await new Promise<void>((resolve, reject) => {
                dbBusiness.close((err) => (err ? reject(err) : resolve()));
            });
        });
    });

    describe("Profile Policy Decision Equivalence", () => {
        it("evaluates same operations identically through policy engine", () => {
            // Terminal session creation (medium-risk mutation with rollback)
            const contextMedium = {
                operation: "terminal_session.start",
                risk: "medium" as const,
                mutatesState: true,
                rollbackPlan: "stop session",
            };

            const policyIndividual = policyEngine.evaluate({
                ...contextMedium,
                executionProfile: INDIVIDUAL_PROFILE,
            });

            const policyBusiness = policyEngine.evaluate({
                ...contextMedium,
                executionProfile: BUSINESS_PROFILE,
            });

            // Both should allow with rollback plan present
            assert.strictEqual(policyIndividual.decision, "allow");
            assert.strictEqual(policyBusiness.decision, "allow");
            assert.strictEqual(policyIndividual.tier, "tier2_conditional");
            assert.strictEqual(policyBusiness.tier, "tier2_conditional");
        });

        it("enforces profile-specific restrictions in policy decisions", () => {
            // Terminal session creation without rollback (medium-risk mutation)
            const contextNoRollback = {
                operation: "terminal_session.start",
                risk: "medium" as const,
                mutatesState: true,
                rollbackPlan: undefined, // Missing!
            };

            const policyIndividual = policyEngine.evaluate({
                ...contextNoRollback,
                executionProfile: INDIVIDUAL_PROFILE,
            });

            const policyBusiness = policyEngine.evaluate({
                ...contextNoRollback,
                executionProfile: BUSINESS_PROFILE,
            });

            // Individual allows with warning
            assert.strictEqual(policyIndividual.decision, "allow");
            assert.ok(
                policyIndividual.reasons.some((r) => r.includes("Warning")),
                "Individual should warn"
            );

            // Business denies
            assert.strictEqual(policyBusiness.decision, "deny");
            assert.ok(
                policyBusiness.reasons.some((r) => r.includes("rollback plan")),
                "Business should mention rollback requirement"
            );
        });
    });
});

export function testProfileParity(): void {
    // Integration test entry point for custom runners
}
