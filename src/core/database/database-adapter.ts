/**
 * Database Abstraction Layer (DAL)
 * 
 * Defines the IDatabaseAdapter interface and provides a SQLite implementation
 * using node:sqlite (DatabaseSync). This abstraction enables future migration
 * to PostgreSQL or other backends without changing consumer code.
 * 
 * @module core/database/database-adapter
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";

// ── Core Types ────────────────────────────────────────────────────────────────

/** A single row returned from a query, keyed by column name. */
export type Row = Record<string, unknown>;

/** Prepared statement handle that can be reused for multiple executions. */
export interface IPreparedStatement {
  /** Execute with parameters and return all matching rows. */
  all(params?: Record<string, unknown> | unknown[]): Row[];
  /** Execute with parameters and return the first matching row, or undefined. */
  get(params?: Record<string, unknown> | unknown[]): Row | undefined;
  /** Execute a mutation (INSERT/UPDATE/DELETE) with parameters. */
  run(params?: Record<string, unknown> | unknown[]): void;
}

/** Configuration for creating a database adapter. */
export interface DatabaseAdapterConfig {
  /** Connection string or file path. */
  connectionString: string;
  /** Enable WAL mode (SQLite-specific, ignored by other backends). */
  walMode?: boolean;
  /** Additional pragma or config options. */
  pragmas?: Record<string, string>;
}

// ── Interface ─────────────────────────────────────────────────────────────────

/**
 * IDatabaseAdapter — the unified interface all persistence consumers depend on.
 * 
 * Supports synchronous operations (for node:sqlite compatibility) while
 * defining a contract that async backends (PostgreSQL) can also fulfill.
 */
export interface IDatabaseAdapter {
  /** Execute raw SQL (DDL/DML). Used for migrations, schema setup. */
  exec(sql: string): void;

  /** Prepare a reusable statement. */
  prepare(sql: string): IPreparedStatement;

  /** Execute a query and return all rows. */
  queryAll(sql: string, params?: Record<string, unknown> | unknown[]): Row[];

  /** Execute a query and return the first row, or undefined. */
  queryOne(sql: string, params?: Record<string, unknown> | unknown[]): Row | undefined;

  /** Run a mutation (INSERT/UPDATE/DELETE). */
  run(sql: string, params?: Record<string, unknown> | unknown[]): void;

  /** Execute multiple operations within a transaction. */
  transaction<T>(fn: () => T): T;

  /** Close the connection and release resources. */
  close(): void;

  /** Backend identifier (e.g. "sqlite", "postgresql"). */
  readonly backend: string;
}

// ── SQLite Implementation ─────────────────────────────────────────────────────

/**
 * SQLiteDatabaseAdapter — wraps node:sqlite DatabaseSync to satisfy IDatabaseAdapter.
 */
export class SQLiteDatabaseAdapter implements IDatabaseAdapter {
  private readonly db: DatabaseSync;
  readonly backend = "sqlite";

  constructor(config: DatabaseAdapterConfig) {
    this.db = new DatabaseSync(config.connectionString);

    if (config.walMode !== false) {
      this.db.exec("PRAGMA journal_mode=WAL");
    }

    if (config.pragmas) {
      for (const [key, value] of Object.entries(config.pragmas)) {
        this.db.exec(`PRAGMA ${key}=${value}`);
      }
    }
  }

  /** Create from an existing DatabaseSync instance (e.g. for migration from direct usage). */
  static fromExisting(db: DatabaseSync): SQLiteDatabaseAdapter {
    const adapter = Object.create(SQLiteDatabaseAdapter.prototype) as SQLiteDatabaseAdapter;
    (adapter as any).db = db;
    Object.defineProperty(adapter, "backend", { value: "sqlite" });
    return adapter;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): IPreparedStatement {
    const stmt: StatementSync = this.db.prepare(sql);
    return {
      all(params?: Record<string, unknown> | unknown[]): Row[] {
        return (params ? stmt.all(params as any) : stmt.all()) as Row[];
      },
      get(params?: Record<string, unknown> | unknown[]): Row | undefined {
        return (params ? stmt.get(params as any) : stmt.get()) as Row | undefined;
      },
      run(params?: Record<string, unknown> | unknown[]): void {
        params ? stmt.run(params as any) : stmt.run();
      },
    };
  }

  queryAll(sql: string, params?: Record<string, unknown> | unknown[]): Row[] {
    const stmt = this.db.prepare(sql);
    return (params ? stmt.all(params as any) : stmt.all()) as Row[];
  }

  queryOne(sql: string, params?: Record<string, unknown> | unknown[]): Row | undefined {
    const stmt = this.db.prepare(sql);
    return (params ? stmt.get(params as any) : stmt.get()) as Row | undefined;
  }

  run(sql: string, params?: Record<string, unknown> | unknown[]): void {
    const stmt = this.db.prepare(sql);
    params ? stmt.run(params as any) : stmt.run();
  }

  transaction<T>(fn: () => T): T {
    // node:sqlite doesn't have a built-in transaction helper,
    // so we wrap with BEGIN/COMMIT/ROLLBACK manually.
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  /** Expose the underlying DatabaseSync for incremental migration. */
  getUnderlyingDb(): DatabaseSync {
    return this.db;
  }
}
