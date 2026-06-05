import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ActivityEvent, ActivitySubscriber } from "./types.js";
import type { IActivityStore } from "../database/store-interfaces.js";

export class SqliteActivityStore implements IActivityStore {
    private readonly db: DatabaseSync;
    private readonly insertStmt: StatementSync;
    private readonly selectStmt: StatementSync;
    private readonly insertLlreStmt: StatementSync;
    /** Set to true after close() so late-arriving Guardian/timer events are silently dropped. */
    private _closed = false;

    constructor(readonly dbPath: string = "prism-activity.db") {
        this.db = new DatabaseSync(dbPath);
        this.migrate();

        this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO activity_events
        (id, timestamp, session_id, layer, operation, status,
         confidence, duration_ms, details,
         authority_tier, policy_decision, side_effects,
         character_id, prism_user_id, prism_user_email,
         operator_id, operator_email, client_id, assignment_id, accountability_chain,
         rollback_plan, hash)
      VALUES
        (:id, :timestamp, :sessionId, :layer, :operation, :status,
         :confidence, :durationMs, :details,
         :authorityTier, :policyDecision, :sideEffects,
         :characterId, :prismUserId, :prismUserEmail,
         :operatorId, :operatorEmail, :clientId, :assignmentId, :accountabilityChain,
         :rollbackPlan, :hash)
    `);

        this.selectStmt = this.db.prepare(`
      SELECT * FROM activity_events
      ORDER BY timestamp DESC
      LIMIT 1000
    `);

        this.insertLlreStmt = this.db.prepare(`
      INSERT OR REPLACE INTO prism_llre_telemetry
        (id, timestamp, session_id, correlation_id, model_name,
         tokens_consumed, latency_ms, cost_usd, rsi_score, csr_score, tca_score, teq_score, details)
      VALUES
        (:id, :timestamp, :sessionId, :correlationId, :modelName,
         :tokensConsumed, :latencyMs, :costUsd, :rsiScore, :csrScore, :tcaScore, :teqScore, :details)
    `);
    }

    private migrate(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id            TEXT PRIMARY KEY,
        timestamp     TEXT NOT NULL,
        session_id    TEXT NOT NULL,
        layer         TEXT NOT NULL,
        operation     TEXT NOT NULL,
        status        TEXT NOT NULL,
        confidence    REAL,
        duration_ms   INTEGER,
        details       TEXT,
        authority_tier  TEXT,
        policy_decision TEXT,
        side_effects  TEXT,
        character_id  TEXT,
        prism_user_id TEXT,
        prism_user_email TEXT,
        operator_id   TEXT,
        operator_email TEXT,
        client_id     TEXT,
        assignment_id TEXT,
        accountability_chain TEXT,
        rollback_plan TEXT,
        hash          TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ae_session   ON activity_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_ae_operation ON activity_events(operation);
      CREATE INDEX IF NOT EXISTS idx_ae_timestamp ON activity_events(timestamp);

      CREATE TABLE IF NOT EXISTS prism_llre_telemetry (
        id             TEXT PRIMARY KEY,
        timestamp      TEXT NOT NULL,
        session_id     TEXT NOT NULL,
        correlation_id TEXT,
        model_name     TEXT NOT NULL,
        tokens_consumed INTEGER NOT NULL,
        latency_ms     INTEGER NOT NULL,
        cost_usd       REAL NOT NULL,
        rsi_score      REAL NOT NULL,
        csr_score      REAL NOT NULL,
        tca_score      REAL NOT NULL,
        teq_score      REAL NOT NULL,
        details        TEXT DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_llre_session    ON prism_llre_telemetry(session_id);
      CREATE INDEX IF NOT EXISTS idx_llre_timestamp  ON prism_llre_telemetry(timestamp);
      CREATE INDEX IF NOT EXISTS idx_llre_teq        ON prism_llre_telemetry(teq_score);
    `);

        this.ensureColumns("activity_events", [
            { name: "confidence", definition: "REAL" },
            { name: "duration_ms", definition: "INTEGER" },
            { name: "details", definition: "TEXT DEFAULT '{}'" },
            { name: "authority_tier", definition: "TEXT" },
            { name: "policy_decision", definition: "TEXT" },
            { name: "side_effects", definition: "TEXT DEFAULT '[]'" },
            { name: "character_id", definition: "TEXT" },
            { name: "prism_user_id", definition: "TEXT" },
            { name: "prism_user_email", definition: "TEXT" },
            { name: "operator_id", definition: "TEXT" },
            { name: "operator_email", definition: "TEXT" },
            { name: "client_id", definition: "TEXT" },
            { name: "assignment_id", definition: "TEXT" },
            { name: "accountability_chain", definition: "TEXT" },
            { name: "rollback_plan", definition: "TEXT" },
            { name: "hash", definition: "TEXT" },
        ]);
    }

    private ensureColumns(
        tableName: string,
        columns: Array<{ name: string; definition: string }>,
    ): void {
        const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
        const existing = new Set(rows.map((row) => row.name));

        for (const column of columns) {
            if (existing.has(column.name)) {
                continue;
            }

            this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.definition}`);
        }
    }

    onEvent(event: ActivityEvent): void {
        // Silently drop events after the DB is closed (e.g. Guardian timers firing during shutdown).
        if (this._closed) return;

        if (event.operation === "llre.telemetry.recorded") {
            const metrics = event.details as any;
            this.saveLlreTelemetry({
                sessionId: metrics.sessionId ?? event.sessionId,
                correlationId: metrics.correlationId ?? null,
                modelName: metrics.modelName ?? "unknown-model",
                tokensConsumed: Number(metrics.tokensConsumed ?? 0),
                latencyMs: Number(metrics.latencyMs ?? event.durationMs ?? 0),
                costUsd: Number(metrics.costUsd ?? 0.0),
                rsi: Number(metrics.rsi ?? metrics.rsiScore ?? 1.0),
                csr: Number(metrics.csr ?? metrics.csrScore ?? 1.0),
                tca: Number(metrics.tca ?? metrics.tcaScore ?? 1.0),
                teq: Number(metrics.teq ?? metrics.teqScore ?? 0.0),
                details: metrics.details ?? metrics,
            });
            return;
        }

        this.insertStmt.run({
            id: event.id,
            timestamp: event.timestamp,
            sessionId: event.sessionId,
            layer: event.layer,
            operation: event.operation,
            status: event.status,
            confidence: event.confidence ?? null,
            durationMs: event.durationMs ?? null,
            details: JSON.stringify(event.details),
            authorityTier: event.authorityTier ?? null,
            policyDecision: event.policyDecision ?? null,
            sideEffects: JSON.stringify(event.sideEffects ?? []),
            characterId: event.characterId ?? null,
            prismUserId: event.prismUserId ?? null,
            prismUserEmail: event.prismUserEmail ?? null,
            operatorId: event.operatorId ?? null,
            operatorEmail: event.operatorEmail ?? null,
            clientId: event.clientId ?? null,
            assignmentId: event.assignmentId ?? null,
            accountabilityChain: event.accountabilityChain ? JSON.stringify(event.accountabilityChain) : null,
            rollbackPlan: event.rollbackPlan ?? null,
            hash: event.hash ?? null,
        });
    }

    queryEvents(filter: {
        sessionId?: string;
        operation?: string;
        layer?: string;
        characterId?: string;
        prismUserId?: string;
        prismUserEmail?: string;
        operatorId?: string;
        operatorEmail?: string;
        clientId?: string;
        assignmentId?: string;
    }): ActivityEvent[] {
        if (this._closed) return [];
        const conditions: string[] = [];
        const params: Record<string, string> = {};

        if (filter.sessionId) { conditions.push("session_id = :sessionId"); params.sessionId = filter.sessionId; }
        if (filter.operation) { conditions.push("operation = :operation"); params.operation = filter.operation; }
        if (filter.layer) { conditions.push("layer = :layer"); params.layer = filter.layer; }
        if (filter.characterId) { conditions.push("character_id = :characterId"); params.characterId = filter.characterId; }
        if (filter.prismUserId) { conditions.push("prism_user_id = :prismUserId"); params.prismUserId = filter.prismUserId; }
        if (filter.prismUserEmail) { conditions.push("prism_user_email = :prismUserEmail"); params.prismUserEmail = filter.prismUserEmail; }
        if (filter.operatorId) { conditions.push("operator_id = :operatorId"); params.operatorId = filter.operatorId; }
        if (filter.operatorEmail) { conditions.push("operator_email = :operatorEmail"); params.operatorEmail = filter.operatorEmail; }
        if (filter.clientId) { conditions.push("client_id = :clientId"); params.clientId = filter.clientId; }
        if (filter.assignmentId) { conditions.push("assignment_id = :assignmentId"); params.assignmentId = filter.assignmentId; }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = this.db.prepare(
            `SELECT * FROM activity_events ${where} ORDER BY timestamp DESC LIMIT 1000`
        ).all(params) as Record<string, unknown>[];

        return rows.map((row) => ({
            id: String(row.id),
            timestamp: String(row.timestamp),
            sessionId: String(row.session_id),
            layer: String(row.layer) as ActivityEvent["layer"],
            operation: String(row.operation),
            status: String(row.status) as ActivityEvent["status"],
            confidence: row.confidence != null ? Number(row.confidence) : undefined,
            durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
            details: JSON.parse(String(row.details ?? "{}")),
            authorityTier: row.authority_tier != null ? String(row.authority_tier) as ActivityEvent["authorityTier"] : undefined,
            policyDecision: row.policy_decision != null ? String(row.policy_decision) as ActivityEvent["policyDecision"] : undefined,
            sideEffects: JSON.parse(String(row.side_effects ?? "[]")),
            characterId: row.character_id != null ? String(row.character_id) : undefined,
            prismUserId: row.prism_user_id != null ? String(row.prism_user_id) : undefined,
            prismUserEmail: row.prism_user_email != null ? String(row.prism_user_email) : undefined,
            operatorId: row.operator_id != null ? String(row.operator_id) : undefined,
            operatorEmail: row.operator_email != null ? String(row.operator_email) : undefined,
            clientId: row.client_id != null ? String(row.client_id) : undefined,
            assignmentId: row.assignment_id != null ? String(row.assignment_id) : undefined,
            accountabilityChain: row.accountability_chain != null
                ? JSON.parse(String(row.accountability_chain)) as ActivityEvent["accountabilityChain"]
                : undefined,
            rollbackPlan: row.rollback_plan != null ? String(row.rollback_plan) : undefined,
            hash: row.hash != null ? String(row.hash) : undefined,
        }));
    }

    saveLlreTelemetry(metrics: {
        sessionId: string;
        correlationId?: string;
        modelName: string;
        tokensConsumed: number;
        latencyMs: number;
        costUsd: number;
        rsi: number;
        csr: number;
        tca: number;
        teq: number;
        details?: Record<string, unknown>;
    }): void {
        if (this._closed) return;
        const id = "llre-" + Math.random().toString(36).substring(2, 14);
        this.insertLlreStmt.run({
            id,
            timestamp: new Date().toISOString(),
            sessionId: metrics.sessionId,
            correlationId: metrics.correlationId ?? null,
            modelName: metrics.modelName,
            tokensConsumed: metrics.tokensConsumed,
            latencyMs: metrics.latencyMs,
            costUsd: metrics.costUsd,
            rsiScore: metrics.rsi,
            csrScore: metrics.csr,
            tcaScore: metrics.tca,
            teqScore: metrics.teq,
            details: JSON.stringify(metrics.details ?? {}),
        });
    }

    queryLlreTelemetry(sessionId: string): any[] {
        if (this._closed) return [];
        return this.db.prepare(`
            SELECT * FROM prism_llre_telemetry
            WHERE session_id = :sessionId
            ORDER BY timestamp DESC
        `).all({ sessionId }) as any[];
    }

    close(): void {
        if (this._closed) return;
        this._closed = true;
        this.db.close();
    }
}
