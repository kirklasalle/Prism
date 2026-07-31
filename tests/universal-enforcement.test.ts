/**
 * Phase 3 Security Test Suite — Universal Authority Gating & Provenance (IC-05, IC-06, IC-07)
 *
 * Tests:
 * 1. `validateAuthorityContext()` hard-gate validation (rejects missing or caller-supplied context).
 * 2. `enforceAuthorityContext()` throws `ExecutionAuthorityError` when context is invalid.
 * 3. `resolveAuthorityContextForSession()` resolves authority context for Individual and Business profiles.
 * 4. `ActivityBus.emit()` populates event provenance fields from `ExecutionAuthorityContext`.
 * 5. `GuardianAgent.verifyOperatorAuthorityBinding()` checks operator-specific authority health (IC-06).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    validateAuthorityContext,
    enforceAuthorityContext,
    createServerAuthorityContext,
    ExecutionAuthorityError,
    type ExecutionAuthorityContext,
} from "../src/core/security/execution-authority-context.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import { GuardianAgent } from "../src/core/agents/guardian-agent.js";

describe("Phase 3 Universal Enforcement Suite (IC-05, IC-06, IC-07)", () => {
    let tmpDir: string;
    let dbPath: string;
    let store: ChatSessionStore;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-phase3-test-"));
        dbPath = join(tmpDir, "test.db");
        store = new ChatSessionStore(dbPath);
    });

    afterEach(() => {
        store.close();
        if (existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── 1. Hard-Gate ExecutionAuthorityContext Validation ────────────────

    describe("1. Hard-Gate ExecutionAuthorityContext Validation (IC-05)", () => {
        it("returns valid=false for missing/null authority context in Phase 3", () => {
            const result = validateAuthorityContext(null);
            assert.strictEqual(result.valid, false, "Null context must fail validation in Phase 3");
            assert.ok(result.reason.includes("EXECUTION_BLOCKED"));
            assert.ok(result.missingFields.length > 0);
        });

        it("returns valid=false when caller attempts to supply caller-resolved context", () => {
            const callerCtx: ExecutionAuthorityContext = {
                certificateId: "cert-forged",
                assignmentId: "asgn-forged",
                operatorEmail: "attacker@example.com",
                operatorName: "Attacker",
                cacEmail: "cac@example.com",
                cacName: "CAC",
                resolvedAt: new Date().toISOString(),
                resolvedBy: "caller",
            };

            const result = validateAuthorityContext(callerCtx);
            assert.strictEqual(result.valid, false, "Caller-resolved context must be rejected");
            assert.ok(result.reason.includes("caller-supplied identity is forbidden"));
        });

        it("enforceAuthorityContext throws ExecutionAuthorityError for invalid context", () => {
            assert.throws(
                () => enforceAuthorityContext(null),
                (err: any) => err instanceof ExecutionAuthorityError && err.message.includes("EXECUTION_BLOCKED"),
                "Must throw ExecutionAuthorityError for missing context",
            );
        });

        it("returns valid=true for complete server-resolved context", () => {
            const serverCtx = createServerAuthorityContext({
                certificateId: "cert-valid-123",
                assignmentId: "asgn-valid-456",
                operatorEmail: "kirk@prismrefraction.com",
                operatorName: "Kirk LaSalle",
                cacEmail: "cac@prismrefraction.com",
                cacName: "CAC Main Agent",
                executionProfile: "individual",
            });

            const result = validateAuthorityContext(serverCtx);
            assert.strictEqual(result.valid, true, "Complete server context must pass validation");
            assert.strictEqual(result.missingFields.length, 0);
        });
    });

    // ── 2. Profile Resolution (Individual & Business) ────────────────────

    describe("2. Server-Side Profile Resolution (Individual & Business Profiles)", () => {
        it("resolves Individual profile authority context for a chat session", () => {
            const session = store.createSession({
                title: "PRISM Individual Chat",
                operatorEmail: "operator@prismrefraction.com",
                executionProfile: "individual",
            });

            const ctx = store.resolveAuthorityContextForSession(session.sessionId);
            assert.strictEqual(ctx.resolvedBy, "server");
            assert.strictEqual(ctx.executionProfile, "individual");
            assert.strictEqual(ctx.operatorEmail, "operator@prismrefraction.com");
            assert.ok(ctx.certificateId);
            assert.ok(ctx.assignmentId);
        });

        it("resolves Business profile authority context for a multi-tenant session", () => {
            const session = store.createSession({
                title: "PRISM Business Dept Chat",
                operatorEmail: "corp-user@prismrefraction.com",
                executionProfile: "business",
            });

            const ctx = store.resolveAuthorityContextForSession(session.sessionId);
            assert.strictEqual(ctx.resolvedBy, "server");
            assert.strictEqual(ctx.executionProfile, "business");
            assert.strictEqual(ctx.operatorEmail, "corp-user@prismrefraction.com");
        });
    });

    // ── 3. Provenance Population in Activity Bus ─────────────────────────

    describe("3. Provenance Population in Activity Bus (IC-05, IC-11)", () => {
        it("populates operatorEmail and assignmentId onto emitted activity events", () => {
            const bus = new ActivityBus();
            const ctx = createServerAuthorityContext({
                certificateId: "cert-999",
                assignmentId: "asgn-888",
                operatorEmail: "kirk@prismrefraction.com",
            });

            const event = bus.emit(
                {
                    sessionId: "sess-111",
                    layer: "agent",
                    operation: "tool_execute",
                    status: "succeeded",
                    details: { note: "Tool execution verified" },
                },
                ctx,
            );

            assert.strictEqual(event.operatorEmail, "kirk@prismrefraction.com");
            assert.strictEqual(event.assignmentId, "asgn-888");
            assert.ok(event.hash, "Event hash must be calculated");
        });
    });

    // ── 4. Guardian Operator Health Gate (IC-06) ──────────────────────────

    describe("4. Operator-Specific Guardian Health Gate (IC-06)", () => {
        it("returns healthy=false when no active certificate exists for operator", () => {
            const bus = new ActivityBus();
            const guardian = new GuardianAgent(bus, {} as any, []);
            const health = guardian.verifyOperatorAuthorityBinding("nonexistent@example.com");
            assert.strictEqual(health.healthy, false, "Must be unhealthy when operator certificate is missing");
            assert.ok(health.reason.length > 0, "Should state health failure reason");
        });
    });
});
