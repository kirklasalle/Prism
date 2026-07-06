import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, beforeEach, afterEach } from "mocha";
import {
    getOrGenerateKeyPair,
    signCertificateContent,
    verifyCertificateContent,
    verifyMarkdownCertificate,
} from "../src/core/security/initialization-signature.js";

describe("PRISM Initialization Certificate Security Suite", () => {
    let tmpDir: string;
    let dbPath: string;
    let db: DatabaseSync;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "prism-cert-test-"));
        dbPath = join(tmpDir, "prism-activity.db");
        db = new DatabaseSync(dbPath);

        // Create the basic schema for our SQLite triggers
        db.exec(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                session_id TEXT PRIMARY KEY,
                title TEXT,
                operator_email TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                message_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY(session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS support_tickets (
                ticket_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                source TEXT NOT NULL,
                status TEXT NOT NULL,
                severity TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        `);

        // Apply our database write-protection triggers
        db.exec(`
            CREATE TRIGGER IF NOT EXISTS prevent_cert_message_update
            BEFORE UPDATE ON chat_messages
            FOR EACH ROW
            WHEN OLD.metadata_json LIKE '%"type":"certificate"%'
            BEGIN
                SELECT RAISE(FAIL, 'Modification of immutable Initialization Certificate is forbidden');
            END;

            CREATE TRIGGER IF NOT EXISTS prevent_cert_message_delete
            BEFORE DELETE ON chat_messages
            FOR EACH ROW
            WHEN OLD.metadata_json LIKE '%"type":"certificate"%'
            BEGIN
                SELECT RAISE(FAIL, 'Deletion of immutable Initialization Certificate is forbidden');
            END;

            CREATE TRIGGER IF NOT EXISTS prevent_cert_session_update
            BEFORE UPDATE ON chat_sessions
            FOR EACH ROW
            WHEN OLD.title LIKE '%Initialization Certificate%'
            BEGIN
                SELECT CASE
                    WHEN NEW.title != OLD.title OR (
                        OLD.operator_email IS NOT NULL AND 
                        OLD.operator_email != 'operator@prism.local' AND 
                        OLD.operator_email != 'not set' AND 
                        NEW.operator_email != OLD.operator_email
                    )
                    THEN RAISE(FAIL, 'Modification of immutable Initialization Certificate session is forbidden')
                END;
            END;

            CREATE TRIGGER IF NOT EXISTS prevent_cert_session_delete
            BEFORE DELETE ON chat_sessions
            FOR EACH ROW
            WHEN OLD.title LIKE '%Initialization Certificate%'
            BEGIN
                SELECT RAISE(FAIL, 'Deletion of immutable Initialization Certificate session is forbidden');
            END;
        `);
    });

    afterEach(() => {
        try {
            db.close();
        } catch {
            /* best effort */
        }
        if (existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    describe("1. Cryptographic Signatures", () => {
        it("generates system keys and correctly signs and verifies arbitrary content", () => {
            const keys = getOrGenerateKeyPair();
            assert.ok(keys.privateKeyPem && keys.publicKeyBase64);

            const content = "Test configuration values: host=localhost, port=7070";
            const { signatureBase64, publicKeyBase64 } = signCertificateContent(content);

            assert.strictEqual(publicKeyBase64, keys.publicKeyBase64);
            assert.ok(verifyCertificateContent(content, signatureBase64, publicKeyBase64));

            // Tampering check
            assert.ok(!verifyCertificateContent(content + " tampered", signatureBase64, publicKeyBase64));
        });

        it("signs and verifies signed markdown certificate structure using parser helper", () => {
            const rawContent =
                "# PRISM Initialization Certificate\n**Session:** 123-abc\n## Configuration Summary\n- **Execution Profile:** individual";
            const { signatureBase64, publicKeyBase64 } = signCertificateContent(rawContent);

            const fullMarkdownCert = [
                rawContent,
                "",
                "## Cryptographic Signature Verification",
                `- **Public Key:** ${publicKeyBase64}`,
                `- **Signature:** ${signatureBase64}`,
                "- **Algorithm:** ed25519",
                "",
                "---",
                "*This certificate is an immutable provenance record of the initial PRISM system configuration.*",
            ].join("\n");

            assert.ok(verifyMarkdownCertificate(fullMarkdownCert));

            // Tamper with settings
            const tamperedMarkdown = fullMarkdownCert.replace("individual", "business");
            assert.ok(!verifyMarkdownCertificate(tamperedMarkdown));
        });
    });

    describe("2. Database Write Protection (Triggers)", () => {
        it("prevents modifying or deleting certificate message rows", () => {
            db.prepare(
                `
                INSERT INTO chat_sessions (session_id, title, operator_email, created_at)
                VALUES ('sess-1', 'PRISM Initialization Certificate — 2026-07-02', 'operator@prism.local', '2026-07-02T12:00:00Z')
            `,
            ).run();

            db.prepare(
                `
                INSERT INTO chat_messages (message_id, session_id, role, content, created_at, metadata_json)
                VALUES ('msg-1', 'sess-1', 'assistant', 'Certificate Content', '2026-07-02T12:00:00Z', '{"type":"certificate"}')
            `,
            ).run();

            // Attempt to update message
            assert.throws(() => {
                db.prepare(
                    `
                    UPDATE chat_messages SET content = 'hacked' WHERE message_id = 'msg-1'
                `,
                ).run();
            }, /Modification of immutable Initialization Certificate is forbidden/);

            // Attempt to delete message
            assert.throws(() => {
                db.prepare(
                    `
                    DELETE FROM chat_messages WHERE message_id = 'msg-1'
                `,
                ).run();
            }, /Deletion of immutable Initialization Certificate is forbidden/);

            // Verify content is untouched
            const msg = db.prepare("SELECT content FROM chat_messages WHERE message_id = 'msg-1'").get() as {
                content: string;
            };
            assert.strictEqual(msg.content, "Certificate Content");
        });

        it("prevents deleting or unauthorized updating of certificate session rows", () => {
            db.prepare(
                `
                INSERT INTO chat_sessions (session_id, title, operator_email, created_at)
                VALUES ('sess-2', 'PRISM Initialization Certificate — 2026-07-02', 'realoperator@prism.local', '2026-07-02T12:00:00Z')
            `,
            ).run();

            // Attempt to rename/change title
            assert.throws(() => {
                db.prepare(
                    `
                    UPDATE chat_sessions SET title = 'Renamed Session' WHERE session_id = 'sess-2'
                `,
                ).run();
            }, /Modification of immutable Initialization Certificate session is forbidden/);

            // Attempt to delete session
            assert.throws(() => {
                db.prepare(
                    `
                    DELETE FROM chat_sessions WHERE session_id = 'sess-2'
                `,
                ).run();
            }, /Deletion of immutable Initialization Certificate session is forbidden/);

            // Update email from one real email to another should fail
            assert.throws(() => {
                db.prepare(
                    `
                    UPDATE chat_sessions SET operator_email = 'hacker@prism.local' WHERE session_id = 'sess-2'
                `,
                ).run();
            }, /Modification of immutable Initialization Certificate session is forbidden/);
        });

        it("allows claiming of placeholder/null email exactly once", () => {
            db.prepare(
                `
                INSERT INTO chat_sessions (session_id, title, operator_email, created_at)
                VALUES ('sess-3', 'PRISM Initialization Certificate — 2026-07-02', 'operator@prism.local', '2026-07-02T12:00:00Z')
            `,
            ).run();

            db.prepare(
                `
                INSERT INTO chat_sessions (session_id, title, operator_email, created_at)
                VALUES ('sess-4', 'PRISM Initialization Certificate — 2026-07-02', NULL, '2026-07-02T12:00:00Z')
            `,
            ).run();

            // Claim should succeed since current is NULL
            db.prepare(
                `
                UPDATE chat_sessions SET operator_email = 'realoperator@prism.local' WHERE session_id = 'sess-4'
            `,
            ).run();

            // Subsequent update should fail
            assert.throws(() => {
                db.prepare(
                    `
                    UPDATE chat_sessions SET operator_email = 'newoperator@prism.local' WHERE session_id = 'sess-4'
                `,
                ).run();
            }, /Modification of immutable Initialization Certificate session is forbidden/);
        });
    });
});
