/**
 * Phase F-B — PostgresDatabaseAdapter scaffold tests.
 *
 * Verifies that:
 *  - the adapter can be instantiated and reports `unsupported` status
 *    when `pg` is not installed (the default in CI),
 *  - synchronous methods throw a clear error rather than crashing,
 *  - the `:named` -> `$N` parameter translator handles ordinary,
 *    repeated, and string-literal-embedded parameters correctly,
 *  - the backend selector reads the env flag.
 */

import {
    PostgresDatabaseAdapter,
    translateNamedParams,
    selectedBackend,
} from "../src/core/database/postgres-database-adapter.js";

function assert(cond: unknown, msg: string): void {
    if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function testPostgresAdapter(): Promise<void> {
    // ── Parameter translation ──
    {
        const { sql, order } = translateNamedParams(
            "SELECT * FROM t WHERE a = :foo AND b = :bar AND c = :foo",
        );
        assert(sql === "SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $1", `translated sql: ${sql}`);
        assert(order.length === 2 && order[0] === "foo" && order[1] === "bar", "param order");
    }
    {
        // String literal must NOT have its `:colon` substituted.
        const { sql, order } = translateNamedParams(
            "SELECT 'hello :world' AS msg, :real AS r",
        );
        assert(sql.includes("'hello :world'"), "string literal preserved");
        assert(sql.endsWith("$1 AS r"), "real param substituted");
        assert(order.length === 1 && order[0] === "real", "only real param tracked");
    }
    {
        // Doubled single quotes inside literal must not break parser.
        const { sql } = translateNamedParams(
            "INSERT INTO t (s) VALUES ('it''s :ok') RETURNING :id",
        );
        assert(sql.includes("'it''s :ok'"), "doubled quote literal preserved");
        assert(sql.endsWith("$1"), "post-literal param substituted");
    }

    // ── Adapter instantiation + status reporting ──
    const adapter = new PostgresDatabaseAdapter({ connectionString: "postgres://invalid:0/none" });
    assert(adapter.backend === "postgresql", "backend identifier");
    const before = adapter.status();
    assert(before.status === "unsupported", "unsupported before connect()");

    // Synchronous methods must throw a clear error rather than crash.
    let threw = false;
    try { adapter.exec("SELECT 1"); } catch { threw = true; }
    assert(threw, "exec throws when not ready");

    // Connect attempt should NOT throw — degrades to error/unsupported.
    const ok = await adapter.connect();
    if (ok) {
        // pg is installed AND a real Postgres responded — extremely
        // unlikely in CI; but if so, just close and pass.
        adapter.close();
    } else {
        const after = adapter.status();
        assert(
            after.status === "unsupported" || after.status === "error",
            `expected unsupported|error, got ${after.status}`,
        );
        adapter.close();
    }

    // ── Backend selector ──
    const prev = process.env.PRISM_DATABASE_BACKEND;
    try {
        process.env.PRISM_DATABASE_BACKEND = "postgres";
        assert(selectedBackend() === "postgres", "selectedBackend respects env");
        process.env.PRISM_DATABASE_BACKEND = "";
        assert(selectedBackend() === "sqlite", "selectedBackend defaults to sqlite");
    } finally {
        if (prev === undefined) delete process.env.PRISM_DATABASE_BACKEND;
        else process.env.PRISM_DATABASE_BACKEND = prev;
    }
}
