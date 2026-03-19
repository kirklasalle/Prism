import { DatabaseSync } from "node:sqlite";

export interface PackageRow {
    packageId: string;
    title: string;
    areaOfInterest: string | null;
    objective: string | null;
    successCriteria: string | null;
    dependencies: string[];
    status: string;
    createdAt: string;
    updatedAt: string;
    sessionIds: string[];
    lastRunAt: string | null;
    lastExportAt: string | null;
    exportArtifactPath: string | null;
}

export interface PackageHistoryRow {
    historyId: string;
    packageId: string;
    title: string;
    action: string;
    timestamp: string;
    status: string;
    previousStatus: string | null;
    nextStatus: string | null;
    source: string;
    message: string | null;
    targetSessionId: string | null;
}

export class SessionPackageSqliteStore {
    private readonly db: DatabaseSync;

    constructor(dbPath: string) {
        this.db = new DatabaseSync(dbPath);
        this.migrate();
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS session_packages (
                package_id            TEXT PRIMARY KEY,
                title                 TEXT NOT NULL DEFAULT 'Session Package',
                area_of_interest      TEXT,
                objective             TEXT,
                success_criteria      TEXT,
                dependencies          TEXT NOT NULL DEFAULT '[]',
                status                TEXT NOT NULL DEFAULT 'planned',
                created_at            TEXT NOT NULL,
                updated_at            TEXT NOT NULL,
                session_ids           TEXT NOT NULL DEFAULT '[]',
                last_run_at           TEXT,
                last_export_at        TEXT,
                export_artifact_path  TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sp_status  ON session_packages(status);
            CREATE INDEX IF NOT EXISTS idx_sp_updated ON session_packages(updated_at);

            CREATE TABLE IF NOT EXISTS session_package_history (
                history_id        TEXT PRIMARY KEY,
                package_id        TEXT NOT NULL,
                title             TEXT NOT NULL DEFAULT 'Session Package',
                action            TEXT NOT NULL DEFAULT 'status_changed',
                timestamp         TEXT NOT NULL,
                status            TEXT NOT NULL DEFAULT 'planned',
                previous_status   TEXT,
                next_status       TEXT,
                source            TEXT NOT NULL DEFAULT 'dashboard_api',
                message           TEXT,
                target_session_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sph_pkg ON session_package_history(package_id);
            CREATE INDEX IF NOT EXISTS idx_sph_ts  ON session_package_history(timestamp);
        `);

        this.ensureColumns("session_packages", [
            { name: "title",                definition: "TEXT NOT NULL DEFAULT 'Session Package'" },
            { name: "area_of_interest",     definition: "TEXT" },
            { name: "objective",            definition: "TEXT" },
            { name: "success_criteria",     definition: "TEXT" },
            { name: "dependencies",         definition: "TEXT NOT NULL DEFAULT '[]'" },
            { name: "last_run_at",          definition: "TEXT" },
            { name: "last_export_at",       definition: "TEXT" },
            { name: "export_artifact_path", definition: "TEXT" },
        ]);
        this.ensureColumns("session_package_history", [
            { name: "title",             definition: "TEXT NOT NULL DEFAULT 'Session Package'" },
            { name: "previous_status",   definition: "TEXT" },
            { name: "next_status",       definition: "TEXT" },
            { name: "source",            definition: "TEXT NOT NULL DEFAULT 'dashboard_api'" },
            { name: "message",           definition: "TEXT" },
            { name: "target_session_id", definition: "TEXT" },
        ]);
    }

    private ensureColumns(tableName: string, columns: Array<{ name: string; definition: string }>): void {
        const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
        const existing = new Set(rows.map((r) => r.name));
        for (const column of columns) {
            if (!existing.has(column.name)) {
                this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.definition}`);
            }
        }
    }

    upsertPackage(row: PackageRow): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO session_packages
                (package_id, title, area_of_interest, objective, success_criteria,
                 dependencies, status, created_at, updated_at, session_ids,
                 last_run_at, last_export_at, export_artifact_path)
            VALUES
                (:packageId, :title, :areaOfInterest, :objective, :successCriteria,
                 :dependencies, :status, :createdAt, :updatedAt, :sessionIds,
                 :lastRunAt, :lastExportAt, :exportArtifactPath)
        `).run({
            packageId: row.packageId,
            title: row.title,
            areaOfInterest: row.areaOfInterest ?? null,
            objective: row.objective ?? null,
            successCriteria: row.successCriteria ?? null,
            dependencies: JSON.stringify(row.dependencies),
            status: row.status,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            sessionIds: JSON.stringify(row.sessionIds),
            lastRunAt: row.lastRunAt ?? null,
            lastExportAt: row.lastExportAt ?? null,
            exportArtifactPath: row.exportArtifactPath ?? null,
        });
    }

    deletePackage(packageId: string): void {
        this.db.prepare(
            "DELETE FROM session_packages WHERE package_id = :packageId"
        ).run({ packageId });
    }

    listPackages(): PackageRow[] {
        const rows = this.db.prepare(
            "SELECT * FROM session_packages ORDER BY updated_at DESC"
        ).all({}) as Record<string, unknown>[];
        return rows.map((row) => this.rowToPackage(row));
    }

    getPackage(packageId: string): PackageRow | undefined {
        const row = this.db.prepare(
            "SELECT * FROM session_packages WHERE package_id = :packageId"
        ).get({ packageId }) as Record<string, unknown> | undefined;
        return row ? this.rowToPackage(row) : undefined;
    }

    countPackages(): number {
        const result = this.db.prepare(
            "SELECT COUNT(*) as cnt FROM session_packages"
        ).get({}) as { cnt: number };
        return result.cnt;
    }

    upsertHistoryEntry(row: PackageHistoryRow): void {
        this.db.prepare(`
            INSERT OR IGNORE INTO session_package_history
                (history_id, package_id, title, action, timestamp, status,
                 previous_status, next_status, source, message, target_session_id)
            VALUES
                (:historyId, :packageId, :title, :action, :timestamp, :status,
                 :previousStatus, :nextStatus, :source, :message, :targetSessionId)
        `).run({
            historyId: row.historyId,
            packageId: row.packageId,
            title: row.title,
            action: row.action,
            timestamp: row.timestamp,
            status: row.status,
            previousStatus: row.previousStatus ?? null,
            nextStatus: row.nextStatus ?? null,
            source: row.source,
            message: row.message ?? null,
            targetSessionId: row.targetSessionId ?? null,
        });
    }

    listHistory(limit: number): PackageHistoryRow[] {
        const rows = this.db.prepare(
            "SELECT * FROM session_package_history ORDER BY timestamp DESC LIMIT :limit"
        ).all({ limit: Math.max(1, limit) }) as Record<string, unknown>[];
        return rows.map((row) => this.rowToHistory(row));
    }

    countHistory(): number {
        const result = this.db.prepare(
            "SELECT COUNT(*) as cnt FROM session_package_history"
        ).get({}) as { cnt: number };
        return result.cnt;
    }

    packageCountByStatus(): Record<string, number> {
        const rows = this.db.prepare(
            "SELECT status, COUNT(*) as cnt FROM session_packages GROUP BY status"
        ).all({}) as Array<{ status: string; cnt: number }>;
        const result: Record<string, number> = {};
        for (const row of rows) {
            result[row.status] = row.cnt;
        }
        return result;
    }

    packageCreatedPerDay(days: number): Array<{ day: string; count: number }> {
        // Use parameterized date filter to avoid injection
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
        const rows = this.db.prepare(`
            SELECT substr(created_at, 1, 10) as day, COUNT(*) as count
            FROM session_packages
            WHERE substr(created_at, 1, 10) >= :cutoff
            GROUP BY day
            ORDER BY day ASC
        `).all({ cutoff }) as Array<{ day: string; count: number }>;
        return rows;
    }

    actionFrequency(limit: number): Array<{ action: string; count: number }> {
        const rows = this.db.prepare(
            "SELECT action, COUNT(*) as count FROM session_package_history GROUP BY action ORDER BY count DESC LIMIT :limit"
        ).all({ limit: Math.max(1, limit) }) as Array<{ action: string; count: number }>;
        return rows;
    }

    close(): void {
        this.db.close();
    }

    private rowToPackage(row: Record<string, unknown>): PackageRow {
        return {
            packageId: String(row.package_id),
            title: String(row.title ?? "Session Package"),
            areaOfInterest: row.area_of_interest != null ? String(row.area_of_interest) : null,
            objective: row.objective != null ? String(row.objective) : null,
            successCriteria: row.success_criteria != null ? String(row.success_criteria) : null,
            dependencies: JSON.parse(String(row.dependencies ?? "[]")) as string[],
            status: String(row.status ?? "planned"),
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
            sessionIds: JSON.parse(String(row.session_ids ?? "[]")) as string[],
            lastRunAt: row.last_run_at != null ? String(row.last_run_at) : null,
            lastExportAt: row.last_export_at != null ? String(row.last_export_at) : null,
            exportArtifactPath: row.export_artifact_path != null ? String(row.export_artifact_path) : null,
        };
    }

    private rowToHistory(row: Record<string, unknown>): PackageHistoryRow {
        return {
            historyId: String(row.history_id),
            packageId: String(row.package_id),
            title: String(row.title ?? "Session Package"),
            action: String(row.action ?? "status_changed"),
            timestamp: String(row.timestamp),
            status: String(row.status ?? "planned"),
            previousStatus: row.previous_status != null ? String(row.previous_status) : null,
            nextStatus: row.next_status != null ? String(row.next_status) : null,
            source: String(row.source ?? "dashboard_api"),
            message: row.message != null ? String(row.message) : null,
            targetSessionId: row.target_session_id != null ? String(row.target_session_id) : null,
        };
    }
}
