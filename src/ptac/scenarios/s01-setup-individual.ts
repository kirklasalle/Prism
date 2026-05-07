/**
 * PTAC scenario s01-setup-individual.
 *
 * Verifies the Individual-profile happy path of the Setup Wizard:
 *
 *   1. PAD integrity is intact at boot                    (padHashVerify)
 *   2. Wizard accepts profile=individual + completes      (setupWizard)
 *   3. PAD integrity remains intact post-completion       (padHashVerify)
 *   4. A first chat round-trip succeeds against the
 *      live `/api/chat` endpoint                          (chat)
 *
 * This is the smallest possible end-to-end scenario — it touches every
 * subsystem on the critical path (directive verification, setup wizard,
 * preferences persistence, chat session bootstrap) without requiring host
 * input injection, real OAuth secrets, or container runtimes.
 *
 * Registered into the `fast`, `full`, and `demo` suites.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S01: PtacScenario = {
    id: "s01-setup-individual",
    title: "Setup Wizard — Individual profile happy path",
    suites: ["fast", "full", "demo"],
    requiresHost: false,
    tags: ["setup", "individual", "smoke"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "wizard-individual-complete",
            label: "Run setup wizard with profile=individual",
            kind: "setupWizard",
            profile: "individual",
            // The Individual profile accepts placeholder emails (sample data
            // ships with @prism.local) — exercising this confirms R3 only
            // fails closed for Business, not Individual.
            operatorEmail: "operator@prism.local",
            timeoutMs: 15_000,
        },
        {
            id: "post-setup-pad-verify",
            label: "Verify PAD integrity after wizard completion",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "first-chat",
            label: "First chat round-trip against /api/chat",
            kind: "chat",
            prompt: "Hello PRISM — what is the current date?",
            timeoutMs: 20_000,
        },
    ],
};

registerScenario(SCENARIO_S01);
