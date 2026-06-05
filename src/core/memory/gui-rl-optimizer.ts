import { DatabaseSync } from "node:sqlite";

export interface GuiActionOutcome {
  id?: number;
  sessionId: string;
  objective: string;
  actionType: string;
  targetSelector: string;
  success: boolean;
  reward: number;
  errorMessage?: string;
  timestamp: string;
}

export class GuiRlOptimizer {
  private db!: DatabaseSync;
  private dbPath: string;

  constructor(dbPath: string = "prism-gui-rl.db") {
    this.dbPath = dbPath;
    this.initDb();
  }

  private initDb(): void {
    try {
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS gui_rl_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          objective TEXT NOT NULL,
          action_type TEXT NOT NULL,
          target_selector TEXT NOT NULL,
          success INTEGER NOT NULL,
          reward REAL NOT NULL,
          error_message TEXT,
          timestamp TEXT NOT NULL
        );
      `);
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_gui_rl_selector ON gui_rl_ledger(target_selector);
      `);
    } catch (err) {
      // Fallback to in-memory db if file locks or permission issues occur
      this.dbPath = ":memory:";
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS gui_rl_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          objective TEXT NOT NULL,
          action_type TEXT NOT NULL,
          target_selector TEXT NOT NULL,
          success INTEGER NOT NULL,
          reward REAL NOT NULL,
          error_message TEXT,
          timestamp TEXT NOT NULL
        );
      `);
    }
  }

  /**
   * Record the outcome of a GUI action execution to compute rewards and update policy.
   * Reward structure:
   *   - Success = +1.0 reward
   *   - Failure = -1.0 reward
   */
  recordActionOutcome(
    sessionId: string,
    objective: string,
    actionType: string,
    targetSelector: string,
    success: boolean,
    errorMessage?: string
  ): void {
    const reward = success ? 1.0 : -1.0;
    try {
      const stmt = this.db.prepare(`
        INSERT INTO gui_rl_ledger (session_id, objective, action_type, target_selector, success, reward, error_message, timestamp)
        VALUES (:sessionId, :objective, :actionType, :targetSelector, :success, :reward, :errorMessage, :timestamp)
      `);
      stmt.run({
        sessionId,
        objective,
        actionType,
        targetSelector: targetSelector || "",
        success: success ? 1 : 0,
        reward,
        errorMessage: errorMessage ?? null,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Ignore database write failures gracefully in production agent runs
    }
  }

  /**
   * Retrieve reinforcement learning advice for the proposed action/selector.
   * If this selector has repeated failures, suggests alternative strategies or warns the model.
   */
  getPolicyAdvice(targetSelector: string): string | null {
    if (!targetSelector || targetSelector.trim() === "") {
      return null;
    }

    try {
      const stmt = this.db.prepare(`
        SELECT success, reward, error_message
        FROM gui_rl_ledger
        WHERE target_selector = :targetSelector
        ORDER BY timestamp DESC
        LIMIT 5
      `);
      const trials = stmt.all({ targetSelector }) as Array<{
        success: number;
        reward: number;
        error_message: string | null;
      }>;

      if (trials.length === 0) {
        return null;
      }

      const failures = trials.filter((t) => t.success === 0);
      const successes = trials.filter((t) => t.success === 1);

      if (failures.length > 0 && successes.length === 0) {
        const lastError = failures[0].error_message ?? "unknown error";
        return `[GUI RL POLICY WARNING] The target selector "${targetSelector}" has failed consistently in past trials (Error: "${lastError}"). Avoid this selector and attempt to use alternative DOM-level selectors or coordinates.`;
      }

      if (failures.length > successes.length) {
        return `[GUI RL POLICY ADVICE] Selector "${targetSelector}" has a high failure rate in past executions. Exercise caution or try visual anchor mapping.`;
      }

      if (successes.length > 0 && failures.length === 0) {
        return `[GUI RL POLICY CONFIDENCE] Selector "${targetSelector}" has succeeded consistently in past runs. High probability of success.`;
      }
    } catch {
      // Ignore database errors
    }

    return null;
  }

  close(): void {
    try {
      this.db.close();
    } catch {}
  }
}
