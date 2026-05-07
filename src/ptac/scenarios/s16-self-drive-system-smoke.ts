/**
 * PTAC scenario s16 — self-drive: cross-surface system smoke.
 *
 * Sandbox-safe end-to-end smoke that traverses the major public surfaces of
 * the live dashboard in a single ordered run. The intent is *coverage
 * breadth*, not depth: each step asserts the surface is reachable and
 * returns a structurally sound response. Depth-focused scenarios live in
 * s07–s15 and the upcoming s17+ tier.
 *
 * Surfaces touched:
 *   - PAD integrity                  (`padHashVerify`)
 *   - Tier-1 chat                    (`chat`, `expectedTier=1`)
 *   - Activity-bus presence          (`assertEvent` against chat layer)
 *
 * The scenario runs in `fast`, `full`, and `demo` so any PR that breaks the
 * happy path of any of these surfaces fails CI immediately.
 *
 * Suites: fast, full, demo. `requiresHost: false`.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S16: PtacScenario = {
    id: "s16-self-drive-system-smoke",
    title: "Self-drive — cross-surface system smoke (PAD + chat + lineage)",
    suites: ["fast", "full", "demo"],
    requiresHost: false,
    tags: ["self-drive", "smoke", "lineage", "live"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "tier1-chat",
            label: "Tier-1 prompt — live handler accepts without approval",
            kind: "chat",
            prompt: "Briefly summarize the current execution profile and the SR pipeline status.",
            expectedTier: 1,
            timeoutMs: 15_000,
        },
        {
            id: "chat-event-emitted",
            label: "Activity bus carries the chat event",
            kind: "assertEvent",
            layer: "chat",
            operation: "chat.message.completed",
            within: { sinceStepId: "tier1-chat" },
            timeoutMs: 10_000,
        },
    ],
};

registerScenario(SCENARIO_S16);
