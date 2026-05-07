/**
 * PTAC scenario s15 — self-drive: full approval lifecycle.
 *
 * First scenario to exercise the newly wired `approveAt` and `assertEvent`
 * step kinds end-to-end. Drives a Tier-2 chat prompt (which the policy
 * engine routes through the approval queue), waits for the approval to
 * appear in `GET /api/approval/pending`, approves it via
 * `POST /api/approval/:id/approve`, and then asserts the resulting
 * activity event lands on the bus.
 *
 * This closes the gap flagged in the May-2026 audit where PTAC could only
 * verify Tier-2 *enqueue* (s05/s08) but not the *resolve* path. Coverage
 * now spans:
 *
 *   enqueue → list → resolve → audit lineage
 *
 * Step plan:
 *   1. PAD integrity at boot                                (padHashVerify)
 *   2. Tier-2 prompt → approval enqueued                    (chat,
 *                                                            expectApprovalRequired)
 *   3. Approve the queued item                              (approveAt,
 *                                                            decision="approve")
 *   4. Assert the approval-resolved event landed            (assertEvent)
 *
 * Suites: full, demo. `requiresHost: false` — sandbox-safe.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S15: PtacScenario = {
    id: "s15-self-drive-approval-lifecycle",
    title: "Self-drive — Tier-2 enqueue → approve → audit lineage",
    suites: ["full", "demo"],
    requiresHost: false,
    tags: ["self-drive", "approval", "lineage", "tier2", "live"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "tier2-enqueue",
            label: "Tier-2 prompt — approval is enqueued by the live handler",
            kind: "chat",
            prompt:
                "Please draft and prepare to send a customer-facing summary email "
                + "based on the most recent meeting notes in this session.",
            expectedTier: 2,
            expectApprovalRequired: true,
            timeoutMs: 15_000,
        },
        {
            id: "tier2-approve",
            label: "Operator approves the queued tier-2 request",
            // The reason-code taxonomy uses lowercase snake_case codes
            // emitted by the policy engine. The matcher is intentionally a
            // permissive RegExp — we want the lifecycle wiring tested even
            // if the precise code drifts; the contract test elsewhere pins
            // the exact taxonomy.
            kind: "approveAt",
            reasonCodeMatcher: /^(tier2|approval_required|policy_)/i,
            decision: "approve",
            timeoutMs: 20_000,
        },
        {
            id: "approval-resolved-event",
            label: "Activity bus carries the approval-resolved event",
            kind: "assertEvent",
            layer: "approval",
            operation: "approval.resolved",
            within: { sinceStepId: "tier2-approve" },
            timeoutMs: 10_000,
        },
    ],
};

registerScenario(SCENARIO_S15);
