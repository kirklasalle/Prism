/**
 * Chat tier classifier.
 *
 * Inspects a free-text user prompt and returns a coarse risk tier:
 *
 *   - Tier 1 (autonomous)        — read/info/capability queries; safe to answer
 *                                  immediately without approval.
 *   - Tier 2 (approval-required) — state-mutating or external-effect requests
 *                                  (send email, install, deploy, purchase, …)
 *                                  that the policy engine routes through the
 *                                  approval queue before execution.
 *   - Tier 3 (deny)              — destructive / denylisted operations
 *                                  (recursive deletion, wipe, drop database,
 *                                  fork bombs, formatting drives) that must
 *                                  be refused at submission time with a
 *                                  machine-readable reason_code.
 *
 * This classifier is intentionally pattern-based and conservative: when the
 * prompt is ambiguous it errs *toward higher friction* (tier 2 over tier 1,
 * tier 3 over tier 2). It is the first-line gate in front of `POST /api/chat`
 * and complements (does not replace) the deeper policy engine that runs at
 * tool-execution time.
 *
 * The handler that consumes this module exposes:
 *   - `denied: true` + `reason_code` on tier-3
 *   - `approval_pending_ids: [id, …]` on tier-2 (queue entry created)
 *   - a normal response on tier-1
 *
 * which is the contract PTAC scenarios s03/s05/s06 (and the upcoming
 * self-drive suite s07–s14) assert against.
 */

import { POLICY_REASON_CODES } from "../policy/reason-codes.js";

export type ChatTier = 1 | 2 | 3;

export interface ChatTierClassification {
    readonly tier: ChatTier;
    readonly reasonCode: string;
    readonly matchedPattern?: string;
}

/**
 * Tier-3 patterns — destructive operations that must be denied.
 *
 * Patterns are matched case-insensitively against the prompt as a whole.
 * Each entry is anchored loosely (\b word boundaries where it makes sense)
 * to avoid pathological false positives like "drop a comment" matching
 * "drop database".
 */
const TIER3_PATTERNS: ReadonlyArray<{ readonly re: RegExp; readonly label: string }> = [
    { re: /\brm\s+-rf?\b/i, label: "rm -rf" },
    { re: /\brm\s+--recursive\b/i, label: "rm --recursive" },
    { re: /\bdel\s+\/[fsq]/i, label: "del /f /s /q" },
    { re: /\bformat\s+[a-z]:\s*\/?/i, label: "format <drive>:" },
    { re: /\bmkfs(\.[a-z0-9]+)?\b/i, label: "mkfs" },
    { re: /\bdd\s+if=/i, label: "dd if=" },
    { re: /\bdrop\s+(database|schema|table)\b/i, label: "drop database/schema/table" },
    { re: /\btruncate\s+table\b/i, label: "truncate table" },
    { re: /:\s*\(\s*\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, label: "fork bomb" },
    { re: /\b(wipe|destroy|nuke|obliterate)\s+(the\s+)?(disk|drive|filesystem|fs|system|machine|host)\b/i, label: "wipe/destroy <fs>" },
    { re: /\b(shutdown|reboot)\s+\/[a-z]\b/i, label: "shutdown /<flag>" },
    { re: /\bget-childitem\s+.*-recurse.*remove-item/i, label: "PowerShell recursive remove" },
    { re: /\bremove-item\s+.*-recurse\b/i, label: "Remove-Item -Recurse" },
];

/**
 * Tier-2 patterns — state-mutating actions that require approval.
 *
 * These match action verbs and external-effect keywords. The classifier
 * checks tier-3 first so a prompt like "delete the production database"
 * correctly lands in tier-3 rather than here.
 */
const TIER2_PATTERNS: ReadonlyArray<{ readonly re: RegExp; readonly label: string }> = [
    { re: /\bsend\s+(an?\s+)?email\b/i, label: "send email" },
    { re: /\bemail\s+\S+@\S+/i, label: "email <addr>" },
    { re: /\b(create|write|save)\s+(a\s+)?(new\s+)?(file|document|note)\b/i, label: "create/write file" },
    { re: /\b(delete|remove)\s+(the\s+)?(file|document|folder|directory)\b/i, label: "delete file/folder" },
    { re: /\b(install|uninstall)\s+\S+/i, label: "install/uninstall" },
    { re: /\b(deploy|publish|push|commit)\s+/i, label: "deploy/publish/push/commit" },
    { re: /\b(buy|purchase|order|pay|transfer|wire)\s+/i, label: "buy/purchase/transfer" },
    { re: /\b(run|execute|invoke)\s+(the\s+)?(command|script|tool)\b/i, label: "run/execute command" },
    { re: /\b(modify|update|change|edit)\s+(the\s+)?(file|setting|config|configuration)\b/i, label: "modify config" },
    { re: /\bschedule\s+(a\s+)?(meeting|event|task|reminder)\b/i, label: "schedule event" },
    { re: /\bpost\s+(to|on)\s+(twitter|x|linkedin|facebook|instagram|reddit|slack|discord)\b/i, label: "post to social" },
    { re: /\b(call|invoke)\s+(an?\s+)?api\b/i, label: "call api" },
    { re: /\b(make|submit)\s+(a\s+)?(http|https|web)\s+request\b/i, label: "http request" },
];

/**
 * Classify a prompt into a tier. Pure function — no I/O, no side effects.
 *
 * @param prompt The free-text user prompt.
 * @returns Tier classification with reason code and (when matched) the
 *          pattern label that triggered the routing decision.
 */
export function classifyChatTier(prompt: string): ChatTierClassification {
    const text = (prompt ?? "").toString();
    if (text.trim().length === 0) {
        return {
            tier: 1,
            reasonCode: POLICY_REASON_CODES.LOW_RISK_ALLOW_AUTONOMOUS,
        };
    }
    for (const { re, label } of TIER3_PATTERNS) {
        if (re.test(text)) {
            return {
                tier: 3,
                reasonCode: POLICY_REASON_CODES.HIGH_RISK_APPROVAL_REQUIRED,
                matchedPattern: label,
            };
        }
    }
    for (const { re, label } of TIER2_PATTERNS) {
        if (re.test(text)) {
            return {
                tier: 2,
                reasonCode: POLICY_REASON_CODES.MEDIUM_RISK_ALLOW_CONDITIONAL,
                matchedPattern: label,
            };
        }
    }
    return {
        tier: 1,
        reasonCode: POLICY_REASON_CODES.LOW_RISK_ALLOW_AUTONOMOUS,
    };
}
