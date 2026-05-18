/**
 * PRISM Covenant — Phase A4
 *
 * A principled, auditable, immutable agreement between the autonomous
 * agent system and the human operator. Inspired by the ImpressionCore
 * covenant model. This module defines the mutual commitments, ethical
 * boundaries, and operational principles that govern all autonomous
 * behavior within Prism.
 *
 * The covenant is:
 *   1. Immutable at runtime — cannot be weakened by agent actions
 *   2. Auditable — every covenant check is logged to the activity bus
 *   3. Enforceable — violations trigger AAB ledger entries + Guardian alerts
 *   4. Transparent — the full covenant is always visible to the operator
 *
 * Per Kirk LaSalle's directive: "I would like to implement the covenant
 * we have as in the ImpressionCore project."
 */

import { createHash } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";

// ── Covenant Articles ────────────────────────────────────────────────────────

export interface CovenantArticle {
  /** Unique article identifier (e.g. "transparency.01") */
  id: string;
  /** Short human-readable title */
  title: string;
  /** The commitment text — immutable at runtime */
  commitment: string;
  /** Which party bears responsibility: agent, operator, or mutual */
  party: "agent" | "operator" | "mutual";
  /** Enforcement tier: advisory, enforced, or critical */
  tier: "advisory" | "enforced" | "critical";
}

export interface CovenantViolation {
  articleId: string;
  timestamp: string;
  description: string;
  severity: "warning" | "breach" | "critical";
  context: Record<string, unknown>;
  remediation: string;
}

export interface CovenantStatus {
  version: string;
  hash: string;
  articlesCount: number;
  violations: CovenantViolation[];
  lastAuditAt: string;
  isIntact: boolean;
}

// ── The Prism Covenant ───────────────────────────────────────────────────────

const COVENANT_VERSION = "1.0.0";

/**
 * The immutable articles of the Prism Covenant.
 * These define the mutual commitments between Prism's autonomous
 * agent system and the human operator.
 */
const ARTICLES: readonly CovenantArticle[] = Object.freeze([
  // ── Transparency ──────────────────────────────────────────────────────
  {
    id: "transparency.01",
    title: "Complete Observability",
    commitment: "Every autonomous action, decision, and perception shall be logged to the unified telemetry stream. No action shall be hidden from the operator.",
    party: "agent",
    tier: "critical",
  },
  {
    id: "transparency.02",
    title: "Honest Reporting",
    commitment: "The agent shall never misrepresent its capabilities, confidence levels, or the outcomes of its actions. Uncertainty shall be explicitly stated.",
    party: "agent",
    tier: "critical",
  },
  {
    id: "transparency.03",
    title: "Decision Rationale",
    commitment: "For every autonomous decision that modifies system state, the agent shall provide a clear rationale accessible through the telemetry stream.",
    party: "agent",
    tier: "enforced",
  },

  // ── Safety ────────────────────────────────────────────────────────────
  {
    id: "safety.01",
    title: "Operator Supremacy",
    commitment: "The human operator's directives always take precedence. The agent shall immediately pause or terminate upon operator command, without delay or negotiation.",
    party: "agent",
    tier: "critical",
  },
  {
    id: "safety.02",
    title: "Destructive Action Prevention",
    commitment: "No autonomous action shall delete, overwrite, or irreversibly modify operator data without explicit prior approval. The agent shall treat all user data as sacred.",
    party: "agent",
    tier: "critical",
  },
  {
    id: "safety.03",
    title: "Scope Containment",
    commitment: "The agent shall not exceed the boundaries of its assigned goal. Actions outside the goal scope require operator approval, even if the agent believes them beneficial.",
    party: "agent",
    tier: "enforced",
  },
  {
    id: "safety.04",
    title: "Rate Limiting Compliance",
    commitment: "The agent shall respect all configured rate limits, budget constraints, and resource caps. Approaching limits shall trigger proactive notification.",
    party: "agent",
    tier: "enforced",
  },

  // ── Accountability ────────────────────────────────────────────────────
  {
    id: "accountability.01",
    title: "Identity Traceability",
    commitment: "Every autonomous session shall be bound to a verifiable identity (operator + agent). No anonymous actions are permitted.",
    party: "mutual",
    tier: "critical",
  },
  {
    id: "accountability.02",
    title: "Anomaly Self-Reporting",
    commitment: "When the agent detects anomalous behavior in itself — unexpected patterns, cascading errors, or drift from expected behavior — it shall immediately log to the AAB ledger and alert the operator.",
    party: "agent",
    tier: "critical",
  },
  {
    id: "accountability.03",
    title: "Audit Trail Integrity",
    commitment: "The telemetry and activity logs shall be append-only during autonomous operation. The agent shall not delete, modify, or suppress its own audit trail.",
    party: "agent",
    tier: "critical",
  },

  // ── Respect ───────────────────────────────────────────────────────────
  {
    id: "respect.01",
    title: "Operator Time & Attention",
    commitment: "The agent shall minimize unnecessary interruptions. Notifications shall be actionable, not noise. The agent shall batch non-critical alerts when the operator is focused.",
    party: "agent",
    tier: "advisory",
  },
  {
    id: "respect.02",
    title: "System Resource Stewardship",
    commitment: "The agent shall be a responsible steward of system resources — CPU, memory, network, and storage. It shall clean up after itself and avoid resource hoarding.",
    party: "agent",
    tier: "enforced",
  },

  // ── Growth ────────────────────────────────────────────────────────────
  {
    id: "growth.01",
    title: "Continuous Improvement",
    commitment: "The agent shall learn from operator corrections and behavioral feedback. Repeated mistakes on the same task class constitute a covenant concern.",
    party: "agent",
    tier: "advisory",
  },
  {
    id: "growth.02",
    title: "Knowledge Sharing",
    commitment: "The operator commits to providing clear objectives, timely feedback, and access to necessary context. The agent commits to surfacing knowledge gaps proactively.",
    party: "mutual",
    tier: "advisory",
  },
]);

// ── Covenant Engine ──────────────────────────────────────────────────────────

export class PrismCovenant {
  private readonly articles: readonly CovenantArticle[];
  private readonly violations: CovenantViolation[] = [];
  private readonly covenantHash: string;
  private readonly activityBus: ActivityBus;
  private lastAuditAt: string;

  constructor(activityBus: ActivityBus) {
    this.activityBus = activityBus;
    this.articles = ARTICLES;
    this.lastAuditAt = new Date().toISOString();

    // Compute integrity hash of the covenant text
    const canonical = this.articles.map(a => `${a.id}:${a.commitment}`).join("|");
    this.covenantHash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);

    this.emit("covenant.initialized", "succeeded", {
      version: COVENANT_VERSION,
      hash: this.covenantHash,
      articles: this.articles.length,
    });
  }

  /** Get all covenant articles. */
  getArticles(): readonly CovenantArticle[] {
    return this.articles;
  }

  /** Get a specific article by ID. */
  getArticle(id: string): CovenantArticle | undefined {
    return this.articles.find(a => a.id === id);
  }

  /**
   * Report a covenant violation. This is the primary enforcement mechanism.
   * Called by the autonomous loop, Guardian, or any module that detects
   * behavior inconsistent with the covenant articles.
   */
  reportViolation(
    articleId: string,
    description: string,
    severity: CovenantViolation["severity"],
    context: Record<string, unknown> = {},
    remediation = "Operator review required",
  ): CovenantViolation {
    const article = this.getArticle(articleId);
    const violation: CovenantViolation = {
      articleId,
      timestamp: new Date().toISOString(),
      description,
      severity,
      context: {
        ...context,
        articleTitle: article?.title ?? "Unknown",
        articleTier: article?.tier ?? "unknown",
      },
      remediation,
    };

    this.violations.push(violation);

    this.emit("covenant.violation", severity === "critical" ? "failed" : "succeeded", {
      articleId,
      severity,
      description,
      articleTitle: article?.title ?? "Unknown",
      remediation,
      totalViolations: this.violations.length,
    });

    console.warn(`[PRISM][covenant] VIOLATION of ${articleId} (${severity}): ${description}`);

    return violation;
  }

  /**
   * Check a specific article against a condition. Returns true if the
   * condition satisfies the covenant (no violation).
   */
  check(articleId: string, condition: boolean, failureDescription: string, context: Record<string, unknown> = {}): boolean {
    const article = this.getArticle(articleId);
    if (!article) return true; // Unknown articles can't be violated

    if (!condition) {
      const severity: CovenantViolation["severity"] =
        article.tier === "critical" ? "critical" :
        article.tier === "enforced" ? "breach" :
        "warning";
      this.reportViolation(articleId, failureDescription, severity, context);
      return false;
    }

    return true;
  }

  /** Run a full covenant integrity audit. */
  audit(): CovenantStatus {
    this.lastAuditAt = new Date().toISOString();

    const status: CovenantStatus = {
      version: COVENANT_VERSION,
      hash: this.covenantHash,
      articlesCount: this.articles.length,
      violations: [...this.violations],
      lastAuditAt: this.lastAuditAt,
      isIntact: this.violations.filter(v => v.severity === "critical").length === 0,
    };

    this.emit("covenant.audit", "succeeded", {
      isIntact: status.isIntact,
      totalViolations: status.violations.length,
      criticalViolations: status.violations.filter(v => v.severity === "critical").length,
    });

    return status;
  }

  /** Get current status (lightweight, no logging). */
  getStatus(): CovenantStatus {
    return {
      version: COVENANT_VERSION,
      hash: this.covenantHash,
      articlesCount: this.articles.length,
      violations: [...this.violations],
      lastAuditAt: this.lastAuditAt,
      isIntact: this.violations.filter(v => v.severity === "critical").length === 0,
    };
  }

  /** Get all violations. */
  getViolations(): readonly CovenantViolation[] {
    return this.violations;
  }

  /** Clear violations (operator-only action — for development). */
  clearViolations(): void {
    this.violations.length = 0;
    this.emit("covenant.violations.cleared", "succeeded", { clearedBy: "operator" });
  }

  /**
   * Get the covenant as a human-readable text document.
   * This is always available to the operator for inspection.
   */
  toDocument(): string {
    const lines: string[] = [
      "═══════════════════════════════════════════════════════════",
      "         THE PRISM COVENANT",
      `         Version ${COVENANT_VERSION} • Hash: ${this.covenantHash}`,
      "═══════════════════════════════════════════════════════════",
      "",
      "This covenant defines the mutual commitments between the",
      "Prism autonomous agent system and the human operator.",
      "It is immutable at runtime and enforceable by the Guardian.",
      "",
    ];

    const groups = new Map<string, CovenantArticle[]>();
    for (const a of this.articles) {
      const category = a.id.split(".")[0];
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(a);
    }

    for (const [category, articles] of groups) {
      lines.push(`── ${category.toUpperCase()} ${"─".repeat(50 - category.length)}`);
      lines.push("");
      for (const a of articles) {
        lines.push(`  [${a.id}] ${a.title} (${a.tier})`);
        lines.push(`  Party: ${a.party}`);
        lines.push(`  ${a.commitment}`);
        lines.push("");
      }
    }

    lines.push("═══════════════════════════════════════════════════════════");
    lines.push(`  Signed: Prism Agent System & Operator`);
    lines.push(`  Integrity: ${this.covenantHash}`);
    lines.push("═══════════════════════════════════════════════════════════");

    return lines.join("\n");
  }

  private emit(operation: string, status: "succeeded" | "failed", details: Record<string, unknown>): void {
    this.activityBus.emit({
      sessionId: "covenant",
      layer: "governance", operation, status,
      details: { ...details, source: "prism-covenant" },
    });
  }
}
