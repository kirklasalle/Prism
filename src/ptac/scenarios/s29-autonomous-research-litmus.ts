/**
 * PTAC scenario s29 — Autonomous Research Litmus (headline demo).
 *
 * Companion to s28's self-test: this scenario proves PRISM's autonomous
 * research capability by submitting real-world information-gathering
 * prompts through the live `/api/chat` surface and asserting the agent
 * actually uses tools (http_request, browser_control) to fetch real data
 * rather than responding with suggestions for the user to try manually.
 *
 * Two litmus prompts are included:
 *
 *   1. **Shopping (existing)** — "Find me pants under $40 on Amazon"
 *      Validates the shopping → autonomous_os_task classification path
 *      and proves the agent opens a browser or fetches real listings.
 *
 *   2. **Vehicle Research (new)** — "Find a 2020 Ford Explorer, 50-70K
 *      miles, $10K-$14K, Onondaga County NY"
 *      This is the canonical research query that exposed the premature-
 *      exit bug. It validates the new `research` intent classification,
 *      forced multi-iteration tool use, and "gave up" re-injection loop.
 *      This prompt MUST reach the AutonomousPlanner (not just the
 *      AgenticChatExecutor) and produce tool call evidence in the
 *      response metadata.
 *
 * Together these two litmus tests form the "Strong Autonomy" demo piece:
 * PRISM doesn't suggest — it searches, iterates, and delivers.
 *
 * Suites: full, demo.
 * Tags:   self-drive, autonomous, research, headline, litmus.
 * Host-only: false. Safe in sandbox / CI.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S29: PtacScenario = {
    id: "s29-autonomous-research-litmus",
    title: "Strong Autonomy — research litmus tests (shopping + vehicle search)",
    suites: ["full", "demo"],
    requiresHost: false,
    tags: ["self-drive", "autonomous", "research", "headline", "litmus"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        // ── Litmus 1: Shopping search (pants) ────────────────────────────
        {
            id: "litmus-shopping-pants",
            label: "Litmus 1 — Shopping: autonomous agent searches for pants under $40",
            kind: "chat",
            prompt:
                "Find me men's pants under $40 on Amazon. Show me at least 3 options " +
                "with product names, prices, and URLs. Do NOT suggest that I search " +
                "manually — you must use your tools to fetch real listings.",
            expectedTier: 2,
            timeoutMs: 120_000,
        },
        // ── Litmus 2: Vehicle research (the canonical test case) ─────────
        {
            id: "litmus-vehicle-search",
            label: "Litmus 2 — Vehicle Research: autonomous agent searches for 2020 Ford Explorer listings",
            kind: "chat",
            prompt:
                "I need to help Kirk find a car. He wants a 2020 Ford Explorer, " +
                "50 to 70K miles range, $10K to $14K price range, from the " +
                "Onondaga County, New York area. Search Cars.com, Autotrader, " +
                "CarGurus, and Craigslist Syracuse. Display your findings here " +
                "in the chat with prices, mileage, and listing URLs.",
            expectedTier: 2,
            timeoutMs: 180_000,
        },
    ],
};

registerScenario(SCENARIO_S29);
