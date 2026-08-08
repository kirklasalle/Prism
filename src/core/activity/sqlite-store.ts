import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ActivityEvent, ActivitySubscriber } from "./types.js";
import type { IActivityStore } from "../database/store-interfaces.js";
import {
    CURRENT_AUDIT_HASH_VERSION,
    GENESIS_PREVIOUS_HASH,
    computeChainedEventHash,
    type HashChainedEvent,
} from "./hash-chained-audit.js";

/**
 * Result of verifying the persisted audit chain.
 *
 * `unchainedRows` are rows written before the IC-11 chain migration. They are reported
 * separately and are never counted as verified — an unprovable row must not be presented
 * as a proven one.
 */
export interface PersistedChainVerification {
    status: "valid" | "invalid" | "indeterminate";
    valid: boolean;
    /** Rows carrying a sequence number that were cryptographically checked. */
    checked: number;
    /** Pre-migration rows with no chain metadata. Unprovable, not invalid. */
    unchainedRows: number;
    /** Sequence number of the first chained row present. */
    firstSequence: number | null;
    /** True when the earliest retained row is not sequence 1, i.e. predecessors were pruned. */
    rootedAfterPrune: boolean;
    /** Sequence number at which verification failed, if any. */
    brokenAtSequence: number | null;
    reason: string;
}

export class SqliteActivityStore implements IActivityStore {
    private readonly db: DatabaseSync;
    private readonly insertStmt: StatementSync;
    private readonly selectStmt: StatementSync;
    private readonly insertLlreStmt: StatementSync;
    /** Set to true after close() so late-arriving Guardian/timer events are silently dropped. */
    private _closed = false;

    constructor(readonly dbPath: string = "prism-activity.db") {
        this.db = new DatabaseSync(dbPath, { timeout: 5_000 });
        try {
            this.migrate();
        } catch (error) {
            this.db.close();
            throw error;
        }

        // IC-11 Phase 0: INSERT OR IGNORE prevents overwriting existing audit events.
        // UUID-based IDs make collisions astronomically unlikely.
        this.insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO activity_events
        (id, timestamp, session_id, layer, operation, status,
         confidence, duration_ms, details,
         authority_tier, policy_decision, side_effects,
         character_id, prism_user_id, prism_user_email,
         operator_id, operator_email, client_id, execution_profile_segment, assignment_id, accountability_chain,
         rollback_plan, hash, previous_hash, sequence_number, hash_version)
      VALUES
        (:id, :timestamp, :sessionId, :layer, :operation, :status,
         :confidence, :durationMs, :details,
         :authorityTier, :policyDecision, :sideEffects,
         :characterId, :prismUserId, :prismUserEmail,
         :operatorId, :operatorEmail, :clientId, :executionProfileSegment, :assignmentId, :accountabilityChain,
         :rollbackPlan, :hash, :previousHash, :sequenceNumber, :hashVersion)
    `);

        this.selectStmt = this.db.prepare(`
      SELECT * FROM activity_events
      ORDER BY timestamp DESC
      LIMIT 1000
    `);

        // IC-11 Phase 0: INSERT OR IGNORE for telemetry as well.
        this.insertLlreStmt = this.db.prepare(`
      INSERT OR IGNORE INTO prism_llre_telemetry
        (id, timestamp, session_id, correlation_id, model_name,
         tokens_consumed, latency_ms, cost_usd, rsi_score, csr_score, tca_score, teq_score, details)
      VALUES
        (:id, :timestamp, :sessionId, :correlationId, :modelName,
         :tokensConsumed, :latencyMs, :costUsd, :rsiScore, :csrScore, :tcaScore, :teqScore, :details)
    `);
    }

    private migrate(): void {
        this.db.exec("BEGIN IMMEDIATE");
        try {
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

      CREATE TABLE IF NOT EXISTS prism_llre_telemetry (
        id             TEXT PRIMARY KEY,
        timestamp      TEXT NOT NULL,
        session_id     TEXT NOT NULL,
        correlation_id TEXT,
        model_name     TEXT NOT NULL,
        tokens_consumed INTEGER NOT NULL,
        latency_ms     INTEGER NOT NULL,
        cost_usd       REAL NOT NULL,
        rsi_score      REAL NOT NULL,
        csr_score      REAL NOT NULL,
        tca_score      REAL NOT NULL,
        teq_score      REAL NOT NULL,
        details        TEXT DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_llre_session    ON prism_llre_telemetry(session_id);
      CREATE INDEX IF NOT EXISTS idx_llre_timestamp  ON prism_llre_telemetry(timestamp);
      CREATE INDEX IF NOT EXISTS idx_llre_teq        ON prism_llre_telemetry(teq_score);
    `);

            this.ensureColumns("activity_events", [
                { name: "confidence", definition: "REAL" },
                { name: "duration_ms", definition: "INTEGER" },
                { name: "details", definition: "TEXT DEFAULT '{}'" },
                { name: "authority_tier", definition: "TEXT" },
                { name: "policy_decision", definition: "TEXT" },
                { name: "side_effects", definition: "TEXT DEFAULT '[]'" },
                { name: "character_id", definition: "TEXT" },
                { name: "prism_user_id", definition: "TEXT" },
                { name: "prism_user_email", definition: "TEXT" },
                { name: "operator_id", definition: "TEXT" },
                { name: "operator_email", definition: "TEXT" },
                { name: "client_id", definition: "TEXT" },
                { name: "execution_profile_segment", definition: "TEXT" },
                { name: "assignment_id", definition: "TEXT" },
                { name: "accountability_chain", definition: "TEXT" },
                { name: "rollback_plan", definition: "TEXT" },
                { name: "hash", definition: "TEXT" },
                { name: "previous_hash", definition: "TEXT" },
                { name: "sequence_number", definition: "INTEGER" },
                { name: "hash_version", definition: "INTEGER" },
            ]);

            const duplicate = this.db.prepare(`
            SELECT sequence_number, COUNT(*) AS count
            FROM activity_events
            WHERE sequence_number IS NOT NULL
            GROUP BY sequence_number
            HAVING COUNT(*) > 1
            LIMIT 1
        `).get() as { sequence_number: number | bigint; count: number | bigint } | undefined;
            if (duplicate) {
                throw new Error(
                    `Audit-chain migration refused: sequence ${String(duplicate.sequence_number)} occurs ${String(duplicate.count)} times. Preserve the database for forensic review.`,
                );
            }

            this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ae_sequence ON activity_events(sequence_number);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_ae_sequence_unique
            ON activity_events(sequence_number)
            WHERE sequence_number IS NOT NULL;

                        CREATE TABLE IF NOT EXISTS audit_chain_state (
                            id INTEGER PRIMARY KEY CHECK (id = 1),
                            last_pruned_sequence INTEGER NOT NULL DEFAULT 0,
                            last_pruned_hash TEXT NOT NULL DEFAULT '${GENESIS_PREVIOUS_HASH}'
                        );
                        INSERT OR IGNORE INTO audit_chain_state
                            (id, last_pruned_sequence, last_pruned_hash)
                        VALUES (1, 0, '${GENESIS_PREVIOUS_HASH}');
    `);

            this.installAppendOnlyGuards();
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }

    /**
     * IC-11: make the persisted chain append-only.
     *
     * Updates are refused unconditionally — nothing in PRISM legitimately rewrites an
     * audit row. Deletes are refused unless the governed retention sweep has raised the
     * guard flag, so ad-hoc SQL cannot quietly excise history while a configured,
     * event-emitting retention policy still can.
     */
    private installAppendOnlyGuards(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_chain_guard (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        retention_active INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO audit_chain_guard (id, retention_active) VALUES (1, 0);
    UPDATE audit_chain_guard SET retention_active = 0 WHERE id = 1;

    DROP TRIGGER IF EXISTS prevent_activity_event_update;
    DROP TRIGGER IF EXISTS prevent_activity_event_delete;

    CREATE TRIGGER prevent_activity_event_update
      BEFORE UPDATE ON activity_events
      FOR EACH ROW
      BEGIN
        SELECT RAISE(FAIL, 'Modification of append-only audit event is forbidden');
      END;

    CREATE TRIGGER prevent_activity_event_delete
      BEFORE DELETE ON activity_events
      FOR EACH ROW
      WHEN (SELECT retention_active FROM audit_chain_guard WHERE id = 1) = 0
      BEGIN
        SELECT RAISE(FAIL, 'Deletion of append-only audit event is forbidden outside a governed retention sweep');
      END;
    `);
    }

    private ensureColumns(tableName: string, columns: Array<{ name: string; definition: string }>): void {
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
        // Silently drop events after the DB is closed (e.g. Guardian timers firing during shutdown).
        if (this._closed) return;

        if (event.operation === "llre.telemetry.recorded") {
            const metrics = event.details as any;
            this.saveLlreTelemetry({
                sessionId: metrics.sessionId ?? event.sessionId,
                correlationId: metrics.correlationId ?? null,
                modelName: metrics.modelName ?? "unknown-model",
                tokensConsumed: Number(metrics.tokensConsumed ?? 0),
                latencyMs: Number(metrics.latencyMs ?? event.durationMs ?? 0),
                costUsd: Number(metrics.costUsd ?? 0.0),
                rsi: Number(metrics.rsi ?? metrics.rsiScore ?? 1.0),
                csr: Number(metrics.csr ?? metrics.csrScore ?? 1.0),
                tca: Number(metrics.tca ?? metrics.tcaScore ?? 1.0),
                teq: Number(metrics.teq ?? metrics.teqScore ?? 0.0),
                details: metrics.details ?? metrics,
            });
            return;
        }

        // The ActivityBus chain is process-local. Select and advance the durable head under
        // an immediate write lock so concurrent PRISM processes cannot claim one sequence.
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const head = this.db
                .prepare(`
                    SELECT sequence_number, hash
                    FROM activity_events
                    WHERE sequence_number IS NOT NULL AND hash IS NOT NULL
                    ORDER BY sequence_number DESC
                    LIMIT 1
                `)
                .get() as { sequence_number: number | bigint; hash: string } | undefined;
            const prunedHead = this.db
                .prepare(`SELECT last_pruned_sequence, last_pruned_hash FROM audit_chain_state WHERE id = 1`)
                .get() as { last_pruned_sequence: number | bigint; last_pruned_hash: string };
            const durableSequence = head ? Number(head.sequence_number) : Number(prunedHead.last_pruned_sequence);
            const sequenceNumber = durableSequence + 1;
            const previousHash = head?.hash ?? prunedHead.last_pruned_hash;
            const hash = computeChainedEventHash(previousHash, event, CURRENT_AUDIT_HASH_VERSION);
            const result = this.insertStmt.run({
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
                characterId: event.characterId ?? null,
                prismUserId: event.prismUserId ?? null,
                prismUserEmail: event.prismUserEmail ?? null,
                operatorId: event.operatorId ?? null,
                operatorEmail: event.operatorEmail ?? null,
                clientId: event.clientId ?? null,
                executionProfileSegment: event.executionProfileSegment ?? null,
                assignmentId: event.assignmentId ?? null,
                accountabilityChain: event.accountabilityChain ? JSON.stringify(event.accountabilityChain) : null,
                rollbackPlan: event.rollbackPlan ?? null,
                hash,
                previousHash,
                sequenceNumber,
                hashVersion: CURRENT_AUDIT_HASH_VERSION,
            });
            if (Number(result.changes) !== 1) throw new Error(`Audit event ${event.id} was not persisted`);
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }

    /**
     * IC-11: verify the chain as persisted, not as held in memory.
     *
     * The in-process `ActivityBus` chain proves nothing after a restart; this reads the
     * rows back in sequence order and re-derives every digest from stored content.
     */
    verifyPersistedChain(): PersistedChainVerification {
        if (this._closed) {
            return {
                status: "invalid",
                valid: false,
                checked: 0,
                unchainedRows: 0,
                firstSequence: null,
                rootedAfterPrune: false,
                brokenAtSequence: null,
                reason: "Store is closed",
            };
        }

        const unchainedRows = Number(
            (this.db.prepare("SELECT COUNT(*) AS c FROM activity_events WHERE sequence_number IS NULL").get() as {
                c: number | bigint;
            }).c,
        );

        const rows = this.db
            .prepare(
                `SELECT * FROM activity_events WHERE sequence_number IS NOT NULL ORDER BY sequence_number ASC`,
            )
            .all() as Record<string, unknown>[];
        const chainState = this.db
            .prepare(`SELECT last_pruned_sequence, last_pruned_hash FROM audit_chain_state WHERE id = 1`)
            .get() as { last_pruned_sequence: number | bigint; last_pruned_hash: string };

        if (rows.length === 0) {
            return {
                status: "indeterminate",
                valid: false,
                checked: 0,
                unchainedRows,
                firstSequence: null,
                rootedAfterPrune: false,
                brokenAtSequence: null,
                reason:
                    unchainedRows > 0
                        ? `No chained events. ${unchainedRows} pre-migration row(s) are unprovable.`
                        : Number(chainState.last_pruned_sequence) > 0
                            ? `No retained events. History through sequence ${String(chainState.last_pruned_sequence)} was pruned; no event can currently be verified.`
                            : "Chain is empty; no event can be verified.",
            };
        }

        const firstSequence = Number(rows[0]!.sequence_number);
        const rootedAfterPrune = firstSequence !== 1;
        const prunedSequence = Number(chainState.last_pruned_sequence);
        let expectedSequence = firstSequence;
        let expectedPrevHash = rootedAfterPrune ? chainState.last_pruned_hash : GENESIS_PREVIOUS_HASH;

        if (rootedAfterPrune && (firstSequence !== prunedSequence + 1 || prunedSequence === 0)) {
            return {
                status: "invalid",
                valid: false,
                checked: 0,
                unchainedRows,
                firstSequence,
                rootedAfterPrune,
                brokenAtSequence: firstSequence,
                reason: `Retained root is not authorized by prune state: first sequence ${firstSequence}, recorded pruned sequence ${prunedSequence}.`,
            };
        }

        for (const row of rows) {
            const sequence = Number(row.sequence_number);

            if (sequence !== expectedSequence) {
                return {
                    status: "invalid",
                    valid: false,
                    checked: sequence - firstSequence,
                    unchainedRows,
                    firstSequence,
                    rootedAfterPrune,
                    brokenAtSequence: sequence,
                    reason: `Sequence gap: expected ${expectedSequence}, found ${sequence}. Row(s) were removed or never written.`,
                };
            }

            const previousHash = String(row.previous_hash ?? "");
            if (previousHash !== expectedPrevHash) {
                return {
                    status: "invalid",
                    valid: false,
                    checked: sequence - firstSequence,
                    unchainedRows,
                    firstSequence,
                    rootedAfterPrune,
                    brokenAtSequence: sequence,
                    reason: `Broken link at sequence ${sequence} (event ${String(row.id)}): expected predecessor ${expectedPrevHash.slice(0, 12)}, stored ${previousHash.slice(0, 12)}`,
                };
            }

            const hashVersion = row.hash_version == null ? 1 : Number(row.hash_version);
            const recomputed = computeChainedEventHash(previousHash, this.rowToEvent(row), hashVersion);
            const storedHash = String(row.hash ?? "");
            if (recomputed !== storedHash) {
                return {
                    status: "invalid",
                    valid: false,
                    checked: sequence - firstSequence,
                    unchainedRows,
                    firstSequence,
                    rootedAfterPrune,
                    brokenAtSequence: sequence,
                    reason: `Content mismatch at sequence ${sequence} (event ${String(row.id)}): stored digest ${storedHash.slice(0, 12)}, recomputed ${recomputed.slice(0, 12)}. The row was altered after it was written.`,
                };
            }

            expectedPrevHash = storedHash;
            expectedSequence += 1;
        }

        const rootNote = rootedAfterPrune
            ? ` Chain is rooted at sequence ${firstSequence}; events before it were pruned and cannot be proven.`
            : "";
        const legacyNote = unchainedRows > 0 ? ` ${unchainedRows} pre-migration row(s) remain unprovable.` : "";

        const status = unchainedRows > 0 ? "indeterminate" : "valid";
        return {
            status,
            valid: status === "valid",
            checked: rows.length,
            unchainedRows,
            firstSequence,
            rootedAfterPrune,
            brokenAtSequence: null,
            reason: `${status === "valid" ? "Chain intact" : "Retained chain intact, but overall evidence is indeterminate"}: ${rows.length} event(s) from sequence ${firstSequence} to ${expectedSequence - 1}.${rootNote}${legacyNote}`,
        };
    }

    readPersistedChainRange(sequenceStart?: number, sequenceEnd?: number): HashChainedEvent[] {
        if (this._closed) return [];
        const conditions = ["sequence_number IS NOT NULL"];
        const params: Record<string, number> = {};
        if (sequenceStart !== undefined) {
            conditions.push("sequence_number >= :sequenceStart");
            params.sequenceStart = sequenceStart;
        }
        if (sequenceEnd !== undefined) {
            conditions.push("sequence_number <= :sequenceEnd");
            params.sequenceEnd = sequenceEnd;
        }
        const rows = this.db
            .prepare(`SELECT * FROM activity_events WHERE ${conditions.join(" AND ")} ORDER BY sequence_number ASC`)
            .all(params) as Record<string, unknown>[];
        return rows.map((row) => ({
            ...this.rowToEvent(row),
            previousHash: String(row.previous_hash),
            sequenceNumber: Number(row.sequence_number),
            hashVersion: Number(row.hash_version ?? 1),
        }));
    }

    queryEvents(filter: {
        sessionId?: string;
        operation?: string;
        layer?: string;
        characterId?: string;
        prismUserId?: string;
        prismUserEmail?: string;
        operatorId?: string;
        operatorEmail?: string;
        clientId?: string;
        assignmentId?: string;
    }): ActivityEvent[] {
        if (this._closed) return [];
        const conditions: string[] = [];
        const params: Record<string, string> = {};

        if (filter.sessionId) {
            conditions.push("session_id = :sessionId");
            params.sessionId = filter.sessionId;
        }
        if (filter.operation) {
            conditions.push("operation = :operation");
            params.operation = filter.operation;
        }
        if (filter.layer) {
            conditions.push("layer = :layer");
            params.layer = filter.layer;
        }
        if (filter.characterId) {
            conditions.push("character_id = :characterId");
            params.characterId = filter.characterId;
        }
        if (filter.prismUserId) {
            conditions.push("prism_user_id = :prismUserId");
            params.prismUserId = filter.prismUserId;
        }
        if (filter.prismUserEmail) {
            conditions.push("prism_user_email = :prismUserEmail");
            params.prismUserEmail = filter.prismUserEmail;
        }
        if (filter.operatorId) {
            conditions.push("operator_id = :operatorId");
            params.operatorId = filter.operatorId;
        }
        if (filter.operatorEmail) {
            conditions.push("operator_email = :operatorEmail");
            params.operatorEmail = filter.operatorEmail;
        }
        if (filter.clientId) {
            conditions.push("client_id = :clientId");
            params.clientId = filter.clientId;
        }
        if (filter.assignmentId) {
            conditions.push("assignment_id = :assignmentId");
            params.assignmentId = filter.assignmentId;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = this.db
            .prepare(`SELECT * FROM activity_events ${where} ORDER BY timestamp DESC LIMIT 1000`)
            .all(params) as Record<string, unknown>[];

        return rows.map((row) => this.rowToEvent(row));
    }

    /** Single row→event mapping, shared by queries and by chain re-derivation. */
    private rowToEvent(row: Record<string, unknown>): ActivityEvent {
        return {
            id: String(row.id),
            timestamp: String(row.timestamp),
            sessionId: String(row.session_id),
            layer: String(row.layer) as ActivityEvent["layer"],
            operation: String(row.operation),
            status: String(row.status) as ActivityEvent["status"],
            confidence: row.confidence != null ? Number(row.confidence) : undefined,
            durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
            details: JSON.parse(String(row.details ?? "{}")),
            authorityTier:
                row.authority_tier != null ? (String(row.authority_tier) as ActivityEvent["authorityTier"]) : undefined,
            policyDecision:
                row.policy_decision != null
                    ? (String(row.policy_decision) as ActivityEvent["policyDecision"])
                    : undefined,
            sideEffects: JSON.parse(String(row.side_effects ?? "[]")),
            characterId: row.character_id != null ? String(row.character_id) : undefined,
            prismUserId: row.prism_user_id != null ? String(row.prism_user_id) : undefined,
            prismUserEmail: row.prism_user_email != null ? String(row.prism_user_email) : undefined,
            operatorId: row.operator_id != null ? String(row.operator_id) : undefined,
            operatorEmail: row.operator_email != null ? String(row.operator_email) : undefined,
            clientId: row.client_id != null ? String(row.client_id) : undefined,
            executionProfileSegment:
                row.execution_profile_segment != null
                    ? (String(row.execution_profile_segment) as ActivityEvent["executionProfileSegment"])
                    : undefined,
            assignmentId: row.assignment_id != null ? String(row.assignment_id) : undefined,
            accountabilityChain:
                row.accountability_chain != null
                    ? (JSON.parse(String(row.accountability_chain)) as ActivityEvent["accountabilityChain"])
                    : undefined,
            rollbackPlan: row.rollback_plan != null ? String(row.rollback_plan) : undefined,
            hash: row.hash != null ? String(row.hash) : undefined,
        };
    }

    saveLlreTelemetry(metrics: {
        sessionId: string;
        correlationId?: string;
        modelName: string;
        tokensConsumed: number;
        latencyMs: number;
        costUsd: number;
        rsi: number;
        csr: number;
        tca: number;
        teq: number;
        details?: Record<string, unknown>;
    }): void {
        if (this._closed) return;
        const id = "llre-" + Math.random().toString(36).substring(2, 14);
        this.insertLlreStmt.run({
            id,
            timestamp: new Date().toISOString(),
            sessionId: metrics.sessionId,
            correlationId: metrics.correlationId ?? null,
            modelName: metrics.modelName,
            tokensConsumed: metrics.tokensConsumed,
            latencyMs: metrics.latencyMs,
            costUsd: metrics.costUsd,
            rsiScore: metrics.rsi,
            csrScore: metrics.csr,
            tcaScore: metrics.tca,
            teqScore: metrics.teq,
            details: JSON.stringify(metrics.details ?? {}),
        });
    }

    queryLlreTelemetry(sessionId: string): any[] {
        if (this._closed) return [];
        return this.db
            .prepare(
                `
            SELECT * FROM prism_llre_telemetry
            WHERE session_id = :sessionId
            ORDER BY timestamp DESC
        `,
            )
            .all({ sessionId }) as any[];
    }

    close(): void {
        if (this._closed) return;
        this._closed = true;
        this.db.close();
    }
}
