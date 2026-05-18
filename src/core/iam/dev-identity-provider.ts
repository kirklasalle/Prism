/**
 * PRISM Dev Identity Provider — Phase A1 (Autonomous Foundation)
 *
 * Creates and manages a persistent development operator identity for use
 * during local development and testing via `start_web.bat`. Provides:
 *
 *   - Deterministic dev operator identity (`prism-dev-operator@localhost`)
 *   - CAC-compatible session tokens for traceability
 *   - Per-tab session initialization records
 *   - Persistence across restarts via workspace state
 *   - Full audit trail via ActivityBus
 *
 * In production this module is NOT used. The enterprise IAM layer
 * (`iam/store.ts` + `iam/rbac.ts`) handles identity for deployed instances.
 *
 * Design constraints:
 *   - Zero external dependencies beyond node built-ins + PRISM core.
 *   - Idempotent: calling `bootstrap()` multiple times is safe.
 *   - All generated identities logged to activity bus for traceability.
 *   - Mock identity data clearly labeled to prevent confusion with real users.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type { ActivityBus } from "../activity/bus.js";
import type { IamPrincipal } from "./rbac.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DevOperatorIdentity {
  /** Stable operator ID, persisted across restarts. */
  operatorId: string;
  /** Dev email address for traceability. */
  email: string;
  /** Human-readable display name. */
  displayName: string;
  /** RBAC role — always "admin" for dev operator. */
  role: "admin";
  /** Runtime session ID (unique per process start). */
  runtimeSessionId: string;
  /** Machine-derived CAC fingerprint for session binding. */
  cacFingerprint: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 expiry (null = never expires for dev). */
  expiresAt: string | null;
  /** Whether this is a mock identity (always true for dev). */
  isMock: true;
  /** Source identifier. */
  source: "dev-identity-provider";
}

export interface PrismAgentIdentity {
  /** Stable agent ID. */
  agentId: string;
  /** Agent display name. */
  displayName: string;
  /** Agent email for accountability chain. */
  email: string;
  /** Agent role in the system. */
  role: "agent";
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** Whether this is a mock identity (always true for dev). */
  isMock: true;
}

export interface DevIdentitySnapshot {
  operator: DevOperatorIdentity;
  agent: PrismAgentIdentity;
  persistedAt: string;
  machineHostname: string;
  nodeVersion: string;
  platform: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEV_OPERATOR_ID = "prism-dev-operator";
const DEV_OPERATOR_EMAIL = "prism-dev-operator@localhost";
const DEV_OPERATOR_DISPLAY = "Prism Dev Operator (Kirk LaSalle)";

const DEV_AGENT_ID = "prism-agent-core";
const DEV_AGENT_EMAIL = "prism-agent@localhost";
const DEV_AGENT_DISPLAY = "Prism Autonomous Agent";

const STATE_FILENAME = "dev-identity.json";

// ── Provider ─────────────────────────────────────────────────────────────────

export class DevIdentityProvider {
  private operator: DevOperatorIdentity | null = null;
  private agent: PrismAgentIdentity | null = null;
  private readonly stateDir: string;
  private readonly activityBus: ActivityBus | undefined;
  private readonly runtimeSessionId: string;

  constructor(
    workspaceStateDir: string,
    runtimeSessionId: string,
    activityBus?: ActivityBus,
  ) {
    this.stateDir = workspaceStateDir;
    this.runtimeSessionId = runtimeSessionId;
    this.activityBus = activityBus;
  }

  /**
   * Bootstrap the dev identity. Loads from persisted state if available,
   * otherwise creates a new identity. Emits audit events for all created
   * sessions. Idempotent — safe to call multiple times.
   */
  bootstrap(): { operator: DevOperatorIdentity; agent: PrismAgentIdentity } {
    if (this.operator && this.agent) {
      return { operator: this.operator, agent: this.agent };
    }

    // Attempt to load persisted identity
    const persisted = this.loadPersistedIdentity();

    if (persisted) {
      // Reuse persisted operator/agent IDs but create a new runtime session
      this.operator = {
        ...persisted.operator,
        runtimeSessionId: this.runtimeSessionId,
        cacFingerprint: this.computeCacFingerprint(),
      };
      this.agent = { ...persisted.agent };

      this.emitEvent("iam.dev.identity.restored", "succeeded", {
        operatorId: this.operator.operatorId,
        email: this.operator.email,
        agentId: this.agent.agentId,
        runtimeSessionId: this.runtimeSessionId,
        restoredFrom: join(this.stateDir, STATE_FILENAME),
      });
    } else {
      // Create fresh identity
      const now = new Date().toISOString();

      this.operator = {
        operatorId: DEV_OPERATOR_ID,
        email: process.env.PRISM_DEV_EMAIL ?? DEV_OPERATOR_EMAIL,
        displayName: DEV_OPERATOR_DISPLAY,
        role: "admin",
        runtimeSessionId: this.runtimeSessionId,
        cacFingerprint: this.computeCacFingerprint(),
        createdAt: now,
        expiresAt: null,
        isMock: true,
        source: "dev-identity-provider",
      };

      this.agent = {
        agentId: DEV_AGENT_ID,
        displayName: DEV_AGENT_DISPLAY,
        email: DEV_AGENT_EMAIL,
        role: "agent",
        createdAt: now,
        isMock: true,
      };

      this.persistIdentity();

      this.emitEvent("iam.dev.identity.created", "succeeded", {
        operatorId: this.operator.operatorId,
        email: this.operator.email,
        agentId: this.agent.agentId,
        runtimeSessionId: this.runtimeSessionId,
        cacFingerprint: this.operator.cacFingerprint,
      });
    }

    return { operator: this.operator, agent: this.agent };
  }

  /** Get the current operator identity, or null if not bootstrapped. */
  getOperator(): DevOperatorIdentity | null {
    return this.operator;
  }

  /** Get the current agent identity, or null if not bootstrapped. */
  getAgent(): PrismAgentIdentity | null {
    return this.agent;
  }

  /**
   * Build an IamPrincipal compatible with the RBAC system from the dev identity.
   * This allows the dev operator to satisfy all `requireRole()` checks.
   */
  toPrincipal(): IamPrincipal {
    const op = this.operator;
    return {
      userId: op?.operatorId ?? DEV_OPERATOR_ID,
      tenantId: "default",
      roles: ["admin"],
      source: "admin_token",
      email: op?.email ?? DEV_OPERATOR_EMAIL,
      attrs: {
        isMock: true,
        source: "dev-identity-provider",
        runtimeSessionId: this.runtimeSessionId,
        cacFingerprint: op?.cacFingerprint ?? "unknown",
      },
    };
  }

  /**
   * Build an AccountabilityChain fragment from the dev identity.
   * Used to populate ActivityEvent fields for full traceability.
   */
  toAccountabilityFields(): Record<string, string> {
    const op = this.operator;
    const ag = this.agent;
    return {
      operatorId: op?.operatorId ?? DEV_OPERATOR_ID,
      operatorEmail: op?.email ?? DEV_OPERATOR_EMAIL,
      prismUserId: op?.operatorId ?? DEV_OPERATOR_ID,
      prismUserEmail: op?.email ?? DEV_OPERATOR_EMAIL,
      clientId: ag?.agentId ?? DEV_AGENT_ID,
      assignmentId: `dev-session-${this.runtimeSessionId.slice(0, 8)}`,
    };
  }

  /**
   * Compute a CAC fingerprint from machine characteristics.
   * Deterministic per machine + process, but changes across different hosts.
   */
  private computeCacFingerprint(): string {
    const factors = [
      hostname(),
      process.platform,
      process.arch,
      process.env.USERNAME ?? process.env.USER ?? "unknown",
      process.version,
    ].join("|");
    return createHash("sha256").update(factors).digest("hex").slice(0, 32);
  }

  /** Persist identity to workspace state dir. */
  private persistIdentity(): void {
    if (!this.operator || !this.agent) return;
    try {
      if (!existsSync(this.stateDir)) {
        mkdirSync(this.stateDir, { recursive: true });
      }
      const snapshot: DevIdentitySnapshot = {
        operator: this.operator,
        agent: this.agent,
        persistedAt: new Date().toISOString(),
        machineHostname: hostname(),
        nodeVersion: process.version,
        platform: process.platform,
      };
      writeFileSync(
        join(this.stateDir, STATE_FILENAME),
        JSON.stringify(snapshot, null, 2) + "\n",
        { encoding: "utf-8" },
      );
    } catch {
      // Best-effort persistence — failure is non-fatal for dev
    }
  }

  /** Load persisted identity from workspace state dir. */
  private loadPersistedIdentity(): DevIdentitySnapshot | null {
    try {
      const filePath = join(this.stateDir, STATE_FILENAME);
      if (!existsSync(filePath)) return null;
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<DevIdentitySnapshot>;
      if (
        !parsed.operator?.operatorId ||
        !parsed.operator?.email ||
        !parsed.agent?.agentId
      ) {
        return null;
      }
      return parsed as DevIdentitySnapshot;
    } catch {
      return null;
    }
  }

  /** Emit an activity event with dev identity fields. */
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
      details: { ...details, source: "dev-identity-provider" },
      operatorId: this.operator?.operatorId ?? DEV_OPERATOR_ID,
      operatorEmail: this.operator?.email ?? DEV_OPERATOR_EMAIL,
    });
  }
}
