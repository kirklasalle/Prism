import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ActivityEvent, ActivitySubscriber } from "./types.js";

export class SqliteActivityStore implements ActivitySubscriber {
    private readonly db: DatabaseSync;
    private readonly insertStmt: StatementSync;
    private readonly selectStmt: StatementSync;

    constructor(readonly dbPath: string = "prism-activity.db") {
        this.db = new DatabaseSync(dbPath);
        this.migrate();

        this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO activity_events
        (id, timestamp, session_id, layer, operation, status,
         confidence, duration_ms, details,
         authority_tier, policy_decision, side_effects,
         rollback_plan, hash)
      VALUES
        (:id, :timestamp, :sessionId, :layer, :operation, :status,
         :confidence, :durationMs, :details,
         :authorityTier, :policyDecision, :sideEffects,
         :rollbackPlan, :hash)
    `);

        this.selectStmt = this.db.prepare(`
      SELECT * FROM activity_events
      ORDER BY timestamp DESC
      LIMIT 1000
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
        rollback_plan TEXT,
        hash          TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ae_session   ON activity_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_ae_operation ON activity_events(operation);
      CREATE INDEX IF NOT EXISTS idx_ae_timestamp ON activity_events(timestamp);
    `);

        this.ensureColumns("activity_events", [
            { name: "confidence", definition: "REAL" },
            { name: "duration_ms", definition: "INTEGER" },
            { name: "details", definition: "TEXT DEFAULT '{}'" },
            { name: "authority_tier", definition: "TEXT" },
            { name: "policy_decision", definition: "TEXT" },
            { name: "side_effects", definition: "TEXT DEFAULT '[]'" },
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
            rollbackPlan: event.rollbackPlan ?? null,
            hash: event.hash ?? null,
        });
    }

    queryEvents(filter: {
        sessionId?: string;
        operation?: string;
        layer?: string;
    }): ActivityEvent[] {
        const conditions: string[] = [];
        const params: Record<string, string> = {};

        if (filter.sessionId) { conditions.push("session_id = :sessionId"); params.sessionId = filter.sessionId; }
        if (filter.operation) { conditions.push("operation = :operation"); params.operation = filter.operation; }
        if (filter.layer) { conditions.push("layer = :layer"); params.layer = filter.layer; }

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
            rollbackPlan: row.rollback_plan != null ? String(row.rollback_plan) : undefined,
            hash: row.hash != null ? String(row.hash) : undefined,
        }));
    }

    close(): void {
        this.db.close();
    }
}
