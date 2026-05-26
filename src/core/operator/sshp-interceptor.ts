import { createHash } from "node:crypto";
import { readPreferences } from "../config/workspace-resolver.js";
import type { PrismCovenant } from "../governance/prism-covenant.js";

// Lazy-load sharp to prevent startup lag
let sharpModule: typeof import("sharp") | null = null;
async function getSharp(): Promise<typeof import("sharp")> {
  if (!sharpModule) {
    sharpModule = (await import("sharp")).default as any;
  }
  return sharpModule!;
}

export interface SSHPRedactRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Sovereign Sentinel Hyper-Proxy (SSHP) Core Security & PII Redaction Engine.
 * Resides locally inside the execution sandbox boundary.
 * Intercepts low-level page modifications, sanitizes visual screenshots,
 * redacts text-level PII from DOM snapshots, and validates action integrity
 * against the Prism Sacred Covenant.
 */
export class SSHPInterceptor {
  constructor(private readonly covenant?: PrismCovenant | null) {}

  /**
   * Evaluates if SSHP PII Redaction is currently enabled by the operator.
   * Enabled by default (returns true if not configured).
   */
  isEnabled(): boolean {
    try {
      const prefs = readPreferences();
      // Supports direct env override or persistent user preference
      if (process.env.PRISM_SSHP_REDACTION_ENABLED === "false") {
        return false;
      }
      return prefs?.runtimeSettings?.sshpRedactionEnabled !== false;
    } catch {
      return true;
    }
  }

  /**
   * Strips personal identifiable information (emails, credit cards, SSNs) and
   * sensitive input values from raw DOM HTML snapshots.
   */
  sanitizeDom(rawHtml: string): string {
    if (!this.isEnabled()) return rawHtml;

    let sanitized = rawHtml;

    // 1. Redact input field values for sensitive attributes
    sanitized = sanitized.replace(/<input\s+([^>]+)>/gi, (match, attributes) => {
      const isSensitive =
        /type=["']password["']/i.test(attributes) ||
        /name=["'][^"']*(pass|secret|cvv|ssn|card|token|key|cred)[^"']*["']/i.test(attributes) ||
        /id=["'][^"']*(pass|secret|cvv|ssn|card|token|key|cred)[^"']*["']/i.test(attributes) ||
        /autocomplete=["'][^"']*(cc-|ssn|card|credentials)[^"']*["']/i.test(attributes);

      if (isSensitive) {
        if (/value=["']([^"']*)["']/i.test(attributes)) {
          return `<input ${attributes.replace(/value=["']([^"']*)["']/gi, 'value="[REDACTED_PII]"')}>`;
        } else {
          return `<input ${attributes} value="[REDACTED_PII]">`;
        }
      }
      return match;
    });

    // 2. Redact text-level PII formats: Emails, Credit Cards, US SSNs
    // Email addresses
    sanitized = sanitized.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      "[REDACTED_EMAIL]"
    );
    // Credit Cards (13 to 16 digits, with optional spaces/hyphens)
    sanitized = sanitized.replace(
      /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
      "[REDACTED_CARD]"
    );
    // US Social Security Numbers (SSN)
    sanitized = sanitized.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");

    return sanitized;
  }

  /**
   * Dynamically draws filled black rectangles over sensitive element regions
   * on screen using sharp SVG composite layering.
   */
  async redactScreenshot(
    imageBuffer: Buffer,
    rects: SSHPRedactRect[]
  ): Promise<Buffer> {
    if (!this.isEnabled() || rects.length === 0) {
      return imageBuffer;
    }

    try {
      const sharp = await getSharp();
      const instance = sharp(imageBuffer);
      const metadata = await instance.metadata();
      const width = metadata.width ?? 1280;
      const height = metadata.height ?? 800;

      // Draw vector rectangles over target bounding boxes
      let svgRects = "";
      for (const r of rects) {
        // Ensure coordinates do not exceed screenshot canvas bounds
        const x = Math.max(0, Math.min(width, r.x));
        const y = Math.max(0, Math.min(height, r.y));
        const w = Math.max(0, Math.min(width - x, r.width));
        const h = Math.max(0, Math.min(height - y, r.height));
        if (w > 0 && h > 0) {
          svgRects += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="black" />`;
        }
      }

      if (!svgRects) {
        return imageBuffer;
      }

      const svgOverlay = `<svg width="${width}" height="${height}">${svgRects}</svg>`;
      return await instance
        .composite([
          {
            input: Buffer.from(svgOverlay),
            top: 0,
            left: 0,
          },
        ])
        .toBuffer();
    } catch (err) {
      console.error("[PRISM][sshp] Visual redaction failed:", err);
      // Fallback: return raw image on non-fatal drawing error to preserve system continuity
      return imageBuffer;
    }
  }

  /**
   * Audits active user-agent commands against the Prism Sacred Covenant.
   * Blocks actions that violate safety or transparency articles.
   */
  async auditAction(
    command: "navigate" | "click" | "type" | "evaluate",
    args: Record<string, any>
  ): Promise<{ allowed: boolean; reason?: string; violatedArticle?: string }> {
    if (!this.covenant) {
      return { allowed: true };
    }

    // 1. safety.02: Destructive action prevention - block attempts to run destructive evaluations
    if (command === "evaluate") {
      const expr = String(args.expression ?? "").toLowerCase();
      const destructiveKeywords = ["localstorage.clear()", "sessionstorage.clear()", "indexeddb.deletedatabase", "document.body.remove()"];
      for (const kw of destructiveKeywords) {
        if (expr.includes(kw)) {
          const description = `Blocked highly destructive script execution: "${kw}"`;
          this.covenant.check("safety.02", false, description, { command, expression: expr });
          return {
            allowed: false,
            reason: description,
            violatedArticle: "safety.02",
          };
        }
      }
    }

    // 2. safety.03: Scope Containment - block navigation to dangerous protocols
    if (command === "navigate") {
      const urlStr = String(args.url ?? "").trim();
      if (/^(file|chrome|about|view-source|ftp):/i.test(urlStr)) {
        const description = `Blocked navigation to disallowed internal/dangerous protocol URL: "${urlStr}"`;
        this.covenant.check("safety.03", false, description, { command, url: urlStr });
        return {
          allowed: false,
          reason: description,
          violatedArticle: "safety.03",
        };
      }
    }

    // 3. transparency.01 & accountability.03: Ensure all actions are fully observable and authenticated
    if (!args.sessionId) {
      const description = "Blocked session-less browser action. Commands require explicit bound session tracing.";
      this.covenant.check("accountability.01", false, description, { command });
      return {
        allowed: false,
        reason: description,
        violatedArticle: "accountability.01",
      };
    }

    return { allowed: true };
  }
}
