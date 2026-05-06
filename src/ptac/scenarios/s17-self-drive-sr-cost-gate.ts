/**
 * PTAC scenario s17 — self-drive: Spectrum-Refraction status + cost-gate
 * reachability.
 *
 * Sandbox-safe smoke that exercises the live SR endpoints
 * (`/api/sr/status`, `/api/sr/cost-estimate`) without dispatching a real
 * provider call. When the run is started against a dashboard that has the
 * SR triad pre-configured, this scenario provides early warning if the
 * cost-estimate surface regresses; when no triad is configured, the
 * orchestrator falls back to a `/api/sr/status` smoke that still confirms
 * the SR layer is reachable and structurally sound.
 *
 * Together with s16 (chat + lineage smoke), this scenario ensures the
 * provider/SR routing layer never silently disappears between releases.
 *
 * Suites: full, demo. `requiresHost: false`.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S17: PtacScenario = {
    id: "s17-self-drive-sr-cost-gate",
    title: "Self-drive — SR status + cost-estimate reachability",
    suites: ["full", "demo"],
    requiresHost: false,
    tags: ["self-drive", "sr", "cost-gate", "live"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "sr-status-smoke",
            label: "SR status endpoint reachable for ptac sentinel session",
            kind: "srFanOut",
            sessionId: "ptac-sentinel-session",
            prompt: "PTAC SR reachability smoke (no provider call).",
            leftSlot: "primary",
            rightSlot: "secondary",
            timeoutMs: 10_000,
        },
    ],
};

registerScenario(SCENARIO_S17);
