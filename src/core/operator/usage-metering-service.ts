/**
 * Usage Metering Service
 *
 * Persists per-call usage records (tokens + USD cost) to SQLite and provides
 * query methods for the dashboard REST API. Also manages user-defined cost caps
 * and the soft-block check that gates new LLM requests.
 */

import { DatabaseSync } from "node:sqlite";
import { lookupPricing } from "./usage-pricing-catalog.js";

export interface UsageRecord {
  provider: string;
  model: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageSummaryRow {
  provider: string;
  model: string;
  label: string;
  tier: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  inputPer1M: number;
  outputPer1M: number;
}

export interface UsageSummary {
  window: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byModel: UsageSummaryRow[];
  caps: UsageCaps;
  sessionCostUsd: number;         // spend in current session (all time since last reset)
  dailyCostUsd: number;           // spend in last 24 h
  monthlyCostUsd: number;         // spend in last 30 days
}

export type UsageWindow = "1h" | "1d" | "7d" | "30d";

export interface UsageCaps {
  sessionCap: number | null;   // USD; null = disabled
  dailyCap: number | null;
  monthlyCap: number | null;
}

export interface CapCheckResult {
  allowed: boolean;
  remainingUsd: number | null;
  capType: "session" | "daily" | "monthly" | null;
}

const WINDOW_MS: Record<UsageWindow, number> = {
  "1h":  1 * 60 * 60 * 1000,
  "1d":  24 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export class UsageMeteringService {
  private readonly db: DatabaseSync;
  private readonly sessionStartMs: number;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.sessionStartMs = Date.now();
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          INTEGER NOT NULL,
        provider    TEXT NOT NULL,
        model       TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        input_tok   INTEGER NOT NULL DEFAULT 0,
        output_tok  INTEGER NOT NULL DEFAULT 0,
        cost_usd    REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_records(ts);
      CREATE TABLE IF NOT EXISTS usage_caps (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /** Record a single LLM call. */
  record(rec: UsageRecord): void {
    try {
      this.db.prepare(
        `INSERT INTO usage_records (ts, provider, model, session_id, input_tok, output_tok, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        Date.now(),
        rec.provider,
        rec.model,
        rec.sessionId,
        rec.inputTokens,
        rec.outputTokens,
        rec.costUsd,
      );
    } catch {
      // Non-fatal — telemetry must never crash the main flow
    }
  }

  /** Aggregate usage for the given window. */
  getSummary(window: UsageWindow = "1d"): UsageSummary {
    const windowMs = WINDOW_MS[window] ?? WINDOW_MS["1d"];
    const since = Date.now() - windowMs;

    const rows = this.db.prepare(
      `SELECT provider, model,
              COUNT(*) AS requests,
              SUM(input_tok) AS input_tok,
              SUM(output_tok) AS output_tok,
              SUM(cost_usd) AS cost_usd
       FROM usage_records
       WHERE ts >= ?
       GROUP BY provider, model
       ORDER BY cost_usd DESC`,
    ).all(since) as Array<{
      provider: string; model: string;
      requests: number; input_tok: number; output_tok: number; cost_usd: number;
    }>;

    let totalRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;

    const byModel: UsageSummaryRow[] = rows.map((r) => {
      totalRequests += r.requests;
      totalInputTokens += r.input_tok;
      totalOutputTokens += r.output_tok;
      totalCostUsd += r.cost_usd;

      const pricing = lookupPricing(r.provider, r.model);
      return {
        provider: r.provider,
        model: r.model,
        label: pricing?.label ?? r.model,
        tier: pricing?.tier ?? 0,
        requests: r.requests,
        inputTokens: r.input_tok,
        outputTokens: r.output_tok,
        totalCostUsd: r.cost_usd,
        inputPer1M: pricing?.inputPer1M ?? 0,
        outputPer1M: pricing?.outputPer1M ?? 0,
      };
    });

    // Session + rolling window spends for cap display
    const sessionCostUsd = this.sumCostSince(this.sessionStartMs);
    const dailyCostUsd   = this.sumCostSince(Date.now() - WINDOW_MS["1d"]);
    const monthlyCostUsd = this.sumCostSince(Date.now() - WINDOW_MS["30d"]);

    return {
      window,
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
      byModel,
      caps: this.getCaps(),
      sessionCostUsd,
      dailyCostUsd,
      monthlyCostUsd,
    };
  }

  private sumCostSince(sinceMs: number): number {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_records WHERE ts >= ?`,
    ).get(sinceMs) as { total: number };
    return row?.total ?? 0;
  }

  getCaps(): UsageCaps {
    const rows = this.db.prepare(
      `SELECT key, value FROM usage_caps WHERE key IN ('sessionCap','dailyCap','monthlyCap')`,
    ).all() as Array<{ key: string; value: string }>;

    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    const parse = (k: string): number | null => {
      const v = map[k];
      if (v === undefined || v === "null" || v === "") return null;
      const n = parseFloat(v);
      return isFinite(n) && n > 0 ? n : null;
    };

    return {
      sessionCap: parse("sessionCap"),
      dailyCap:   parse("dailyCap"),
      monthlyCap: parse("monthlyCap"),
    };
  }

  setCaps(caps: UsageCaps): void {
    const upsert = this.db.prepare(
      `INSERT INTO usage_caps (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    );
    upsert.run("sessionCap", caps.sessionCap === null ? "null" : String(caps.sessionCap));
    upsert.run("dailyCap",   caps.dailyCap   === null ? "null" : String(caps.dailyCap));
    upsert.run("monthlyCap", caps.monthlyCap === null ? "null" : String(caps.monthlyCap));
  }

  /**
   * Check whether accumulated spend has exceeded any cap.
   * Returns `allowed: false` if any cap is breached, along with how many USD
   * over budget and which cap type triggered it.
   */
  checkCap(): CapCheckResult {
    const caps = this.getCaps();

    const sessionSpend  = this.sumCostSince(this.sessionStartMs);
    const dailySpend    = this.sumCostSince(Date.now() - WINDOW_MS["1d"]);
    const monthlySpend  = this.sumCostSince(Date.now() - WINDOW_MS["30d"]);

    if (caps.sessionCap !== null && sessionSpend >= caps.sessionCap) {
      return { allowed: false, remainingUsd: caps.sessionCap - sessionSpend, capType: "session" };
    }
    if (caps.dailyCap !== null && dailySpend >= caps.dailyCap) {
      return { allowed: false, remainingUsd: caps.dailyCap - dailySpend, capType: "daily" };
    }
    if (caps.monthlyCap !== null && monthlySpend >= caps.monthlyCap) {
      return { allowed: false, remainingUsd: caps.monthlyCap - monthlySpend, capType: "monthly" };
    }

    // Return remaining headroom from the tightest active cap
    const candidates: { remaining: number; capType: "session" | "daily" | "monthly" }[] = [];
    if (caps.sessionCap !== null)  candidates.push({ remaining: caps.sessionCap - sessionSpend,  capType: "session" });
    if (caps.dailyCap !== null)    candidates.push({ remaining: caps.dailyCap   - dailySpend,    capType: "daily" });
    if (caps.monthlyCap !== null)  candidates.push({ remaining: caps.monthlyCap - monthlySpend,  capType: "monthly" });

    if (candidates.length === 0) return { allowed: true, remainingUsd: null, capType: null };
    candidates.sort((a, b) => a.remaining - b.remaining);
    return { allowed: true, remainingUsd: candidates[0].remaining, capType: candidates[0].capType };
  }
}
