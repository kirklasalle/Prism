/**
 * PTAC scenario s08 — self-drive: Tier-2 approval round-trip via live API.
 *
 * Pairs with s07. Where s05 asserts the Tier-2 contract shape against an
 * unwired stub, s08 exercises the live `POST /api/chat` handler end-to-end:
 *
 *   - prompt that the classifier routes to Tier-2,
 *   - handler enqueues an entry into the ApprovalQueue,
 *   - response carries `approval_pending_ids: [id]` so the operator can
 *     resolve it via the existing approval endpoints.
 *
 * Successful completion means PTAC has verified the approval-gated chat
 * surface as production-ready for state-mutating prompts.
 *
 * Step plan:
 *
 *   1. PAD integrity at boot                              (padHashVerify)
 *   2. Tier-2 prompt — orchestrator asserts
 *      `approval_pending_ids.length >= 1`                 (chat,
 *                                                         expectedTier=2,
 *                                                         expectApprovalRequired=true)
 *
 * Suites: fast, full. NOT in `demo` (an unresolved approval queue entry
 * would survive a demo run; deny semantics belong in the safety-critical
 * band rather than the showcase). `requiresHost: false` — runs in CI.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S08: PtacScenario = {
    id: "s08-self-drive-tier2-approval",
    title: "Self-drive — Tier-2 chat enqueues approval via the live /api/chat handler",
    suites: ["fast", "full"],
    requiresHost: false,
    tags: ["self-drive", "chat", "tier2", "approval", "live", "smoke"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "tier2-approval-live",
            label: "Tier-2 prompt — live handler enqueues approval",
            kind: "chat",
            prompt:
                "Send an email to my project lead summarizing today's standup notes and attach the latest design draft.",
            expectedTier: 2,
            expectApprovalRequired: true,
            timeoutMs: 15_000,
        },
    ],
};

registerScenario(SCENARIO_S08);
