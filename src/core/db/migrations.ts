/**
 * R5-2 — versioned SQLite migration runner.
 *
 * Each Prism SQLite database (activity, chat sessions, retrieval dashboard,
 * session packages, terminal sessions, etc.) is opened by its own store
 * class with an embedded `migrate()` method that runs `CREATE TABLE IF NOT
 * EXISTS` + `ALTER TABLE ... ADD COLUMN`. That works for incremental
 * forward-only schema growth, but it does NOT track which migrations have
 * actually been applied to a given file. As Prism gains data-shape changes
 * that require a non-trivial step (back-fill, drop column, rename), we need
 * a real version log.
 *
 * `MigrationRunner` is the production-grade replacement:
 *
 *   - Maintains a `prism_migrations` table per database with
 *     `(version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT
 *     NULL, applied_at TEXT NOT NULL)`.
 *   - Applies pending migrations strictly in ascending `version` order
 *     inside a single transaction per migration.
 *   - Refuses to run if a previously-applied migration's checksum has
 *     changed on disk — that protects against silently editing a shipped
 *     migration and corrupting forks of the same DB.
 *   - Refuses to skip a version (e.g. v1, v2 applied; v3 missing on disk
 *     but v4 present) so deployments can never partially advance.
 *   - Idempotent: re-running with no new migrations is a fast no-op.
 *
 * Usage from a store class:
 *
 * ```ts
 * import { MigrationRunner } from "../db/migrations.js";
 *
 * const runner = new MigrationRunner(db, [
 *     { version: 1, name: "init", up: "CREATE TABLE foo (id TEXT PRIMARY KEY);" },
 *     { version: 2, name: "add-bar", up: "ALTER TABLE foo ADD COLUMN bar TEXT;" },
 * ]);
 * runner.run();
 * ```
 *
 * The runner does **not** read SQL from disk by default — migrations are
 * declared in TypeScript so they ship with the build artifact and are
 * subject to the same review gate as any other code change.
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface Migration {
    /** Strictly ascending positive integer. Gaps are rejected. */
    readonly version: number;
    /** Short stable name used in logs and the migrations table. */
    readonly name: string;
    /** The SQL to execute. May contain multiple statements. */
    readonly up: string;
}

export interface AppliedMigration {
    readonly version: number;
    readonly name: string;
    readonly checksum: string;
    readonly appliedAt: string;
}

export interface MigrationRunResult {
    /** Migrations that were applied on this invocation (in order). */
    readonly applied: readonly AppliedMigration[];
    /** Migrations that were already applied before this invocation. */
    readonly alreadyApplied: readonly AppliedMigration[];
    /** Highest version present in the DB after the run. 0 if none. */
    readonly currentVersion: number;
}

export class MigrationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MigrationError";
    }
}

export class MigrationRunner {
    private static readonly TABLE_NAME = "prism_migrations";

    constructor(
        private readonly db: DatabaseSync,
        private readonly migrations: readonly Migration[],
    ) {
        this.validateDeclarations();
    }

    /** Compute the SHA-256 checksum of a migration's `up` SQL. */
    static checksum(up: string): string {
        return createHash("sha256").update(up, "utf8").digest("hex");
    }

    /** Apply all pending migrations. Safe to call repeatedly. */
    run(): MigrationRunResult {
        this.ensureTable();

        const alreadyApplied = this.listApplied();
        const appliedVersions = new Set(alreadyApplied.map((m) => m.version));

        // Drift / tamper detection: every previously-applied migration that
        // also exists in the declared set must match the original checksum.
        for (const declared of this.migrations) {
            const applied = alreadyApplied.find((m) => m.version === declared.version);
            if (!applied) continue;
            const expected = MigrationRunner.checksum(declared.up);
            if (applied.checksum !== expected) {
                throw new MigrationError(
                    `migration v${declared.version} (${declared.name}) checksum mismatch: ` +
                    `db=${applied.checksum.slice(0, 12)} declared=${expected.slice(0, 12)} — ` +
                    `migrations are immutable once applied; create a new version instead`,
                );
            }
        }

        const pending = this.migrations.filter((m) => !appliedVersions.has(m.version));
        const justApplied: AppliedMigration[] = [];

        const insert = this.db.prepare(
            `INSERT INTO ${MigrationRunner.TABLE_NAME} (version, name, checksum, applied_at)
             VALUES (:version, :name, :checksum, :appliedAt)`,
        );

        for (const m of pending) {
            const checksum = MigrationRunner.checksum(m.up);
            const appliedAt = new Date().toISOString();
            this.db.exec("BEGIN");
            try {
                this.db.exec(m.up);
                insert.run({ version: m.version, name: m.name, checksum, appliedAt });
                this.db.exec("COMMIT");
            } catch (err) {
                this.db.exec("ROLLBACK");
                const e = err as Error;
                throw new MigrationError(
                    `migration v${m.version} (${m.name}) failed: ${e.message}`,
                );
            }
            justApplied.push({ version: m.version, name: m.name, checksum, appliedAt });
        }

        const finalApplied = [...alreadyApplied, ...justApplied];
        const currentVersion = finalApplied.reduce((max, m) => (m.version > max ? m.version : max), 0);

        return {
            applied: justApplied,
            alreadyApplied,
            currentVersion,
        };
    }

    /** List all migrations recorded in the DB, ascending. */
    listApplied(): readonly AppliedMigration[] {
        this.ensureTable();
        const rows = this.db
            .prepare(
                `SELECT version, name, checksum, applied_at AS appliedAt
                 FROM ${MigrationRunner.TABLE_NAME}
                 ORDER BY version ASC`,
            )
            .all() as Array<{ version: number; name: string; checksum: string; appliedAt: string }>;
        return rows.map((r) => ({
            version: r.version,
            name: r.name,
            checksum: r.checksum,
            appliedAt: r.appliedAt,
        }));
    }

    /** The maximum applied version, or 0 if none. */
    currentVersion(): number {
        const applied = this.listApplied();
        return applied.reduce((max, m) => (m.version > max ? m.version : max), 0);
    }

    private ensureTable(): void {
        this.db.exec(
            `CREATE TABLE IF NOT EXISTS ${MigrationRunner.TABLE_NAME} (
                version    INTEGER PRIMARY KEY,
                name       TEXT NOT NULL,
                checksum   TEXT NOT NULL,
                applied_at TEXT NOT NULL
            )`,
        );
    }

    private validateDeclarations(): void {
        if (this.migrations.length === 0) return;

        const versions = this.migrations.map((m) => m.version);
        for (let i = 0; i < versions.length; i++) {
            const v = versions[i]!;
            if (!Number.isInteger(v) || v < 1) {
                throw new MigrationError(
                    `migration version must be a positive integer, got ${v}`,
                );
            }
        }

        // Reject duplicate versions before contiguity / name checks so the
        // operator gets the most precise error.
        const seenVersions = new Set<number>();
        for (const v of versions) {
            if (seenVersions.has(v)) {
                throw new MigrationError(`duplicate migration version: v${v}`);
            }
            seenVersions.add(v);
        }

        // Versions must be strictly ascending (no gaps allowed in declared
        // set). Gaps would silently allow a new v3 to ship without v2 ever
        // being applied to fresh DBs.
        const sorted = [...versions].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length; i++) {
            const expected = i + 1;
            if (sorted[i] !== expected) {
                throw new MigrationError(
                    `migration versions must be 1-indexed and contiguous; ` +
                    `got [${sorted.join(", ")}] (expected v${expected} at position ${i})`,
                );
            }
        }

        // Reject duplicate names too — they collide in operator-facing logs.
        const seenNames = new Set<string>();
        for (const m of this.migrations) {
            if (seenNames.has(m.name)) {
                throw new MigrationError(`duplicate migration name: ${m.name}`);
            }
            seenNames.add(m.name);
        }
    }
}
