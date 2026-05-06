/**
 * PTAC scenario s10 — self-drive: Browser drives the dashboard shell.
 *
 * The first scenario that uses the new `browserDrive` step kind. Launches
 * a headless Playwright session via the dashboard's own browser-control
 * surface, navigates to the running PRISM dashboard root, and asserts
 * the shell renders by waiting for the canonical `#app` mount point.
 *
 * This proves the end-to-end loop:
 *
 *   PTAC → POST /api/browser/launch → Playwright → GET /
 *
 * is healthy. It's also the foundation that subsequent self-drive
 * scenarios (s11–s14) build on.
 *
 * Step plan:
 *
 *   1. PAD integrity at boot                              (padHashVerify)
 *   2. Launch headless browser session                    (browserDrive: launch)
 *   3. Navigate to the dashboard root                     (browserDrive: navigate)
 *   4. Wait for the #app mount point to render            (browserDrive: waitForSelector)
 *   5. Capture a screenshot for the run report            (browserDrive: screenshot)
 *   6. Close the browser session                          (browserDrive: close)
 *
 * Suites: full, demo. NOT in `fast` — Playwright launch adds ~1.5s and
 * we keep the `fast` suite under a few seconds total. `requiresHost: false`
 * — Playwright runs headless under Xvfb / standard CI.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S10: PtacScenario = {
    id: "s10-self-drive-browser-shell",
    title: "Self-drive — Browser launches and renders the dashboard shell",
    suites: ["full", "demo"],
    requiresHost: false,
    tags: ["self-drive", "browser", "dashboard", "smoke"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "browser-launch",
            label: "Launch a headless browser session",
            kind: "browserDrive",
            action: "launch",
            args: { headless: true },
            timeoutMs: 30_000,
        },
        {
            id: "browser-navigate-root",
            label: "Navigate to the dashboard root",
            kind: "browserDrive",
            action: "navigate",
            args: { url: "@dashboard" },
            timeoutMs: 15_000,
        },
        {
            id: "browser-wait-app",
            label: "Wait for #app mount point",
            kind: "browserDrive",
            action: "waitForSelector",
            args: { selector: "#app", timeoutMs: 10_000 },
            timeoutMs: 15_000,
        },
        {
            id: "browser-shell-screenshot",
            label: "Capture dashboard shell screenshot",
            kind: "browserDrive",
            action: "screenshot",
            timeoutMs: 10_000,
        },
        {
            id: "browser-close",
            label: "Close the browser session",
            kind: "browserDrive",
            action: "close",
            timeoutMs: 10_000,
        },
    ],
};

registerScenario(SCENARIO_S10);
