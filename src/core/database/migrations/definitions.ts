/**
 * PRISM Database Migrations — Canonical Schema Definitions
 *
 * Ordered list of all schema migrations. Migration 001 captures the
 * initial schema as it exists at v0.21.0. Subsequent migrations add,
 * modify, or remove tables/columns/indexes.
 *
 * IMPORTANT: Never modify an existing migration. Add a new one at the end.
 *
 * Phase R (Readiness) — Audit remediation item R7b.
 *
 * @module core/database/migrations/definitions
 */

import type { Migration } from "./framework.js";

export const MIGRATIONS: Migration[] = [
    // ── 001: Initial schema (v0.21.0 baseline) ────────────────────────────
    {
        id: 1,
        description: "Initial schema — activity_events, prism_llre_telemetry, retrieval_metrics, session_summaries, chat_sessions, usage_metering, retrieval_dashboard",
        up: (db) => {
            db.exec(`
                -- Activity events (from SqliteActivityStore)
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

                -- LLRE telemetry (from SqliteActivityStore)
                CREATE TABLE IF NOT EXISTS prism_llre_telemetry (
                    id            TEXT PRIMARY KEY,
                    timestamp     TEXT NOT NULL,
                    session_id    TEXT NOT NULL,
                    correlation_id TEXT,
                    model_name    TEXT,
                    tokens_consumed INTEGER,
                    latency_ms    INTEGER,
                    cost_usd      REAL,
                    rsi_score     REAL,
                    csr_score     REAL,
                    tca_score     REAL,
                    teq_score     REAL,
                    details       TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_llre_session ON prism_llre_telemetry(session_id);

                -- Retrieval metrics (from RetrievalMetricsCollector)
                CREATE TABLE IF NOT EXISTS retrieval_metrics (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp     TEXT NOT NULL,
                    query         TEXT NOT NULL,
                    coverage      REAL,
                    utility       REAL,
                    novelty       REAL,
                    latency_ms    INTEGER,
                    source        TEXT,
                    session_id    TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_rm_timestamp ON retrieval_metrics(timestamp);

                -- Session summaries (from SessionMemoryStore)
                CREATE TABLE IF NOT EXISTS session_summaries (
                    session_id    TEXT PRIMARY KEY,
                    summary       TEXT NOT NULL,
                    token_count   INTEGER DEFAULT 0,
                    last_updated  TEXT NOT NULL,
                    metadata      TEXT
                );

                -- Chat sessions (from ChatSessionStore)
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id            TEXT PRIMARY KEY,
                    title         TEXT,
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL,
                    metadata      TEXT,
                    message_count INTEGER DEFAULT 0
                );

                -- Chat messages (from ChatSessionStore)
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id            TEXT PRIMARY KEY,
                    session_id    TEXT NOT NULL,
                    role          TEXT NOT NULL,
                    content       TEXT NOT NULL,
                    timestamp     TEXT NOT NULL,
                    tool_calls    TEXT,
                    attachments   TEXT,
                    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
                );
                CREATE INDEX IF NOT EXISTS idx_cm_session ON chat_messages(session_id);

                -- Usage metering (from UsageMeteringService)
                CREATE TABLE IF NOT EXISTS usage_metering (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp     TEXT NOT NULL,
                    session_id    TEXT,
                    provider      TEXT,
                    model         TEXT,
                    tokens_in     INTEGER DEFAULT 0,
                    tokens_out    INTEGER DEFAULT 0,
                    cost_usd      REAL DEFAULT 0,
                    operation     TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_um_timestamp ON usage_metering(timestamp);

                -- Retrieval dashboard (from RetrievalDashboardStore)
                CREATE TABLE IF NOT EXISTS retrieval_dashboard (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp     TEXT NOT NULL,
                    metric_name   TEXT NOT NULL,
                    metric_value  REAL NOT NULL,
                    tags          TEXT,
                    session_id    TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_rd_metric ON retrieval_dashboard(metric_name);

                -- Character accountability (from CharacterAccountabilityStore)
                CREATE TABLE IF NOT EXISTS character_assignments (
                    id            TEXT PRIMARY KEY,
                    character_id  TEXT NOT NULL,
                    operator_id   TEXT NOT NULL,
                    session_id    TEXT,
                    status        TEXT NOT NULL DEFAULT 'active',
                    assigned_at   TEXT NOT NULL,
                    revoked_at    TEXT,
                    metadata      TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_ca_character ON character_assignments(character_id);

                -- IAM store (from IamStore)
                CREATE TABLE IF NOT EXISTS iam_principals (
                    user_id       TEXT PRIMARY KEY,
                    tenant_id     TEXT NOT NULL DEFAULT 'default',
                    roles         TEXT NOT NULL DEFAULT '["operator"]',
                    email         TEXT,
                    display_name  TEXT,
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL,
                    attrs         TEXT
                );

                -- Session packages (from SessionPackageSqliteStore)
                CREATE TABLE IF NOT EXISTS session_packages (
                    id            TEXT PRIMARY KEY,
                    session_id    TEXT NOT NULL,
                    created_at    TEXT NOT NULL,
                    package_data  TEXT NOT NULL,
                    package_type  TEXT DEFAULT 'trace'
                );
                CREATE INDEX IF NOT EXISTS idx_sp_session ON session_packages(session_id);
            `);
        },
    },

    // ── Future migrations go here ─────────────────────────────────────────
    // {
    //     id: 2,
    //     description: "Add index on chat_messages.timestamp for faster history queries",
    //     up: (db) => {
    //         db.exec(`CREATE INDEX IF NOT EXISTS idx_cm_timestamp ON chat_messages(timestamp);`);
    //     },
    // },
];