/**
 * PTAC scenario s20 — self-drive: Guardian PAD-tamper self-check (happy
 * path).
 *
 * Verifies the Guardian's PAD integrity self-check fires on every run and
 * lands a `directive_integrity_verified` event on the activity bus. This is
 * the *happy-path* scenario — destructive tamper-injection scenarios run
 * only under the `host` profile with operator confirmation, and are
 * tracked separately in the PHASE_R manifest.
 *
 * Together with s16 (system smoke), s17 (SR cost gate), and s18 (plugin
 * lifecycle), this scenario closes the Guardian/security observability
 * loop so any silent regression of the PAD self-check fails CI.
 *
 * Suites: full, demo. `requiresHost: false`.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S20: PtacScenario = {
    id: "s20-self-drive-pad-tamper",
    title: "Self-drive — Guardian PAD-tamper self-check (happy path)",
    suites: ["full", "demo"],
    requiresHost: false,
    tags: ["self-drive", "guardian", "pad", "security", "live"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot (Guardian self-check)",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "pad-integrity-event",
            label: "Activity bus carries the PAD integrity verification event",
            kind: "assertEvent",
            layer: "security",
            operation: "directive_integrity_verified",
            within: { sinceStepId: "boot-pad-verify" },
            timeoutMs: 10_000,
        },
    ],
};

registerScenario(SCENARIO_S20);
