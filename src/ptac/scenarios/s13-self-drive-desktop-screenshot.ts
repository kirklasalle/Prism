/**
 * PTAC scenario s13 — self-drive: Computer-Use desktop screenshot round-trip.
 *
 * The first scenario that drives the real desktop via the
 * computer-use-tool's `POST /api/computer/screenshot` route. Validates
 * that PRISM can capture the operator's screen via its own primitives
 * and round-trip the result through PTAC evidence collection.
 *
 * SAFETY GATES (both required, enforced by the orchestrator):
 *   1. CLI: `--profile=host` + `--i-understand-host-control`.
 *   2. Env: `PRISM_PTAC_SAFE=1`.
 * If either is missing, the orchestrator throws a clear advisory and
 * the run reports the step as failed-by-policy rather than skipped.
 *
 * Step plan:
 *
 *   1. PAD integrity                                       (padHashVerify)
 *   2. Capture desktop screenshot via computer-use         (computerUse: screenshot)
 *
 * Suites: full ONLY. NOT in `fast` (host gate). NOT in `demo` (would
 * disclose operator's desktop in a showcase). `requiresHost: true`.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S13: PtacScenario = {
    id: "s13-self-drive-desktop-screenshot",
    title: "Self-drive — Computer-Use captures the host desktop screenshot",
    suites: ["full"],
    requiresHost: true,
    tags: ["self-drive", "computer-use", "host", "screenshot", "smoke"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "desktop-screenshot",
            label: "Capture desktop screenshot via computer-use-tool",
            kind: "computerUse",
            action: "screenshot",
            args: {},
            timeoutMs: 15_000,
        },
    ],
};

registerScenario(SCENARIO_S13);
