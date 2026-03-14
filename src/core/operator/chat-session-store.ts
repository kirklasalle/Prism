import { randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { PersistedProviderSettings, PrismLlmProviderId } from "./llm-provider-manager.js";

export interface ChatSessionSummary {
    sessionId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    llmProviderId: string | null;
    llmModel: string | null;
    messageCount: number;
    lastMessagePreview: string | null;
    lastMessageRole: "user" | "assistant" | "system" | null;
}

export interface ChatMessage {
    messageId: string;
    sessionId: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAt: string;
    metadata: Record<string, unknown>;
}

export interface SessionConfigDraft {
    sessionId: string;
    providerId: string | null;
    model: string | null;
    updatedAt: string;
    source: string;
}

export interface SessionConfigHistoryEntry {
    historyId: string;
    sessionId: string;
    previousProviderId: string | null;
    previousModel: string | null;
    nextProviderId: string | null;
    nextModel: string | null;
    changedFields: string[];
    appliedAt: string;
    source: string;
}

export interface ProviderSettingsInput {
    baseUrl?: string | null;
    apiKeyHeader?: string | null;
    models?: string[];
    defaultModel?: string | null;
}

export class ChatSessionStore {
    private readonly db: DatabaseSync;
    private readonly insertSessionStmt: StatementSync;
    private readonly insertMessageStmt: StatementSync;
    private readonly touchSessionStmt: StatementSync;
    private readonly updateTitleStmt: StatementSync;
    private readonly updateLlmSelectionStmt: StatementSync;

    constructor(dbPath: string = "prism-activity.db") {
        this.db = new DatabaseSync(dbPath);
        this.migrate();
        this.insertSessionStmt = this.db.prepare(`
            INSERT INTO chat_sessions (session_id, title, created_at, updated_at)
            VALUES (:sessionId, :title, :createdAt, :updatedAt)
        `);
        this.insertMessageStmt = this.db.prepare(`
            INSERT INTO chat_messages (message_id, session_id, role, content, created_at, metadata_json)
            VALUES (:messageId, :sessionId, :role, :content, :createdAt, :metadataJson)
        `);
        this.touchSessionStmt = this.db.prepare(`
            UPDATE chat_sessions
            SET updated_at = :updatedAt
            WHERE session_id = :sessionId
        `);
        this.updateTitleStmt = this.db.prepare(`
            UPDATE chat_sessions
            SET title = :title,
                updated_at = :updatedAt
            WHERE session_id = :sessionId
        `);
        this.updateLlmSelectionStmt = this.db.prepare(`
            UPDATE chat_sessions
            SET llm_provider_id = :providerId,
                llm_model = :model,
                updated_at = :updatedAt
            WHERE session_id = :sessionId
        `);
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                session_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                llm_provider_id TEXT,
                llm_model TEXT
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                message_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY(session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
            ON chat_messages (session_id, created_at);

            CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at
            ON chat_sessions (updated_at DESC);

            CREATE TABLE IF NOT EXISTS chat_config_drafts (
                session_id TEXT PRIMARY KEY,
                provider_id TEXT,
                model TEXT,
                updated_at TEXT NOT NULL,
                source TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chat_config_history (
                history_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                previous_provider_id TEXT,
                previous_model TEXT,
                next_provider_id TEXT,
                next_model TEXT,
                changed_fields_json TEXT NOT NULL,
                applied_at TEXT NOT NULL,
                source TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chat_config_history_session_applied
            ON chat_config_history (session_id, applied_at DESC);

            CREATE TABLE IF NOT EXISTS provider_settings (
                provider_id TEXT PRIMARY KEY,
                base_url TEXT,
                api_key_header TEXT,
                models_json TEXT NOT NULL DEFAULT '[]',
                default_model TEXT,
                updated_at TEXT NOT NULL,
                source TEXT NOT NULL
            );
        `);

        this.ensureColumn("chat_sessions", "llm_provider_id", "TEXT");
        this.ensureColumn("chat_sessions", "llm_model", "TEXT");
    }

    private ensureColumn(table: string, column: string, definition: string): void {
        const existing = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (existing.some((entry) => entry.name === column)) {
            return;
        }
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }

    createSession(title: string = "New Session"): ChatSessionSummary {
        const now = new Date().toISOString();
        const sessionId = randomUUID();
        this.insertSessionStmt.run({
            sessionId,
            title: sanitizeTitle(title),
            createdAt: now,
            updatedAt: now,
        });
        return this.getSession(sessionId)!;
    }

    listSessions(): ChatSessionSummary[] {
        const rows = this.db.prepare(`
            SELECT
                s.session_id,
                s.title,
                s.created_at,
                s.updated_at,
                s.llm_provider_id,
                s.llm_model,
                COALESCE(m.message_count, 0) AS message_count,
                m.last_message_preview,
                m.last_message_role
            FROM chat_sessions s
            LEFT JOIN (
                SELECT
                    session_id,
                    COUNT(*) AS message_count,
                    SUBSTR((
                        SELECT content
                        FROM chat_messages latest
                        WHERE latest.session_id = cm.session_id
                        ORDER BY latest.created_at DESC
                        LIMIT 1
                    ), 1, 160) AS last_message_preview,
                    (
                        SELECT role
                        FROM chat_messages latest
                        WHERE latest.session_id = cm.session_id
                        ORDER BY latest.created_at DESC
                        LIMIT 1
                    ) AS last_message_role
                FROM chat_messages cm
                GROUP BY session_id
            ) m ON m.session_id = s.session_id
            ORDER BY s.updated_at DESC
        `).all() as Array<{
            session_id: string;
            title: string;
            created_at: string;
            updated_at: string;
            llm_provider_id: string | null;
            llm_model: string | null;
            message_count: number;
            last_message_preview: string | null;
            last_message_role: "user" | "assistant" | "system" | null;
        }>;

        return rows.map((row) => ({
            sessionId: row.session_id,
            title: row.title,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            llmProviderId: row.llm_provider_id,
            llmModel: row.llm_model,
            messageCount: row.message_count,
            lastMessagePreview: row.last_message_preview,
            lastMessageRole: row.last_message_role,
        }));
    }

    getSession(sessionId: string): ChatSessionSummary | null {
        return this.listSessions().find((session) => session.sessionId === sessionId) ?? null;
    }

    getMessages(sessionId: string): ChatMessage[] {
        this.assertSessionExists(sessionId);
        const rows = this.db.prepare(`
            SELECT message_id, session_id, role, content, created_at, metadata_json
            FROM chat_messages
            WHERE session_id = :sessionId
            ORDER BY created_at ASC, message_id ASC
        `).all({ sessionId }) as Array<{
            message_id: string;
            session_id: string;
            role: "user" | "assistant" | "system";
            content: string;
            created_at: string;
            metadata_json: string;
        }>;

        return rows.map((row) => ({
            messageId: row.message_id,
            sessionId: row.session_id,
            role: row.role,
            content: row.content,
            createdAt: row.created_at,
            metadata: parseMetadata(row.metadata_json),
        }));
    }

    appendMessage(
        sessionId: string,
        role: "user" | "assistant" | "system",
        content: string,
        metadata: Record<string, unknown> = {},
    ): ChatMessage {
        this.assertSessionExists(sessionId);
        const now = new Date().toISOString();
        const messageId = randomUUID();
        this.insertMessageStmt.run({
            messageId,
            sessionId,
            role,
            content,
            createdAt: now,
            metadataJson: JSON.stringify(metadata),
        });
        this.touchSessionStmt.run({ sessionId, updatedAt: now });
        return {
            messageId,
            sessionId,
            role,
            content,
            createdAt: now,
            metadata,
        };
    }

    updateSessionTitle(sessionId: string, title: string): void {
        this.assertSessionExists(sessionId);
        this.updateTitleStmt.run({
            sessionId,
            title: sanitizeTitle(title),
            updatedAt: new Date().toISOString(),
        });
    }

    updateSessionLlmSelection(sessionId: string, providerId: string | null, model: string | null): void {
        this.assertSessionExists(sessionId);
        this.updateLlmSelectionStmt.run({
            sessionId,
            providerId: providerId?.trim() || null,
            model: model?.trim() || null,
            updatedAt: new Date().toISOString(),
        });
    }

    deleteSession(sessionId: string): void {
        this.assertSessionExists(sessionId);
        this.db.prepare(`
            DELETE FROM chat_sessions
            WHERE session_id = :sessionId
        `).run({ sessionId });
    }

    getSessionConfigDraft(sessionId: string): SessionConfigDraft | null {
        this.assertSessionExists(sessionId);
        const row = this.db.prepare(`
            SELECT session_id, provider_id, model, updated_at, source
            FROM chat_config_drafts
            WHERE session_id = :sessionId
        `).get({ sessionId }) as {
            session_id: string;
            provider_id: string | null;
            model: string | null;
            updated_at: string;
            source: string;
        } | undefined;

        if (!row) {
            return null;
        }

        return {
            sessionId: row.session_id,
            providerId: row.provider_id,
            model: row.model,
            updatedAt: row.updated_at,
            source: row.source,
        };
    }

    upsertSessionConfigDraft(sessionId: string, providerId: string | null, model: string | null, source: string): SessionConfigDraft {
        this.assertSessionExists(sessionId);
        const updatedAt = new Date().toISOString();

        this.db.prepare(`
            INSERT INTO chat_config_drafts (session_id, provider_id, model, updated_at, source)
            VALUES (:sessionId, :providerId, :model, :updatedAt, :source)
            ON CONFLICT(session_id) DO UPDATE SET
                provider_id = excluded.provider_id,
                model = excluded.model,
                updated_at = excluded.updated_at,
                source = excluded.source
        `).run({
            sessionId,
            providerId: providerId?.trim() || null,
            model: model?.trim() || null,
            updatedAt,
            source: source.trim() || "dashboard",
        });

        return this.getSessionConfigDraft(sessionId)!;
    }

    clearSessionConfigDraft(sessionId: string): void {
        this.assertSessionExists(sessionId);
        this.db.prepare(`
            DELETE FROM chat_config_drafts
            WHERE session_id = :sessionId
        `).run({ sessionId });
    }

    appendSessionConfigHistory(
        sessionId: string,
        previousProviderId: string | null,
        previousModel: string | null,
        nextProviderId: string | null,
        nextModel: string | null,
        source: string,
    ): SessionConfigHistoryEntry {
        this.assertSessionExists(sessionId);
        const historyId = randomUUID();
        const appliedAt = new Date().toISOString();
        const changedFields = getChangedConfigFields(previousProviderId, previousModel, nextProviderId, nextModel);

        this.db.prepare(`
            INSERT INTO chat_config_history (
                history_id,
                session_id,
                previous_provider_id,
                previous_model,
                next_provider_id,
                next_model,
                changed_fields_json,
                applied_at,
                source
            ) VALUES (
                :historyId,
                :sessionId,
                :previousProviderId,
                :previousModel,
                :nextProviderId,
                :nextModel,
                :changedFieldsJson,
                :appliedAt,
                :source
            )
        `).run({
            historyId,
            sessionId,
            previousProviderId: previousProviderId?.trim() || null,
            previousModel: previousModel?.trim() || null,
            nextProviderId: nextProviderId?.trim() || null,
            nextModel: nextModel?.trim() || null,
            changedFieldsJson: JSON.stringify(changedFields),
            appliedAt,
            source: source.trim() || "dashboard",
        });

        return {
            historyId,
            sessionId,
            previousProviderId: previousProviderId?.trim() || null,
            previousModel: previousModel?.trim() || null,
            nextProviderId: nextProviderId?.trim() || null,
            nextModel: nextModel?.trim() || null,
            changedFields,
            appliedAt,
            source: source.trim() || "dashboard",
        };
    }

    listSessionConfigHistory(sessionId: string, limit: number = 10): SessionConfigHistoryEntry[] {
        this.assertSessionExists(sessionId);
        const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
        const rows = this.db.prepare(`
            SELECT
                history_id,
                session_id,
                previous_provider_id,
                previous_model,
                next_provider_id,
                next_model,
                changed_fields_json,
                applied_at,
                source
            FROM chat_config_history
            WHERE session_id = :sessionId
            ORDER BY applied_at DESC
            LIMIT :limit
        `).all({ sessionId, limit: safeLimit }) as Array<{
            history_id: string;
            session_id: string;
            previous_provider_id: string | null;
            previous_model: string | null;
            next_provider_id: string | null;
            next_model: string | null;
            changed_fields_json: string;
            applied_at: string;
            source: string;
        }>;

        return rows.map((row) => ({
            historyId: row.history_id,
            sessionId: row.session_id,
            previousProviderId: row.previous_provider_id,
            previousModel: row.previous_model,
            nextProviderId: row.next_provider_id,
            nextModel: row.next_model,
            changedFields: parseChangedFields(row.changed_fields_json),
            appliedAt: row.applied_at,
            source: row.source,
        }));
    }

    getProviderSettings(providerId: PrismLlmProviderId): PersistedProviderSettings | null {
        const row = this.db.prepare(`
            SELECT provider_id, base_url, api_key_header, models_json, default_model, updated_at, source
            FROM provider_settings
            WHERE provider_id = :providerId
        `).get({ providerId }) as {
            provider_id: PrismLlmProviderId;
            base_url: string | null;
            api_key_header: string | null;
            models_json: string;
            default_model: string | null;
            updated_at: string;
            source: string;
        } | undefined;

        if (!row) {
            return null;
        }

        return {
            providerId: row.provider_id,
            baseUrl: row.base_url,
            apiKeyHeader: row.api_key_header,
            models: parseProviderModels(row.models_json),
            defaultModel: row.default_model,
            updatedAt: row.updated_at,
            source: row.source,
        };
    }

    listProviderSettings(): PersistedProviderSettings[] {
        const rows = this.db.prepare(`
            SELECT provider_id, base_url, api_key_header, models_json, default_model, updated_at, source
            FROM provider_settings
            ORDER BY provider_id ASC
        `).all() as Array<{
            provider_id: PrismLlmProviderId;
            base_url: string | null;
            api_key_header: string | null;
            models_json: string;
            default_model: string | null;
            updated_at: string;
            source: string;
        }>;

        return rows.map((row) => ({
            providerId: row.provider_id,
            baseUrl: row.base_url,
            apiKeyHeader: row.api_key_header,
            models: parseProviderModels(row.models_json),
            defaultModel: row.default_model,
            updatedAt: row.updated_at,
            source: row.source,
        }));
    }

    upsertProviderSettings(
        providerId: PrismLlmProviderId,
        settings: ProviderSettingsInput,
        source: string,
    ): PersistedProviderSettings {
        const updatedAt = new Date().toISOString();
        const models = normalizeProviderModels(settings.models ?? []);
        const defaultModel = normalizeOptionalText(settings.defaultModel);
        const resolvedDefaultModel = defaultModel && models.includes(defaultModel)
            ? defaultModel
            : (defaultModel || models[0] || null);

        this.db.prepare(`
            INSERT INTO provider_settings (
                provider_id,
                base_url,
                api_key_header,
                models_json,
                default_model,
                updated_at,
                source
            ) VALUES (
                :providerId,
                :baseUrl,
                :apiKeyHeader,
                :modelsJson,
                :defaultModel,
                :updatedAt,
                :source
            )
            ON CONFLICT(provider_id) DO UPDATE SET
                base_url = excluded.base_url,
                api_key_header = excluded.api_key_header,
                models_json = excluded.models_json,
                default_model = excluded.default_model,
                updated_at = excluded.updated_at,
                source = excluded.source
        `).run({
            providerId,
            baseUrl: normalizeOptionalText(settings.baseUrl),
            apiKeyHeader: normalizeOptionalText(settings.apiKeyHeader),
            modelsJson: JSON.stringify(models),
            defaultModel: resolvedDefaultModel,
            updatedAt,
            source: source.trim() || "dashboard",
        });

        return this.getProviderSettings(providerId)!;
    }

    close(): void {
        this.db.close();
    }

    private assertSessionExists(sessionId: string): void {
        const row = this.db.prepare(`
            SELECT session_id
            FROM chat_sessions
            WHERE session_id = :sessionId
        `).get({ sessionId }) as { session_id: string } | undefined;

        if (!row) {
            throw new Error(`Unknown chat session: ${sessionId}`);
        }
    }
}

function sanitizeTitle(title: string): string {
    const cleaned = title.trim().replace(/\s+/g, " ");
    return cleaned.length > 0 ? cleaned.slice(0, 80) : "New Session";
}

function parseMetadata(metadataJson: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function getChangedConfigFields(
    previousProviderId: string | null,
    previousModel: string | null,
    nextProviderId: string | null,
    nextModel: string | null,
): string[] {
    const changedFields: string[] = [];
    if ((previousProviderId ?? null) !== (nextProviderId ?? null)) {
        changedFields.push("llmProviderId");
    }
    if ((previousModel ?? null) !== (nextModel ?? null)) {
        changedFields.push("llmModel");
    }
    return changedFields;
}

function parseChangedFields(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((entry): entry is string => typeof entry === "string");
    } catch {
        return [];
    }
}

function parseProviderModels(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return normalizeProviderModels(parsed.filter((entry): entry is string => typeof entry === "string"));
    } catch {
        return [];
    }
}

function normalizeProviderModels(models: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const model of models) {
        const trimmed = model.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        normalized.push(trimmed);
    }
    return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}