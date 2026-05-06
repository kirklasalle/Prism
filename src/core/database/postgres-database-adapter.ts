/**
 * Phase F — PostgreSQL Adapter Scaffold (Phase F-B)
 *
 * Provides an `IDatabaseAdapter` implementation backed by PostgreSQL via
 * the optional `pg` package. The package is loaded with a dynamic
 * `import()` so the runtime degrades gracefully when `pg` is not
 * installed — the adapter then advertises `unsupported` status without
 * throwing.
 *
 * This is a *scaffold*: it provides the interface seam, parameter
 * translation (`:named` → `$N`), connection plumbing, and a factory.
 * Full SQL-dialect parity (e.g. SQLite-specific `INSERT OR REPLACE`,
 * `pragma`s) is the responsibility of the migration layer and is out
 * of scope for this pass.
 *
 * Selection: `PRISM_DATABASE_BACKEND=postgres` + `PRISM_DATABASE_URL=postgres://...`.
 * Default backend remains `sqlite`.
 *
 * @module core/database/postgres-database-adapter
 */

import type {
    IDatabaseAdapter,
    IPreparedStatement,
    Row,
    DatabaseAdapterConfig,
} from "./database-adapter.js";

// ── Parameter translation ─────────────────────────────────────────────────────

/**
 * Translate `:named` parameters to PostgreSQL `$N` positional parameters.
 *
 * Skips named-parameter tokens that appear inside single-quoted SQL
 * string literals (Postgres single-quote escape rule: `''` represents a
 * single quote and does not break the literal).
 *
 * @returns the rewritten SQL plus an ordered list of parameter names
 *          (in the order they appear in the rewritten SQL).
 */
export function translateNamedParams(sql: string): { sql: string; order: string[] } {
    const order: string[] = [];
    let out = "";
    let inString = false;
    let i = 0;
    while (i < sql.length) {
        const ch = sql[i];
        if (inString) {
            out += ch;
            if (ch === "'") {
                // doubled single-quote inside literal stays inside
                if (sql[i + 1] === "'") {
                    out += "'";
                    i += 2;
                    continue;
                }
                inString = false;
            }
            i += 1;
            continue;
        }
        if (ch === "'") {
            inString = true;
            out += ch;
            i += 1;
            continue;
        }
        if (ch === ":" && /[A-Za-z_]/.test(sql[i + 1] ?? "")) {
            let j = i + 1;
            while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
            const name = sql.slice(i + 1, j);
            let idx = order.indexOf(name);
            if (idx === -1) {
                order.push(name);
                idx = order.length - 1;
            }
            out += `$${idx + 1}`;
            i = j;
            continue;
        }
        out += ch;
        i += 1;
    }
    return { sql: out, order };
}

function buildPositionalArgs(
    order: string[],
    params: Record<string, unknown> | unknown[] | undefined,
): unknown[] {
    if (!params) return [];
    if (Array.isArray(params)) return params.slice(0, order.length);
    return order.map((name) => (params as Record<string, unknown>)[name]);
}

// ── Adapter ───────────────────────────────────────────────────────────────────

interface PgClient {
    query: (text: string, values?: unknown[]) => Promise<{ rows: Row[] }>;
    end: () => Promise<void>;
}

/**
 * PostgresDatabaseAdapter — scaffold implementation of IDatabaseAdapter.
 *
 * NOTE: The IDatabaseAdapter contract is synchronous (driven by node:sqlite).
 * This adapter exposes synchronous methods that throw `not-yet-supported`
 * when a real Postgres call would be required — the *seam* exists today
 * so consumers can be migrated incrementally; full async-bridging
 * (Atomics.wait or worker thread RPC) is the next pass and tracked
 * separately.
 *
 * The adapter is selectable, instantiable, and exposes `status()` so
 * callers / tests can detect unsupported environments without crashing.
 */
export class PostgresDatabaseAdapter implements IDatabaseAdapter {
    readonly backend = "postgresql";
    private client: PgClient | null = null;
    private _status: "unsupported" | "ready" | "error" = "unsupported";
    private _statusReason = "pg package not loaded";

    constructor(public readonly config: DatabaseAdapterConfig) {}

    /** Attempt to load `pg` and connect. Returns true on success. */
    async connect(): Promise<boolean> {
        try {
            // Dynamic import keeps `pg` an optional peer dep — the
            // package is not required for development or single-node
            // SQLite deployments.
            const pgModule: unknown = await import(/* @vite-ignore */ "pg" as string).catch(() => null);
            if (!pgModule || typeof (pgModule as { Client?: unknown }).Client !== "function") {
                this._status = "unsupported";
                this._statusReason = "pg package not installed";
                return false;
            }
            const ClientCtor = (pgModule as { Client: new (cs: string) => PgClient }).Client;
            const client = new ClientCtor(this.config.connectionString);
            // The constructor returns a client with a `connect()` in the
            // real `pg` package; we treat its absence as a structural
            // mismatch and degrade.
            const maybeConnect = (client as unknown as { connect?: () => Promise<void> }).connect;
            if (typeof maybeConnect === "function") {
                await maybeConnect.call(client);
            }
            this.client = client;
            this._status = "ready";
            this._statusReason = "connected";
            return true;
        } catch (err) {
            this._status = "error";
            this._statusReason = err instanceof Error ? err.message : String(err);
            return false;
        }
    }

    status(): { status: "unsupported" | "ready" | "error"; reason: string } {
        return { status: this._status, reason: this._statusReason };
    }

    private requireReady(): void {
        if (this._status !== "ready") {
            throw new Error(
                `PostgresDatabaseAdapter not ready (${this._status}): ${this._statusReason}. ` +
                "Postgres support requires the optional 'pg' package; ensure it is installed and " +
                "PRISM_DATABASE_URL is set, then call connect() before issuing queries.",
            );
        }
    }

    exec(_sql: string): void {
        this.requireReady();
        throw new Error(
            "PostgresDatabaseAdapter.exec(): synchronous exec not yet supported on the async pg client. " +
            "Use the sqlite backend, or the upcoming async DAL surface.",
        );
    }

    prepare(_sql: string): IPreparedStatement {
        this.requireReady();
        throw new Error(
            "PostgresDatabaseAdapter.prepare(): synchronous prepare not yet supported. " +
            "Translate :named -> $N via translateNamedParams() and use queryAll/queryOne via the async surface.",
        );
    }

    queryAll(_sql: string, _params?: Record<string, unknown> | unknown[]): Row[] {
        this.requireReady();
        throw new Error("PostgresDatabaseAdapter.queryAll(): use the async pg client directly.");
    }

    queryOne(_sql: string, _params?: Record<string, unknown> | unknown[]): Row | undefined {
        this.requireReady();
        throw new Error("PostgresDatabaseAdapter.queryOne(): use the async pg client directly.");
    }

    run(_sql: string, _params?: Record<string, unknown> | unknown[]): void {
        this.requireReady();
        throw new Error("PostgresDatabaseAdapter.run(): use the async pg client directly.");
    }

    transaction<T>(_fn: () => T): T {
        this.requireReady();
        throw new Error("PostgresDatabaseAdapter.transaction(): not supported synchronously.");
    }

    /** Async query helper for early Postgres integration tests. */
    async queryAllAsync(
        sql: string,
        params?: Record<string, unknown> | unknown[],
    ): Promise<Row[]> {
        this.requireReady();
        const { sql: translated, order } = translateNamedParams(sql);
        const values = buildPositionalArgs(order, params);
        const result = await this.client!.query(translated, values);
        return result.rows;
    }

    close(): void {
        if (this.client) {
            // Fire-and-forget close. The client.end() is async; for shutdown
            // semantics in the synchronous IDatabaseAdapter contract we rely
            // on the runtime exit to reap.
            void this.client.end().catch(() => undefined);
            this.client = null;
        }
        this._status = "unsupported";
        this._statusReason = "closed";
    }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface CreateAdapterOptions {
    /** Override the backend selection (otherwise read from env). */
    backend?: "sqlite" | "postgres";
    /** Override the connection string (otherwise read from env). */
    connectionString?: string;
}

/**
 * Read the configured backend selector from the environment.
 * Default: `"sqlite"` for backward compatibility.
 */
export function selectedBackend(): "sqlite" | "postgres" {
    const raw = (process.env.PRISM_DATABASE_BACKEND ?? "").trim().toLowerCase();
    if (raw === "postgres" || raw === "postgresql") return "postgres";
    return "sqlite";
}
