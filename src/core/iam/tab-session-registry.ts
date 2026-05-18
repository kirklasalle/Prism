/**
 * PRISM Tab Session Registry — Phase A1 (Autonomous Foundation)
 *
 * Manages per-tab session lifecycle for the Prism dashboard. Every tab gets
 * a dedicated session at initialization with:
 *
 *   - Unique session ID linked to operator identity
 *   - Event counter for activity tracking
 *   - Status lifecycle (active → idle → terminated)
 *   - Persistence to workspace state for cross-restart recovery
 *   - Full audit trail via ActivityBus
 *
 * All 14 dashboard tabs are registered:
 *   chat, agentic, browser, computer, watch, logs, telemetry,
 *   settings, network, workspace, scheduler, tools, characters, approval-queue
 *
 * Design constraints:
 *   - Each tab session is uniquely identified and traceable.
 *   - All actions from a tab include the tab session ID.
 *   - The registry is serializable for persistence across restarts.
 *   - Event counts are used by telemetry and Guardian for anomaly detection.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActivityBus } from "../activity/bus.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type TabId =
  | "chat"
  | "agentic"
  | "browser"
  | "computer"
  | "watch"
  | "logs"
  | "telemetry"
  | "settings"
  | "network"
  | "workspace"
  | "scheduler"
  | "tools"
  | "characters"
  | "approval-queue";

export type TabSessionStatus = "active" | "idle" | "terminated";

export interface TabSession {
  /** Unique session ID for this tab instance. */
  tabSessionId: string;
  /** Tab identifier. */
  tabId: TabId;
  /** Operator who owns this session. */
  operatorId: string;
  /** Runtime session this tab belongs to. */
  runtimeSessionId: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last activity timestamp. */
  lastActiveAt: string;
  /** Total events recorded in this tab session. */
  eventCount: number;
  /** Current session status. */
  status: TabSessionStatus;
}

export interface TabSessionSnapshot {
  sessions: TabSession[];
  persistedAt: string;
  runtimeSessionId: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const ALL_TAB_IDS: readonly TabId[] = [
  "chat",
  "agentic",
  "browser",
  "computer",
  "watch",
  "logs",
  "telemetry",
  "settings",
  "network",
  "workspace",
  "scheduler",
  "tools",
  "characters",
  "approval-queue",
] as const;

const STATE_FILENAME = "tab-sessions.json";
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes idle → status changes to idle

// ── Tab Display Names ────────────────────────────────────────────────────────

const TAB_DISPLAY_NAMES: Record<TabId, string> = {
  "chat": "Chat",
  "agentic": "Agentic Control",
  "browser": "Browser Control",
  "computer": "Computer Control",
  "watch": "Watch Me",
  "logs": "Logs & Debug",
  "telemetry": "Telemetry",
  "settings": "Provider & Settings",
  "network": "Network & A2A",
  "workspace": "Workspace",
  "scheduler": "Scheduler",
  "tools": "Tools & Contracts",
  "characters": "Characters",
  "approval-queue": "Approval Queue",
};

// ── Registry ─────────────────────────────────────────────────────────────────

export class TabSessionRegistry {
  private sessions = new Map<TabId, TabSession>();
  private readonly stateDir: string;
  private readonly runtimeSessionId: string;
  private readonly operatorId: string;
  private readonly activityBus: ActivityBus | undefined;

  constructor(
    workspaceStateDir: string,
    runtimeSessionId: string,
    operatorId: string,
    activityBus?: ActivityBus,
  ) {
    this.stateDir = workspaceStateDir;
    this.runtimeSessionId = runtimeSessionId;
    this.operatorId = operatorId;
    this.activityBus = activityBus;
  }

  /**
   * Initialize sessions for all tabs. Creates new sessions for each tab
   * and emits audit events. Idempotent — safe to call multiple times.
   */
  initializeAll(): TabSession[] {
    const now = new Date().toISOString();
    const created: TabSession[] = [];

    for (const tabId of ALL_TAB_IDS) {
      if (this.sessions.has(tabId)) continue;

      const session: TabSession = {
        tabSessionId: `tab-${tabId}-${randomUUID().slice(0, 8)}`,
        tabId,
        operatorId: this.operatorId,
        runtimeSessionId: this.runtimeSessionId,
        createdAt: now,
        lastActiveAt: now,
        eventCount: 0,
        status: "active",
      };

      this.sessions.set(tabId, session);
      created.push(session);

      this.emitEvent("tab.session.created", "succeeded", {
        tabSessionId: session.tabSessionId,
        tabId,
        tabDisplayName: TAB_DISPLAY_NAMES[tabId],
        operatorId: this.operatorId,
      });
    }

    // Persist after initializing all
    this.persist();

    return created;
  }

  /**
   * Get or create a session for a specific tab.
   */
  getOrCreate(tabId: TabId): TabSession {
    const existing = this.sessions.get(tabId);
    if (existing) {
      // Reactivate if idle
      if (existing.status === "idle") {
        existing.status = "active";
        existing.lastActiveAt = new Date().toISOString();
        this.emitEvent("tab.session.reactivated", "succeeded", {
          tabSessionId: existing.tabSessionId,
          tabId,
        });
      }
      return existing;
    }

    const now = new Date().toISOString();
    const session: TabSession = {
      tabSessionId: `tab-${tabId}-${randomUUID().slice(0, 8)}`,
      tabId,
      operatorId: this.operatorId,
      runtimeSessionId: this.runtimeSessionId,
      createdAt: now,
      lastActiveAt: now,
      eventCount: 0,
      status: "active",
    };

    this.sessions.set(tabId, session);
    this.emitEvent("tab.session.created", "succeeded", {
      tabSessionId: session.tabSessionId,
      tabId,
      tabDisplayName: TAB_DISPLAY_NAMES[tabId],
      operatorId: this.operatorId,
    });

    return session;
  }

  /**
   * Record an event for a tab, incrementing its counter and updating
   * lastActiveAt. Returns the updated session.
   */
  recordEvent(tabId: TabId): TabSession | null {
    const session = this.sessions.get(tabId);
    if (!session || session.status === "terminated") return null;

    session.eventCount++;
    session.lastActiveAt = new Date().toISOString();
    if (session.status === "idle") {
      session.status = "active";
    }

    return session;
  }

  /** Get a session by tab ID. */
  get(tabId: TabId): TabSession | null {
    return this.sessions.get(tabId) ?? null;
  }

  /** Get a session by its unique session ID. */
  getBySessionId(tabSessionId: string): TabSession | null {
    for (const session of this.sessions.values()) {
      if (session.tabSessionId === tabSessionId) return session;
    }
    return null;
  }

  /** List all tab sessions. */
  listAll(): TabSession[] {
    return Array.from(this.sessions.values());
  }

  /** List all active tab sessions. */
  listActive(): TabSession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.status === "active",
    );
  }

  /**
   * Get a summary of all tab sessions suitable for the Logs & Debug tab.
   */
  getSummary(): Array<{
    tabId: TabId;
    tabDisplayName: string;
    tabSessionId: string;
    status: TabSessionStatus;
    eventCount: number;
    lastActiveAt: string;
  }> {
    return ALL_TAB_IDS.map(tabId => {
      const session = this.sessions.get(tabId);
      return {
        tabId,
        tabDisplayName: TAB_DISPLAY_NAMES[tabId],
        tabSessionId: session?.tabSessionId ?? "(not initialized)",
        status: session?.status ?? "terminated",
        eventCount: session?.eventCount ?? 0,
        lastActiveAt: session?.lastActiveAt ?? "",
      };
    });
  }

  /** Mark a tab session as idle. */
  markIdle(tabId: TabId): void {
    const session = this.sessions.get(tabId);
    if (!session || session.status === "terminated") return;
    session.status = "idle";
    this.emitEvent("tab.session.idle", "succeeded", {
      tabSessionId: session.tabSessionId,
      tabId,
      eventCount: session.eventCount,
    });
  }

  /** Terminate a tab session. */
  terminate(tabId: TabId): void {
    const session = this.sessions.get(tabId);
    if (!session || session.status === "terminated") return;
    session.status = "terminated";
    this.emitEvent("tab.session.terminated", "succeeded", {
      tabSessionId: session.tabSessionId,
      tabId,
      eventCount: session.eventCount,
    });
  }

  /** Terminate all tab sessions. Used during shutdown. */
  terminateAll(): void {
    for (const tabId of ALL_TAB_IDS) {
      this.terminate(tabId);
    }
    this.persist();
  }

  /**
   * Run idle detection: tabs with no activity for > IDLE_THRESHOLD_MS
   * are marked idle automatically.
   */
  detectIdle(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.status !== "active") continue;
      const lastActive = Date.parse(session.lastActiveAt);
      if (Number.isFinite(lastActive) && now - lastActive > IDLE_THRESHOLD_MS) {
        this.markIdle(session.tabId);
      }
    }
  }

  /** Persist all tab sessions to workspace state. */
  persist(): void {
    try {
      if (!existsSync(this.stateDir)) {
        mkdirSync(this.stateDir, { recursive: true });
      }
      const snapshot: TabSessionSnapshot = {
        sessions: Array.from(this.sessions.values()),
        persistedAt: new Date().toISOString(),
        runtimeSessionId: this.runtimeSessionId,
      };
      writeFileSync(
        join(this.stateDir, STATE_FILENAME),
        JSON.stringify(snapshot, null, 2) + "\n",
        { encoding: "utf-8" },
      );
    } catch {
      // Best-effort persistence
    }
  }

  /** Emit an activity event for tab session lifecycle tracking. */
  private emitEvent(
    operation: string,
    status: "succeeded" | "failed",
    details: Record<string, unknown>,
  ): void {
    if (!this.activityBus) return;
    this.activityBus.emit({
      sessionId: this.runtimeSessionId,
      layer: "governance",
      operation,
      status,
      details: { ...details, source: "tab-session-registry" },
      operatorId: this.operatorId,
    });
  }
}
