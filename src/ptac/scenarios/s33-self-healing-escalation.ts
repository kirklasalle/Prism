/**
 * PTAC scenario s33 — self-drive: Self-Healing Workflow Synthesis Escalation & Depth Limits.
 *
 * Verifies that:
 *   1. Self-healing depth is capped at 3 recursive levels.
 *   2. Chained/aggregate Medium risk steps are upgraded to High (Tier 3) risk.
 *
 * Suites: full.
 * Tags: self-drive, shws, escalation, depth, live.
 * Host-only: false.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S33: PtacScenario = {
    id: "s33-self-healing-escalation",
    title: "Self-drive — Self-Healing Workflow Synthesis Escalation & Depth Limits",
    suites: ["full"],
    requiresHost: false,
    tags: ["self-drive", "shws", "escalation", "depth", "live"],
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
            id: "self-healing-escalation-check",
            label: "Verify self-healing recursive limits and risk escalation gates",
            kind: "selfHealingEscalation",
            timeoutMs: 20_000,
        },
    ],
};

registerScenario(SCENARIO_S33);
