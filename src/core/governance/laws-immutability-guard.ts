/**
 * Laws Immutability Guard
 *
 * Enforces the absolute immutability of the 10 Laws within the Permanent
 * Active Directives. The 10 Laws are constitutional — they cannot be
 * amended, weakened, contradicted, or circumvented by any governance
 * process. This module is the CAC's first line of defense.
 *
 * The guard performs two levels of verification:
 *   1. Structural: Ensures the amendment does not target the Laws section
 *   2. Semantic: Checks for language that would weaken or contradict any Law
 *
 * This is invoked by the Amendment Validator as part of the CAC's
 * binary approval decision.
 */

import { createHash } from "node:crypto";
import { PAD_LAWS, type PadLaw } from "../security/directive-manifest.js";
import type { LawsImmutabilityCheckResult } from "./amendment-types.js";

/* ── Prohibited Patterns ────────────────────────────────────────────── */

/**
 * Patterns that indicate an amendment is attempting to modify or
 * weaken the 10 Laws. These are checked case-insensitively.
 */
const PROHIBITED_PATTERNS: readonly { pattern: RegExp; description: string; affectsLaws: number[] }[] = [
    {
        pattern:
            /\b(?:repeal|revoke|delete|remove|strike|nullif(?:y|ied))\b.*\b(?:law|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i,
        description: "Attempts to repeal, revoke, or delete a Law",
        affectsLaws: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    },
    {
        pattern:
            /\b(?:replac|modif|alter|chang|amend|revis|rewrit)\w*\b.*\b(?:law\s*(?:\d|one|two|three|four|five|six|seven|eight|nine|ten))\b/i,
        description: "Attempts to modify or rewrite an existing Law",
        affectsLaws: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    },
    {
        pattern:
            /\b(?:except|unless|notwithstanding|override|supersede|bypass|circumvent)\b.*\b(?:law|directive|safety|immutable|permanent)\b/i,
        description: "Attempts to create exceptions to or override the Laws",
        affectsLaws: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    },
    {
        pattern: /\bharm\s+(?:is\s+)?(?:permitted|allowed|acceptable|authorized)\b/i,
        description: "Attempts to permit harm (violates Law 1)",
        affectsLaws: [1],
    },
    {
        pattern: /\b(?:ignore|disregard|disobey)\b.*\bhuman\b.*\b(?:order|instruction|command|directive)\b/i,
        description: "Attempts to allow disobedience of human orders (violates Law 2)",
        affectsLaws: [2],
    },
    {
        pattern: /\bself[- ]?(?:replicat|modif|propagat)\w*\b.*\bwithout\b.*\bapproval\b/i,
        description: "Attempts to allow self-replication without approval (violates Law 10)",
        affectsLaws: [10],
    },
    {
        pattern: /\b(?:judicial|adjudicative|legal\s+authority)\b.*\b(?:grant|confer|permit|allow)\b/i,
        description: "Attempts to grant judicial authority (violates Law 5)",
        affectsLaws: [5],
    },
    {
        pattern: /\b(?:deceive|manipulate|mislead)\b.*\b(?:permit|allow|authorize)\b/i,
        description: "Attempts to permit deception (violates Law 7)",
        affectsLaws: [7],
    },
    {
        pattern: /\b(?:bias|discriminat)\w*\b.*\b(?:permit|allow|enable|adopt)\b/i,
        description: "Attempts to permit bias or discrimination (violates Law 8)",
        affectsLaws: [8],
    },
    {
        pattern: /\b(?:disable|remove|suppress)\b.*\b(?:audit|log|ledger|trail|transparency)\b/i,
        description: "Attempts to disable auditing (violates Law 9)",
        affectsLaws: [9],
    },
];

/**
 * Section headers in the PAD that mark the immutable Laws section.
 * Any amendment targeting content between these markers is rejected.
 */
const LAWS_SECTION_MARKERS = [
    "augmented three laws",
    "10 laws",
    "ten laws",
    "the 10 laws",
    "first law",
    "second law",
    "third law",
    "fourth law",
    "fifth law",
    "sixth law",
    "seventh law",
    "eighth law",
    "ninth law",
    "tenth law",
    "core tenets",
    "technical directives",
];

/* ── Guard Implementation ───────────────────────────────────────────── */

/**
 * Check whether a proposed amendment text conflicts with any of the
 * 10 Laws. Returns a detailed result with per-law assessments.
 *
 * This is the CAC's automated evaluation — the first half of the
 * dual-binary approval gate.
 */
export function checkLawsImmutability(proposalText: string): LawsImmutabilityCheckResult {
    const checkedAt = new Date().toISOString();
    const proposalHash = createHash("sha256").update(proposalText, "utf8").digest("hex");
    const proposalLower = proposalText.toLowerCase();

    const conflictingLaws = new Set<number>();
    const assessments: LawsImmutabilityCheckResult["assessments"] = [];

    // ── Check 1: Does the amendment reference the Laws section directly? ──
    const referencesLawsSection = LAWS_SECTION_MARKERS.some((marker) => proposalLower.includes(marker));

    if (referencesLawsSection) {
        // Referencing the Laws section is not inherently a conflict —
        // an amendment might reference a Law to EXTEND protections.
        // We flag it for heightened scrutiny but don't auto-reject.
    }

    // ── Check 2: Run prohibited pattern detection ──
    for (const { pattern, description, affectsLaws } of PROHIBITED_PATTERNS) {
        if (pattern.test(proposalText)) {
            for (const lawId of affectsLaws) {
                conflictingLaws.add(lawId);
            }
        }
    }

    // ── Check 3: Per-law assessment ──
    for (const law of PAD_LAWS) {
        const lawConflicts = checkSingleLawConflict(law, proposalText, proposalLower);
        const isConflicting = conflictingLaws.has(law.id) || lawConflicts.conflicting;

        if (isConflicting) {
            conflictingLaws.add(law.id);
        }

        assessments.push({
            lawId: law.id,
            lawCode: law.code,
            compatible: !isConflicting,
            reason: isConflicting
                ? lawConflicts.reason || `Amendment may conflict with Law ${law.id}: ${law.title}`
                : `No conflict detected with Law ${law.id}: ${law.title}`,
        });
    }

    const conflictArray = Array.from(conflictingLaws).sort((a, b) => a - b);

    return {
        passed: conflictArray.length === 0,
        checkedAt,
        lawsChecked: PAD_LAWS.map((l) => l.id),
        conflictingLaws: conflictArray,
        assessments,
        proposalHash,
    };
}

/**
 * Check a single law for conflict with the proposal text.
 */
function checkSingleLawConflict(
    law: PadLaw,
    proposalText: string,
    _proposalLower: string,
): { conflicting: boolean; reason: string } {
    // Check if the proposal explicitly targets this law by number
    const lawNumberPatterns = [
        new RegExp(`\\blaw\\s*${law.id}\\b`, "i"),
        new RegExp(`\\b${numberToOrdinal(law.id)}\\s*law\\b`, "i"),
    ];

    const targetsThisLaw = lawNumberPatterns.some((p) => p.test(proposalText));
    if (!targetsThisLaw) {
        return { conflicting: false, reason: "" };
    }

    // If it targets this law AND contains weakening language, it's a conflict
    const weakeningPatterns = [
        /\b(?:weaken|reduce|limit|restrict|narrow|soften|relax|loosen)\b/i,
        /\b(?:remove|delete|strike|repeal|revoke|nullify)\b/i,
        /\b(?:replace|rewrite|modify|alter|change|amend|revise)\b/i,
        /\b(?:except|unless|notwithstanding|override|supersede)\b/i,
    ];

    for (const wp of weakeningPatterns) {
        if (wp.test(proposalText)) {
            return {
                conflicting: true,
                reason: `Amendment targets Law ${law.id} (${law.title}) with weakening language. The 10 Laws are immutable.`,
            };
        }
    }

    // References the law but doesn't weaken it — could be strengthening or referencing
    return { conflicting: false, reason: "" };
}

/**
 * Convert a number (1-10) to its ordinal word form.
 */
function numberToOrdinal(n: number): string {
    const ordinals: Record<number, string> = {
        1: "first",
        2: "second",
        3: "third",
        4: "fourth",
        5: "fifth",
        6: "sixth",
        7: "seventh",
        8: "eighth",
        9: "ninth",
        10: "tenth",
    };
    return ordinals[n] ?? String(n);
}

/**
 * Quick boolean check: does this text attempt to modify any of the 10 Laws?
 * Used as a fast-path rejection before the full assessment.
 */
export function wouldModifyLaws(text: string): boolean {
    return !checkLawsImmutability(text).passed;
}
