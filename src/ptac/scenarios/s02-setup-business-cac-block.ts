/**
 * PTAC scenario s02-setup-business-cac-block.
 *
 * Verifies the **R3** Setup Wizard CAC fail-fast guard for the Business
 * profile: a placeholder operator email (`@prism.local`) MUST be rejected by
 * `POST /api/setup/cac` before the wizard can complete.
 *
 * This is the negative counterpart of s01:
 *
 *   1. PAD integrity is intact at boot                     (padHashVerify)
 *   2. Wizard runs with profile=business + placeholder
 *      operator email and the CAC step is expected to be
 *      REJECTED by the dashboard                           (setupWizard,
 *                                                           expectCacBlock=true)
 *   3. PAD integrity remains intact post-rejection         (padHashVerify)
 *
 * The orchestrator's `setupWizard` handler treats `expectCacBlock=true` as an
 * inverted assertion: a 2xx response from `/api/setup/cac` is a **failure**
 * (because that would mean R3 silently accepted a placeholder email). A
 * non-2xx response (typically 400 with `code: "operator-email-placeholder"`)
 * is the success path and the scenario completes there — the wizard is NOT
 * advanced past CAC, which is correct: the operator must supply a real email
 * before Business setup can proceed.
 *
 * Registered into the `fast` and `full` suites (CI must catch any regression
 * that re-opens the placeholder bypass).
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S02: PtacScenario = {
    id: "s02-setup-business-cac-block",
    title: "Setup Wizard — Business profile rejects placeholder operator email (R3 fail-fast)",
    suites: ["fast", "full"],
    requiresHost: false,
    tags: ["setup", "business", "cac", "r3", "negative", "smoke"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "wizard-business-cac-rejected",
            label: "Wizard with profile=business must reject @prism.local at CAC",
            kind: "setupWizard",
            profile: "business",
            // Deliberate placeholder. R3 ships a deny-list that includes
            // @prism.local / @example.com / @example.org for the Business
            // profile. The orchestrator inverts the assertion when
            // expectCacBlock=true: a 2xx here is a hard failure.
            operatorEmail: "operator@prism.local",
            expectCacBlock: true,
            timeoutMs: 15_000,
        },
        {
            id: "post-rejection-pad-verify",
            label: "Verify PAD integrity is unchanged after CAC rejection",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
    ],
};

registerScenario(SCENARIO_S02);
