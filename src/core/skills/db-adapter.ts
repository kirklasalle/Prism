import { DatabaseSync } from "node:sqlite";
import { SkillSession, SkillSessionStatus } from "./types.js";

export class SkillsDbAdapter {
  private readonly db: DatabaseSync;

  constructor(dbPath: string = "prism-activity.db") {
    this.db = new DatabaseSync(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prism_skill_sessions (
        session_id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        current_step TEXT NOT NULL,
        state_payload TEXT NOT NULL,
        parent_chat_session TEXT,
        step_history TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_prism_skill_sessions_skill
      ON prism_skill_sessions (skill_id);

      CREATE INDEX IF NOT EXISTS idx_prism_skill_sessions_chat
      ON prism_skill_sessions (parent_chat_session);
    `);
  }

  public saveSession(session: SkillSession): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO prism_skill_sessions (
        session_id, skill_id, current_step, state_payload,
        parent_chat_session, step_history, status, created_at, updated_at
      ) VALUES (
        :sessionId, :skillId, :currentStep, :statePayload,
        :parentChatSession, :stepHistory, :status, :createdAt, :updatedAt
      )
    `).run({
      sessionId: session.sessionId,
      skillId: session.skillId,
      currentStep: session.currentStep,
      statePayload: JSON.stringify(session.statePayload),
      parentChatSession: session.parentChatSession,
      stepHistory: JSON.stringify(session.stepHistory),
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    });
  }

  public getSession(sessionId: string): SkillSession | null {
    const row = this.db.prepare(`
      SELECT * FROM prism_skill_sessions WHERE session_id = :sessionId
    `).get({ sessionId }) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.toSession(row);
  }

  public listSessions(): SkillSession[] {
    const rows = this.db.prepare(`
      SELECT * FROM prism_skill_sessions ORDER BY updated_at DESC
    `).all() as Record<string, unknown>[];

    return rows.map(row => this.toSession(row));
  }

  public deleteSession(sessionId: string): void {
    this.db.prepare(`
      DELETE FROM prism_skill_sessions WHERE session_id = :sessionId
    `).run({ sessionId });
  }

  public close(): void {
    this.db.close();
  }

  private toSession(row: Record<string, unknown>): SkillSession {
    let statePayload: Record<string, any> = {};
    try {
      if (row.state_payload) {
        statePayload = JSON.parse(String(row.state_payload));
      }
    } catch {
      statePayload = {};
    }

    let stepHistory: any[] = [];
    try {
      if (row.step_history) {
        stepHistory = JSON.parse(String(row.step_history));
      }
    } catch {
      stepHistory = [];
    }

    return {
      sessionId: String(row.session_id),
      skillId: String(row.skill_id),
      currentStep: String(row.current_step),
      statePayload,
      parentChatSession: row.parent_chat_session != null ? String(row.parent_chat_session) : null,
      stepHistory,
      status: String(row.status) as SkillSessionStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}
