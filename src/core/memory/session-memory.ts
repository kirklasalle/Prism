import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ActivityEvent, ActivitySubscriber } from "../activity/types.js";

export interface SessionSummary {
    sessionId: string;
    totalEvents: number;
    failures: number;
    toolExecutions: number;
    updatedAt: string;
}

export class SessionMemoryStore implements ActivitySubscriber {
    private readonly db: DatabaseSync;
    private readonly upsertStmt: StatementSync;

    constructor(dbPath: string = "prism-activity.db") {
        this.db = new DatabaseSync(dbPath);
        this.migrate();
        this.upsertStmt = this.db.prepare(`
      INSERT INTO session_summaries (session_id, total_events, failures, tool_executions, updated_at)
      VALUES (:sessionId, :totalEvents, :failures, :toolExecutions, :updatedAt)
      ON CONFLICT(session_id) DO UPDATE SET
        total_events = excluded.total_events,
        failures = excluded.failures,
        tool_executions = excluded.tool_executions,
        updated_at = excluded.updated_at
    `);
    }

    private migrate(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_summaries (
        session_id TEXT PRIMARY KEY,
        total_events INTEGER NOT NULL,
        failures INTEGER NOT NULL,
        tool_executions INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

        this.ensureColumns("session_summaries", [
            { name: "total_events", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "failures", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "tool_executions", definition: "INTEGER NOT NULL DEFAULT 0" },
            { name: "updated_at", definition: "TEXT NOT NULL DEFAULT ''" },
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
        const row = this.db.prepare(`
      SELECT total_events, failures, tool_executions
      FROM session_summaries
      WHERE session_id = :sessionId
    `).get({ sessionId: event.sessionId }) as
            | { total_events: number; failures: number; tool_executions: number }
            | undefined;

        const nextTotal = (row?.total_events ?? 0) + 1;
        const nextFailures = (row?.failures ?? 0) + (event.status === "failed" ? 1 : 0);
        const nextToolExecutions = (row?.tool_executions ?? 0) + (event.layer === "tool_execution" ? 1 : 0);

        this.upsertStmt.run({
            sessionId: event.sessionId,
            totalEvents: nextTotal,
            failures: nextFailures,
            toolExecutions: nextToolExecutions,
            updatedAt: new Date().toISOString(),
        });
    }

    getSessionSummary(sessionId: string): SessionSummary | null {
        const row = this.db.prepare(`
      SELECT session_id, total_events, failures, tool_executions, updated_at
      FROM session_summaries
      WHERE session_id = :sessionId
    `).get({ sessionId }) as
            | {
                session_id: string;
                total_events: number;
                failures: number;
                tool_executions: number;
                updated_at: string;
            }
            | undefined;

        if (!row) {
            return null;
        }

        return {
            sessionId: row.session_id,
            totalEvents: row.total_events,
            failures: row.failures,
            toolExecutions: row.tool_executions,
            updatedAt: row.updated_at,
        };
    }

    close(): void {
        this.db.close();
    }
}
