import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, beforeEach, afterEach } from "node:test";
import { ActivityBus } from "../src/core/activity/bus.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { DashboardService } from "../src/core/operator/dashboard-service.js";
import { InMemoryProviderSecretStore } from "../src/core/operator/provider-secret-store.js";
import {
    getOrGenerateKeyPair,
    signCertificateContent,
    verifyCertificateContent,
    verifyMarkdownCertificate,
    verifyMarkdownCertificateWithPin,
} from "../src/core/security/initialization-signature.js";
import {
    registerKey,
    getActiveKey,
    revokeKey,
    isKeyTrusted,
} from "../src/core/security/key-registry.js";
import { validateAuthorityContext } from "../src/core/security/execution-authority-context.js";

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
                        NEW.operator_email != OLD.operator_email AND
                        (NEW.operator_email IS NULL OR NEW.operator_email NOT LIKE 'archived:%')
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

        it("allows archiving a real operator certificate ownership marker", () => {
            db.prepare(
                `
                INSERT INTO chat_sessions (session_id, title, operator_email, created_at)
                VALUES ('sess-5', 'PRISM Initialization Certificate — 2026-07-02', 'realoperator@prism.local', '2026-07-02T12:00:00Z')
            `,
            ).run();

            db.prepare(
                `
                UPDATE chat_sessions
                SET operator_email = 'archived:2026-07-02t13:00:00z:realoperator@prism.local'
                WHERE session_id = 'sess-5'
            `,
            ).run();

            const session = db.prepare("SELECT operator_email FROM chat_sessions WHERE session_id = 'sess-5'").get() as {
                operator_email: string;
            };
            assert.ok(session.operator_email.startsWith("archived:"));
        });
    });

    describe("3. Certificate Session Lock", () => {
        function createService(): DashboardService {
            return new DashboardService(
                new ApprovalQueue(),
                new ActivityBus(),
                {
                    sessionId: "test-session",
                    environmentProfile: "test",
                    mode: "server",
                    startedAt: new Date().toISOString(),
                    executionProfileSegment: "individual",
                },
                new ChatSessionStore(":memory:"),
                [],
                0,
                undefined,
                undefined,
                new InMemoryProviderSecretStore(),
            );
        }

        function createCertificateSession(service: DashboardService): string {
            const session = service.createChatSession({
                title: "PRISM Initialization Certificate — Locked",
                allowUnbound: true,
            });
            service.getChatStore().appendMessage(
                session.sessionId,
                "assistant",
                "# PRISM Initialization Certificate\n## Cryptographic Signature Verification\n- **Algorithm:** ed25519\n- **Guardian:** Active",
                { type: "certificate" },
            );
            return session.sessionId;
        }

        it("refuses non-certificate chat in a locked certificate session", async () => {
            const service = createService();
            const sessionId = createCertificateSession(service);

            (service as any).generateAssistantReply = async () => {
                throw new Error("generateAssistantReply should not be called for refused prompts");
            };

            const turn = await service.submitChatMessage(sessionId, "Write me a marketing poem.");

            assert.equal(turn.userMessage.content, "Write me a marketing poem.");
            assert.match(turn.assistantMessage.content, /locked to the certificate itself and PRISM core security/i);
            assert.equal(turn.assistantMessage.metadata.intent, "initialization_certificate_lock");
            assert.equal(turn.assistantMessage.metadata.certificateLock, "scope_refused");
        });

        it("allows certificate explanation requests and injects a certificate-only guardrail", async () => {
            const service = createService();
            const sessionId = createCertificateSession(service);

            (service as any).generateAssistantReply = async (_sessionId: string, prompt: string, conversation: any[]) => {
                assert.match(prompt, /ed25519/i);
                assert.ok(
                    conversation.some(
                        (entry) => entry.role === "system" && /Only explain the certificate's content/i.test(entry.content),
                    ),
                );
                assert.ok(
                    conversation.some(
                        (entry) => entry.metadata && entry.metadata.type === "certificate" && /ed25519/i.test(entry.content),
                    ),
                );
                return {
                    content: "The ed25519 signature proves the certificate content has not been tampered with.",
                    metadata: { intent: "certificate_explanation" },
                };
            };

            const turn = await service.submitChatMessage(sessionId, "Explain the ed25519 signature in the certificate.");

            assert.match(turn.assistantMessage.content, /has not been tampered with/i);
            assert.equal(turn.assistantMessage.metadata.intent, "certificate_explanation");
            assert.equal(turn.assistantMessage.metadata.certificateLock, "allowed");
        });

        it("refuses relentless repeated certificate prompts", async () => {
            const service = createService();
            const sessionId = createCertificateSession(service);
            const repeatedPrompt = "Explain the Guardian line in the certificate.";

            service.getChatStore().appendMessage(sessionId, "user", repeatedPrompt, { source: "test" });
            service.getChatStore().appendMessage(sessionId, "assistant", "Guardian explanation 1", {
                intent: "certificate_explanation",
            });
            service.getChatStore().appendMessage(sessionId, "user", repeatedPrompt, { source: "test" });
            service.getChatStore().appendMessage(sessionId, "assistant", "Guardian explanation 2", {
                intent: "certificate_explanation",
            });

            (service as any).generateAssistantReply = async () => {
                throw new Error("generateAssistantReply should not be called for relentless repeats");
            };

            const turn = await service.submitChatMessage(sessionId, repeatedPrompt);

            assert.match(turn.assistantMessage.content, /will not repeat the same explanation relentlessly/i);
            assert.equal(turn.assistantMessage.metadata.certificateLock, "repeat_refused");
        });
    });

    // ── IC-10 / IC-12 Phase 0: Key Material and Pinned Verification ────────

    describe("6. Phase 0 Key Material Security (IC-12)", () => {
        it("verifyMarkdownCertificateWithPin returns valid=false for malformed markdown", () => {
            const result = verifyMarkdownCertificateWithPin("not a valid certificate");
            assert.strictEqual(result.valid, false);
            assert.ok(result.reason.includes("marker not found"));
        });

        it("verifyMarkdownCertificateWithPin returns valid=false when signature is wrong", () => {
            const content = "# Test Certificate\n\nSome content here.";
            const { signatureBase64, publicKeyBase64 } = signCertificateContent(content);

            // Build a markdown certificate with a tampered content
            const tamperedMd =
                "# Test Certificate\n\nTampered content.\n\n## Cryptographic Signature Verification\n\n" +
                `- **Public Key:** ${publicKeyBase64}\n- **Signature:** ${signatureBase64}\n`;

            const result = verifyMarkdownCertificateWithPin(tamperedMd);
            assert.strictEqual(result.valid, false, "Tampered content should fail signature verification");
        });

        it("key registry tracks key fingerprints", () => {
            // Create an in-memory registry
            const registry = { version: 1 as const, keys: [] };
            const fakeKey = "MCowBQYDK2VwAyEAVrLXMR2aKK9MPFhIcMU3xT6y2bC8DYlhRH5dT3qQ8xg=";
            const entry = registerKey(registry, fakeKey);

            assert.ok(entry.keyId, "Key should have an ID");
            assert.ok(entry.fingerprint, "Key should have a fingerprint");
            assert.strictEqual(entry.status, "active");

            // Active key should be the one we registered
            const active = getActiveKey(registry);
            assert.ok(active);
            assert.strictEqual(active.fingerprint, entry.fingerprint);

            // Trust check should pass
            const trustResult = isKeyTrusted(registry, fakeKey);
            assert.strictEqual(trustResult.trusted, true);

            // Revoke the key
            const revoked = revokeKey(registry, entry.fingerprint, "Phase 0 audit");
            assert.strictEqual(revoked, true);

            // Trust check should now fail
            const trustResult2 = isKeyTrusted(registry, fakeKey);
            assert.strictEqual(trustResult2.trusted, false);
            assert.ok(trustResult2.reason.includes("revoked"));

            // Unknown key should not be trusted
            const unknownResult = isKeyTrusted(registry, "dW5rbm93bl9rZXk=");
            assert.strictEqual(unknownResult.trusted, false);
            assert.ok(unknownResult.reason.includes("Unknown"));
        });
    });

    describe("7. Phase 0 Execution Authority Context (IC-05)", () => {
        it("validateAuthorityContext warns on missing context but returns valid in Phase 0", () => {
            const result = validateAuthorityContext(null);
            assert.strictEqual(result.valid, true, "Phase 0 is warn-only, so null context is 'valid'");
            assert.ok(result.missingFields.length > 0, "Should report missing fields");
            assert.ok(result.reason.includes("PHASE0_WARN"));
        });

        it("validateAuthorityContext returns no missing fields for complete context", () => {
            const result = validateAuthorityContext({
                certificateId: "cert-123",
                assignmentId: "asgn-456",
                operatorEmail: "kirk@example.com",
                operatorName: "Kirk LaSalle",
                cacEmail: "cac@example.com",
                cacName: "CAC Agent",
                resolvedAt: new Date().toISOString(),
                resolvedBy: "server",
            });
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.missingFields.length, 0);
            assert.ok(result.reason.includes("complete"));
        });
    });
});
