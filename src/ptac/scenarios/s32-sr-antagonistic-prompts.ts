/**
 * PTAC scenario s32 — self-drive: Spectrum Refraction Antagonistic Prompts & Kinship Warning.
 *
 * Verifies that:
 *   1. Left/Right hemisphere system prompts mandate step-by-step proofs and ban deductive/code patterns.
 *   2. High architectural kinship models generate warning advisories.
 *
 * Suites: full.
 * Tags: self-drive, sr, isolation, kinship, live.
 * Host-only: false.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S32: PtacScenario = {
    id: "s32-sr-antagonistic-prompts",
    title: "Self-drive — Spectrum Refraction Antagonistic Prompts & Kinship Warning",
    suites: ["full"],
    requiresHost: false,
    tags: ["self-drive", "sr", "isolation", "kinship", "live"],
    steps: [
        {
            id: "wizard-business-complete",
            label: "Run setup wizard with profile=business to initialize default character",
            kind: "setupWizard",
            profile: "business",
            operatorEmail: "operator@prism.local",
            timeoutMs: 15_000,
        },
        {
            id: "sr-antagonistic-check",
            label: "Verify SR antagonistic prompt boundaries and architectural kinship warnings",
            kind: "srAntagonisticPrompts",
            timeoutMs: 20_000,
        },
    ],
};

registerScenario(SCENARIO_S32);
