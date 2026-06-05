import { DatabaseSync } from "node:sqlite";
import type { BrowserAgentGoalState } from "./autonomous-browser-agent.js";

export class AgentCheckpointStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string = "prism-activity.db") {
    this.db = new DatabaseSync(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        session_id TEXT PRIMARY KEY,
        goal_state_json TEXT NOT NULL,
        conversation_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  saveCheckpoint(sessionId: string, goalState: BrowserAgentGoalState, conversation: any[]): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agent_checkpoints (session_id, goal_state_json, conversation_json, updated_at)
      VALUES (:sessionId, :goalStateJson, :conversationJson, :updatedAt)
      ON CONFLICT(session_id) DO UPDATE SET
        goal_state_json = excluded.goal_state_json,
        conversation_json = excluded.conversation_json,
        updated_at = excluded.updated_at
    `).run({
      sessionId,
      goalStateJson: JSON.stringify(goalState),
      conversationJson: JSON.stringify(conversation),
      updatedAt: now
    });
  }

  getCheckpoint(sessionId: string): { goalState: BrowserAgentGoalState; conversation: any[] } | null {
    try {
      const row = this.db.prepare(`
        SELECT goal_state_json, conversation_json
        FROM agent_checkpoints
        WHERE session_id = :sessionId
      `).get({ sessionId }) as { goal_state_json: string; conversation_json: string } | undefined;

      if (!row) return null;
      return {
        goalState: JSON.parse(row.goal_state_json),
        conversation: JSON.parse(row.conversation_json)
      };
    } catch {
      return null;
    }
  }

  deleteCheckpoint(sessionId: string): void {
    this.db.prepare(`
      DELETE FROM agent_checkpoints
      WHERE session_id = :sessionId
    `).run({ sessionId });
  }
}
