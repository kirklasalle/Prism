/**
 * PRISM DatabaseManager — Centralized SQLite Connection Manager
 *
 * Provides a single shared `DatabaseSync` instance to all stores,
 * preventing WAL lock contention from multiple connections to the
 * same database file. All stores accept an optional `DatabaseSync`
 * in their constructor; when provided, they use the shared instance
 * instead of creating their own.
 *
 * Phase R (Readiness) — Audit remediation item R2b.
 *
 * @module core/database/manager
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface DatabaseManagerConfig {
    /** Absolute or relative path to the SQLite database file. */
    dbPath: string;
    /** Enable WAL mode for better concurrent read performance. Default: true. */
    walMode?: boolean;
    /** Additional pragma values to set on startup. */
    pragmas?: Record<string, string>;
}

const DEFAULT_PRAGMAS: Record<string, string> = {
    journal_mode: "WAL",
    synchronous: "NORMAL",
    foreign_keys: "ON",
    busy_timeout: "5000",
    cache_size: "-64000", // 64 MB
};

/**
 * DatabaseManager — singleton factory.
 *
 * Usage:
 *   const mgr = DatabaseManager.getInstance({ dbPath: "/data/prism.db" });
 *   mgr.db.exec("SELECT 1");
 *   mgr.close();
 */
export class DatabaseManager {
    private static _instance: DatabaseManager | null = null;
    private _db: DatabaseSync | null = null;
    private _refCount = 0;
    private readonly config: Required<DatabaseManagerConfig>;

    private constructor(config: DatabaseManagerConfig) {
        this.config = {
            walMode: config.walMode ?? true,
            pragmas: { ...DEFAULT_PRAGMAS, ...config.pragmas },
            dbPath: resolve(config.dbPath),
        };
    }

    /**
     * Get or create the shared DatabaseManager instance.
     * Call once at startup with the database path; subsequent calls
     * with any path return the same instance.
     */
    static getInstance(config?: DatabaseManagerConfig): DatabaseManager {
        if (!DatabaseManager._instance) {
            if (!config) {
                throw new Error(
                    "DatabaseManager.getInstance() requires a config on first call. " +
                    "Call it once at startup with { dbPath: '...' }.",
                );
            }
            DatabaseManager._instance = new DatabaseManager(config);
        }
        return DatabaseManager._instance;
    }

    /**
     * Reset the singleton (for testing only).
     */
    static resetInstance(): void {
        if (DatabaseManager._instance) {
            DatabaseManager._instance.close();
            DatabaseManager._instance = null;
        }
    }

    /**
     * Get the shared database connection. Opens it on first access
     * and ensures the directory exists.
     */
    get db(): DatabaseSync {
        if (!this._db) {
            // Ensure the directory exists
            const dir = dirname(this.config.dbPath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }

            this._db = new DatabaseSync(this.config.dbPath);

            // Apply pragmas
            for (const [key, value] of Object.entries(this.config.pragmas)) {
                this._db.exec(`PRAGMA ${key} = ${value}`);
            }

            if (this.config.walMode) {
                // WAL mode is already set via pragmas, but ensure it explicitly
                this._db.exec("PRAGMA journal_mode=WAL");
            }
        }
        return this._db;
    }

    /**
     * Increment reference count. Each store that shares this manager
     * should call `ref()` to indicate active usage.
     */
    ref(): void {
        this._refCount++;
    }

    /**
     * Decrement reference count.
     */
    unref(): void {
        this._refCount = Math.max(0, this._refCount - 1);
    }

    /**
     * Close the database connection when no more references exist.
     * Force-close if `force` is true regardless of reference count.
     */
    close(force = false): void {
        if (force) {
            this._closeDb();
            return;
        }
        this._refCount = Math.max(0, this._refCount - 1);
        if (this._refCount <= 0 && this._db) {
            this._closeDb();
        }
    }

    /**
     * Checkpoint the WAL file to merge it into the main database.
     */
    checkpoint(): void {
        if (this._db) {
            this._db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        }
    }

    /** Return the absolute database path. */
    get dbPath(): string {
        return this.config.dbPath;
    }

    /** Return the reference count (diagnostic). */
    get refCount(): number {
        return this._refCount;
    }

    /** Return whether the database connection is open. */
    get isOpen(): boolean {
        return this._db !== null;
    }

    private _closeDb(): void {
        if (this._db) {
            try {
                this.checkpoint();
                this._db.close();
            } catch {
                // Best-effort close
            }
            this._db = null;
        }
    }
}