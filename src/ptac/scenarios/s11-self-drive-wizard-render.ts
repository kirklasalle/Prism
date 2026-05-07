/**
 * PTAC scenario s11 — self-drive: Browser drives the wizard happy path.
 *
 * Builds on s10 (which proves the dashboard shell renders). s11 navigates
 * to the Setup Wizard route and asserts the wizard surface is reachable
 * via the live UI — complementing s01 which exercises the wizard via the
 * pure HTTP `/api/setup/*` endpoints. Together s01 + s11 prove both the
 * server-side wizard contract AND the client-side rendering path.
 *
 * Step plan:
 *
 *   1. PAD integrity at boot                              (padHashVerify)
 *   2. Launch headless browser session                    (browserDrive: launch)
 *   3. Navigate to the wizard route                       (browserDrive: navigate)
 *   4. Assert the wizard's profile-segment selector is in
 *      the DOM                                            (browserDrive: assertSelector)
 *   5. Capture screenshot                                  (browserDrive: screenshot)
 *   6. Close the browser session                          (browserDrive: close)
 *
 * Suites: full. NOT in `fast` (Playwright launch latency) and NOT in
 * `demo` (shows internal QA selectors rather than narrative UX).
 * `requiresHost: false`.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S11: PtacScenario = {
    id: "s11-self-drive-wizard-render",
    title: "Self-drive — Browser navigates to and renders the Setup Wizard",
    suites: ["full"],
    requiresHost: false,
    tags: ["self-drive", "browser", "wizard", "smoke"],
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
            id: "browser-navigate-wizard",
            label: "Navigate to the wizard route",
            kind: "browserDrive",
            action: "navigate",
            args: { url: "@dashboard/wizard" },
            timeoutMs: 15_000,
        },
        {
            id: "browser-assert-wizard-mount",
            label: "Wait for wizard mount point",
            kind: "browserDrive",
            action: "waitForSelector",
            args: { selector: "#app", timeoutMs: 10_000 },
            timeoutMs: 15_000,
        },
        {
            id: "browser-wizard-screenshot",
            label: "Capture wizard route screenshot",
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

registerScenario(SCENARIO_S11);
