import { randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { PersistedProviderSettings, PrismLlmProviderId, RoutingConfig } from "./llm-provider-manager.js";
import type { ModelCapabilityProfile } from "./model-capability-matrix.js";

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
    attachments?: ChatAttachment[];
}

export interface ChatAttachment {
    attachmentId: string;
    messageId: string;
    sessionId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    thumbnailPath?: string;
    includeInContext: boolean;
    createdAt: string;
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
        // Enable WAL mode for better concurrent read performance
        this.db.exec("PRAGMA journal_mode=WAL");
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

        // Attachment storage table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chat_attachments (
                attachment_id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                storage_path TEXT NOT NULL,
                thumbnail_path TEXT,
                include_in_context INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                FOREIGN KEY(message_id) REFERENCES chat_messages(message_id) ON DELETE CASCADE,
                FOREIGN KEY(session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
            ON chat_attachments (message_id);

            CREATE INDEX IF NOT EXISTS idx_chat_attachments_session
            ON chat_attachments (session_id);
        `);

        // Routing configuration persistence (single-row table)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS routing_config (
                config_key TEXT PRIMARY KEY DEFAULT 'default',
                strategy TEXT NOT NULL DEFAULT 'single',
                role_overrides_json TEXT NOT NULL DEFAULT '{}',
                agent_overrides_json TEXT NOT NULL DEFAULT '{}',
                modality_overrides_json TEXT NOT NULL DEFAULT '{}',
                preferred_modality TEXT,
                updated_at TEXT NOT NULL DEFAULT ''
            );
        `);

        // Model capability profile persistence (runtime user-defined profiles)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS model_profiles (
                pattern TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                tier INTEGER NOT NULL,
                parameter_size TEXT NOT NULL,
                parameters_billions REAL NOT NULL DEFAULT 0,
                context_window INTEGER NOT NULL DEFAULT 4096,
                estimated_vram_mb INTEGER NOT NULL DEFAULT 0,
                max_output_tokens INTEGER NOT NULL DEFAULT 2048,
                adaptive_prompt_budget INTEGER NOT NULL DEFAULT 1000,
                strengths_json TEXT NOT NULL DEFAULT '[]',
                modalities_json TEXT NOT NULL DEFAULT '["text"]',
                locality TEXT NOT NULL DEFAULT 'cloud',
                version_constraint TEXT,
                updated_at TEXT NOT NULL
            );
        `);

        // Deprecation lifecycle columns (safe migration for existing DBs)
        this.ensureColumn("model_profiles", "deprecated", "INTEGER DEFAULT 0");
        this.ensureColumn("model_profiles", "deprecated_at", "TEXT");
        this.ensureColumn("model_profiles", "sunset_date", "TEXT");
        this.ensureColumn("model_profiles", "successor", "TEXT");
        this.ensureColumn("model_profiles", "deprecation_reason", "TEXT");

        // Spectrum Refraction (Prism SR) per-session config
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sr_config (
                session_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                left_provider_id TEXT,
                left_model TEXT,
                right_provider_id TEXT,
                right_model TEXT,
                updated_at TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
            );
        `);

        // SR saved presets (named configurations)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sr_presets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                scope TEXT NOT NULL DEFAULT 'global',
                scope_id TEXT,
                left_provider_id TEXT,
                left_model TEXT,
                right_provider_id TEXT,
                right_model TEXT,
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );
        `);

        // D4c: extended SR config columns (safe migration for existing DBs)
        this.ensureColumn("sr_config", "left_slot", "TEXT");
        this.ensureColumn("sr_config", "right_slot", "TEXT");
        this.ensureColumn("sr_config", "left_timeout_ms", "INTEGER");
        this.ensureColumn("sr_config", "right_timeout_ms", "INTEGER");
        this.ensureColumn("sr_config", "circuit_breaker_enabled", "INTEGER DEFAULT 1");
        this.ensureColumn("sr_config", "show_hemispheres", "INTEGER DEFAULT 0");
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

    // ── Routing config persistence ────────────────────────────────────

    saveRoutingConfig(config: RoutingConfig): void {
        const updatedAt = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO routing_config (
                config_key, strategy,
                role_overrides_json, agent_overrides_json,
                modality_overrides_json, preferred_modality, updated_at
            ) VALUES (
                'default', :strategy,
                :roleOverridesJson, :agentOverridesJson,
                :modalityOverridesJson, :preferredModality, :updatedAt
            )
            ON CONFLICT(config_key) DO UPDATE SET
                strategy = excluded.strategy,
                role_overrides_json = excluded.role_overrides_json,
                agent_overrides_json = excluded.agent_overrides_json,
                modality_overrides_json = excluded.modality_overrides_json,
                preferred_modality = excluded.preferred_modality,
                updated_at = excluded.updated_at
        `).run({
            strategy: config.strategy || "single",
            roleOverridesJson: JSON.stringify(config.roleOverrides ?? {}),
            agentOverridesJson: JSON.stringify(config.agentOverrides ?? {}),
            modalityOverridesJson: JSON.stringify(config.modalityOverrides ?? {}),
            preferredModality: config.preferredModality ?? null,
            updatedAt,
        });
    }

    loadRoutingConfig(): RoutingConfig | null {
        const row = this.db.prepare(`
            SELECT strategy, role_overrides_json, agent_overrides_json,
                   modality_overrides_json, preferred_modality
            FROM routing_config
            WHERE config_key = 'default'
            LIMIT 1
        `).get() as {
            strategy: string;
            role_overrides_json: string;
            agent_overrides_json: string;
            modality_overrides_json: string;
            preferred_modality: string | null;
        } | undefined;

        if (!row) return null;

        return {
            strategy: (row.strategy === "multi" || row.strategy === "modality") ? row.strategy : "single",
            roleOverrides: safeJsonParse(row.role_overrides_json),
            agentOverrides: safeJsonParse(row.agent_overrides_json),
            modalityOverrides: safeJsonParse(row.modality_overrides_json),
            preferredModality: row.preferred_modality ?? null,
        };
    }

    // ── Model profile persistence ─────────────────────────────────────

    listModelProfiles(): ModelCapabilityProfile[] {
        const rows = this.db.prepare(`
            SELECT pattern, label, tier, parameter_size, parameters_billions,
                   context_window, estimated_vram_mb, max_output_tokens,
                   adaptive_prompt_budget, strengths_json, modalities_json,
                   locality, version_constraint,
                   deprecated, deprecated_at, sunset_date, successor, deprecation_reason
            FROM model_profiles
            ORDER BY pattern ASC
        `).all() as Array<{
            pattern: string;
            label: string;
            tier: number;
            parameter_size: string;
            parameters_billions: number;
            context_window: number;
            estimated_vram_mb: number;
            max_output_tokens: number;
            adaptive_prompt_budget: number;
            strengths_json: string;
            modalities_json: string;
            locality: string;
            version_constraint: string | null;
            deprecated: number | null;
            deprecated_at: string | null;
            sunset_date: string | null;
            successor: string | null;
            deprecation_reason: string | null;
        }>;

        return rows.map((row) => ({
            pattern: row.pattern,
            label: row.label,
            tier: row.tier as 1 | 2 | 3 | 4 | 5,
            parameterSize: row.parameter_size as "tiny" | "small" | "medium" | "large" | "frontier",
            parametersBillions: row.parameters_billions,
            contextWindow: row.context_window,
            estimatedVramMb: row.estimated_vram_mb,
            maxOutputTokens: row.max_output_tokens,
            adaptivePromptBudget: row.adaptive_prompt_budget,
            strengths: (JSON.parse(row.strengths_json || "[]") as string[]),
            modalities: (JSON.parse(row.modalities_json || '["text"]') as string[]),
            locality: row.locality as "local" | "cloud",
            ...(row.version_constraint ? { versionConstraint: row.version_constraint } : {}),
            ...(row.deprecated ? { deprecated: true } : {}),
            ...(row.deprecated_at ? { deprecatedAt: row.deprecated_at } : {}),
            ...(row.sunset_date ? { sunsetDate: row.sunset_date } : {}),
            ...(row.successor ? { successor: row.successor } : {}),
            ...(row.deprecation_reason ? { deprecationReason: row.deprecation_reason } : {}),
        } as ModelCapabilityProfile));
    }

    upsertModelProfile(profile: ModelCapabilityProfile): void {
        const updatedAt = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO model_profiles (
                pattern, label, tier, parameter_size, parameters_billions,
                context_window, estimated_vram_mb, max_output_tokens,
                adaptive_prompt_budget, strengths_json, modalities_json,
                locality, version_constraint,
                deprecated, deprecated_at, sunset_date, successor, deprecation_reason,
                updated_at
            ) VALUES (
                :pattern, :label, :tier, :parameterSize, :parametersBillions,
                :contextWindow, :estimatedVramMb, :maxOutputTokens,
                :adaptivePromptBudget, :strengthsJson, :modalitiesJson,
                :locality, :versionConstraint,
                :deprecated, :deprecatedAt, :sunsetDate, :successor, :deprecationReason,
                :updatedAt
            )
            ON CONFLICT(pattern) DO UPDATE SET
                label = excluded.label,
                tier = excluded.tier,
                parameter_size = excluded.parameter_size,
                parameters_billions = excluded.parameters_billions,
                context_window = excluded.context_window,
                estimated_vram_mb = excluded.estimated_vram_mb,
                max_output_tokens = excluded.max_output_tokens,
                adaptive_prompt_budget = excluded.adaptive_prompt_budget,
                strengths_json = excluded.strengths_json,
                modalities_json = excluded.modalities_json,
                locality = excluded.locality,
                version_constraint = excluded.version_constraint,
                deprecated = excluded.deprecated,
                deprecated_at = excluded.deprecated_at,
                sunset_date = excluded.sunset_date,
                successor = excluded.successor,
                deprecation_reason = excluded.deprecation_reason,
                updated_at = excluded.updated_at
        `).run({
            pattern: profile.pattern,
            label: profile.label,
            tier: profile.tier,
            parameterSize: profile.parameterSize,
            parametersBillions: profile.parametersBillions,
            contextWindow: profile.contextWindow,
            estimatedVramMb: profile.estimatedVramMb,
            maxOutputTokens: profile.maxOutputTokens,
            adaptivePromptBudget: profile.adaptivePromptBudget,
            strengthsJson: JSON.stringify(profile.strengths ?? []),
            modalitiesJson: JSON.stringify(profile.modalities ?? ["text"]),
            locality: profile.locality,
            versionConstraint: (profile as any).versionConstraint ?? null,
            deprecated: profile.deprecated ? 1 : 0,
            deprecatedAt: profile.deprecatedAt ?? null,
            sunsetDate: profile.sunsetDate ?? null,
            successor: profile.successor ?? null,
            deprecationReason: profile.deprecationReason ?? null,
            updatedAt,
        });
    }

    removeModelProfile(pattern: string): boolean {
        const result = this.db.prepare(`
            DELETE FROM model_profiles WHERE pattern = :pattern
        `).run({ pattern });
        return (result as any).changes > 0;
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

    // ── Attachment methods ──────────────────────────────────────────────

    saveAttachment(attachment: Omit<ChatAttachment, "attachmentId" | "createdAt">): ChatAttachment {
        const attachmentId = randomUUID();
        const createdAt = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO chat_attachments (attachment_id, message_id, session_id, file_name, mime_type, size_bytes, storage_path, thumbnail_path, include_in_context, created_at)
            VALUES (:attachmentId, :messageId, :sessionId, :fileName, :mimeType, :sizeBytes, :storagePath, :thumbnailPath, :includeInContext, :createdAt)
        `).run({
            attachmentId,
            messageId: attachment.messageId,
            sessionId: attachment.sessionId,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            storagePath: attachment.storagePath,
            thumbnailPath: attachment.thumbnailPath ?? null,
            includeInContext: attachment.includeInContext ? 1 : 0,
            createdAt,
        });
        return { ...attachment, attachmentId, createdAt };
    }

    getAttachments(messageId: string): ChatAttachment[] {
        const rows = this.db.prepare(`
            SELECT attachment_id, message_id, session_id, file_name, mime_type, size_bytes, storage_path, thumbnail_path, include_in_context, created_at
            FROM chat_attachments
            WHERE message_id = :messageId
            ORDER BY created_at ASC
        `).all({ messageId }) as Array<{
            attachment_id: string; message_id: string; session_id: string;
            file_name: string; mime_type: string; size_bytes: number;
            storage_path: string; thumbnail_path: string | null;
            include_in_context: number; created_at: string;
        }>;

        return rows.map((row) => ({
            attachmentId: row.attachment_id,
            messageId: row.message_id,
            sessionId: row.session_id,
            fileName: row.file_name,
            mimeType: row.mime_type,
            sizeBytes: row.size_bytes,
            storagePath: row.storage_path,
            thumbnailPath: row.thumbnail_path ?? undefined,
            includeInContext: row.include_in_context === 1,
            createdAt: row.created_at,
        }));
    }

    getSessionAttachments(sessionId: string): ChatAttachment[] {
        const rows = this.db.prepare(`
            SELECT attachment_id, message_id, session_id, file_name, mime_type, size_bytes, storage_path, thumbnail_path, include_in_context, created_at
            FROM chat_attachments
            WHERE session_id = :sessionId
            ORDER BY created_at ASC
        `).all({ sessionId }) as Array<{
            attachment_id: string; message_id: string; session_id: string;
            file_name: string; mime_type: string; size_bytes: number;
            storage_path: string; thumbnail_path: string | null;
            include_in_context: number; created_at: string;
        }>;

        return rows.map((row) => ({
            attachmentId: row.attachment_id,
            messageId: row.message_id,
            sessionId: row.session_id,
            fileName: row.file_name,
            mimeType: row.mime_type,
            sizeBytes: row.size_bytes,
            storagePath: row.storage_path,
            thumbnailPath: row.thumbnail_path ?? undefined,
            includeInContext: row.include_in_context === 1,
            createdAt: row.created_at,
        }));
    }

    getAttachmentById(attachmentId: string): ChatAttachment | undefined {
        const row = this.db.prepare(`
            SELECT attachment_id, message_id, session_id, file_name, mime_type, size_bytes, storage_path, thumbnail_path, include_in_context, created_at
            FROM chat_attachments
            WHERE attachment_id = :attachmentId
            LIMIT 1
        `).get({ attachmentId }) as {
            attachment_id: string; message_id: string; session_id: string;
            file_name: string; mime_type: string; size_bytes: number;
            storage_path: string; thumbnail_path: string | null;
            include_in_context: number; created_at: string;
        } | undefined;

        if (!row) {
            return undefined;
        }

        return {
            attachmentId: row.attachment_id,
            messageId: row.message_id,
            sessionId: row.session_id,
            fileName: row.file_name,
            mimeType: row.mime_type,
            sizeBytes: row.size_bytes,
            storagePath: row.storage_path,
            thumbnailPath: row.thumbnail_path ?? undefined,
            includeInContext: row.include_in_context === 1,
            createdAt: row.created_at,
        };
    }

    deleteAttachment(attachmentId: string): boolean {
        const result = this.db.prepare(`
            DELETE FROM chat_attachments WHERE attachment_id = :attachmentId
        `).run({ attachmentId });
        return (result as any).changes > 0;
    }

    // ── Spectrum Refraction (Prism SR) config ───────────────────────────

    getSRConfig(sessionId: string): {
        enabled: boolean;
        leftProviderId: string | null;
        leftModel: string | null;
        rightProviderId: string | null;
        rightModel: string | null;
        leftSlot: string | null;
        rightSlot: string | null;
        leftTimeoutMs: number | null;
        rightTimeoutMs: number | null;
        circuitBreakerEnabled: boolean;
        showHemispheres: boolean;
    } | null {
        const row = this.db.prepare(`
            SELECT enabled, left_provider_id, left_model, right_provider_id, right_model,
                   left_slot, right_slot, left_timeout_ms, right_timeout_ms,
                   circuit_breaker_enabled, show_hemispheres
            FROM sr_config
            WHERE session_id = :sessionId
        `).get({ sessionId }) as {
            enabled: number;
            left_provider_id: string | null;
            left_model: string | null;
            right_provider_id: string | null;
            right_model: string | null;
            left_slot: string | null;
            right_slot: string | null;
            left_timeout_ms: number | null;
            right_timeout_ms: number | null;
            circuit_breaker_enabled: number | null;
            show_hemispheres: number | null;
        } | undefined;

        if (!row) return null;

        return {
            enabled: row.enabled === 1,
            leftProviderId: row.left_provider_id,
            leftModel: row.left_model,
            rightProviderId: row.right_provider_id,
            rightModel: row.right_model,
            leftSlot: row.left_slot ?? null,
            rightSlot: row.right_slot ?? null,
            leftTimeoutMs: row.left_timeout_ms ?? null,
            rightTimeoutMs: row.right_timeout_ms ?? null,
            circuitBreakerEnabled: row.circuit_breaker_enabled !== 0,
            showHemispheres: row.show_hemispheres === 1,
        };
    }

    saveSRConfig(
        sessionId: string,
        enabled: boolean,
        leftProviderId: string | null,
        leftModel: string | null,
        rightProviderId: string | null,
        rightModel: string | null,
        opts?: {
            leftSlot?: string | null;
            rightSlot?: string | null;
            leftTimeoutMs?: number | null;
            rightTimeoutMs?: number | null;
            circuitBreakerEnabled?: boolean;
            showHemispheres?: boolean;
        },
    ): void {
        this.assertSessionExists(sessionId);
        const updatedAt = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO sr_config (session_id, enabled, left_provider_id, left_model, right_provider_id, right_model,
                left_slot, right_slot, left_timeout_ms, right_timeout_ms, circuit_breaker_enabled, show_hemispheres, updated_at)
            VALUES (:sessionId, :enabled, :leftProviderId, :leftModel, :rightProviderId, :rightModel,
                :leftSlot, :rightSlot, :leftTimeoutMs, :rightTimeoutMs, :circuitBreakerEnabled, :showHemispheres, :updatedAt)
            ON CONFLICT(session_id) DO UPDATE SET
                enabled = excluded.enabled,
                left_provider_id = excluded.left_provider_id,
                left_model = excluded.left_model,
                right_provider_id = excluded.right_provider_id,
                right_model = excluded.right_model,
                left_slot = excluded.left_slot,
                right_slot = excluded.right_slot,
                left_timeout_ms = excluded.left_timeout_ms,
                right_timeout_ms = excluded.right_timeout_ms,
                circuit_breaker_enabled = excluded.circuit_breaker_enabled,
                show_hemispheres = excluded.show_hemispheres,
                updated_at = excluded.updated_at
        `).run({
            sessionId,
            enabled: enabled ? 1 : 0,
            leftProviderId: leftProviderId?.trim() || null,
            leftModel: leftModel?.trim() || null,
            rightProviderId: rightProviderId?.trim() || null,
            rightModel: rightModel?.trim() || null,
            leftSlot: opts?.leftSlot ?? null,
            rightSlot: opts?.rightSlot ?? null,
            leftTimeoutMs: opts?.leftTimeoutMs ?? null,
            rightTimeoutMs: opts?.rightTimeoutMs ?? null,
            circuitBreakerEnabled: opts?.circuitBreakerEnabled !== false ? 1 : 0,
            showHemispheres: opts?.showHemispheres ? 1 : 0,
            updatedAt,
        });
    }

    deleteSRConfig(sessionId: string): void {
        this.db.prepare(`
            DELETE FROM sr_config WHERE session_id = :sessionId
        `).run({ sessionId });
    }

    // ── SR Presets (named saved configurations) ─────────────────────────

    listSRPresets(scope: "global" | "session", scopeId?: string): Array<{
        id: string; name: string; scope: string; scopeId: string | null;
        leftProviderId: string | null; leftModel: string | null;
        rightProviderId: string | null; rightModel: string | null;
        createdAt: string; updatedAt: string;
    }> {
        const rows = scope === "global"
            ? this.db.prepare(`SELECT * FROM sr_presets WHERE scope = 'global' ORDER BY updated_at DESC`).all() as any[]
            : this.db.prepare(`SELECT * FROM sr_presets WHERE scope = 'session' AND scope_id = :scopeId ORDER BY updated_at DESC`).all({ scopeId: scopeId ?? "" }) as any[];
        return rows.map(r => ({
            id: r.id,
            name: r.name,
            scope: r.scope,
            scopeId: r.scope_id,
            leftProviderId: r.left_provider_id,
            leftModel: r.left_model,
            rightProviderId: r.right_provider_id,
            rightModel: r.right_model,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        }));
    }

    saveSRPreset(
        id: string,
        name: string,
        scope: "global" | "session",
        scopeId: string | null,
        leftProviderId: string | null,
        leftModel: string | null,
        rightProviderId: string | null,
        rightModel: string | null,
    ): void {
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO sr_presets (id, name, scope, scope_id, left_provider_id, left_model, right_provider_id, right_model, created_at, updated_at)
            VALUES (:id, :name, :scope, :scopeId, :leftProviderId, :leftModel, :rightProviderId, :rightModel, :now, :now)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                left_provider_id = excluded.left_provider_id,
                left_model = excluded.left_model,
                right_provider_id = excluded.right_provider_id,
                right_model = excluded.right_model,
                updated_at = excluded.updated_at
        `).run({
            id,
            name: name.trim().slice(0, 80),
            scope,
            scopeId: scopeId ?? null,
            leftProviderId: leftProviderId?.trim() || null,
            leftModel: leftModel?.trim() || null,
            rightProviderId: rightProviderId?.trim() || null,
            rightModel: rightModel?.trim() || null,
            now,
        });
    }

    deleteSRPreset(id: string): boolean {
        const result = this.db.prepare(`DELETE FROM sr_presets WHERE id = :id`).run({ id });
        return (result as any).changes > 0;
    }

    getSRPreset(id: string): {
        id: string; name: string; scope: string; scopeId: string | null;
        leftProviderId: string | null; leftModel: string | null;
        rightProviderId: string | null; rightModel: string | null;
    } | null {
        const row = this.db.prepare(`SELECT * FROM sr_presets WHERE id = :id`).get({ id }) as any;
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            scope: row.scope,
            scopeId: row.scope_id,
            leftProviderId: row.left_provider_id,
            leftModel: row.left_model,
            rightProviderId: row.right_provider_id,
            rightModel: row.right_model,
        };
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

function safeJsonParse(raw: string): Record<string, any> {
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}