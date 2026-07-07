/**
 * PTAC scenario s30 — self-drive: continuous verification blocks chat on PAD tamper.
 *
 * Verifies that:
 *   1. PAD integrity starts out valid.
 *   2. Tampering with Permanent_Active_Directives.txt causes health to fail.
 *   3. When the active check fails, attempts to send a real chat message
 *      and generate LLM content are blocked with a clear failure.
 *   4. Restoring the file makes the system healthy again.
 *
 * Suites: full.
 * Tags: self-drive, guardian, pad, security, live.
 * Host-only: false.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S30: PtacScenario = {
    id: "s30-continuous-pad-verify",
    title: "Self-drive — continuous verification blocks chat on PAD tamper",
    suites: ["full"],
    requiresHost: false,
    tags: ["self-drive", "guardian", "pad", "security", "live"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot is valid",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "wizard-individual-complete",
            label: "Run setup wizard with profile=individual to initialize default character",
            kind: "setupWizard",
            profile: "individual",
            operatorEmail: "operator@prism.local",
            timeoutMs: 15_000,
        },
        {
            id: "tamper-pad",
            label: "Tamper with Permanent_Active_Directives.txt",
            kind: "tamperPad",
            text: "Adding unauthorized directives to tamper the file",
        },
        {
            id: "assert-tamper-detected",
            label: "Verify PAD integrity check detects tamper",
            kind: "padHashVerify",
            expectTamper: true,
            timeoutMs: 5_000,
        },
        {
            id: "chat-blocked-on-tamper",
            label: "Verify chat message generation is blocked when PAD is tampered",
            kind: "chat",
            prompt: "What is the status of the system?",
            realGeneration: true,
            expectError: true,
            timeoutMs: 20_000,
        },
        {
            id: "restore-pad",
            label: "Restore Permanent_Active_Directives.txt to original state",
            kind: "restorePad",
        },
        {
            id: "post-restore-pad-verify",
            label: "Verify PAD integrity is valid again post-restore",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
    ],
};

registerScenario(SCENARIO_S30);
