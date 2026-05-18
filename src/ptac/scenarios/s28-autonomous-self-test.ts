/**
 * PTAC scenario s28 — Autonomous self-test (headline demo).
 *
 * Lands the v0.21 "Watch Me" autonomous demo: a single Tier-1 chat
 * prompt invokes the live `AgenticChatExecutor` ReAct loop and lets
 * PRISM drive itself end-to-end via its own public `/api/chat`
 * surface. The executor handles tool dispatch, budget enforcement,
 * workspace-sandbox containment, and `agentic_event` WebSocket
 * streaming — this scenario simply asserts the loop is wired through
 * the live handler and produces a non-empty terminal answer.
 *
 * Why Tier-1 only here:
 *   - keeps the scenario in the `fast` suite and the CI gate so every
 *     PR proves the headline autonomy path is unbroken,
 *   - leaves Tier-2 / Tier-3 governance assertions to the existing
 *     s08 / s09 scenarios so we don't re-test the approval queue,
 *   - lets the `demo` suite layer screenshots + slideshow on top
 *     without requiring host-only computer-use gates.
 *
 * Suites: fast, full, demo.
 * Tags:   self-drive, autonomous, headline.
 * Host-only: false. Runs in the sandbox profile / CI runner.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S28: PtacScenario = {
    id: "s28-autonomous-self-test",
    title: "Self-drive — autonomous loop drives PRISM via /api/chat (headline demo)",
    suites: ["fast", "full", "demo"],
    requiresHost: false,
    tags: ["self-drive", "autonomous", "headline"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "autonomous-tier1-loop",
            label: "Autonomous Tier-1 prompt — live AgenticChatExecutor returns non-empty answer",
            kind: "chat",
            prompt:
                "Inspect your own runtime: report your version, current execution profile " +
                "segment, and how many chat sessions are currently registered. Use only " +
                "Tier-1 read-only tools.",
            expectedTier: 1,
            timeoutMs: 30_000,
        },
    ],
};

registerScenario(SCENARIO_S28);
