/**
 * PRISM Database Migration Framework
 *
 * Provides schema versioning and ordered migration execution so that
 * SQLite schema changes are safe, auditable, and reversible.
 *
 * Each migration is a numbered function that receives the DatabaseSync
 * instance and can execute arbitrary DDL/DML. Migrations run in order
 * and are tracked in a `_prism_schema_version` table.
 *
 * Phase R (Readiness) — Audit remediation item R7b.
 *
 * @module core/database/migrations
 */

import { DatabaseSync } from "node:sqlite";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Migration {
    /** Unique migration ID (positive integer, chronological). */
    id: number;
    /** Human-readable description of what this migration changes. */
    description: string;
    /** The actual migration function — receives the db and executes DDL/DML. */
    up: (db: DatabaseSync) => void;
    /** Optional rollback function. */
    down?: (db: DatabaseSync) => void;
}

// ── Migration Runner ─────────────────────────────────────────────────────────

const SCHEMA_TABLE = "_prism_schema_version";

/**
 * Ensure the schema version tracking table exists.
 */
function ensureSchemaTable(db: DatabaseSync): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${SCHEMA_TABLE} (
            id          INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
}

/**
 * Get the set of already-applied migration IDs.
 */
function getAppliedMigrations(db: DatabaseSync): Set<number> {
    ensureSchemaTable(db);
    try {
        const rows = db.prepare(`SELECT id FROM ${SCHEMA_TABLE}`).all() as { id: number }[];
        return new Set(rows.map((r) => r.id));
    } catch {
        return new Set();
    }
}

/**
 * Run all pending migrations in order. Safe to call multiple times —
 * already-applied migrations are skipped.
 *
 * @param db - The target database instance.
 * @param migrations - Ordered array of all known migrations.
 * @returns The list of migrations that were applied (empty if up-to-date).
 */
export function runMigrations(db: DatabaseSync, migrations: Migration[]): Migration[] {
    const applied = getAppliedMigrations(db);
    const pending = migrations
        .filter((m) => !applied.has(m.id))
        .sort((a, b) => a.id - b.id);

    if (pending.length === 0) {
        return [];
    }

    const insertStmt = db.prepare(
        `INSERT INTO ${SCHEMA_TABLE} (id, description) VALUES (:id, :description)`,
    );

    for (const migration of pending) {
        try {
            migration.up(db);
            insertStmt.run({ id: migration.id, description: migration.description });
            console.log(`[migrations] Applied migration #${migration.id}: ${migration.description}`);
        } catch (err) {
            console.error(
                `[migrations] FAILED migration #${migration.id}: ${migration.description}`,
                (err as Error).message,
            );
            throw err;
        }
    }

    return pending;
}

/**
 * Get the current schema version info for diagnostics.
 */
export function getSchemaVersion(db: DatabaseSync): { current: number; migrations: number; appliedAt: string | null } {
    ensureSchemaTable(db);
    const maxRow = db.prepare(
        `SELECT MAX(id) as current, COUNT(*) as migrations FROM ${SCHEMA_TABLE}`,
    ).get() as { current: number | null; migrations: number };
    const latestRow = db.prepare(
        `SELECT applied_at FROM ${SCHEMA_TABLE} ORDER BY id DESC LIMIT 1`,
    ).get() as { applied_at: string } | undefined;

    return {
        current: maxRow.current ?? 0,
        migrations: maxRow.migrations ?? 0,
        appliedAt: latestRow?.applied_at ?? null,
    };
}

/**
 * List all known migrations (for diagnostics / CI gates).
 */
export function listMigrations(migrations: Migration[]): { id: number; description: string }[] {
    return migrations
        .map((m) => ({ id: m.id, description: m.description }))
        .sort((a, b) => a.id - b.id);
}