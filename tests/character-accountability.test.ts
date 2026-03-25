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

        console.log("✓ CharacterAccountability tests passed");
    } finally {
        store.close();
    }
}