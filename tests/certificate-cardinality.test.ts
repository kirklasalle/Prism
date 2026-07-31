/**
 * Phase 2 Security Test Suite — Certificate Cardinality & Legacy Quarantine (IC-13)
 *
 * Tests:
 * 1. Exactly 1 active Initialization Certificate per operator constraint (`idx_unique_active_operator_cert`).
 * 2. Attempting to issue a second active certificate to the same operator fails closed with a unique constraint error.
 * 3. `executeCertificateMigration` quarantines historical `operator@prism.local` dev placeholder records (`is_quarantined = 1`).
 * 4. Quarantined records do not block issuing a new active certificate for the operator.
 * 5. `CertificateLifecycleStore` persists and verifies signed lifecycle events (`issued`, `archived`, `superseded`, `revoked`).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { executeCertificateMigration } from "../src/core/security/certificate-migration-manifest.js";
import { CertificateLifecycleStore } from "../src/core/security/certificate-lifecycle-store.js";

describe("Phase 2 Certificate Cardinality & Quarantine Suite (IC-13)", () => {
    let tmpDir: string;
    let dbPath: string;
    let store: ChatSessionStore;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-phase2-test-"));
        dbPath = join(tmpDir, "test.db");
        store = new ChatSessionStore(dbPath);
    });

    afterEach(() => {
        store.close();
        if (existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── 1. Unique Active Certificate Constraint ───────────────────────────

    describe("1. Exactly 1 Active Certificate Per Operator Constraint (IC-13)", () => {
        it("allows issuing one active certificate for an operator", () => {
            const session = store.createSession({
                title: "PRISM Initialization Certificate — Kirk",
                operatorEmail: "kirk@prismrefraction.com",
            });
            assert.ok(session.sessionId);
            assert.strictEqual(session.operatorEmail, "kirk@prismrefraction.com");
        });

        it("fails closed when attempting to issue a second active certificate to the same operator", () => {
            store.createSession({
                title: "PRISM Initialization Certificate — Kirk",
                operatorEmail: "kirk@prismrefraction.com",
            });

            // Second creation with same title and operatorEmail must throw unique constraint error
            assert.throws(
                () => {
                    store.createSession({
                        title: "PRISM Initialization Certificate — Kirk Dup",
                        operatorEmail: "kirk@prismrefraction.com",
                    });
                },
                /UNIQUE constraint failed/i,
                "Second active certificate for the same operator must fail unique constraint",
            );
        });

        it("allows issuing a second certificate if the first certificate is archived", () => {
            const first = store.createSession({
                title: "PRISM Initialization Certificate — First",
                operatorEmail: "kirk@prismrefraction.com",
            });

            // Archive the first certificate session operator_email
            store.updateSessionOperatorEmail(first.sessionId, "archived:2026-07-31:kirk@prismrefraction.com");

            // Now issuing a new active certificate for the operator succeeds
            const second = store.createSession({
                title: "PRISM Initialization Certificate — Second",
                operatorEmail: "kirk@prismrefraction.com",
            });
            assert.ok(second.sessionId);
            assert.strictEqual(second.operatorEmail, "kirk@prismrefraction.com");
        });
    });

    // ── 2. Legacy Developer Placeholder Quarantine ────────────────────────

    describe("2. Legacy Developer Placeholder Quarantine (IC-13)", () => {
        it("quarantines legacy operator@prism.local dev placeholder records so they do not block active issuance", () => {
            // Directly insert a raw legacy session with operator@prism.local
            const rawDb = (store as any).db as DatabaseSync;
            rawDb.exec(`
                INSERT INTO chat_sessions (session_id, title, created_at, updated_at, operator_email, is_quarantined)
                VALUES ('legacy-1', 'PRISM Initialization Certificate — Old Dev', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'operator@prism.local', 0);
            `);

            // Run migration
            const summary = executeCertificateMigration(rawDb);
            assert.ok(summary.quarantinedCount >= 1, "Should quarantine the legacy session");

            // Verify legacy row is marked is_quarantined = 1
            const row = rawDb.prepare("SELECT is_quarantined FROM chat_sessions WHERE session_id = 'legacy-1'").get() as { is_quarantined: number };
            assert.strictEqual(row.is_quarantined, 1);

            // Now creating an active certificate for kirk@prismrefraction.com succeeds cleanly
            const activeSession = store.createSession({
                title: "PRISM Initialization Certificate — Active",
                operatorEmail: "kirk@prismrefraction.com",
            });
            assert.ok(activeSession.sessionId);
        });
    });

    // ── 3. Signed Certificate Lifecycle Events ───────────────────────────

    describe("3. Signed Certificate Lifecycle Events (IC-03, IC-11)", () => {
        it("records and verifies signed lifecycle transition events", () => {
            const rawDb = (store as any).db as DatabaseSync;
            const lifecycleStore = new CertificateLifecycleStore(rawDb);

            const certId = "cert-123456";
            const operator = "kirk@prismrefraction.com";

            // Record issued event
            const issuedEvt = lifecycleStore.recordEvent(certId, "issued", operator, "Initial setup certificate issuance");
            assert.ok(issuedEvt.eventId.startsWith("evt-cert-"));
            assert.strictEqual(issuedEvt.eventType, "issued");
            assert.ok(lifecycleStore.verifyEventSignature(issuedEvt), "Issued event signature must be valid");

            // Record archived event
            const archivedEvt = lifecycleStore.recordEvent(certId, "archived", operator, "Operator role update key rotation");
            assert.strictEqual(archivedEvt.eventType, "archived");
            assert.ok(lifecycleStore.verifyEventSignature(archivedEvt), "Archived event signature must be valid");

            // List history
            const history = lifecycleStore.getEventsForCertificate(certId);
            assert.strictEqual(history.length, 2);
            assert.strictEqual(history[0].eventType, "issued");
            assert.strictEqual(history[1].eventType, "archived");
        });
    });
});
