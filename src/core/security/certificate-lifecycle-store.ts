/**
 * Signed Certificate Lifecycle Event Store — Phase 2 (IC-03, IC-11)
 *
 * Implements an immutable, append-only SQLite store for certificate lifecycle events:
 *   - `issued`: New certificate generated and signed for an operator.
 *   - `archived`: Active certificate archived (e.g. operator role update).
 *   - `superseded`: Certificate replaced by a newer sequence certificate.
 *   - `revoked`: Certificate explicitly revoked due to key compromise or policy violation.
 *
 * Each lifecycle event includes a signature computed over its canonical JSON string.
 *
 * @module core/security/certificate-lifecycle-store
 */

import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { signCertificateContent, verifyCertificateContent } from "./initialization-signature.js";

export type CertificateLifecycleEventType = "issued" | "archived" | "superseded" | "revoked";

export interface CertificateLifecycleEvent {
    readonly eventId: string;
    readonly certificateId: string;
    readonly eventType: CertificateLifecycleEventType;
    readonly operatorEmail: string;
    readonly reasoning: string;
    readonly timestamp: string;
    readonly signatureBase64: string;
    readonly publicKeyBase64: string;
}

export class CertificateLifecycleStore {
    private readonly insertStmt: ReturnType<DatabaseSync["prepare"]>;

    constructor(private readonly db: DatabaseSync) {
        this.migrate();
        this.insertStmt = this.db.prepare(`
            INSERT OR IGNORE INTO certificate_lifecycle_events
                (event_id, certificate_id, event_type, operator_email, reasoning, timestamp, signature_b64, public_key_b64)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?)
        `);
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS certificate_lifecycle_events (
                event_id TEXT PRIMARY KEY,
                certificate_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                operator_email TEXT NOT NULL,
                reasoning TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                signature_b64 TEXT NOT NULL,
                public_key_b64 TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_cert_lifecycle_cert_id
            ON certificate_lifecycle_events (certificate_id);

            CREATE INDEX IF NOT EXISTS idx_cert_lifecycle_operator
            ON certificate_lifecycle_events (operator_email);
        `);
    }

    /**
     * Record a signed lifecycle transition event.
     */
    recordEvent(
        certificateId: string,
        eventType: CertificateLifecycleEventType,
        operatorEmail: string,
        reasoning: string,
    ): CertificateLifecycleEvent {
        const eventId = "evt-cert-" + randomUUID();
        const timestamp = new Date().toISOString();

        const payload = JSON.stringify({
            eventId,
            certificateId,
            eventType,
            operatorEmail: operatorEmail.trim().toLowerCase(),
            reasoning,
            timestamp,
        });

        const { signatureBase64, publicKeyBase64 } = signCertificateContent(payload);

        this.insertStmt.run(
            eventId,
            certificateId,
            eventType,
            operatorEmail.trim().toLowerCase(),
            reasoning,
            timestamp,
            signatureBase64,
            publicKeyBase64,
        );

        return {
            eventId,
            certificateId,
            eventType,
            operatorEmail: operatorEmail.trim().toLowerCase(),
            reasoning,
            timestamp,
            signatureBase64,
            publicKeyBase64,
        };
    }

    /**
     * Get all lifecycle events for a specific certificate ID.
     */
    getEventsForCertificate(certificateId: string): CertificateLifecycleEvent[] {
        const stmt = this.db.prepare(`
            SELECT event_id, certificate_id, event_type, operator_email, reasoning, timestamp, signature_b64, public_key_b64
            FROM certificate_lifecycle_events
            WHERE certificate_id = ?
            ORDER BY timestamp ASC
        `);
        const rows = stmt.all(certificateId) as Array<{
            event_id: string;
            certificate_id: string;
            event_type: CertificateLifecycleEventType;
            operator_email: string;
            reasoning: string;
            timestamp: string;
            signature_b64: string;
            public_key_b64: string;
        }>;

        return rows.map((r) => ({
            eventId: r.event_id,
            certificateId: r.certificate_id,
            eventType: r.event_type,
            operatorEmail: r.operator_email,
            reasoning: r.reasoning,
            timestamp: r.timestamp,
            signatureBase64: r.signature_b64,
            publicKeyBase64: r.public_key_b64,
        }));
    }

    /**
     * Verify the signature of a lifecycle event.
     */
    verifyEventSignature(event: CertificateLifecycleEvent): boolean {
        const payload = JSON.stringify({
            eventId: event.eventId,
            certificateId: event.certificateId,
            eventType: event.eventType,
            operatorEmail: event.operatorEmail,
            reasoning: event.reasoning,
            timestamp: event.timestamp,
        });

        return verifyCertificateContent(payload, event.signatureBase64, event.publicKeyBase64);
    }
}
