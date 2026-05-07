import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityBus } from "../src/core/activity/bus.js";
import { CharacterAccountabilityManager } from "../src/core/accountability/character-accountability-manager.js";
import { CharacterAccountabilityStore } from "../src/core/accountability/character-accountability-store.js";

export async function testCharacterAccountability(): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), "prism-character-accountability-"));
    const dbPath = join(tempDir, "activity.db");

    const activityBus = new ActivityBus();
    const store = new CharacterAccountabilityStore(dbPath);
    const manager = new CharacterAccountabilityManager(store, activityBus);

    try {
        const assignment = manager.assign({
            characterId: "analyst",
            prismUserId: "prism-system-user",
            prismUserEmail: "prism@prism.local",
            operatorId: "operator-kirk",
            operatorEmail: "kirk@lasalle.io",
            clientId: "browser-client-a",
            sessionId: "session-123",
            executionProfile: "individual",
        });

        assert.strictEqual(assignment.state, "active");
        assert.ok(assignment.assignmentId.length > 0);

        const fromStore = store.get(assignment.assignmentId);
        assert.ok(fromStore);
        assert.strictEqual(fromStore!.characterId, "analyst");
        assert.strictEqual(fromStore!.prismUserId, "prism-system-user");
        assert.strictEqual(fromStore!.prismUserEmail, "prism@prism.local");
        assert.strictEqual(fromStore!.operatorId, "operator-kirk");
        assert.strictEqual(fromStore!.operatorEmail, "kirk@lasalle.io");

        const afterDispatch = manager.recordDispatch(assignment.assignmentId);
        assert.ok(afterDispatch);
        assert.strictEqual(afterDispatch!.dispatchCount, 1);

        const suspended = manager.suspend(assignment.assignmentId, "policy hold");
        assert.ok(suspended);
        assert.strictEqual(suspended!.state, "suspended");
        assert.strictEqual(suspended!.suspendReason, "policy hold");

        const resumed = manager.resume(assignment.assignmentId);
        assert.ok(resumed);
        assert.strictEqual(resumed!.state, "active");

        const revoked = manager.revoke(assignment.assignmentId, "manual revocation");
        assert.ok(revoked);
        assert.strictEqual(revoked!.state, "revoked");
        assert.strictEqual(revoked!.revocationReason, "manual revocation");

        const byCharacter = manager.queryByCharacter("analyst");
        assert.strictEqual(byCharacter.length, 1);
        const byOperator = manager.queryByOperator("operator-kirk");
        assert.strictEqual(byOperator.length, 1);
        const byPrismUser = manager.queryByPrismUser("prism-system-user");
        assert.strictEqual(byPrismUser.length, 1);
        const byPrismEmail = manager.queryByPrismUserEmail("Prism@Prism.Local");
        assert.strictEqual(byPrismEmail.length, 1);
        const byOperatorEmail = manager.queryByOperatorEmail("KIRK@LASALLE.IO");
        assert.strictEqual(byOperatorEmail.length, 1);
        const byExecutionProfile = manager.queryByExecutionProfile("individual");
        assert.strictEqual(byExecutionProfile.length, 1);
        const byClient = manager.queryByClient("browser-client-a");
        assert.strictEqual(byClient.length, 1);

        const events = activityBus.listEvents();
        assert.ok(events.length >= 5);
        const assignEvent = events.find((event) => event.operation === "character_accountability.assign");
        assert.ok(assignEvent);
        assert.strictEqual(assignEvent!.assignmentId, assignment.assignmentId);
        assert.strictEqual(assignEvent!.characterId, "analyst");
        assert.strictEqual(assignEvent!.prismUserEmail, "prism@prism.local");
        assert.strictEqual(assignEvent!.executionProfileSegment, "individual");
        assert.strictEqual(assignEvent!.accountabilityChain?.operatorId, "operator-kirk");
        assert.strictEqual(assignEvent!.accountabilityChain?.operatorEmail, "kirk@lasalle.io");

        assert.throws(() => {
            manager.assign({
                characterId: "analyst",
                prismUserId: "prism-system-user",
                prismUserEmail: "invalid-email",
                operatorId: "operator-kirk",
                operatorEmail: "kirk@lasalle.io",
                clientId: "browser-client-a",
                sessionId: "session-123",
            });
        }, /Invalid prismUserEmail/);

        const strictManager = new CharacterAccountabilityManager(store, activityBus);
        assert.throws(() => {
            strictManager.assign({
                characterId: "analyst",
                prismUserId: "prism-system-user",
                prismUserEmail: "prism@company.com",
                operatorId: "operator-kirk",
                operatorEmail: "kirk@other.com",
                clientId: "browser-client-a",
                sessionId: "session-123",
                executionProfile: "enterprise",
            });
        }, /Business profile requires matching email domains/);

        const businessAssignment = strictManager.assign({
            characterId: "analyst",
            prismUserId: "prism-system-user",
            prismUserEmail: "prism@company.com",
            operatorId: "operator-kirk",
            operatorEmail: "kirk@company.com",
            clientId: "browser-client-a",
            sessionId: "session-123",
            executionProfile: "corporate",
        });
        assert.strictEqual(businessAssignment.executionProfileSegment, "business");

        // ── E5: permissionScopes and revokeExpiredScopes ─────────────────────

        // setPermissionScopes — basic assignment
        const scopeAssignment = manager.assign({
            characterId: "analyst",
            prismUserId: "prism-system-user",
            prismUserEmail: "prism@prism.local",
            operatorId: "operator-kirk",
            operatorEmail: "kirk@lasalle.io",
            clientId: "browser-client-scope",
            sessionId: "session-scope-1",
        });
        const futureExpiry = new Date(Date.now() + 60_000).toISOString();
        const updated = manager.setPermissionScopes(scopeAssignment.assignmentId, [
            { scope: "email:read", expiresAt: futureExpiry },
            { scope: "calendar:read", expiresAt: null },
        ]);
        assert.ok(updated, "setPermissionScopes should return updated assignment");
        assert.strictEqual(updated!.permissionScopes?.length, 2, "Should have 2 scopes");
        assert.strictEqual(updated!.permissionScopes?.[0].scope, "email:read");

        // Persisted after reload
        const reloaded = manager.get(scopeAssignment.assignmentId);
        assert.strictEqual(reloaded?.permissionScopes?.length, 2, "Scopes should persist in SQLite");

        // revokeExpiredScopes — nothing expires yet
        const revoked0 = manager.revokeExpiredScopes();
        assert.strictEqual(revoked0.length, 0, "No scopes expired yet");

        // setPermissionScopes with a past expiry to trigger revocation
        const pastExpiry = new Date(Date.now() - 1000).toISOString();
        const expiredAssignment = manager.assign({
            characterId: "analyst",
            prismUserId: "prism-system-user",
            prismUserEmail: "prism@prism.local",
            operatorId: "operator-kirk",
            operatorEmail: "kirk@lasalle.io",
            clientId: "browser-client-expired",
            sessionId: "session-scope-2",
        });
        manager.setPermissionScopes(expiredAssignment.assignmentId, [
            { scope: "tool:execute", expiresAt: pastExpiry },
        ]);
        const revoked1 = manager.revokeExpiredScopes();
        assert.strictEqual(revoked1.length, 1, "One assignment should be revoked due to expired scope");
        assert.strictEqual(revoked1[0].assignmentId, expiredAssignment.assignmentId);
        assert.strictEqual(revoked1[0].state, "revoked");

        // Already-revoked assignment should not appear in a second pass
        const revoked2 = manager.revokeExpiredScopes();
        assert.strictEqual(revoked2.length, 0, "Already-revoked assignments should not be re-revoked");

        // ── R3: Business profile rejects placeholder / non-routable email domains ──
        const placeholderManager = new CharacterAccountabilityManager(store, activityBus);
        const placeholderCases: Array<{ email: string; reason: string }> = [
            { email: "admin@prism.local", reason: "PRISM scaffolding placeholder" },
            { email: "user@example.com", reason: "RFC 2606 reserved" },
            { email: "test@example.org", reason: "RFC 2606 reserved" },
            { email: "ops@localhost", reason: "loopback" },
            { email: "ceo@invalid", reason: "RFC 6761 reserved" },
            { email: "lead@workstation.local", reason: "subdomain of .local" },
        ];
        for (const { email, reason } of placeholderCases) {
            assert.throws(() => {
                placeholderManager.assign({
                    characterId: "analyst",
                    prismUserId: "prism-system-user",
                    prismUserEmail: email,
                    operatorId: "operator-kirk",
                    operatorEmail: email,
                    clientId: "browser-client-placeholder",
                    sessionId: "session-placeholder",
                    executionProfile: "business",
                });
            }, /placeholder|non-production|Invalid/, `Should reject ${reason}: ${email}`);
        }

        // Same placeholder emails MUST be accepted on Individual profile —
        // PRISM ships sample data with `@prism.local` for individual users.
        const individualOk = placeholderManager.assign({
            characterId: "analyst",
            prismUserId: "prism-system-user",
            prismUserEmail: "user@prism.local",
            operatorId: "operator-kirk",
            operatorEmail: "user@prism.local",
            clientId: "browser-client-individual",
            sessionId: "session-individual",
            executionProfile: "individual",
        });
        assert.strictEqual(individualOk.executionProfileSegment, "individual");

        console.log("✓ CharacterAccountability tests passed");
    } finally {
        store.close();
    }
}

/**
 * Phase E3 / E5 — chain inspector + email-verification helpers.
 */
export async function testCharacterAccountabilityPhaseE3(): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), "prism-cac-e3-"));
    const dbPath = join(tempDir, "activity.db");
    const activityBus = new ActivityBus();
    const store = new CharacterAccountabilityStore(dbPath);
    const manager = new CharacterAccountabilityManager(store, activityBus);

    try {
        const a = manager.assign({
            characterId: "analyst",
            prismUserId: "prism-system-user",
            prismUserEmail: "user@acme-corp.com",
            operatorId: "operator-1",
            operatorEmail: "operator@acme-corp.com",
            clientId: "test-client",
            sessionId: "session-e3",
            executionProfile: "business",
        });

        const chain = manager.getAssignmentChain(a.assignmentId);
        assert.ok(chain);
        assert.strictEqual(chain!.assignment.assignmentId, a.assignmentId);
        assert.strictEqual(chain!.scopes.total, 0);
        assert.strictEqual(chain!.emailVerification.verified, false);

        // Mismatched email → reject
        const bad = manager.markEmailVerified(a.assignmentId, "nope@acme-corp.com", "gmail");
        assert.strictEqual(bad, null);
        assert.strictEqual(manager.isEmailVerificationFresh(a.assignmentId), false);

        // Matching email → accepted
        const ok = manager.markEmailVerified(a.assignmentId, "operator@acme-corp.com", "gmail");
        assert.ok(ok);
        assert.ok(ok!.emailVerifiedAt);
        assert.strictEqual(ok!.emailVerifiedProvider, "gmail");
        assert.strictEqual(manager.isEmailVerificationFresh(a.assignmentId), true);
        assert.strictEqual(manager.isEmailVerificationFresh(a.assignmentId, 0), false);

        const audit = manager.exportAudit({});
        const row = audit.find((r) => r.assignmentId === a.assignmentId);
        assert.ok(row);
        assert.strictEqual(row!.emailVerifiedProvider, "gmail");

        console.log("✓ CharacterAccountability Phase E3/E5 tests passed");
    } finally {
        store.close();
    }
}