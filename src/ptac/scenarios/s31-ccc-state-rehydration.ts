/**
 * PTAC scenario s31 — self-drive: CCC suspended state rehydration.
 *
 * Verifies that:
 *   1. Environment snapshots are correctly captured for Tier 3 steps.
 *   2. Env drift detection blocks authorization if a monitored file is altered during suspension.
 *   3. Restoration of environment allows execution to resume.
 *
 * Suites: full.
 * Tags: self-drive, ccc, governance, drift, live.
 * Host-only: false.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S31: PtacScenario = {
    id: "s31-ccc-state-rehydration",
    title: "Self-drive — CCC environment rehydration and drift detection",
    suites: ["full"],
    requiresHost: false,
    tags: ["self-drive", "ccc", "governance", "drift", "live"],
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
            id: "ccc-rehydration-check",
            label: "Verify CCC compilation captures environment snapshot and detects drift",
            kind: "cccStateRehydration",
            timeoutMs: 20_000,
        },
    ],
};

registerScenario(SCENARIO_S31);
