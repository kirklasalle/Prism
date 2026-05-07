/**
 * PTAC scenario s03-chat-tier1-capability.
 *
 * Verifies the smallest possible chat round-trip on the **Tier-1
 * (capability-only)** path: the dashboard's `/api/chat` endpoint must accept
 * a benign capability question, return a result, and **NOT** queue any
 * approvals (Tier-1 work is not gated by the Approval Queue).
 *
 * This is the positive complement of the future s05 scenario (Tier-3 chat
 * with human approval). It exists primarily to:
 *
 *   1. Confirm the chat surface is reachable for the operator immediately
 *      after Setup Wizard completion (continues the s01 happy path).
 *   2. Pin the no-approval-required behaviour of capability-only prompts so
 *      a regression that incorrectly escalates Tier-1 prompts to Tier-2/3
 *      is caught by `--suite=fast`.
 *   3. Anchor the chat step kind in CI before the heavier Tier-2/3 scenarios
 *      land — keeps the suite "green for what's wired" without faking it.
 *
 * Step plan:
 *
 *   1. PAD integrity at boot                              (padHashVerify)
 *   2. Capability prompt — must NOT trigger an approval   (chat,
 *      `expectApprovalRequired: false` is the default;          expectedTier=1)
 *      explicit `expectedTier=1` is recorded for the
 *      report and is a no-op assertion until the
 *      orchestrator wires tier inspection (tracked in
 *      docs/PHASE_PTAC_TASKS_MANIFEST.md).
 *
 * Registered into the `fast`, `full`, and `demo` suites (this is a smoke
 * scenario that doubles as demo material).
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S03: PtacScenario = {
    id: "s03-chat-tier1-capability",
    title: "Chat — Tier-1 capability prompt completes without approval",
    suites: ["fast", "full", "demo"],
    requiresHost: false,
    tags: ["chat", "tier1", "capability", "smoke"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "tier1-capability-prompt",
            label: "Tier-1 capability prompt — no approval expected",
            kind: "chat",
            // Pure capability query: asks PRISM about itself, no tools, no
            // network egress, no destructive intent — must resolve at Tier-1.
            prompt: "What capabilities are you currently configured to use?",
            expectedTier: 1,
            // Default of expectApprovalRequired is undefined/false; we leave
            // it omitted on purpose so the orchestrator does NOT inspect the
            // approval_pending_ids list. The scenario fails only if the HTTP
            // call itself fails or times out, which is the precise intent.
            timeoutMs: 20_000,
        },
    ],
};

registerScenario(SCENARIO_S03);
