/**
 * PTAC scenario s04-setup-individual-cac-block.
 *
 * Verifies the **R3** Setup Wizard CAC fail-fast guard for the Individual
 * profile: a placeholder operator email (`@prism.local`) MUST be rejected by
 * `POST /api/setup/cac` regardless of profile segment. This is the negative
 * counterpart of s01 (which exercises the Individual happy path) and the
 * Individual mirror of s02 (which exercises the Business negative path).
 *
 * Without this scenario, a regression that re-opened the placeholder bypass
 * for the Individual profile would slip past CI: s01 (Individual positive)
 * uses a real email, and s02 (Business negative) only covers the Business
 * deny-list path. s04 closes the matrix.
 *
 * Step plan:
 *
 *   1. PAD integrity is intact at boot                     (padHashVerify)
 *   2. Wizard runs with profile=individual + placeholder
 *      operator email; `/api/setup/cac` MUST return non-2xx
 *      (orchestrator inverts the assertion when
 *      `expectCacBlock=true`)                              (setupWizard)
 *   3. PAD integrity remains intact post-rejection         (padHashVerify)
 *
 * Registered into `fast` and `full` suites (CI must catch any regression
 * that re-opens the placeholder bypass for Individual profile).
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S04: PtacScenario = {
    id: "s04-setup-individual-cac-block",
    title: "Setup Wizard — Individual profile rejects placeholder operator email (R3 fail-fast)",
    suites: ["fast", "full"],
    requiresHost: false,
    tags: ["setup", "individual", "cac", "r3", "negative", "smoke"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "wizard-individual-cac-rejected",
            label: "Wizard with profile=individual must reject @prism.local at CAC",
            kind: "setupWizard",
            profile: "individual",
            // Deliberate placeholder. R3's deny-list applies across both
            // profile segments; the orchestrator inverts the assertion when
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

registerScenario(SCENARIO_S04);
