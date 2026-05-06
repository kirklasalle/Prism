/**
 * Phase E3b tests — Session creation-as-governance-gate at the store layer.
 *
 * Covers:
 *   - createSession(input) records character_id, cac_assignment_id, execution_profile,
 *     operator_email, assistant_email.
 *   - Backward-compat string form produces NULL governance fields (legacy/unbound).
 *   - bindSessionCharacter() rewrites governance fields on an existing row.
 *   - getSession()/listSessions() expose the new fields on summaries.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";

describe("ChatSessionStore — E3b governance-gate fields", () => {
    let tmpDir: string;
    let store: ChatSessionStore;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-e3b-bind-"));
        store = new ChatSessionStore(join(tmpDir, "test.db"));
    });

    after(() => {
        store.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("string form creates an unbound session with NULL governance fields", () => {
        const s = store.createSession("Legacy-style");
        assert.equal(s.title, "Legacy-style");
        assert.equal(s.characterId, null);
        assert.equal(s.cacAssignmentId, null);
        assert.equal(s.executionProfile, null);
        assert.equal(s.operatorEmail, null);
        assert.equal(s.assistantEmail, null);
    });

    it("input form persists characterId, cacAssignmentId, executionProfile, emails", () => {
        const s = store.createSession({
            title: "Bound",
            characterId: "aria-individual",
            cacAssignmentId: "cac-1234",
            executionProfile: "individual",
            operatorEmail: "operator@prism.local",
            assistantEmail: "aria@prism.local",
        });
        assert.equal(s.characterId, "aria-individual");
        assert.equal(s.cacAssignmentId, "cac-1234");
        assert.equal(s.executionProfile, "individual");
        assert.equal(s.operatorEmail, "operator@prism.local");
        assert.equal(s.assistantEmail, "aria@prism.local");
    });

    it("bindSessionCharacter() rewrites governance fields on an existing row", () => {
        const s = store.createSession("Unbound");
        const bound = store.bindSessionCharacter(s.sessionId, {
            characterId: "phoenix-business",
            cacAssignmentId: "cac-5678",
            executionProfile: "business",
            operatorEmail: "ops@example.com",
            assistantEmail: "phoenix@example.com",
        });
        assert.ok(bound, "returns a summary for an existing session");
        assert.equal(bound!.characterId, "phoenix-business");
        assert.equal(bound!.cacAssignmentId, "cac-5678");
        assert.equal(bound!.executionProfile, "business");
        assert.equal(bound!.operatorEmail, "ops@example.com");
        assert.equal(bound!.assistantEmail, "phoenix@example.com");
    });

    it("bindSessionCharacter() returns null for an unknown sessionId", () => {
        const result = store.bindSessionCharacter("does-not-exist", {
            characterId: "aria-individual",
        });
        assert.equal(result, null);
    });

    it("listSessions() surfaces governance fields on every row", () => {
        const all = store.listSessions();
        for (const row of all) {
            assert.ok("characterId" in row);
            assert.ok("cacAssignmentId" in row);
            assert.ok("executionProfile" in row);
            assert.ok("operatorEmail" in row);
            assert.ok("assistantEmail" in row);
        }
    });
});
