import { DatabaseSync } from "node:sqlite";

export type CharacterAssignmentState = "active" | "suspended" | "revoked";

export interface PermissionScope {
    scope: string;
    expiresAt: string | null; // ISO-8601 or null for never-expires
    maxTier?: "tier1_autonomous" | "tier2_conditional" | "tier3_approval";
    allowedActions?: string[]; // ["inspect", "control"] — omit = all
}

export interface CharacterAssignment {
    assignmentId: string;
    characterId: string;
    prismUserId: string;
    prismUserEmail: string;
    operatorId: string;
    operatorEmail: string;
    clientId: string;
    sessionId: string;
    executionProfileSegment: "individual" | "business";
    workspaceHub: string;
    state: CharacterAssignmentState;
    suspendReason?: string;
    revocationReason?: string;
    dispatchCount: number;
    assignedAt: string;
    updatedAt: string;
    lastActiveAt: string;
    permissionScopes?: PermissionScope[];
    /** Phase E5: ISO-8601 timestamp when the operator email was verified via OAuth. */
    emailVerifiedAt?: string | null;
    /** Phase E5: which OAuth provider verified the email ("gmail" | "outlook" | "mock_oauth"). */
    emailVerifiedProvider?: "gmail" | "outlook" | "mock_oauth" | null;
}

export interface CharacterAssignmentFilter {
    characterId?: string;
    prismUserId?: string;
    prismUserEmail?: string;
    operatorId?: string;
    operatorEmail?: string;
    clientId?: string;
    sessionId?: string;
    executionProfileSegment?: "individual" | "business";
    state?: CharacterAssignmentState;
}

export class CharacterAccountabilityStore {
    private readonly db: DatabaseSync;

    constructor(readonly dbPath: string = "prism-activity.db") {
        this.db = new DatabaseSync(dbPath);
        this.migrate();
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS character_assignments (
                assignment_id TEXT PRIMARY KEY,
                character_id TEXT NOT NULL,
                prism_user_id TEXT NOT NULL,
                prism_user_email TEXT NOT NULL,
                operator_id TEXT NOT NULL,
                operator_email TEXT NOT NULL,
                client_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                execution_profile_segment TEXT NOT NULL DEFAULT 'individual',
                state TEXT NOT NULL,
                suspend_reason TEXT,
                revocation_reason TEXT,
                dispatch_count INTEGER NOT NULL DEFAULT 0,
                assigned_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_active_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_character_assignments_character
            ON character_assignments (character_id);

            CREATE INDEX IF NOT EXISTS idx_character_assignments_operator
            ON character_assignments (operator_id);

            CREATE INDEX IF NOT EXISTS idx_character_assignments_prism_user
            ON character_assignments (prism_user_id);

            CREATE INDEX IF NOT EXISTS idx_character_assignments_prism_email
            ON character_assignments (prism_user_email);

            CREATE INDEX IF NOT EXISTS idx_character_assignments_operator_email
            ON character_assignments (operator_email);

            CREATE INDEX IF NOT EXISTS idx_character_assignments_client
            ON character_assignments (client_id);

            CREATE INDEX IF NOT EXISTS idx_character_assignments_session
            ON character_assignments (session_id);

            CREATE INDEX IF NOT EXISTS idx_character_assignments_state
            ON character_assignments (state);
        `);

        this.ensureColumn("character_assignments", "prism_user_id", "TEXT");
        this.ensureColumn("character_assignments", "prism_user_email", "TEXT");
        this.ensureColumn("character_assignments", "operator_email", "TEXT");
        this.ensureColumn("character_assignments", "execution_profile_segment", "TEXT DEFAULT 'individual'");
        this.ensureColumn("character_assignments", "workspace_hub", "TEXT DEFAULT ''");
        this.ensureColumn("character_assignments", "permission_scopes", "TEXT DEFAULT '[]'");
        this.ensureColumn("character_assignments", "email_verified_at", "TEXT");
        this.ensureColumn("character_assignments", "email_verified_provider", "TEXT");
    }

    private ensureColumn(table: string, column: string, definition: string): void {
        const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (rows.some((row) => row.name === column)) {
            return;
        }

        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }

    save(assignment: CharacterAssignment): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO character_assignments (
                assignment_id, character_id, prism_user_id, prism_user_email,
                operator_id, operator_email, client_id, session_id, execution_profile_segment, workspace_hub, state,
                suspend_reason, revocation_reason, dispatch_count,
                assigned_at, updated_at, last_active_at, permission_scopes,
                email_verified_at, email_verified_provider
            ) VALUES (
                :assignmentId, :characterId, :prismUserId, :prismUserEmail,
                :operatorId, :operatorEmail, :clientId, :sessionId, :executionProfileSegment, :workspaceHub, :state,
                :suspendReason, :revocationReason, :dispatchCount,
                :assignedAt, :updatedAt, :lastActiveAt, :permissionScopes,
                :emailVerifiedAt, :emailVerifiedProvider
            )
        `).run({
            assignmentId: assignment.assignmentId,
            characterId: assignment.characterId,
            prismUserId: assignment.prismUserId,
            prismUserEmail: assignment.prismUserEmail,
            operatorId: assignment.operatorId,
            operatorEmail: assignment.operatorEmail,
            clientId: assignment.clientId,
            sessionId: assignment.sessionId,
            executionProfileSegment: assignment.executionProfileSegment,
            workspaceHub: assignment.workspaceHub ?? "",
            state: assignment.state,
            suspendReason: assignment.suspendReason ?? null,
            revocationReason: assignment.revocationReason ?? null,
            dispatchCount: assignment.dispatchCount,
            assignedAt: assignment.assignedAt,
            updatedAt: assignment.updatedAt,
            lastActiveAt: assignment.lastActiveAt,
            permissionScopes: JSON.stringify(assignment.permissionScopes ?? []),
            emailVerifiedAt: assignment.emailVerifiedAt ?? null,
            emailVerifiedProvider: assignment.emailVerifiedProvider ?? null,
        });
    }

    get(assignmentId: string): CharacterAssignment | null {
        const row = this.db.prepare(`
            SELECT * FROM character_assignments WHERE assignment_id = :assignmentId
        `).get({ assignmentId }) as Record<string, unknown> | undefined;

        if (!row) {
            return null;
        }

        return this.toAssignment(row);
    }

    delete(assignmentId: string): void {
        this.db.prepare(`
            DELETE FROM character_assignments WHERE assignment_id = :assignmentId
        `).run({ assignmentId });
    }

    list(filter: CharacterAssignmentFilter = {}): CharacterAssignment[] {
        const conditions: string[] = [];
        const params: Record<string, string> = {};

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
        if (filter.sessionId) {
            conditions.push("session_id = :sessionId");
            params.sessionId = filter.sessionId;
        }
        if (filter.executionProfileSegment) {
            conditions.push("execution_profile_segment = :executionProfileSegment");
            params.executionProfileSegment = filter.executionProfileSegment;
        }
        if (filter.state) {
            conditions.push("state = :state");
            params.state = filter.state;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = this.db.prepare(`
            SELECT * FROM character_assignments
            ${where}
            ORDER BY updated_at DESC, assignment_id ASC
        `).all(params) as Record<string, unknown>[];

        return rows.map((row) => this.toAssignment(row));
    }

    close(): void {
        this.db.close();
    }

    private toAssignment(row: Record<string, unknown>): CharacterAssignment {
        let permissionScopes: PermissionScope[] = [];
        try {
            if (row.permission_scopes) {
                permissionScopes = JSON.parse(String(row.permission_scopes)) as PermissionScope[];
            }
        } catch {
            permissionScopes = [];
        }
        return {
            assignmentId: String(row.assignment_id),
            characterId: String(row.character_id),
            prismUserId: String(row.prism_user_id),
            prismUserEmail: String(row.prism_user_email),
            operatorId: String(row.operator_id),
            operatorEmail: String(row.operator_email),
            clientId: String(row.client_id),
            sessionId: String(row.session_id),
            executionProfileSegment: String(row.execution_profile_segment) as "individual" | "business",
            workspaceHub: row.workspace_hub != null ? String(row.workspace_hub) : "",
            state: String(row.state) as CharacterAssignmentState,
            suspendReason: row.suspend_reason != null ? String(row.suspend_reason) : undefined,
            revocationReason: row.revocation_reason != null ? String(row.revocation_reason) : undefined,
            dispatchCount: Number(row.dispatch_count ?? 0),
            assignedAt: String(row.assigned_at),
            updatedAt: String(row.updated_at),
            lastActiveAt: String(row.last_active_at),
            permissionScopes,
            emailVerifiedAt: row.email_verified_at != null ? String(row.email_verified_at) : null,
            emailVerifiedProvider: row.email_verified_provider != null
                ? (String(row.email_verified_provider) as "gmail" | "outlook" | "mock_oauth")
                : null,
        };
    }
}